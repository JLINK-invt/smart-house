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

export const commandStatusEventSchema = z.object({
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  command: z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    status: z.enum(['pending', 'sent', 'acknowledged', 'failed', 'expired']),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .nullable(),
  }),
});

export type CommandStatusEvent = z.infer<typeof commandStatusEventSchema>;

export const alertStatusEventSchema = z.object({
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  alert: z.object({
    id: z.string().uuid(),
    ruleId: z.string().uuid(),
    deviceId: z.string().uuid(),
    metric: z.string().min(1),
    observedValue: z.number(),
    observedAt: z.string().datetime(),
    message: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    state: z.enum(['open', 'acknowledged', 'resolved', 'silenced']),
    openedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
  }),
});

export type AlertStatusEvent = z.infer<typeof alertStatusEventSchema>;
