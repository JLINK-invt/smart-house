import {
  normalizeTelemetry,
  type TelemetryNormalizationOptions,
} from './telemetry-normalizer';
import {
  relayTelemetrySchema,
  temperatureTelemetrySchema,
} from '@smart-house/contracts';

const options: TelemetryNormalizationOptions = {
  receivedAt: new Date('2026-08-06T12:01:00.000Z'),
  maxFutureSkewMs: 5 * 60_000,
  lateAfterMs: 24 * 60 * 60_000,
  maxPastAgeMs: 7 * 24 * 60 * 60_000,
};

describe('normalizeTelemetry', () => {
  it('converts Fahrenheit to Celsius and preserves its source', () => {
    const telemetry = temperatureTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: 'message-1',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-08-06T12:00:00.000Z',
      metrics: { temperature: { value: 75.2, unit: 'fahrenheit' } },
    });

    expect(normalizeTelemetry(telemetry, options)).toMatchObject({
      receivedAt: '2026-08-06T12:01:00.000Z',
      timeQuality: 'on_time',
      readings: [
        {
          metric: 'temperature',
          value: 24,
          unit: 'celsius',
          sourceValue: 75.2,
          sourceUnit: 'fahrenheit',
        },
      ],
    });
  });

  it('keeps relay state as a canonical boolean', () => {
    const telemetry = relayTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: 'message-2',
      tenantId: 'demo',
      deviceId: 'relay-1',
      deviceType: 'relay',
      occurredAt: '2026-08-06T12:00:00.000Z',
      metrics: { relayState: { value: true, unit: 'boolean' } },
    });

    expect(normalizeTelemetry(telemetry, options).readings[0]).toEqual({
      metric: 'relayState',
      value: true,
      unit: 'boolean',
      sourceValue: true,
      sourceUnit: 'boolean',
    });
  });

  it('rejects occurredAt beyond the future-skew allowance', () => {
    const telemetry = temperatureTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: 'message-3',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-08-06T12:06:00.001Z',
      metrics: { temperature: { value: 24, unit: 'celsius' } },
    });

    expect(() => normalizeTelemetry(telemetry, options)).toThrow(
      'allowed future skew',
    );
  });

  it('preserves old occurredAt values and classifies them as late', () => {
    const telemetry = temperatureTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: 'message-4',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-08-05T12:00:59.999Z',
      metrics: { temperature: { value: 24, unit: 'celsius' } },
    });

    const normalized = normalizeTelemetry(telemetry, options);
    expect(normalized.occurredAt).toBe('2026-08-05T12:00:59.999Z');
    expect(normalized.timeQuality).toBe('late');
  });

  it('rejects occurredAt values outside the replay window', () => {
    const telemetry = temperatureTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: 'message-5',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-07-30T12:00:59.999Z',
      metrics: { temperature: { value: 24, unit: 'celsius' } },
    });

    expect(() => normalizeTelemetry(telemetry, options)).toThrow(
      'allowed past age',
    );
  });
});
