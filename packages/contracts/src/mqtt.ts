import { z } from 'zod';

const identifierSchema = z.string().min(1).max(128);
const timestampSchema = z.string().datetime();

const telemetryBaseSchema = z.object({
  messageId: identifierSchema,
  deviceId: identifierSchema,
  tenantId: z.string().min(1).max(64),
  occurredAt: timestampSchema,
});

export const temperatureTelemetrySchema = telemetryBaseSchema
  .extend({
    deviceType: z.literal('temperature_sensor'),
    metrics: z.object({
      temperature: z.object({
        value: z.number().min(-50).max(100),
        unit: z.literal('celsius'),
      }),
    }),
  })
  .strict();

export const relayTelemetrySchema = telemetryBaseSchema
  .extend({
    deviceType: z.literal('relay'),
    metrics: z.object({
      relayState: z.object({
        value: z.boolean(),
        unit: z.literal('boolean'),
      }),
    }),
  })
  .strict();

export const telemetrySchema = z.union([
  temperatureTelemetrySchema,
  relayTelemetrySchema,
]);

export const commandAckSchema = z
  .object({
    messageId: identifierSchema,
    commandId: identifierSchema,
    tenantId: z.string().min(1).max(64),
    deviceId: identifierSchema,
    status: z.enum(['acknowledged', 'failed']),
    occurredAt: timestampSchema,
    result: z.object({ state: z.enum(['on', 'off']) }).optional(),
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(256),
      })
      .optional(),
  })
  .strict();

export type Telemetry = z.infer<typeof telemetrySchema>;
export type TemperatureTelemetry = z.infer<typeof temperatureTelemetrySchema>;
export type RelayTelemetry = z.infer<typeof relayTelemetrySchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
