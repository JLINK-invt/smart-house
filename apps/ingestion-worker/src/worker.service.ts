import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { telemetrySchema, type Telemetry } from '@smart-house/contracts';
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

  async onModuleInit(): Promise<void> {
    this.database = new Pool({ connectionString: this.config.DATABASE_URL });
    this.redis = new Redis(this.config.REDIS_URL);
    this.database.on('error', (error) =>
      this.logger.error('PostgreSQL pool connection error.', error),
    );
    await this.database.query('SELECT 1');
    await this.redis.ping();
    this.connectMqtt();
  }

  async onModuleDestroy(): Promise<void> {
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
      clientId: `smart-house-ingestion-${crypto.randomUUID()}`,
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
    const deviceId = await this.ensureDevice(organizationId, telemetry);
    const metric =
      telemetry.deviceType === 'temperature_sensor'
        ? 'temperature'
        : 'relay_state';
    const reading =
      telemetry.deviceType === 'temperature_sensor'
        ? telemetry.metrics.temperature
        : {
            value: telemetry.metrics.relayState.value ? 1 : 0,
            unit: 'boolean',
          };

    const result = await this.databaseOrThrow().query(
      `INSERT INTO telemetry_records (organization_id, device_id, message_id, metric, value, unit, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, device_id, message_id, metric, occurred_at) DO NOTHING`,
      [
        organizationId,
        deviceId,
        telemetry.messageId,
        metric,
        reading.value,
        reading.unit,
        telemetry.occurredAt,
      ],
    );
    if (result.rowCount === 0) {
      this.logger.debug(`Ignored duplicate telemetry ${telemetry.messageId}.`);
      return;
    }

    await this.redisOrThrow().publish(
      'telemetry.persisted',
      JSON.stringify({
        correlationId: telemetry.messageId,
        metric,
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
  ): Promise<string> {
    const existing = await this.databaseOrThrow().query<{ id: string }>(
      'SELECT id FROM devices WHERE organization_id = $1 AND external_id = $2 LIMIT 1',
      [organizationId, telemetry.deviceId],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const created = await this.databaseOrThrow().query<{ id: string }>(
      `INSERT INTO devices (organization_id, external_id, name, type, status)
       VALUES ($1, $2, $2, $3, 'online') RETURNING id`,
      [organizationId, telemetry.deviceId, telemetry.deviceType],
    );
    return created.rows[0].id;
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
