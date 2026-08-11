import { temperatureTelemetrySchema } from '@smart-house/contracts';
import {
  normalizeTelemetry,
  type NormalizedTelemetry,
} from './telemetry-normalizer';
import { WorkerService } from './worker.service';

const telemetryPayload = {
  schemaVersion: '1.0' as const,
  messageId: 'message-1',
  tenantId: 'demo',
  deviceId: 'sensor-1',
  deviceType: 'temperature_sensor' as const,
  occurredAt: '2026-01-01T00:00:00.000Z',
  metrics: { temperature: { value: 68, unit: 'fahrenheit' as const } },
};

const currentTelemetryPayload = () => ({
  ...telemetryPayload,
  occurredAt: new Date().toISOString(),
});

const commandAckPayload = {
  schemaVersion: '1.0' as const,
  messageId: 'ack-1',
  commandId: 'command-1',
  tenantId: 'demo',
  deviceId: 'relay-1',
  status: 'acknowledged' as const,
  occurredAt: '2026-01-01T00:01:00.000Z',
  result: { state: 'on' as const },
};

const normalize = (): NormalizedTelemetry =>
  normalizeTelemetry(temperatureTelemetrySchema.parse(telemetryPayload), {
    receivedAt: new Date('2026-01-01T00:01:00.000Z'),
    maxFutureSkewMs: 5 * 60_000,
    lateAfterMs: 24 * 60 * 60_000,
    maxPastAgeMs: 7 * 24 * 60 * 60_000,
  });

type TransactionOptions = {
  catalogMetrics?: string[];
  commitError?: Error;
  deviceType?: string;
  insertError?: Error;
  rowCount?: number;
};

