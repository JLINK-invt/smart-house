import { z } from 'zod';

export const MAX_MQTT_PAYLOAD_BYTES = 8 * 1024;

export const messageIdSchema = z.string().min(1).max(128);
export const tenantIdSchema = z.string().min(1).max(64);
export const deviceIdSchema = z.string().min(1).max(128);
export const isoDateSchema = z.string().datetime({ offset: true });

export function parseJsonPayload(
  payload: Buffer,
  maximumBytes = MAX_MQTT_PAYLOAD_BYTES,
): unknown {
  if (payload.byteLength > maximumBytes) {
    throw new Error(`MQTT payload exceeds ${maximumBytes} bytes`);
  }

  return JSON.parse(payload.toString('utf8')) as unknown;
}
