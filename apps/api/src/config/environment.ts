import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://smart_house:smart_house@localhost:5432/smart_house'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(values: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(values);
}