function setupTransaction(options: TransactionOptions = {}) {
  const release = jest.fn();
  const query = jest.fn(async (statement: string, _parameters?: unknown[]) => {
    void _parameters;
    await Promise.resolve();
    if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rows: [] };
    if (statement === 'COMMIT') {
      if (options.commitError) throw options.commitError;
      return { rows: [] };
    }
    if (statement.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (statement.includes('SELECT id FROM organizations')) {
      return { rows: [{ id: 'organization-1' }] };
    }
    if (statement.includes('INSERT INTO devices')) {
      return {
        rows: [
          {
            id: 'device-1',
            type: options.deviceType ?? 'temperature_sensor',
            capabilityVersion: 'v1',
          },
        ],
      };
    }
    if (statement.includes('device_capability_catalog')) {
      return { rows: [{ metrics: options.catalogMetrics ?? ['temperature'] }] };
    }
    if (statement.includes('INSERT INTO telemetry_records')) {
      if (options.insertError) throw options.insertError;
      return { rowCount: options.rowCount ?? 1, rows: [] };
    }
    if (statement.includes('FROM alert_rules')) return { rows: [] };
    if (statement.includes('INSERT INTO alerts')) {
      return { rowCount: 1, rows: [] };
    }
    if (statement.includes('INSERT INTO outbox_events')) {
      return { rowCount: 1, rows: [] };
    }
    if (statement.includes('UPDATE devices')) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  const client = { query, release };
  const connect = jest.fn().mockResolvedValue(client);
  const poolQuery = jest.fn();
  const publish = jest.fn().mockResolvedValue(1);
  const service = new WorkerService();
  (
    service as unknown as {
      database: { connect: jest.Mock; query: jest.Mock };
    }
  ).database = { connect, query: poolQuery };
  (service as unknown as { redis: { publish: jest.Mock } }).redis = { publish };

  return { service, client, connect, poolQuery, publish, query, release };
}

async function persist(
  service: WorkerService,
  telemetry: NormalizedTelemetry = normalize(),
) {
  return (
    service as unknown as {
      persist: (value: NormalizedTelemetry) => Promise<void>;
    }
  ).persist(telemetry);
}

type RelayRow = {
  id: string;
  payload: Record<string, unknown>;
};

type RedisTransaction = {
  exec: () => Promise<Array<[Error | null, unknown]> | null | undefined>;
  publish: (channel: string, payload: string) => RedisTransaction;
  xadd: (
    key: string,
    id: string,
    field: string,
    payload: string,
  ) => RedisTransaction;
};

function setupRelay(
  rows: RelayRow[],
  deliveries: Array<Array<[Error | null, unknown]> | null | Error> = [
    [
      [null, '1-0'],
      [null, 1],
    ],
  ],
  options: { markError?: Error } = {},
) {
  const release = jest.fn();
  const updates: string[] = [];
  const publishCalls: Array<[string, string]> = [];
  const xaddCalls: Array<[string, string, string, string]> = [];
  const query = jest.fn(async (statement: string, parameters?: unknown[]) => {
    await Promise.resolve();
    if (
      statement === 'BEGIN' ||
      statement === 'COMMIT' ||
      statement === 'ROLLBACK'
    ) {
      return { rows: [] };
    }
    if (statement.includes('SELECT id, payload')) return { rows };
    if (statement.includes('UPDATE outbox_events')) {
      if (options.markError) throw options.markError;
      updates.push((parameters as string[])[0]);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  });
  const exec = jest.fn(() => {
    const delivery = deliveries.shift();
    if (delivery instanceof Error) return Promise.reject(delivery);
    return Promise.resolve(delivery);
  });
  const transaction: RedisTransaction = {
    exec,
    publish(channel, payload) {
      publishCalls.push([channel, payload]);
      return transaction;
    },
    xadd(key, id, field, payload) {
      xaddCalls.push([key, id, field, payload]);
      return transaction;
    },
  };
  const multi = jest.fn(() => transaction);
  const service = new WorkerService();
  (service as unknown as { database: { connect: jest.Mock } }).database = {
    connect: jest.fn().mockResolvedValue({ query, release }),
  };
  (service as unknown as { redis: { multi: jest.Mock } }).redis = { multi };

  return {
    exec,
    multi,
    publishCalls,
    query,
    release,
    service,
    updates,
    xaddCalls,
  };
}

async function relay(service: WorkerService) {
  return (
    service as unknown as { relayOutboxBatch: () => Promise<void> }
  ).relayOutboxBatch();
}

function parseEvent(payload: string): Record<string, unknown> {
  const event: unknown = JSON.parse(payload);
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new Error('Expected an event object.');
  }
  return event as Record<string, unknown>;
}

describe('WorkerService', () => {
  it('is constructible before an MQTT adapter is configured', () => {
    expect(new WorkerService()).toBeInstanceOf(WorkerService);
  });

  it('accepts a valid telemetry message on its matching tenant topic', async () => {
    const service = new WorkerService();
    const persistTelemetry = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { persist: jest.Mock }).persist = persistTelemetry;

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/sensor-1/telemetry',
      Buffer.from(JSON.stringify(currentTelemetryPayload())),
    );

    expect(persistTelemetry).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid telemetry payload before persistence', async () => {
    const service = new WorkerService();
    const persistTelemetry = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn();
    (service as unknown as { persist: jest.Mock }).persist = persistTelemetry;
    (service as unknown as { logger: { warn: jest.Mock } }).logger = { warn };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/sensor-1/telemetry',
      Buffer.from('{"not":"telemetry"}'),
    );

    expect(persistTelemetry).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected telemetry'),
    );
  });

  it.each([
    ['malformed JSON', Buffer.from('{not-json')],
    ['an oversized payload', Buffer.alloc(8 * 1024 + 1, 'a')],
  ])(
    'rejects %s without interrupting subsequent telemetry',
    async (_name, payload) => {
      const service = new WorkerService();
      const persistTelemetry = jest.fn().mockResolvedValue(undefined);
      const warn = jest.fn();
      (service as unknown as { persist: jest.Mock }).persist = persistTelemetry;
      (service as unknown as { logger: { warn: jest.Mock } }).logger = {
        warn,
      };

      const consume = (
        service as unknown as {
          consume: (topic: string, body: Buffer) => Promise<void>;
        }
      ).consume.bind(service);
      await consume('tenants/demo/devices/sensor-1/telemetry', payload);
      await consume(
        'tenants/demo/devices/sensor-1/telemetry',
        Buffer.from(JSON.stringify(currentTelemetryPayload())),
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Rejected telemetry'),
      );
      expect(persistTelemetry).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['tenants/other/devices/sensor-1/telemetry', telemetryPayload],
    ['tenants/demo/devices/another-sensor/telemetry', telemetryPayload],
    [
      'tenants/demo/devices/sensor-1/telemetry',
      { ...telemetryPayload, tenantId: 'other' },
    ],
  ])('rejects a tenant or topic mismatch for %s', async (topic, payload) => {
    const service = new WorkerService();
    const persistTelemetry = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn();
    (service as unknown as { persist: jest.Mock }).persist = persistTelemetry;
    (service as unknown as { logger: { warn: jest.Mock } }).logger = { warn };

    await (
      service as unknown as {
        consume: (messageTopic: string, body: Buffer) => Promise<void>;
      }
    ).consume(topic, Buffer.from(JSON.stringify(payload)));

    expect(persistTelemetry).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('topic or tenant does not match'),
    );
  });

  it('records a matching command acknowledgement from pending or sent idempotently', async () => {
    const release = jest.fn();
    const query = jest.fn((statement: string, _parameters?: unknown[]) => {
      void _parameters;
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes('FROM commands c')) {
        return {
          rows: [
            {
              organizationId: 'organization-1',
              deviceId: 'device-1',
              externalId: 'relay-1',
              tenantId: 'demo',
              status: 'sent',
            },
          ],
        };
      }
      if (statement.includes('SET status = $2'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'command-1',
              organizationId: 'organization-1',
              deviceId: 'device-1',
              type: 'relay.set',
              status: 'acknowledged',
              expiresAt: '2026-01-01T00:05:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
              error: null,
            },
          ],
        };
      if (statement.includes('INSERT INTO outbox_events'))
        return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release }),
    };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/relay-1/command-acks',
      Buffer.from(JSON.stringify(commandAckPayload)),
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('pending', 'sent')"),
      ['command-1', 'acknowledged', null],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO outbox_events'),
      [
        expect.any(String),
        'organization-1',
        'command.status',
        expect.objectContaining({
          organizationId: 'organization-1',
          deviceId: 'device-1',
          // Jest matchers intentionally return unknown-shaped values.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          command: expect.objectContaining({
            id: 'command-1',
            status: 'acknowledged',
          }),
        }),
      ],
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('persists a device failure detail with a failed acknowledgement', async () => {
    const release = jest.fn();
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes('FROM commands c')) {
        return {
          rows: [
            {
              organizationId: 'organization-1',
              deviceId: 'device-1',
              externalId: 'relay-1',
              tenantId: 'demo',
              status: 'sent',
            },
          ],
        };
      }
      if (statement.includes('SET status = $2'))
        return {
          rowCount: 1,
          rows: [
            {
              id: 'command-1',
              organizationId: 'organization-1',
              deviceId: 'device-1',
              type: 'relay.set',
              status: 'failed',
              expiresAt: '2026-01-01T00:05:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
              error: { code: 'RELAY_OFFLINE', message: 'Relay is offline.' },
            },
          ],
        };
      if (statement.includes('INSERT INTO outbox_events'))
        return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release }),
    };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/relay-1/command-acks',
      Buffer.from(
        JSON.stringify({
          ...commandAckPayload,
          status: 'failed',
          error: { code: 'RELAY_OFFLINE', message: 'Relay is offline.' },
        }),
      ),
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('error = $3::jsonb'),
      [
        'command-1',
        'failed',
        JSON.stringify({ code: 'RELAY_OFFLINE', message: 'Relay is offline.' }),
      ],
    );
  });

  it('does not change a command already finalized by a duplicate acknowledgement', async () => {
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes('FROM commands c')) {
        return {
          rows: [
            {
              organizationId: 'organization-1',
              deviceId: 'device-1',
              externalId: 'relay-1',
              tenantId: 'demo',
              status: 'acknowledged',
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
    };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/relay-1/command-acks',
      Buffer.from(JSON.stringify(commandAckPayload)),
    );

    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes('SET status = $2'),
      ),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it.each([
    ['an unknown command', { rows: [] }],
    [
      'a cross-tenant acknowledgement',
      {
        rows: [
          {
            organizationId: 'organization-1',
            deviceId: 'device-1',
            externalId: 'relay-1',
            tenantId: 'other',
            status: 'sent',
          },
        ],
      },
    ],
  ])('rejects and logs %s', async (_name, commandResult) => {
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'ROLLBACK')
        return { rows: [] };
      if (statement.includes('FROM commands c')) return commandResult;
      throw new Error(`Unexpected query: ${statement}`);
    });
    const warn = jest.fn();
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
    };
    (service as unknown as { logger: { warn: jest.Mock } }).logger = { warn };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/relay-1/command-acks',
      Buffer.from(JSON.stringify(commandAckPayload)),
    );

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected command acknowledgement'),
    );
    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes('SET status = $2'),
      ),
    ).toBe(false);
  });

  it('rejects malformed command acknowledgements before database access', async () => {
    const service = new WorkerService();
    const warn = jest.fn();
    (service as unknown as { logger: { warn: jest.Mock } }).logger = { warn };

    await (
      service as unknown as {
        consume: (topic: string, payload: Buffer) => Promise<void>;
      }
    ).consume(
      'tenants/demo/devices/relay-1/command-acks',
      Buffer.from('{"commandId":"command-1"}'),
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected command acknowledgement'),
    );
  });

  it('commits telemetry and its outbox event atomically on one client', async () => {
    const { connect, poolQuery, publish, query, release, service } =
      setupTransaction();

    await persist(service);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    const commitCall = query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    const presenceCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes('UPDATE devices'),
    );
    expect(presenceCall).toBeGreaterThan(-1);
    const outboxCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes('INSERT INTO outbox_events'),
    );
    expect(outboxCall).toBeGreaterThan(presenceCall);
    expect(commitCall).toBeGreaterThan(outboxCall);
    const outboxParameters = query.mock.calls[outboxCall]?.[1] as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(typeof outboxParameters[0]).toBe('string');
    expect(outboxParameters[1]).toBe('organization-1');
    expect(outboxParameters[2]).toBe('telemetry.persisted');
    expect(outboxParameters[3]).toMatchObject({
      correlationId: 'message-1',
      organizationId: 'organization-1',
    });
    expect(outboxParameters[0]).toBe(outboxParameters[3].eventId);
  });

  it('persists canonical Celsius with source and time metadata', async () => {
    const { query, service } = setupTransaction();

    await persist(service);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('source_value'),
      [
        'organization-1',
        'device-1',
        'message-1',
        'temperature',
        20,
        'celsius',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:01:00.000Z',
        '1.0',
        68,
        'fahrenheit',
        'on_time',
      ],
    );
  });

  it('evaluates newly persisted readings in the telemetry transaction', async () => {
    const { query, service } = setupTransaction();

    await persist(service);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM alert_rules'),
      ['organization-1', 'device-1', 'temperature'],
    );
    const alertCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes('FROM alert_rules'),
    );
    const commitCall = query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(alertCall).toBeGreaterThan(-1);
    expect(commitCall).toBeGreaterThan(alertCall);
    expect(query.mock.calls[alertCall][0]).toContain('FOR UPDATE');
  });

  it('starts the duration clock before opening and opens after it has elapsed', async () => {
    const rule: {
      id: string;
      name: string;
      metric: string;
      operator: 'gt';
      threshold: number;
      severity: 'high';
      durationSeconds: number;
      hysteresis: number;
      cooldownSeconds: number;
      conditionStartedAt: string | null;
    } = {
      id: 'rule-1',
      name: 'High temperature',
      metric: 'temperature',
      operator: 'gt',
      threshold: 30,
      severity: 'high',
      durationSeconds: 60,
      hysteresis: 0,
      cooldownSeconds: 0,
      conditionStartedAt: null,
    };
    const query = jest.fn((statement: string) => {
      if (statement.includes('FROM alert_rules')) return { rows: [rule] };
      if (statement.includes('SELECT id FROM alerts')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const service = new WorkerService();
    const evaluate = (observedAt: string) =>
      (
        service as unknown as {
          evaluateThresholdAlerts: (
            client: { query: jest.Mock },
            organizationId: string,
            deviceId: string,
            metric: string,
            value: number,
            time: string,
          ) => Promise<void>;
        }
      ).evaluateThresholdAlerts(
        { query },
        'organization-1',
        'device-1',
        'temperature',
        31,
        observedAt,
      );

    await evaluate('2026-01-01T00:00:00.000Z');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO alerts')),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('condition_started_at = $3'),
      ['rule-1', 'organization-1', '2026-01-01T00:00:00.000Z'],
    );

    query.mockClear();
    rule.conditionStartedAt = '2026-01-01T00:00:00.000Z';
    await evaluate('2026-01-01T00:01:00.000Z');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alerts'),
      ['rule-1', 'organization-1', 'device-1', 31, '2026-01-01T00:01:00.000Z'],
    );
  });

  it('uses hysteresis to retain an open incident until the recovery threshold is crossed', async () => {
    const rule = {
      id: 'rule-1',
      name: 'High temperature',
      metric: 'temperature',
      operator: 'gt',
      threshold: 30,
      severity: 'high',
      durationSeconds: 0,
      hysteresis: 2,
      cooldownSeconds: 0,
      conditionStartedAt: '2026-01-01T00:00:00.000Z',
    };
    const query = jest.fn((statement: string) => {
      if (statement.includes('FROM alert_rules')) return { rows: [rule] };
      if (statement.includes('SELECT id FROM alerts'))
        return { rows: [{ id: 'alert-1' }] };
      return { rows: [], rowCount: 1 };
    });
    const service = new WorkerService();
    const evaluate = (value: number) =>
      (
        service as unknown as {
          evaluateThresholdAlerts: (
            client: { query: jest.Mock },
            organizationId: string,
            deviceId: string,
            metric: string,
            value: number,
            time: string,
          ) => Promise<void>;
        }
      ).evaluateThresholdAlerts(
        { query },
        'organization-1',
        'device-1',
        'temperature',
        value,
        '2026-01-01T00:01:00.000Z',
      );

    await evaluate(29);
    expect(
      query.mock.calls.some(([sql]) => sql.includes("SET state = 'resolved'")),
    ).toBe(false);
    query.mockClear();
    await evaluate(28);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'resolved'"),
      ['organization-1', 'rule-1', 'device-1', '2026-01-01T00:01:00.000Z'],
    );
  });

  it('applies cooldown when opening a new incident for a resolved rule', async () => {
    const query = jest.fn((statement: string) => {
      if (statement.includes('FROM alert_rules')) {
        return {
          rows: [
            {
              id: 'rule-1',
              name: 'High temperature',
              metric: 'temperature',
              operator: 'gt',
              threshold: 30,
              severity: 'high',
              durationSeconds: 0,
              hysteresis: 0,
              cooldownSeconds: 300,
              conditionStartedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (statement.includes('SELECT id FROM alerts')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const service = new WorkerService();
    await (
      service as unknown as {
        evaluateThresholdAlerts: (
          client: { query: jest.Mock },
          organizationId: string,
          deviceId: string,
          metric: string,
          value: number,
          time: string,
        ) => Promise<void>;
      }
    ).evaluateThresholdAlerts(
      { query },
      'organization-1',
      'device-1',
      'temperature',
      31,
      '2026-01-01T00:01:00.000Z',
    );

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO alerts'),
    );
    expect(insert?.[0]).toContain("a.state = 'resolved'");
    expect(insert?.[0]).toContain("r.cooldown_seconds * interval '1 second'");
  });

  it('commits duplicate telemetry without presence, outbox, or Redis side effects', async () => {
    const { publish, query, release, service } = setupTransaction({
      rowCount: 0,
    });

    await persist(service);

    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE devices')),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO outbox_events'),
      ),
    ).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an insert failure', { insertError: new Error('insert failed') }],
    ['a commit failure', { commitError: new Error('commit failed') }],
  ])(
    'rolls back without an external delivery after %s',
    async (_name, options) => {
      const { publish, query, release, service } = setupTransaction(options);

      await expect(persist(service)).rejects.toThrow('failed');

      expect(query).toHaveBeenCalledWith('ROLLBACK');
      expect(publish).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it('rolls back unsupported capabilities without inserting or publishing', async () => {
    const { publish, query, release, service } = setupTransaction({
      catalogMetrics: [],
    });

    await expect(persist(service)).rejects.toThrow('metric not supported');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO telemetry_records'),
      ),
    ).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back telemetry whose type differs from the registered device', async () => {
    const { publish, query, service } = setupTransaction({
      deviceType: 'relay',
    });

    await expect(persist(service)).rejects.toThrow('type does not match');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(publish).not.toHaveBeenCalled();
  });

  it('relays pending events in deterministic database order', async () => {
    const rows = [
      { id: 'event-1', payload: { correlationId: 'message-1' } },
      { id: 'event-2', payload: { correlationId: 'message-2' } },
    ];
    const { publishCalls, query, service, updates } = setupRelay(rows, [
      [
        [null, '1-0'],
        [null, 1],
      ],
      [
        [null, '2-0'],
        [null, 1],
      ],
    ]);

    await relay(service);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at, id'),
      [
        [
          'telemetry.persisted',
          'command.status',
          'alert.status',
          'notification.inbox',
        ],
        100,
      ],
    );
    expect(updates).toEqual(['event-1', 'event-2']);
    expect(
      publishCalls.map(([, payload]) => parseEvent(payload).eventId),
    ).toEqual(['event-1', 'event-2']);
  });

  it('sends an equal stable-ID envelope to the Stream and PubSub', async () => {
    const { publishCalls, service, xaddCalls } = setupRelay([
      {
        id: 'outbox-1',
        payload: { eventId: 'stale', correlationId: 'message-1' },
      },
    ]);

    await relay(service);

    expect(xaddCalls).toHaveLength(1);
    expect(xaddCalls[0]?.slice(0, 3)).toEqual([
      'telemetry.persisted.stream',
      '*',
      'event',
    ]);
    expect(publishCalls).toEqual([['telemetry.persisted', xaddCalls[0]?.[3]]]);
    expect(parseEvent(xaddCalls[0]?.[3] ?? '')).toMatchObject({
      eventId: 'outbox-1',
      correlationId: 'message-1',
    });
  });

  it('marks an outbox event only after Redis delivery succeeds', async () => {
    const { exec, query, service } = setupRelay([
      { id: 'event-1', payload: { correlationId: 'message-1' } },
    ]);

    await relay(service);

    const updateCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes('UPDATE outbox_events'),
    );
    expect(exec.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[updateCall],
    );
  });

  it('leaves a Redis delivery failure pending', async () => {
    const row = { id: 'event-1', payload: { correlationId: 'message-1' } };
    const first = setupRelay([row], [new Error('redis unavailable')]);

    await expect(relay(first.service)).rejects.toThrow('redis unavailable');

    expect(first.updates).toEqual([]);
    expect(first.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('retries a delivered event with the same ID after database marking fails', async () => {
    const row = { id: 'event-1', payload: { correlationId: 'message-1' } };
    const first = setupRelay([row], undefined, {
      markError: new Error('database unavailable'),
    });

    await expect(relay(first.service)).rejects.toThrow('database unavailable');

    expect(first.updates).toEqual([]);
    expect(first.query).toHaveBeenCalledWith('ROLLBACK');
    expect(parseEvent(first.publishCalls[0]?.[1] ?? '').eventId).toBe(
      'event-1',
    );

    const retry = setupRelay([row]);
    await relay(retry.service);

    expect(retry.updates).toEqual(['event-1']);
    expect(parseEvent(retry.publishCalls[0]?.[1] ?? '').eventId).toBe(
      'event-1',
    );
  });

  it('publishes a pending relay command at QoS 1 before marking it sent', async () => {
    const command = {
      schemaVersion: '1.0' as const,
      commandId: 'command-1',
      nonce: 'nonce-1',
      tenantId: 'demo',
      deviceId: 'relay-1',
      commandType: 'relay.set' as const,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:05:00.000Z',
      payload: { state: 'on' as const },
    };
    const release = jest.fn();
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes('SELECT e.id, e.payload')) {
        return { rows: [{ id: 'outbox-1', payload: command }] };
      }
      if (statement.includes('UPDATE commands')) {
        return { rowCount: 1, rows: [{ status: 'sent' }] };
      }
      if (statement.includes('INSERT INTO outbox_events')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes('UPDATE outbox_events')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const publish = jest.fn(
      (_topic, _payload, _options, callback: (error?: Error) => void) =>
        callback(),
    );
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release }),
    };
    (service as unknown as { mqtt: { publish: jest.Mock } }).mqtt = { publish };

    await (
      service as unknown as { relayCommandOutboxBatch: () => Promise<void> }
    ).relayCommandOutboxBatch();

    expect(publish).toHaveBeenCalledWith(
      'tenants/demo/devices/relay-1/commands',
      JSON.stringify(command),
      { qos: 1 },
      expect.any(Function),
    );
    const sentCall = query.mock.calls.findIndex(([statement]) =>
      statement.includes('UPDATE commands'),
    );
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[sentCall],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('leaves a command pending when its QoS 1 publish fails', async () => {
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'ROLLBACK') {
        return { rows: [] };
      }
      if (statement.includes('SELECT e.id, e.payload')) {
        return {
          rows: [
            {
              id: 'outbox-1',
              payload: {
                schemaVersion: '1.0',
                commandId: 'command-1',
                nonce: 'nonce-1',
                tenantId: 'demo',
                deviceId: 'relay-1',
                commandType: 'relay.set',
                issuedAt: '2026-01-01T00:00:00.000Z',
                expiresAt: '2026-01-01T00:05:00.000Z',
                payload: { state: 'on' },
              },
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
    };
    (service as unknown as { mqtt: { publish: jest.Mock } }).mqtt = {
      publish: jest.fn(
        (_topic, _payload, _options, callback: (error?: Error) => void) =>
          callback(new Error('broker unavailable')),
      ),
    };

    await expect(
      (
        service as unknown as {
          relayCommandOutboxBatch: () => Promise<void>;
        }
      ).relayCommandOutboxBatch(),
    ).rejects.toThrow('broker unavailable');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes('UPDATE commands'),
      ),
    ).toBe(false);
  });

  it('opens offline alerts once for a real online-to-offline transition', async () => {
    const service = new WorkerService();
    let transitions = 0;
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes("SET status = 'offline'")) {
        transitions += 1;
        return transitions === 1
          ? {
              rowCount: 1,
              rows: [{ organizationId: 'organization-1', id: 'device-1' }],
            }
          : { rowCount: 0, rows: [] };
      }
      if (statement.includes('INSERT INTO alerts'))
        return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const connect = jest.fn().mockResolvedValue({ query, release: jest.fn() });
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect,
    };

    await (
      service as unknown as { reconcileDeviceStatuses: () => Promise<void> }
    ).reconcileDeviceStatuses();
    await (
      service as unknown as { reconcileDeviceStatuses: () => Promise<void> }
    ).reconcileDeviceStatuses();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'offline'"),
      [90],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "ON CONFLICT (rule_id, device_id) WHERE state = 'open'",
      ),
      ['organization-1', 'device-1'],
    );
    expect(
      query.mock.calls.filter(([statement]) =>
        statement.includes('INSERT INTO alerts'),
      ),
    ).toHaveLength(1);
  });

  it('resolves open offline alerts when a device reconnects', async () => {
    const query = jest.fn((statement: string) => {
      if (statement.includes('WITH previous AS')) {
        return { rows: [{ previousStatus: 'offline', status: 'online' }] };
      }
      if (statement.includes("SET state = 'resolved'")) return { rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();

    await (
      service as unknown as {
        updateDevicePresence: (
          client: { query: jest.Mock },
          organizationId: string,
          deviceId: string,
          occurredAt: string,
        ) => Promise<void>;
      }
    ).updateDevicePresence(
      { query },
      'organization-1',
      'device-1',
      '2026-01-01T00:02:00.000Z',
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.rule_type = 'device_offline'"),
      ['organization-1', 'device-1', '2026-01-01T00:02:00.000Z'],
    );
  });

  it('uses cooldown and open-alert uniqueness to suppress flapping storms', async () => {
    const query = jest.fn((statement: string, _parameters?: unknown[]) => {
      void _parameters;
      if (statement.includes('INSERT INTO alerts')) return { rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();

    await (
      service as unknown as {
        openDeviceOfflineAlerts: (
          client: { query: jest.Mock },
          organizationId: string,
          deviceId: string,
        ) => Promise<void>;
      }
    ).openDeviceOfflineAlerts({ query }, 'organization-1', 'device-1');

    const [statement, parameters] = query.mock.calls[0];
    expect(statement).toContain(
      "a.resolved_at > now() - (r.cooldown_seconds * interval '1 second')",
    );
    expect(statement).toContain(
      "ON CONFLICT (rule_id, device_id) WHERE state = 'open' DO NOTHING",
    );
    expect(parameters).toEqual(['organization-1', 'device-1']);
  });

  it('expires pending and sent commands and suppresses their unpublished outbox events', async () => {
    const release = jest.fn();
    const query = jest.fn((statement: string) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes("SET status = 'expired'")) {
        return {
          rows: [
            {
              id: 'command-1',
              organizationId: 'organization-1',
              deviceId: 'device-1',
              type: 'relay.set',
              status: 'expired',
              expiresAt: '2026-01-01T00:05:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
              error: null,
            },
          ],
        };
      }
      if (statement.includes('INSERT INTO outbox_events'))
        return { rowCount: 1, rows: [] };
      if (statement.includes('UPDATE outbox_events')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const service = new WorkerService();
    (service as unknown as { database: { connect: jest.Mock } }).database = {
      connect: jest.fn().mockResolvedValue({ query, release }),
    };

    await (
      service as unknown as {
        reconcileExpiredCommands: () => Promise<void>;
      }
    ).reconcileExpiredCommands();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('pending', 'sent')"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('id = ANY($2::uuid[])'),
      ['mqtt.command.publish', ['command-1']],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO outbox_events'),
      [
        expect.any(String),
        'organization-1',
        'command.status',
        expect.objectContaining({
          // Jest matchers intentionally return unknown-shaped values.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          command: expect.objectContaining({
            id: 'command-1',
            status: 'expired',
          }),
        }),
      ],
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled, out-of-order, and stale presence from moving backwards', async () => {
    const service = new WorkerService();
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query };

    await (
      service as unknown as {
        updateDevicePresence: (
          databaseClient: typeof client,
          organizationId: string,
          deviceId: string,
          occurredAt: string,
        ) => Promise<void>;
      }
    ).updateDevicePresence(
      client,
      'organization-1',
      'device-1',
      '2025-12-31T23:00:00.000Z',
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHEN d.status = 'disabled' THEN 'disabled'"),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('GREATEST(COALESCE(d.last_seen_at'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('$3::timestamptz >= COALESCE(d.last_seen_at'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("now() - ($4 * interval '1 second')"),
      expect.any(Array),
    );
  });
});
