import { z } from 'zod';

const schema = z.object({
  MQTT_URL: z.string().url().default('mqtt://localhost:1883'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://smart_house:smart_house@localhost:5432/smart_house'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SIMULATOR_TENANT_ID: z.string().min(1).default('demo'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function readWorkerConfig(values: NodeJS.ProcessEnv): WorkerConfig {
  return schema.parse(values);
}
