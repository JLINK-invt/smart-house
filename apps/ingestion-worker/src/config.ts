import { z } from 'zod';

const schema = z.object({
  MQTT_URL: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'mqtts:', {
      message: 'MQTT_URL must use mqtts://',
    })
    .default('mqtts://localhost:8883'),
  MQTT_CA_FILE: z.string().min(1).default('../../infra/local/certs/ca.crt'),
  MQTT_CERT_FILE: z
    .string()
    .min(1)
    .default('../../infra/local/certs/platform-worker.crt'),
  MQTT_KEY_FILE: z
    .string()
    .min(1)
    .default('../../infra/local/certs/platform-worker.key'),
  MQTT_CLIENT_ID: z.string().min(1).max(128).default('smart-house-ingestion'),
  MQTT_SESSION_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86_400)
    .default(3_600),
  MQTT_RECONNECT_PERIOD_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://smart_house:smart_house@localhost:5432/smart_house'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  TELEMETRY_OUTBOX_STREAM_KEY: z
    .string()
    .min(1)
    .default('telemetry.persisted.stream'),
  TELEMETRY_OUTBOX_PUBSUB_CHANNEL: z
    .string()
    .min(1)
    .default('telemetry.persisted'),
  TELEMETRY_OUTBOX_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000),
  TELEMETRY_OUTBOX_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .default(100),
  NOTIFICATION_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000),
  NOTIFICATION_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(25),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_FROM: z.string().email().default('alerts@smart-house.local'),
  SIMULATOR_TENANT_ID: z.string().min(1).default('demo'),
  DEVICE_ONLINE_GRACE_PERIOD_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),
  DEVICE_STATUS_RECONCILIATION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  TELEMETRY_MAX_FUTURE_SKEW_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(300),
  TELEMETRY_LATE_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400),
});

export type WorkerConfig = z.infer<typeof schema>;

export function readWorkerConfig(values: NodeJS.ProcessEnv): WorkerConfig {
  return schema.parse(values);
}
