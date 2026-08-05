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
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://smart_house:smart_house@localhost:5432/smart_house'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
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
});

export type WorkerConfig = z.infer<typeof schema>;

export function readWorkerConfig(values: NodeJS.ProcessEnv): WorkerConfig {
  return schema.parse(values);
}
