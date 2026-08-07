import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  parseCommandAckPayload,
  parseTelemetryPayload,
  type CommandAck,
  relayCommandSchema,
  type CommandStatusEvent,
  type RelayCommand,
  type Telemetry,
} from '@smart-house/contracts';
import { readFileSync } from 'node:fs';
import Redis from 'ioredis';
import { connect, type MqttClient } from 'mqtt';
import { Pool, type PoolClient } from 'pg';
import { readWorkerConfig } from './config';
import {
  normalizeTelemetry,
  type NormalizedTelemetry,
} from './telemetry-normalizer';

const telemetryTopic = 'tenants/+/devices/+/telemetry';
const commandAckTopic = 'tenants/+/devices/+/command-acks';
const persistedTelemetryTopic = 'telemetry.persisted';
const commandPublishOutboxTopic = 'mqtt.command.publish';
const commandStatusOutboxTopic = 'command.status';

type OutboxRow = {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
};

type CommandOutboxRow = {
  id: string;
  payload: RelayCommand;
  organizationId: string;
  deviceId: string;
  type: string;
  expiresAt: string;
  createdAt: string;
  error: { code: string; message: string } | null;
};

type CommandStatusRow = CommandStatusEvent['command'] & {
  organizationId: string;
  deviceId: string;
};

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly config = readWorkerConfig(process.env);
  private database?: Pool;
  private redis?: Redis;
  private mqtt?: MqttClient;
  private reconciliationTimer?: NodeJS.Timeout;
  private outboxTimer?: NodeJS.Timeout;
  private commandOutboxTimer?: NodeJS.Timeout;
  private activeOutboxRelay?: Promise<void>;
  private activeCommandOutboxRelay?: Promise<void>;

  async onModuleInit(): Promise<void> {
    this.database = new Pool({ connectionString: this.config.DATABASE_URL });
    this.redis = new Redis(this.config.REDIS_URL);
    this.database.on('error', (error) =>
      this.logger.error('PostgreSQL pool connection error.', error),
    );
    await this.database.query('SELECT 1');
    await this.redis.ping();
    this.connectMqtt();
    this.startOutboxRelay();
    this.startCommandOutboxRelay();
    this.reconciliationTimer = setInterval(
      () => void this.reconcileStatuses(),
      this.config.DEVICE_STATUS_RECONCILIATION_INTERVAL_MS,
    );
    void this.reconcileStatuses();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.commandOutboxTimer) clearInterval(this.commandOutboxTimer);
    await new Promise<void>(
      (resolve) => this.mqtt?.end(false, {}, () => resolve()) ?? resolve(),
    );
    await this.activeOutboxRelay;
    await this.activeCommandOutboxRelay;
    await this.database?.end();
    await this.redis?.quit();
  }

  start(): void {
    this.logger.log('Ingestion worker is consuming simulated MQTT telemetry.');
  }

  private connectMqtt(): void {
    this.mqtt = connect(this.config.MQTT_URL, {
      clientId: this.config.MQTT_CLIENT_ID,
      ca: readFileSync(this.config.MQTT_CA_FILE),
      cert: readFileSync(this.config.MQTT_CERT_FILE),
      key: readFileSync(this.config.MQTT_KEY_FILE),
      rejectUnauthorized: true,
      protocolVersion: 5,
      clean: false,
      properties: {
        sessionExpiryInterval: this.config.MQTT_SESSION_EXPIRY_SECONDS,
      },
      reconnectPeriod: this.config.MQTT_RECONNECT_PERIOD_MS,
      resubscribe: false,
    });

    this.mqtt.on('connect', () => {
      this.mqtt?.subscribe(
        [telemetryTopic, commandAckTopic],
        { qos: 1 },
        (error) => {
          if (error) {
            this.logger.error('Failed to subscribe to MQTT topics.', error);
            return;
          }
          this.logger.log(
            `Subscribed to ${telemetryTopic} and ${commandAckTopic}.`,
          );
        },
      );
    });
    this.mqtt.on(
      'message',
      (topic, payload) => void this.consume(topic, payload),
    );
    this.mqtt.on('error', (error) =>
      this.logger.error('MQTT connection error.', error),
    );
  }

  private async consume(topic: string, payload: Buffer): Promise<void> {
    if (this.isCommandAckTopic(topic)) {
      await this.consumeCommandAck(topic, payload);
      return;
    }

    const receivedAt = new Date();
    try {
      const telemetry = parseTelemetryPayload(payload);
      this.assertTopic(topic, telemetry);
      await this.persist(
        normalizeTelemetry(telemetry, {
          receivedAt,
          maxFutureSkewMs:
            this.config.TELEMETRY_MAX_FUTURE_SKEW_SECONDS * 1_000,
          lateAfterMs: this.config.TELEMETRY_LATE_AFTER_SECONDS * 1_000,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Rejected telemetry: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
  }

  private async consumeCommandAck(
    topic: string,
    payload: Buffer,
  ): Promise<void> {
    try {
      const acknowledgement = parseCommandAckPayload(payload);
      this.assertCommandAckTopic(topic, acknowledgement);
      await this.persistCommandAck(acknowledgement);
    } catch (error) {
      this.logger.warn(
        `Rejected command acknowledgement: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
  }

  private assertTopic(topic: string, telemetry: Telemetry): void {
    const expected = `tenants/${telemetry.tenantId}/devices/${telemetry.deviceId}/telemetry`;
    if (
      topic !== expected ||
      telemetry.tenantId !== this.config.SIMULATOR_TENANT_ID
    ) {
      throw new Error('Telemetry topic or tenant does not match the payload.');
    }
  }

  private isCommandAckTopic(topic: string): boolean {
    return /^tenants\/[^/]+\/devices\/[^/]+\/command-acks$/.test(topic);
  }

  private assertCommandAckTopic(
    topic: string,
    acknowledgement: CommandAck,
  ): void {
    const expected = `tenants/${acknowledgement.tenantId}/devices/${acknowledgement.deviceId}/command-acks`;
    if (
      topic !== expected ||
      acknowledgement.tenantId !== this.config.SIMULATOR_TENANT_ID
    ) {
      throw new Error(
        'Command acknowledgement topic or tenant does not match the payload.',
      );
    }
  }

  private async persistCommandAck(acknowledgement: CommandAck): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    try {
      await client.query('BEGIN');
      const command = await client.query<{
        organizationId: string;
        deviceId: string;
        externalId: string;
        tenantId: string | null;
        status: string;
      }>(
        `SELECT c.organization_id AS "organizationId", c.device_id AS "deviceId",
                d.external_id AS "externalId", o.mqtt_tenant_id AS "tenantId", c.status
         FROM commands c
         JOIN devices d ON d.id = c.device_id AND d.organization_id = c.organization_id
         JOIN organizations o ON o.id = c.organization_id
         WHERE c.id = $1
         FOR UPDATE`,
        [acknowledgement.commandId],
      );
      const existing = command.rows[0];
      if (!existing)
        throw new Error(
          'Command acknowledgement references an unknown command.',
        );
      if (
        existing.tenantId !== acknowledgement.tenantId ||
        existing.externalId !== acknowledgement.deviceId
      ) {
        throw new Error(
          'Command acknowledgement tenant or device does not match the command.',
        );
      }

      if (['acknowledged', 'failed'].includes(existing.status)) {
        await client.query('COMMIT');
        this.logger.debug(
          `Ignored duplicate command acknowledgement ${acknowledgement.messageId}.`,
        );
        return;
      }
      if (existing.status === 'expired') {
        throw new Error(
          'Command acknowledgement arrived after the command expired.',
        );
      }
      if (!['pending', 'sent'].includes(existing.status)) {
        throw new Error(
          `Command acknowledgement is not allowed from ${existing.status}.`,
        );
      }

      const updated = await client.query<CommandStatusRow>(
        `UPDATE commands
         SET status = $2, error = $3::jsonb, updated_at = now()
         WHERE id = $1 AND status IN ('pending', 'sent') AND expires_at > now()
         RETURNING id, organization_id AS "organizationId", device_id AS "deviceId",
                   type, status, expires_at AS "expiresAt", created_at AS "createdAt", error`,
        [
          acknowledgement.commandId,
          acknowledgement.status,
          acknowledgement.error ? JSON.stringify(acknowledgement.error) : null,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error(
          'Command acknowledgement arrived after the command expired.',
        );
      }
      await this.enqueueCommandStatus(client, updated.rows[0]);
      await client.query('COMMIT');
      this.logger.log(
        `Recorded command ${acknowledgement.commandId} as ${acknowledgement.status}.`,
      );
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back command acknowledgement transaction.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async persist(telemetry: NormalizedTelemetry): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    let newlyPersisted = false;
    try {
      await client.query('BEGIN');
      const organizationId = await this.ensureOrganization(
        client,
        telemetry.tenantId,
      );
      const device = await this.ensureDevice(client, organizationId, telemetry);
      if (device.type !== telemetry.deviceType) {
        throw new Error(
          'Telemetry device type does not match the registered device.',
        );
      }
      const catalog = await this.catalogFor(
        client,
        device.type,
        device.capabilityVersion,
      );
      const readings = telemetry.readings;
      if (!readings.every(({ metric }) => catalog.metrics.includes(metric))) {
        throw new Error(
          'Telemetry contains a metric not supported by the registered device.',
        );
      }

      for (const reading of readings) {
        const result = await client.query(
          `INSERT INTO telemetry_records (
             organization_id, device_id, message_id, metric, value, unit,
             occurred_at, received_at, schema_version, source_value, source_unit,
             time_quality
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (organization_id, device_id, message_id, metric, occurred_at) DO NOTHING`,
          [
            organizationId,
            device.id,
            telemetry.messageId,
            reading.metric,
            typeof reading.value === 'boolean'
              ? Number(reading.value)
              : reading.value,
            reading.unit,
            telemetry.occurredAt,
            telemetry.receivedAt,
            telemetry.schemaVersion,
            reading.sourceValue,
            reading.sourceUnit,
            telemetry.timeQuality,
          ],
        );
        newlyPersisted ||= result.rowCount === 1;
      }

      if (newlyPersisted) {
        await this.updateDevicePresence(
          client,
          device.id,
          telemetry.occurredAt,
        );
        const eventId = crypto.randomUUID();
        await client.query(
          `INSERT INTO outbox_events (id, organization_id, topic, payload)
           VALUES ($1, $2, $3, $4)`,
          [
            eventId,
            organizationId,
            persistedTelemetryTopic,
            {
              eventId,
              correlationId: telemetry.messageId,
              metric: telemetry.readings.map(({ metric }) => metric).join(','),
              organizationId,
              telemetry,
            },
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back telemetry transaction.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    } finally {
      client.release();
    }

    if (!newlyPersisted) {
      this.logger.debug(`Ignored duplicate telemetry ${telemetry.messageId}.`);
      return;
    }
    this.logger.log(`Persisted telemetry ${telemetry.messageId}.`);
  }

  private startOutboxRelay(): void {
    this.outboxTimer = setInterval(
      () => void this.runOutboxRelay(),
      this.config.TELEMETRY_OUTBOX_POLL_INTERVAL_MS,
    );
    void this.runOutboxRelay();
  }

  private startCommandOutboxRelay(): void {
    this.commandOutboxTimer = setInterval(
      () => void this.runCommandOutboxRelay(),
      this.config.TELEMETRY_OUTBOX_POLL_INTERVAL_MS,
    );
    void this.runCommandOutboxRelay();
  }

  private runOutboxRelay(): Promise<void> {
    if (this.activeOutboxRelay) return this.activeOutboxRelay;

    const relay = this.relayOutboxBatch()
      .catch((error: unknown) => {
        this.logger.error(
          'Failed to relay telemetry outbox.',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.activeOutboxRelay === relay)
          this.activeOutboxRelay = undefined;
      });
    this.activeOutboxRelay = relay;
    return relay;
  }

  private async relayOutboxBatch(): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OutboxRow>(
        `SELECT id, payload
         FROM outbox_events
         WHERE processed_at IS NULL AND topic = ANY($1)
         ORDER BY created_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [
          [persistedTelemetryTopic, commandStatusOutboxTopic],
          this.config.TELEMETRY_OUTBOX_BATCH_SIZE,
        ],
      );

      for (const row of result.rows) {
        const topic = row.topic ?? persistedTelemetryTopic;
        const payload = JSON.stringify({ ...row.payload, eventId: row.id });
        const delivery = await this.redisOrThrow()
          .multi()
          .xadd(
            topic === persistedTelemetryTopic
              ? this.config.TELEMETRY_OUTBOX_STREAM_KEY
              : `${topic}.stream`,
            '*',
            'event',
            payload,
          )
          .publish(topic, payload)
          .exec();
        if (!delivery)
          throw new Error('Redis discarded the outbox transaction.');
        const commandError = delivery.find(([error]) => error)?.[0];
        if (commandError) throw commandError;

        await client.query(
          'UPDATE outbox_events SET processed_at = now() WHERE id = $1',
          [row.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back outbox relay transaction.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private runCommandOutboxRelay(): Promise<void> {
    if (this.activeCommandOutboxRelay) return this.activeCommandOutboxRelay;

    const relay = this.relayCommandOutboxBatch()
      .catch((error: unknown) => {
        this.logger.error(
          'Failed to relay command outbox.',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.activeCommandOutboxRelay === relay)
          this.activeCommandOutboxRelay = undefined;
      });
    this.activeCommandOutboxRelay = relay;
    return relay;
  }

  private async relayCommandOutboxBatch(): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<CommandOutboxRow>(
        `SELECT e.id, e.payload, c.organization_id AS "organizationId",
                c.device_id AS "deviceId", c.type,
                c.expires_at AS "expiresAt", c.created_at AS "createdAt", c.error
         FROM outbox_events e
         JOIN commands c ON c.id = e.id
         WHERE e.processed_at IS NULL AND e.topic = $1
           AND c.status = 'pending' AND c.expires_at > now()
         ORDER BY e.created_at, e.id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [commandPublishOutboxTopic, this.config.TELEMETRY_OUTBOX_BATCH_SIZE],
      );

      for (const row of result.rows) {
        const command = relayCommandSchema.parse(row.payload);
        await this.publishCommand(command);
        const marked = await client.query<Pick<CommandStatusRow, 'status'>>(
          `UPDATE commands SET status = 'sent', updated_at = now()
             WHERE id = $1 AND status = 'pending' AND expires_at > now()
             RETURNING status`,
          [command.commandId],
        );
        if (marked.rowCount !== 1) {
          const status = await client.query<{ status: string }>(
            'SELECT status FROM commands WHERE id = $1',
            [command.commandId],
          );
          if (
            !['acknowledged', 'failed', 'expired'].includes(
              status.rows[0]?.status ?? '',
            )
          ) {
            throw new Error(`Command ${command.commandId} is not pending.`);
          }
        } else {
          await this.enqueueCommandStatus(client, {
            ...row,
            status: marked.rows[0].status,
          });
        }
        await client.query(
          'UPDATE outbox_events SET processed_at = now() WHERE id = $1',
          [row.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back command outbox relay transaction.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async publishCommand(command: RelayCommand): Promise<void> {
    const topic = `tenants/${command.tenantId}/devices/${command.deviceId}/commands`;
    await new Promise<void>((resolve, reject) => {
      this.mqttOrThrow().publish(
        topic,
        JSON.stringify(command),
        { qos: 1 },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  }

  private async enqueueCommandStatus(
    client: PoolClient,
    command: CommandStatusRow,
  ): Promise<void> {
    const eventId = crypto.randomUUID();
    await client.query(
      `INSERT INTO outbox_events (id, organization_id, topic, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        eventId,
        command.organizationId,
        commandStatusOutboxTopic,
        {
          eventId,
          correlationId: command.id,
          organizationId: command.organizationId,
          deviceId: command.deviceId,
          command: {
            id: command.id,
            type: command.type,
            status: command.status,
            expiresAt: command.expiresAt,
            createdAt: command.createdAt,
            error: command.error,
          },
        } satisfies CommandStatusEvent,
      ],
    );
  }

  private async ensureOrganization(
    client: PoolClient,
    tenantId: string,
  ): Promise<string> {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [tenantId],
    );
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM organizations WHERE mqtt_tenant_id = $1 LIMIT 1',
      [tenantId],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const created = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, mqtt_tenant_id)
       VALUES ($1, $2) RETURNING id`,
      [`Simulator ${tenantId}`, tenantId],
    );
    return created.rows[0].id;
  }

  private async ensureDevice(
    client: PoolClient,
    organizationId: string,
    telemetry: Pick<NormalizedTelemetry, 'deviceId' | 'deviceType'>,
  ): Promise<{ id: string; type: string; capabilityVersion: string }> {
    const created = await client.query<{
      id: string;
      type: string;
      capabilityVersion: string;
    }>(
      `INSERT INTO devices (organization_id, external_id, name, type, capability_version)
       VALUES ($1, $2, $2, $3, 'v1')
       ON CONFLICT (organization_id, external_id) DO NOTHING
       RETURNING id, type, capability_version AS "capabilityVersion"`,
      [organizationId, telemetry.deviceId, telemetry.deviceType],
    );
    if (created.rows[0]) return created.rows[0];
    const existing = await client.query<{
      id: string;
      type: string;
      capabilityVersion: string;
    }>(
      `SELECT id, type, capability_version AS "capabilityVersion"
       FROM devices WHERE organization_id = $1 AND external_id = $2`,
      [organizationId, telemetry.deviceId],
    );
    if (!existing.rows[0]) throw new Error('Failed to find or create device.');
    return existing.rows[0];
  }

  private async catalogFor(client: PoolClient, type: string, version: string) {
    const result = await client.query<{ metrics: string[] }>(
      `SELECT metrics FROM device_capability_catalog
       WHERE device_type = $1 AND version = $2`,
      [type, version],
    );
    if (!result.rows[0]) {
      throw new Error('Registered device has no capability catalog.');
    }
    return result.rows[0];
  }

  private async updateDevicePresence(
    client: PoolClient,
    deviceId: string,
    occurredAt: string,
  ): Promise<void> {
    await client.query(
      `UPDATE devices
       SET last_seen_at = GREATEST(COALESCE(last_seen_at, '-infinity'::timestamptz), $2::timestamptz),
           status = CASE
             WHEN status = 'disabled' THEN 'disabled'
             WHEN $2::timestamptz >= now() - ($3 * interval '1 second')
                  AND $2::timestamptz >= COALESCE(last_seen_at, '-infinity'::timestamptz)
               THEN 'online'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [deviceId, occurredAt, this.config.DEVICE_ONLINE_GRACE_PERIOD_SECONDS],
    );
  }

  private async reconcileStatuses(): Promise<void> {
    await Promise.all([
      this.reconcileDeviceStatuses(),
      this.reconcileExpiredCommands(),
    ]);
  }

  private async reconcileExpiredCommands(): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<CommandStatusRow>(
        `UPDATE commands
          SET status = 'expired', updated_at = now()
          WHERE status IN ('pending', 'sent') AND expires_at <= now()
          RETURNING id, organization_id AS "organizationId", device_id AS "deviceId",
                    type, status, expires_at AS "expiresAt", created_at AS "createdAt", error`,
      );
      if (expired.rows.length) {
        for (const command of expired.rows)
          await this.enqueueCommandStatus(client, command);
        await client.query(
          `UPDATE outbox_events SET processed_at = now()
           WHERE topic = $1 AND processed_at IS NULL AND id = ANY($2::uuid[])`,
          [commandPublishOutboxTopic, expired.rows.map(({ id }) => id)],
        );
      }
      await client.query('COMMIT');
      if (expired.rows.length) {
        this.logger.log(`Expired ${expired.rows.length} command(s).`);
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back command expiry reconciliation.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      this.logger.error(
        'Failed to reconcile expired commands.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      client.release();
    }
  }

  private async reconcileDeviceStatuses(): Promise<void> {
    try {
      const result = await this.databaseOrThrow().query(
        `UPDATE devices SET status = 'offline', updated_at = now()
         WHERE status = 'online'
           AND (last_seen_at IS NULL OR last_seen_at < now() - ($1 * interval '1 second'))`,
        [this.config.DEVICE_ONLINE_GRACE_PERIOD_SECONDS],
      );
      if (result.rowCount) {
        this.logger.log(`Marked ${result.rowCount} stale device(s) offline.`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to reconcile device presence.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private databaseOrThrow(): Pool {
    if (!this.database) throw new Error('Database is not initialized.');
    return this.database;
  }

  private redisOrThrow(): Redis {
    if (!this.redis) throw new Error('Redis is not initialized.');
    return this.redis;
  }

  private mqttOrThrow(): MqttClient {
    if (!this.mqtt) throw new Error('MQTT is not initialized.');
    return this.mqtt;
  }
}
