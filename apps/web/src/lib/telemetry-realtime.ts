import type { LatestTelemetry } from "@smart-house/contracts";

export type HistoricalTelemetryPoint = {
  occurredAt: string;
  value: number;
  unit: string;
};

export type TelemetryReading = LatestTelemetry[number];

export type PersistedTelemetryEvent = {
  eventId: string;
  correlationId: string;
  telemetry: {
    deviceId: string;
    occurredAt: string;
    readings: Array<{ metric: string; value: number; unit: string }>;
  };
};

const maximumRememberedEventIds = 500;

function readingKey(reading: Pick<TelemetryReading, "deviceId" | "metric">) {
  return `${reading.deviceId}\u0000${reading.metric}`;
}

function isNewer(
  candidate: Pick<TelemetryReading, "occurredAt">,
  current: Pick<TelemetryReading, "occurredAt">,
) {
  return Date.parse(candidate.occurredAt) > Date.parse(current.occurredAt);
}

export function mergeTelemetrySnapshot(
  current: readonly TelemetryReading[],
  snapshot: readonly TelemetryReading[],
): TelemetryReading[] {
  const merged = new Map(current.map((reading) => [readingKey(reading), reading]));

  for (const reading of snapshot) {
    const previous = merged.get(readingKey(reading));
    if (!previous || isNewer(reading, previous)) merged.set(readingKey(reading), reading);
  }

  return [...merged.values()];
}

export function mergeTelemetrySeries(
  current: readonly HistoricalTelemetryPoint[],
  incoming: readonly HistoricalTelemetryPoint[],
): HistoricalTelemetryPoint[] {
  const points = new Map(current.map((point) => [point.occurredAt, point]));
  for (const point of incoming) points.set(point.occurredAt, point);
  return [...points.values()].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );
}

export function applyPersistedTelemetry(
  current: readonly TelemetryReading[],
  seenEventIds: readonly string[],
  event: PersistedTelemetryEvent,
) {
  if (seenEventIds.includes(event.eventId)) {
    return { readings: [...current], seenEventIds: [...seenEventIds], applied: false };
  }

  const readings = mergeTelemetrySnapshot(
    current,
    event.telemetry.readings.map((reading) => ({
      ...reading,
      deviceId: event.telemetry.deviceId,
      occurredAt: event.telemetry.occurredAt,
      correlationId: event.correlationId,
    })),
  );
  const updatedEventIds = [...seenEventIds, event.eventId].slice(
    -maximumRememberedEventIds,
  );

  return { readings, seenEventIds: updatedEventIds, applied: true };
}

export function parsePersistedTelemetryEvent(
  value: unknown,
): PersistedTelemetryEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const telemetry = event.telemetry;
  if (!telemetry || typeof telemetry !== "object") return null;
  const payload = telemetry as Record<string, unknown>;

  if (
    typeof event.eventId !== "string" ||
    typeof event.correlationId !== "string" ||
    typeof payload.deviceId !== "string" ||
    typeof payload.occurredAt !== "string" ||
    Number.isNaN(Date.parse(payload.occurredAt)) ||
    !Array.isArray(payload.readings)
  ) {
    return null;
  }

  const readings = payload.readings.filter(
    (reading): reading is { metric: string; value: number; unit: string } =>
      !!reading &&
      typeof reading === "object" &&
      typeof (reading as Record<string, unknown>).metric === "string" &&
      typeof (reading as Record<string, unknown>).value === "number" &&
      typeof (reading as Record<string, unknown>).unit === "string",
  );

  return readings.length === 0
    ? null
    : {
        eventId: event.eventId,
        correlationId: event.correlationId,
        telemetry: {
          deviceId: payload.deviceId,
          occurredAt: payload.occurredAt,
          readings,
        },
      };
}
