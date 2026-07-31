import { z } from 'zod';

export const latestTelemetrySchema = z.array(
  z.object({
    deviceId: z.string(),
    metric: z.string(),
    value: z.number(),
    unit: z.string(),
    occurredAt: z.string().datetime(),
    correlationId: z.string(),
  }),
);

export type LatestTelemetry = z.infer<typeof latestTelemetrySchema>;
