import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { telemetrySchema, type Telemetry } from '@smart-house/contracts';
import { readFileSync } from 'node:fs';
import Redis from 'ioredis';
import { connect, type MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { readWorkerConfig } from './config';

const telemetryTopic = 'tenants/+/devices/+/telemetry';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly config = readWorkerConfig(process.env);
  private database?: Pool;
  private redis?: Redis;
  private mqtt?: MqttClient;
  private reconciliationTimer?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    this.database = new Pool({ connectionString: this.config.DATABASE_URL });
    this.redis = new Redis(this.config.REDIS_URL);
    this.database.on('error', (error) =>
      this.logger.error('PostgreSQL pool connection error.', error),
    );
    await this.database.query('SELECT 1');
    await this.redis.ping();
    this.connectMqtt();
    this.reconciliationTimer = setInterval(
      () => void this.reconcileDeviceStatuses(),
      this.config.DEVICE_STATUS_RECONCILIATION_INTERVAL_MS,
    );
    void this.reconcileDeviceStatuses();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    await this.database?.end();
    await this.redis?.quit();
    await new Promise<void>(
      (resolve) => this.mqtt?.end(false, {}, () => resolve()) ?? resolve(),
    );
  }

  start(): void {
    this.logger.log('Ingestion worker is consuming simulated MQTT telemetry.');
  }

  private connectMqtt(): void {
    this.mqtt = connect(this.config.MQTT_URL, {
      clientId: `${this.config.MQTT_CLIENT_ID}-${crypto.randomUUID()}`,
      ca: readFileSync(this.config.MQTT_CA_FILE),
      cert: readFileSync(this.config.MQTT_CERT_FILE),
      key: readFileSync(this.config.MQTT_KEY_FILE),
      rejectUnauthorized: true,
      reconnectPeriod: 1_000,
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
    try {
      const telemetry = telemetrySchema.parse(
        JSON.parse(payload.toString('utf8')),
      );
      this.assertTopic(topic, telemetry);
      await this.persist(telemetry);
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

  private async persist(telemetry: Telemetry): Promise<void> {
    const organizationId = await this.ensureOrganization(telemetry.tenantId);
    const device = await this.ensureDevice(organizationId, telemetry);
    const catalog = await this.catalogFor(
      device.type,
      device.capabilityVersion,
    );
    if (device.type !== telemetry.deviceType) {
      throw new Error(
        'Telemetry device type does not match the registered device.',
      );
    }
    const readings =
      telemetry.deviceType === 'temperature_sensor'
        ? [
            {
              metric: 'temperature',
              value: telemetry.metrics.temperature.value,
              unit: telemetry.metrics.temperature.unit,
            },
          ]
        : [
            {
              metric: 'relayState',
              value: Number(telemetry.metrics.relayState.value),
              unit: telemetry.metrics.relayState.unit,
            },
          ];
    if (!readings.every(({ metric }) => catalog.metrics.includes(metric))) {
      throw new Error(
        'Telemetry contains a metric not supported by the registered device.',
      );
    }

    for (const reading of readings) {
      const result = await this.databaseOrThrow().query(
        `INSERT INTO telemetry_records (organization_id, device_id, message_id, metric, value, unit, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, device_id, message_id, metric, occurred_at) DO NOTHING`,
        [
          organizationId,
          device.id,
          telemetry.messageId,
          reading.metric,
          reading.value,
          reading.unit,
          telemetry.occurredAt,
        ],
      );
      if (result.rowCount === 0) {
        this.logger.debug(
          `Ignored duplicate telemetry ${telemetry.messageId}.`,
        );
        return;
      }
    }

    await this.updateDevicePresence(device.id, telemetry.occurredAt);

    await this.redisOrThrow().publish(
      'telemetry.persisted',
      JSON.stringify({
        correlationId: telemetry.messageId,
        metric: readings.map(({ metric }) => metric).join(','),
        organizationId,
        telemetry,
      }),
    );
    this.logger.log(`Persisted telemetry ${telemetry.messageId}.`);
  }

  private async ensureOrganization(tenantId: string): Promise<string> {
    const existing = await this.databaseOrThrow().query<{ id: string }>(
      'SELECT id FROM organizations WHERE name = $1 LIMIT 1',
      [`Simulator ${tenantId}`],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const created = await this.databaseOrThrow().query<{ id: string }>(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [`Simulator ${tenantId}`],
    );
    return created.rows[0].id;
  }

  private async ensureDevice(
    organizationId: string,
    telemetry: Telemetry,
  ): Promise<{ id: string; type: string; capabilityVersion: string }> {
    const existing = await this.databaseOrThrow().query<{
      id: string;
      type: string;
      capabilityVersion: string;
    }>(
      `SELECT id, type, capability_version AS "capabilityVersion"
       FROM devices WHERE organization_id = $1 AND external_id = $2 LIMIT 1`,
      [organizationId, telemetry.deviceId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const created = await this.databaseOrThrow().query<{
      id: string;
      type: string;
      capabilityVersion: string;
    }>(
      `INSERT INTO devices (organization_id, external_id, name, type, capability_version)
        VALUES ($1, $2, $2, $3, 'v1')
       RETURNING id, type, capability_version AS "capabilityVersion"`,
      [organizationId, telemetry.deviceId, telemetry.deviceType],
    );
    return created.rows[0];
  }

  private async catalogFor(type: string, version: string) {
    const result = await this.databaseOrThrow().query<{ metrics: string[] }>(
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
    deviceId: string,
    occurredAt: string,
  ): Promise<void> {
    await this.databaseOrThrow().query(
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
