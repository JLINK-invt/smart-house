import type { Telemetry } from '@smart-house/contracts';

export type TimeQuality = 'on_time' | 'late';

type NormalizedReading =
  | {
      metric: 'temperature';
      value: number;
      unit: 'celsius';
      sourceValue: number;
      sourceUnit: 'celsius' | 'fahrenheit';
    }
  | {
      metric: 'relayState';
      value: boolean;
      unit: 'boolean';
      sourceValue: boolean;
      sourceUnit: 'boolean';
    };

export type NormalizedTelemetry = Omit<Telemetry, 'metrics'> & {
  receivedAt: string;
  timeQuality: TimeQuality;
  readings: NormalizedReading[];
};

export type TelemetryNormalizationOptions = {
  receivedAt: Date;
  maxFutureSkewMs: number;
  lateAfterMs: number;
  maxPastAgeMs: number;
};

export function normalizeTelemetry(
  telemetry: Telemetry,
  options: TelemetryNormalizationOptions,
): NormalizedTelemetry {
  const occurredAtMs = Date.parse(telemetry.occurredAt);
  const receivedAtMs = options.receivedAt.getTime();
  if (occurredAtMs - receivedAtMs > options.maxFutureSkewMs) {
    throw new Error('Telemetry occurredAt exceeds the allowed future skew.');
  }
  if (receivedAtMs - occurredAtMs > options.maxPastAgeMs) {
    throw new Error('Telemetry occurredAt exceeds the allowed past age.');
  }

  const timeQuality: TimeQuality =
    receivedAtMs - occurredAtMs > options.lateAfterMs ? 'late' : 'on_time';
  const readings: NormalizedReading[] =
    telemetry.deviceType === 'temperature_sensor'
      ? [normalizeTemperature(telemetry.metrics.temperature)]
      : [
          {
            metric: 'relayState',
            value: telemetry.metrics.relayState.value,
            unit: 'boolean',
            sourceValue: telemetry.metrics.relayState.value,
            sourceUnit: telemetry.metrics.relayState.unit,
          },
        ];

  return {
    schemaVersion: telemetry.schemaVersion,
    messageId: telemetry.messageId,
    deviceId: telemetry.deviceId,
    tenantId: telemetry.tenantId,
    occurredAt: telemetry.occurredAt,
    deviceType: telemetry.deviceType,
    receivedAt: options.receivedAt.toISOString(),
    timeQuality,
    readings,
  };
}

function normalizeTemperature(
  source: Extract<
    Telemetry,
    { deviceType: 'temperature_sensor' }
  >['metrics']['temperature'],
): Extract<NormalizedReading, { metric: 'temperature' }> {
  const value =
    source.unit === 'fahrenheit'
      ? Number((((source.value - 32) * 5) / 9).toFixed(6))
      : source.value;
  return {
    metric: 'temperature',
    value,
    unit: 'celsius',
    sourceValue: source.value,
    sourceUnit: source.unit,
  };
}
