import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createOperationalMetrics } from '@smart-house/observability';
import {
  parseCommandAckPayload,
  parseTelemetryPayload,
  type CommandAck,
  relayCommandSchema,
  type CommandStatusEvent,
  type RelayCommand,
  type Telemetry,
} from '@smart-house/contracts';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Redis from 'ioredis';
import { connect, type MqttClient } from 'mqtt';
import nodemailer from 'nodemailer';
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
const alertStatusOutboxTopic = 'alert.status';
const notificationInboxOutboxTopic = 'notification.inbox';
const operationalMetrics = createOperationalMetrics(
  'smart-house-ingestion-worker',
);

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

type ThresholdRule = {
  id: string;
  name: string;
  metric: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  durationSeconds: number;
  hysteresis: number;
  cooldownSeconds: number;
  conditionStartedAt: string | null;
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
  private notificationTimer?: NodeJS.Timeout;
  private operationalMetricsTimer?: NodeJS.Timeout;
  private activeOutboxRelay?: Promise<void>;
  private activeCommandOutboxRelay?: Promise<void>;
  private activeNotificationRelay?: Promise<void>;

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
    this.startNotificationRelay();
    this.operationalMetricsTimer = setInterval(
      () => void this.measureOperationalState(),
      10_000,
    );
    this.recordCertificateExpiry();
    void this.measureOperationalState();
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
    if (this.notificationTimer) clearInterval(this.notificationTimer);
    if (this.operationalMetricsTimer)
      clearInterval(this.operationalMetricsTimer);
    await new Promise<void>(
      (resolve) => this.mqtt?.end(false, {}, () => resolve()) ?? resolve(),
    );
    await this.activeOutboxRelay;
    await this.activeCommandOutboxRelay;
    await this.activeNotificationRelay;
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
      const persisted = await this.persist(
        normalizeTelemetry(telemetry, {
          receivedAt,
          maxFutureSkewMs:
            this.config.TELEMETRY_MAX_FUTURE_SKEW_SECONDS * 1_000,
          lateAfterMs: this.config.TELEMETRY_LATE_AFTER_SECONDS * 1_000,
          maxPastAgeMs: this.config.TELEMETRY_MAX_PAST_AGE_SECONDS * 1_000,
        }),
      );
      operationalMetrics.countTelemetry(persisted ? 'accepted' : 'duplicate');
      operationalMetrics.recordIngestionLatency(
        Math.max(0, receivedAt.getTime() - Date.parse(telemetry.occurredAt)) /
          1_000,
      );
    } catch (error) {
      operationalMetrics.countTelemetry('rejected');
      operationalMetrics.countWorkerError('telemetry');
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
      operationalMetrics.countWorkerError('command_acknowledgement');
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

  private async persist(telemetry: NormalizedTelemetry): Promise<boolean> {
    const startedAt = performance.now();
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
        if (result.rowCount === 1) {
          await this.evaluateThresholdAlerts(
            client,
            organizationId,
            device.id,
            reading.metric,
            typeof reading.value === 'boolean'
              ? Number(reading.value)
              : reading.value,
            telemetry.occurredAt,
          );
        }
        newlyPersisted ||= result.rowCount === 1;
      }

      if (newlyPersisted) {
        await this.updateDevicePresence(
          client,
          organizationId,
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
      return false;
    }
    operationalMetrics.recordPersistenceLatency(
      (performance.now() - startedAt) / 1_000,
    );
    this.logger.log(`Persisted telemetry ${telemetry.messageId}.`);
    return true;
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
        operationalMetrics.countWorkerError('outbox');
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
        `SELECT id, payload, topic
         FROM outbox_events
         WHERE processed_at IS NULL AND topic = ANY($1)
         ORDER BY created_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [
          [
            persistedTelemetryTopic,
            commandStatusOutboxTopic,
            alertStatusOutboxTopic,
            notificationInboxOutboxTopic,
          ],
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
        operationalMetrics.countWorkerError('command_outbox');
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
    organizationId: string,
    deviceId: string,
    occurredAt: string,
  ): Promise<void> {
    const result = await client.query<{
      previousStatus: string;
      status: string;
    }>(
      `WITH previous AS (
         SELECT status FROM devices
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE
       )
       UPDATE devices d
        SET last_seen_at = GREATEST(COALESCE(d.last_seen_at, '-infinity'::timestamptz), $3::timestamptz),
            status = CASE
              WHEN d.status = 'disabled' THEN 'disabled'
              WHEN $3::timestamptz >= now() - ($4 * interval '1 second')
                   AND $3::timestamptz >= COALESCE(d.last_seen_at, '-infinity'::timestamptz)
                THEN 'online'
              ELSE d.status
            END,
            updated_at = now()
       FROM previous
       WHERE d.id = $1 AND d.organization_id = $2
       RETURNING previous.status AS "previousStatus", d.status`,
      [
        deviceId,
        organizationId,
        occurredAt,
        this.config.DEVICE_ONLINE_GRACE_PERIOD_SECONDS,
      ],
    );
    if (
      result.rows[0]?.previousStatus === 'offline' &&
      result.rows[0].status === 'online'
    ) {
      await this.resolveDeviceOfflineAlerts(
        client,
        organizationId,
        deviceId,
        occurredAt,
      );
    }
  }

  private async evaluateThresholdAlerts(
    client: PoolClient,
    organizationId: string,
    deviceId: string,
    metric: string,
    observedValue: number,
    observedAt: string,
  ): Promise<void> {
    const rules = await client.query<ThresholdRule>(
      `SELECT id, name, metric, operator, threshold, severity,
              duration_seconds AS "durationSeconds", hysteresis,
              cooldown_seconds AS "cooldownSeconds",
              condition_started_at AS "conditionStartedAt"
       FROM alert_rules
       WHERE organization_id = $1 AND device_id = $2 AND metric = $3 AND enabled
       FOR UPDATE`,
      [organizationId, deviceId, metric],
    );

    for (const rule of rules.rows) {
      const open = await client.query<{ id: string }>(
        `SELECT id FROM alerts
         WHERE organization_id = $1 AND rule_id = $2 AND device_id = $3
           AND state = 'open'
         FOR UPDATE`,
        [organizationId, rule.id, deviceId],
      );

      if (open.rows[0]) {
        if (!this.hasRecovered(rule, observedValue)) continue;
        await client.query(
          `UPDATE alerts SET state = 'resolved', resolved_at = $4::timestamptz
           WHERE organization_id = $1 AND rule_id = $2 AND device_id = $3
             AND state = 'open' AND opened_at <= $4::timestamptz`,
          [organizationId, rule.id, deviceId, observedAt],
        );
        await client.query(
          `UPDATE alert_rules SET condition_started_at = NULL
           WHERE id = $1 AND organization_id = $2
             AND (condition_started_at IS NULL OR condition_started_at <= $3::timestamptz)`,
          [rule.id, organizationId, observedAt],
        );
        continue;
      }

      if (!this.hasBreached(rule, observedValue)) {
        await client.query(
          `UPDATE alert_rules SET condition_started_at = NULL
           WHERE id = $1 AND organization_id = $2
             AND (condition_started_at IS NULL OR condition_started_at <= $3::timestamptz)`,
          [rule.id, organizationId, observedAt],
        );
        continue;
      }

      const conditionStartedAt = rule.conditionStartedAt ?? observedAt;
      if (!rule.conditionStartedAt) {
        await client.query(
          `UPDATE alert_rules SET condition_started_at = $3::timestamptz
           WHERE id = $1 AND organization_id = $2`,
          [rule.id, organizationId, observedAt],
        );
      }
      if (
        Date.parse(observedAt) - Date.parse(conditionStartedAt) <
        rule.durationSeconds * 1_000
      ) {
        continue;
      }

      const openedAlert = await client.query<{ id: string }>(
        `INSERT INTO alerts
           (organization_id, device_id, rule_id, severity, metric, observed_value,
            observed_at, message, opened_at)
          SELECT r.organization_id, r.device_id, r.id, r.severity, r.metric, $4::double precision,
                $5::timestamptz,
                 'Rule "' || r.name || '": observed ' || ($4::double precision)::text || ' for ' || r.metric ||
                  ' crossed ' || r.operator || ' threshold ' || r.threshold,
                $5::timestamptz
         FROM alert_rules r
         WHERE r.id = $1 AND r.organization_id = $2 AND r.device_id = $3
           AND NOT EXISTS (
             SELECT 1 FROM alerts a
             WHERE a.organization_id = $2 AND a.rule_id = r.id AND a.device_id = $3
               AND a.state = 'resolved'
               AND a.resolved_at > $5::timestamptz -
                 (r.cooldown_seconds * interval '1 second')
           )
          ON CONFLICT (rule_id, device_id) WHERE state = 'open' DO NOTHING
          RETURNING id`,
        [rule.id, organizationId, deviceId, observedValue, observedAt],
      );
      if (openedAlert.rows[0])
        await this.enqueueAlertNotification(
          client,
          organizationId,
          openedAlert.rows[0].id,
          'open',
        );
    }
  }

  private async openDeviceOfflineAlerts(
    client: PoolClient,
    organizationId: string,
    deviceId: string,
  ): Promise<void> {
    const openedAlerts = await client.query<{ id: string }>(
      `INSERT INTO alerts
         (organization_id, device_id, rule_id, severity, metric, observed_value,
          observed_at, message, opened_at)
       SELECT r.organization_id, r.device_id, r.id, r.severity, 'device_status', 0,
              now(), 'Rule "' || r.name || '": device is offline', now()
       FROM alert_rules r
       WHERE r.organization_id = $1 AND r.device_id = $2
         AND r.rule_type = 'device_offline' AND r.enabled
         AND NOT EXISTS (
           SELECT 1 FROM alerts a
           WHERE a.organization_id = $1 AND a.rule_id = r.id AND a.device_id = $2
             AND a.state = 'resolved'
             AND a.resolved_at > now() - (r.cooldown_seconds * interval '1 second')
         )
       ON CONFLICT (rule_id, device_id) WHERE state = 'open' DO NOTHING
        RETURNING id`,
      [organizationId, deviceId],
    );
    for (const alert of openedAlerts.rows)
      await this.enqueueAlertNotification(
        client,
        organizationId,
        alert.id,
        'open',
      );
  }

  private async enqueueAlertNotification(
    client: PoolClient,
    organizationId: string,
    alertId: string,
    event: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO notification_jobs (organization_id, topic, payload, idempotency_key)
        SELECT $1, 'alert.notification',
               jsonb_build_object('alertId', a.id, 'event', $3::text, 'severity', a.severity,
                 'message', a.message, 'deviceId', a.device_id),
               'alert:' || a.id::text || ':' || $3::text
       FROM alerts a WHERE a.id = $2 AND a.organization_id = $1
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [organizationId, alertId, event],
    );
  }

  private async resolveDeviceOfflineAlerts(
    client: PoolClient,
    organizationId: string,
    deviceId: string,
    resolvedAt: string,
  ): Promise<void> {
    await client.query(
      `UPDATE alerts a SET state = 'resolved', resolved_at = $3::timestamptz
       FROM alert_rules r
       WHERE a.organization_id = $1 AND a.device_id = $2 AND a.state = 'open'
         AND a.rule_id = r.id AND r.organization_id = $1
         AND r.rule_type = 'device_offline'
         AND a.opened_at <= $3::timestamptz`,
      [organizationId, deviceId, resolvedAt],
    );
  }

  private hasBreached(rule: ThresholdRule, value: number): boolean {
    switch (rule.operator) {
      case 'gt':
        return value > rule.threshold;
      case 'gte':
        return value >= rule.threshold;
      case 'lt':
        return value < rule.threshold;
      case 'lte':
        return value <= rule.threshold;
    }
  }

  private hasRecovered(rule: ThresholdRule, value: number): boolean {
    const resetThreshold =
      rule.operator === 'gt' || rule.operator === 'gte'
        ? rule.threshold - rule.hysteresis
        : rule.threshold + rule.hysteresis;
    switch (rule.operator) {
      case 'gt':
        return value <= resetThreshold;
      case 'gte':
        return value < resetThreshold;
      case 'lt':
        return value >= resetThreshold;
      case 'lte':
        return value > resetThreshold;
    }
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
    const client = await this.databaseOrThrow().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ organizationId: string; id: string }>(
        `UPDATE devices
         SET status = 'offline', updated_at = now()
         WHERE status = 'online'
           AND (last_seen_at IS NULL OR last_seen_at < now() - ($1 * interval '1 second'))
         RETURNING organization_id AS "organizationId", id`,
        [this.config.DEVICE_ONLINE_GRACE_PERIOD_SECONDS],
      );
      for (const device of result.rows) {
        await this.openDeviceOfflineAlerts(
          client,
          device.organizationId,
          device.id,
        );
      }
      await client.query('COMMIT');
      if (result.rowCount) {
        this.logger.log(`Marked ${result.rowCount} stale device(s) offline.`);
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back device presence reconciliation.',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      this.logger.error(
        'Failed to reconcile device presence.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      client.release();
    }
  }

  private startNotificationRelay(): void {
    this.notificationTimer = setInterval(
      () => void this.runNotificationRelay(),
      this.config.NOTIFICATION_POLL_INTERVAL_MS,
    );
    void this.runNotificationRelay();
  }

  private runNotificationRelay(): Promise<void> {
    if (this.activeNotificationRelay) return this.activeNotificationRelay;
    const relay = this.relayNotificationBatch()
      .catch((error: unknown) => {
        operationalMetrics.countWorkerError('notifications');
        this.logger.error(
          'Failed to relay notification jobs.',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.activeNotificationRelay === relay)
          this.activeNotificationRelay = undefined;
      });
    this.activeNotificationRelay = relay;
    return relay;
  }

  private async relayNotificationBatch(): Promise<void> {
    for (
      let count = 0;
      count < this.config.NOTIFICATION_BATCH_SIZE;
      count += 1
    ) {
      const job = await this.claimNotificationJob();
      if (!job) return;
      try {
        await this.deliverNotification(job);
        await this.databaseOrThrow().query(
          `UPDATE notification_jobs SET status = 'completed', completed_at = now(), locked_at = NULL
           WHERE id = $1`,
          [job.id],
        );
        operationalMetrics.countNotification('completed');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown delivery failure';
        const result = await this.databaseOrThrow().query<{ status: string }>(
          `UPDATE notification_jobs
           SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
               available_at = CASE WHEN attempts >= max_attempts THEN available_at
                 ELSE now() + (LEAST(3600, power(2, attempts) * 5) * interval '1 second') END,
               locked_at = NULL, last_error = $2,
               dead_lettered_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
           WHERE id = $1
           RETURNING status`,
          [job.id, message],
        );
        operationalMetrics.countNotification(
          result.rows[0]?.status === 'dead_letter' ? 'dead_letter' : 'retry',
        );
      }
    }
  }

  private async claimNotificationJob(): Promise<{
    id: string;
    organizationId: string;
    payload: {
      alertId: string;
      event: string;
      severity: string;
      message: string;
      deviceId: string;
    };
  } | null> {
    const result = await this.databaseOrThrow().query<{
      id: string;
      organizationId: string;
      payload: {
        alertId: string;
        event: string;
        severity: string;
        message: string;
        deviceId: string;
      };
    }>(
      `WITH next AS (
         SELECT id FROM notification_jobs
         WHERE (status = 'pending' AND available_at <= now())
            OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
         ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE notification_jobs j SET status = 'processing', attempts = attempts + 1, locked_at = now()
       FROM next WHERE j.id = next.id
       RETURNING j.id, j.organization_id AS "organizationId", j.payload`,
    );
    return result.rows[0] ?? null;
  }

  private async deliverNotification(job: {
    id: string;
    organizationId: string;
    payload: {
      alertId: string;
      event: string;
      severity: string;
      message: string;
      deviceId: string;
    };
  }): Promise<void> {
    const client = await this.databaseOrThrow().connect();
    let recipients: { id: string; email: string }[] = [];
    try {
      await client.query('BEGIN');
      const inbox = await client.query<{ id: string; recipientId: string }>(
        `INSERT INTO in_app_notifications
           (organization_id, recipient_id, alert_id, event_key, title, body, severity, data)
          SELECT $1::uuid, m.user_id, $2::uuid, $3::text, 'Alert ' || $4::text, $5::text, $4::text,
                 jsonb_build_object('alertId', $2::uuid, 'event', $6::text, 'deviceId', $7::uuid)
         FROM memberships m WHERE m.organization_id = $1::uuid AND m.status = 'active'
         ON CONFLICT (recipient_id, event_key) DO NOTHING
         RETURNING id, recipient_id AS "recipientId"`,
        [
          job.organizationId,
          job.payload.alertId,
          `alert:${job.payload.alertId}:${job.payload.event}`,
          job.payload.severity,
          job.payload.message,
          job.payload.event,
          job.payload.deviceId,
        ],
      );
      for (const notification of inbox.rows) {
        await client.query(
          `INSERT INTO outbox_events (organization_id, topic, payload)
            VALUES ($1, $2, jsonb_build_object('notificationId', $3::uuid, 'recipientId', $4::uuid, 'alertId', $5::uuid,
              'severity', $6::text, 'body', $7::text))`,
          [
            job.organizationId,
            notificationInboxOutboxTopic,
            notification.id,
            notification.recipientId,
            job.payload.alertId,
            job.payload.severity,
            job.payload.message,
          ],
        );
      }
      const result = await client.query<{ id: string; email: string }>(
        `SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.status = 'active'`,
        [job.organizationId],
      );
      recipients = result.rows;
      if (['high', 'critical'].includes(job.payload.severity)) {
        await client.query(
          `INSERT INTO notification_deliveries (job_id, recipient_id, channel, message_id)
            SELECT $1::uuid, u.id, 'email', 'alert-' || ($1::uuid)::text || '-' || u.id::text || '@smart-house.local'
            FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = $2::uuid AND m.status = 'active'
           ON CONFLICT (job_id, recipient_id, channel) DO NOTHING`,
          [job.id, job.organizationId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!['high', 'critical'].includes(job.payload.severity)) return;
    for (const recipient of recipients)
      await this.sendAlertEmail(job, recipient);
  }

  private async sendAlertEmail(
    job: {
      id: string;
      payload: { severity: string; message: string; alertId: string };
    },
    recipient: { id: string; email: string },
  ): Promise<void> {
    const delivery = await this.databaseOrThrow().query<{
      id: string;
      messageId: string;
    }>(
      `UPDATE notification_deliveries SET status = 'sending'
       WHERE job_id = $1 AND recipient_id = $2 AND channel = 'email' AND status IN ('pending', 'failed')
       RETURNING id, message_id AS "messageId"`,
      [job.id, recipient.id],
    );
    if (!delivery.rows[0]) return;
    try {
      await nodemailer
        .createTransport({
          host: this.config.SMTP_HOST,
          port: this.config.SMTP_PORT,
          secure: false,
        })
        .sendMail({
          from: this.config.SMTP_FROM,
          to: recipient.email,
          subject: `[${job.payload.severity.toUpperCase()}] Smart House alert`,
          text: `${job.payload.message}\n\nAlert: ${job.payload.alertId}`,
          messageId: `<${delivery.rows[0].messageId}>`,
        });
      await this.databaseOrThrow().query(
        `UPDATE notification_deliveries SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`,
        [delivery.rows[0].id],
      );
      operationalMetrics.countNotification('email_sent');
    } catch (error) {
      await this.databaseOrThrow().query(
        `UPDATE notification_deliveries SET status = 'failed', last_error = $2 WHERE id = $1`,
        [
          delivery.rows[0].id,
          error instanceof Error ? error.message : 'SMTP delivery failed',
        ],
      );
      throw error;
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

  private async measureOperationalState(): Promise<void> {
    try {
      const result = await this.databaseOrThrow().query<{
        outbox: string;
        commands: string;
        notifications: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE topic <> $1 AND processed_at IS NULL)::text AS outbox,
           count(*) FILTER (WHERE topic = $1 AND processed_at IS NULL)::text AS commands,
           (SELECT count(*) FROM notification_jobs WHERE status IN ('pending', 'processing'))::text AS notifications
         FROM outbox_events`,
        [commandPublishOutboxTopic],
      );
      const state = result.rows[0];
      if (!state) return;
      operationalMetrics.setBacklog('outbox', Number(state.outbox));
      operationalMetrics.setBacklog('commands', Number(state.commands));
      operationalMetrics.setBacklog(
        'notifications',
        Number(state.notifications),
      );
    } catch (error) {
      operationalMetrics.countWorkerError('backlog_measurement');
      this.logger.error(
        'Failed to measure operational backlogs.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private recordCertificateExpiry(): void {
    for (const [certificate, path] of [
      ['worker', this.config.MQTT_CERT_FILE],
      ['ca', this.config.MQTT_CA_FILE],
    ] as const) {
      try {
        const expiry = new X509Certificate(readFileSync(path)).validTo;
        operationalMetrics.setCertificateExpiry(
          certificate,
          Math.max(0, (Date.parse(expiry) - Date.now()) / 1_000),
        );
      } catch (error) {
        operationalMetrics.countWorkerError('certificate_expiry');
        this.logger.warn(
          `Unable to read ${certificate} certificate expiry: ${error instanceof Error ? error.message : 'unknown error'}.`,
        );
      }
    }
  }
}
