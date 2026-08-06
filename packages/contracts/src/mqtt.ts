import { z } from 'zod';

export const telemetrySchemaVersion = '1.0' as const;
export const maxTelemetryPayloadBytes = 8 * 1024;

const identifierSchema = z.string().min(1).max(128);
const timestampSchema = z.string().datetime({ offset: true });

const telemetryBaseSchema = z.object({
  schemaVersion: z.literal(telemetrySchemaVersion),
  messageId: identifierSchema,
  deviceId: identifierSchema,
  tenantId: z.string().min(1).max(64),
  occurredAt: timestampSchema,
});

export const temperatureTelemetrySchema = telemetryBaseSchema
  .extend({
    deviceType: z.literal('temperature_sensor'),
    metrics: z.object({
      temperature: z.discriminatedUnion('unit', [
        z.object({
          value: z.number().min(-50).max(100),
          unit: z.literal('celsius'),
        }),
        z.object({
          value: z.number().min(-58).max(212),
          unit: z.literal('fahrenheit'),
        }),
      ]),
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

export function parseTelemetryPayload(payload: string | Uint8Array): Telemetry {
  const bytes =
    typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  if (bytes.byteLength > maxTelemetryPayloadBytes) {
    throw new Error(
      `Telemetry payload exceeds ${maxTelemetryPayloadBytes} bytes.`,
    );
  }

  const text =
    typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  return telemetrySchema.parse(JSON.parse(text));
}

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
