import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import type { OrganizationsService } from '../organizations/organizations.service';

const query = jest.fn();
const end = jest.fn();
const connect = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, end, connect })),
}));

const identity = { subject: 'user-1', email: 'user@example.com', roles: [] };
const device = {
  id: 'device-1',
  externalId: 'relay-1',
  name: 'Kitchen relay',
  type: 'relay',
  capabilityVersion: 'v1',
  status: 'inactive',
  lastSeenAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DevicesService', () => {
  const requireMembership = jest.fn();
  const organizations = {
    requireMembership,
  } as unknown as OrganizationsService;
  let service: DevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DevicesService(organizations);
  });

  it('lists devices only after confirming active organization membership', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValue({ rows: [device] });

    await expect(service.list(identity, 'organization-1')).resolves.toEqual({
      items: [device],
      nextCursor: null,
    });

    expect(requireMembership).toHaveBeenCalledWith(identity, 'organization-1');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY name, external_id, id'),
      ['organization-1', 26],
    );
  });

  it('parameterizes inventory filters and returns a stable next cursor', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValue({ rows: [device, { ...device, id: 'device-2' }] });

    const result = await service.list(identity, 'organization-1', {
      q: "Kitchen' OR true --",
      status: 'inactive',
      type: 'relay',
      limit: 1,
    });

    expect(result.items).toEqual([device]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("name ILIKE '%' || $2 || '%'"),
      ['organization-1', "Kitchen' OR true --", 'inactive', 'relay', 2],
    );
    const [[sql]] = query.mock.calls as [string, unknown[]][];
    expect(sql).not.toContain("Kitchen' OR true --");
  });

  it('rejects an invalid inventory cursor after confirming membership', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });

    await expect(
      service.list(identity, 'organization-1', { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires membership and scoped device ownership before reading telemetry', async () => {
    requireMembership.mockRejectedValue(new ForbiddenException());

    await expect(
      service.telemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T01:00:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();

    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValue({ rows: [] });
    await expect(
      service.telemetry(identity, 'organization-1', 'foreign-device', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T01:00:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND id = $2'),
      ['organization-1', 'foreign-device'],
    );
  });

  it('uses the raw telemetry table for short ranges', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          occurredAt: new Date('2026-08-06T00:30:00.000Z'),
          value: 21.5,
          unit: 'celsius',
        },
      ],
    });

    await expect(
      service.telemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T01:00:00.000Z'),
        resolution: 'auto',
      }),
    ).resolves.toMatchObject({ resolution: 'raw', points: [{ value: 21.5 }] });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM telemetry_records'),
      [
        'organization-1',
        'device-1',
        'temperature',
        expect.any(Date),
        expect.any(Date),
      ],
    );
  });

  it('uses fixed aggregate routes and keeps relay state as last state', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query
      .mockResolvedValueOnce({ rows: [device] })
      .mockResolvedValueOnce({ rows: [] });

    await service.telemetry(identity, 'organization-1', 'device-1', {
      metric: 'relayState',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-06T00:00:00.000Z'),
      resolution: '5m',
    });

    const [sql] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('FROM telemetry_relay_5m');
    expect(sql).toContain('last_state');
    expect(sql).not.toContain('avg(');
  });

  it('rejects ranges that exceed their requested resolution', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValueOnce({ rows: [device] });

    await expect(
      service.telemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-03T00:00:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires membership and scoped device ownership before exporting telemetry', async () => {
    requireMembership.mockRejectedValue(new ForbiddenException());

    await expect(
      service.exportTelemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T00:30:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();

    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValue({ rows: [] });
    await expect(
      service.exportTelemetry(identity, 'organization-1', 'foreign-device', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T00:30:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND id = $2'),
      ['organization-1', 'foreign-device'],
    );
  });

  it('enforces export ranges and the explicit export row limit', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValueOnce({ rows: [device] });
    await expect(
      service.exportTelemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T02:00:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    query.mockReset();
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: Array.from({ length: 10_001 }, () => ({
        occurredAt: new Date('2026-08-06T00:00:00.000Z'),
        value: 1,
        unit: 'celsius',
      })),
    });
    await expect(
      service.exportTelemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T00:30:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toThrow('row limit');
    const [, [sql]] = query.mock.calls as [
      [string, unknown[]],
      [string, unknown[]],
    ];
    expect(sql).toContain('LIMIT 10001');
  });

  it('rate limits exports and audits allowed and denied attempts', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    for (let index = 0; index < 10; index += 1) {
      query
        .mockResolvedValueOnce({ rows: [device] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await service.exportTelemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T00:30:00.000Z'),
        resolution: 'raw',
      });
    }
    query
      .mockResolvedValueOnce({ rows: [device] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      service.exportTelemetry(identity, 'organization-1', 'device-1', {
        metric: 'temperature',
        from: new Date('2026-08-06T00:00:00.000Z'),
        to: new Date('2026-08-06T00:30:00.000Z'),
        resolution: 'raw',
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['device.telemetry.export', 'allowed']),
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['device.telemetry.export', 'denied']),
    );
  });

  it('rejects device creation by non-manager roles', async () => {
    requireMembership.mockResolvedValue({ role: 'operator' });

    await expect(
      service.create(identity, 'organization-1', {
        externalId: 'relay-1',
        name: 'Kitchen relay',
        type: 'relay',
        capabilityVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('updates only a device belonging to the requested organization', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({ rows: [device] });

    await service.update(identity, 'organization-1', 'device-1', {
      name: 'New name',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND id = $2'),
      ['organization-1', 'device-1', 'New name'],
    );
  });

  it('reports a missing scoped device when disabling it', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValue({ rows: [] });

    await expect(
      service.disable(identity, 'organization-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects registration against a type/version absent from the catalog', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({ rows: [] });

    await expect(
      service.create(identity, 'organization-1', {
        externalId: 'unknown-1',
        name: 'Unknown',
        type: 'unknown',
        capabilityVersion: 'v1',
      }),
    ).rejects.toThrow('No capability catalog exists');
  });

  it('rejects commands that are not in the registered device catalog', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          type: 'relay',
          version: 'v1',
          metrics: ['relayState'],
          commands: ['relay.set'],
        },
      ],
    });

    await expect(
      service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.reset',
        {},
      ),
    ).rejects.toThrow('not supported');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('atomically queues a versioned relay command with its actor audit record', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    const release = jest.fn();
    query.mockImplementation((statement: string) => {
      if (statement.includes('FROM devices WHERE')) return { rows: [device] };
      if (statement.includes('device_capability_catalog')) {
        return { rows: [{ commands: ['relay.set'] }] };
      }
      if (statement === 'BEGIN' || statement === 'COMMIT') return { rows: [] };
      if (statement.includes('mqtt_tenant_id')) {
        return { rows: [{ tenantId: 'demo' }] };
      }
      if (statement.includes('WITH command AS')) {
        return {
          rows: [
            {
              id: 'command-1',
              type: 'relay.set',
              status: 'pending',
              expiresAt: '2026-01-01T00:05:00.000Z',
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    connect.mockResolvedValue({ query, release });

    await expect(
      service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.set',
        { state: 'on' },
        true,
      ),
    ).resolves.toEqual({
      id: 'command-1',
      type: 'relay.set',
      status: 'pending',
      expiresAt: '2026-01-01T00:05:00.000Z',
    });

    const calls = query.mock.calls as unknown as Array<
      [string, unknown[] | undefined]
    >;
    const commandCall = calls.find(([statement]) =>
      statement.includes('WITH command AS'),
    );
    if (!commandCall?.[1]) throw new Error('Command query was not made.');
    const [statement, parameters] = commandCall;
    expect(statement).toContain('requested_by');
    expect(statement).toContain('INSERT INTO audit_events');
    expect(statement).toContain("'mqtt.command.publish'");
    const payload: unknown = JSON.parse(parameters[5] as string);
    expect(payload).toMatchObject({
      schemaVersion: '1.0',
      tenantId: 'demo',
      deviceId: 'relay-1',
      commandType: 'relay.set',
      payload: { state: 'on' },
    });
    expect((payload as { commandId: string }).commandId).toBe(parameters[0]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('permits operators to issue confirmed commands and audits denied attempts', async () => {
    requireMembership.mockResolvedValue({ role: 'operator' });
    query
      .mockResolvedValueOnce({ rows: [device] })
      .mockResolvedValueOnce({ rows: [{ commands: ['relay.set'] }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.set',
        { state: 'on' },
      ),
    ).rejects.toThrow('explicit confirmation');
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining([
        'denied',
        expect.stringContaining('confirmation_required'),
      ]),
    );
  });

  it('rate limits excessive command attempts and audits the denial', async () => {
    requireMembership.mockResolvedValue({ role: 'operator' });
    for (let index = 0; index < 5; index += 1) {
      const release = jest.fn();
      query.mockImplementation((statement: string) => {
        if (statement.includes('FROM devices WHERE')) return { rows: [device] };
        if (statement.includes('device_capability_catalog'))
          return { rows: [{ commands: ['relay.set'] }] };
        if (statement === 'BEGIN' || statement === 'COMMIT')
          return { rows: [] };
        if (statement.includes('mqtt_tenant_id'))
          return { rows: [{ tenantId: 'demo' }] };
        if (statement.includes('WITH command AS'))
          return {
            rows: [
              {
                id: `command-${index}`,
                type: 'relay.set',
                status: 'pending',
                expiresAt: '2026-01-01T00:05:00.000Z',
              },
            ],
          };
        throw new Error(`Unexpected query: ${statement}`);
      });
      connect.mockResolvedValue({ query, release });
      await service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.set',
        { state: 'on' },
        true,
      );
    }
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [device] })
      .mockResolvedValueOnce({ rows: [{ commands: ['relay.set'] }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.set',
        { state: 'on' },
        true,
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining([
        'denied',
        expect.stringContaining('rate_limited'),
      ]),
    );
  });

  it('returns only scoped command status, expiry, and ACK errors to members', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query
      .mockResolvedValueOnce({ rows: [device] })
      .mockResolvedValueOnce({ rows: [{ commands: ['relay.set'] }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'command-1',
            type: 'relay.set',
            status: 'failed',
            expiresAt: '2026-01-01T00:05:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            error: { code: 'RELAY_OFFLINE', message: 'Relay is offline.' },
          },
        ],
      });

    await expect(
      service.commands(identity, 'organization-1', 'device-1'),
    ).resolves.toEqual({
      supportedCommands: ['relay.set'],
      items: [
        {
          id: 'command-1',
          type: 'relay.set',
          status: 'failed',
          expiresAt: '2026-01-01T00:05:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          error: { code: 'RELAY_OFFLINE', message: 'Relay is offline.' },
        },
      ],
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND device_id = $2'),
      ['organization-1', 'device-1'],
    );
  });

  it('exchanges a valid activation token once and returns only non-secret references', async () => {
    query.mockResolvedValue({
      rows: [{ credentialReference: 'credential-1', deviceId: 'device-1' }],
    });

    await expect(
      service.exchangeActivationToken('token', 'device-1'),
    ).resolves.toEqual({
      deviceIdentity: 'device:device-1',
      credentialReference: 'credential-1',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('consumed_at IS NULL AND expires_at > now()'),
      [expect.any(String), 'device-1'],
    );
  });

  it('rejects a replayed activation token and writes a denial audit event', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-1',
            deviceId: 'device-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('replayed', 'device-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['organization-1', 'denied']),
    );
  });

  it('rejects an expired activation token', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-1',
            deviceId: 'device-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('expired', 'device-1'),
    ).rejects.toThrow('invalid, expired, or already used');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('expires_at > now()'),
      [expect.any(String), 'device-1'],
    );
  });

  it('rejects a token presented for a device in another tenant', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-a',
            deviceId: 'device-a',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('tenant-a-token', 'device-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['organization-a', 'denied']),
    );
  });

  it('lists credential metadata without selecting secrets', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          credentialReference: 'credential-1',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          status: 'active',
        },
      ],
    });

    await expect(
      service.listCredentials(identity, 'organization-1', 'device-1'),
    ).resolves.toHaveLength(1);
    expect(query).toHaveBeenLastCalledWith(
      expect.not.stringContaining('thumbprint'),
      ['organization-1', 'device-1'],
    );
  });

  it('rotates credentials by revoking active records and issuing one activation token', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          expiresAt: '2026-01-01T00:15:00.000Z',
          revokedCredentialReferences: ['credential-1'],
        },
      ],
    });

    await expect(
      service.rotateCredentials(identity, 'organization-1', 'device-1'),
    ).resolves.toMatchObject({
      deviceId: 'device-1',
      expiresAt: '2026-01-01T00:15:00.000Z',
      revokedCredentialReferences: ['credential-1'],
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("'device.credential.rotate'"),
      ['organization-1', 'device-1', expect.any(String), 'user-1'],
    );
  });

  it('revokes only an active credential in the requested organization and audits it', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({
      rows: [
        {
          credentialReference: 'credential-1',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: '2026-01-02T00:00:00.000Z',
          status: 'revoked',
        },
      ],
    });

    await expect(
      service.revokeCredential(
        identity,
        'organization-1',
        'device-1',
        'credential-1',
      ),
    ).resolves.toMatchObject({ status: 'revoked' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'organization_id = $1 AND device_id = $2 AND id = $3 AND revoked_at IS NULL',
      ),
      ['organization-1', 'device-1', 'credential-1', 'user-1'],
    );
  });
});
