import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { parseTelemetryPayload, type Telemetry } from '@smart-house/contracts';
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
const persistedTelemetryTopic = 'telemetry.persisted';

type OutboxRow = {
  id: string;
  payload: Record<string, unknown>;
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
  private activeOutboxRelay?: Promise<void>;

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
    this.reconciliationTimer = setInterval(
      () => void this.reconcileDeviceStatuses(),
      this.config.DEVICE_STATUS_RECONCILIATION_INTERVAL_MS,
    );
    void this.reconcileDeviceStatuses();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    await new Promise<void>(
      (resolve) => this.mqtt?.end(false, {}, () => resolve()) ?? resolve(),
    );
    await this.activeOutboxRelay;
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
      this.mqtt?.subscribe(telemetryTopic, { qos: 1 }, (error) => {
        if (error) {
          this.logger.error('Failed to subscribe to telemetry.', error);
          return;
        }
        this.logger.log(`Subscribed to ${telemetryTopic}.`);
      });
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

  private assertTopic(topic: string, telemetry: Telemetry): void {
    const expected = `tenants/${telemetry.tenantId}/devices/${telemetry.deviceId}/telemetry`;
    if (
      topic !== expected ||
      telemetry.tenantId !== this.config.SIMULATOR_TENANT_ID
    ) {
      throw new Error('Telemetry topic or tenant does not match the payload.');
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
         WHERE processed_at IS NULL AND topic = $1
         ORDER BY created_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [persistedTelemetryTopic, this.config.TELEMETRY_OUTBOX_BATCH_SIZE],
      );

      for (const row of result.rows) {
        const payload = JSON.stringify({ ...row.payload, eventId: row.id });
        const delivery = await this.redisOrThrow()
          .multi()
          .xadd(this.config.TELEMETRY_OUTBOX_STREAM_KEY, '*', 'event', payload)
          .publish(this.config.TELEMETRY_OUTBOX_PUBSUB_CHANNEL, payload)
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

  private async ensureOrganization(
    client: PoolClient,
    tenantId: string,
  ): Promise<string> {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [tenantId],
    );
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM organizations WHERE name = $1 LIMIT 1',
      [`Simulator ${tenantId}`],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const created = await client.query<{ id: string }>(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [`Simulator ${tenantId}`],
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
}
