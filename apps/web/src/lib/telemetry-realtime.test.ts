import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPersistedTelemetry,
  mergeTelemetrySeries,
  mergeTelemetrySnapshot,
} from "./telemetry-realtime.ts";

const initialReading = {
  deviceId: "temp-001",
  metric: "temperature",
  value: 20,
  unit: "celsius",
  occurredAt: "2026-08-06T10:00:00.000Z",
  correlationId: "first",
};

test("keeps the newest reading for each device and metric", () => {
  const readings = mergeTelemetrySnapshot([initialReading], [
    { ...initialReading, value: 18, occurredAt: "2026-08-06T09:00:00.000Z" },
    { ...initialReading, value: 22, occurredAt: "2026-08-06T11:00:00.000Z" },
  ]);

  assert.deepEqual(readings, [
    { ...initialReading, value: 22, occurredAt: "2026-08-06T11:00:00.000Z" },
  ]);
});

test("merges historical and realtime points in timestamp order without duplicates", () => {
  const points = mergeTelemetrySeries(
    [
      { occurredAt: "2026-08-06T10:00:00.000Z", value: 20, unit: "celsius" },
      { occurredAt: "2026-08-06T10:10:00.000Z", value: 22, unit: "celsius" },
    ],
    [
      { occurredAt: "2026-08-06T10:05:00.000Z", value: 21, unit: "celsius" },
      { occurredAt: "2026-08-06T10:10:00.000Z", value: 23, unit: "celsius" },
    ],
  );
  assert.deepEqual(points, [
    { occurredAt: "2026-08-06T10:00:00.000Z", value: 20, unit: "celsius" },
    { occurredAt: "2026-08-06T10:05:00.000Z", value: 21, unit: "celsius" },
    { occurredAt: "2026-08-06T10:10:00.000Z", value: 23, unit: "celsius" },
  ]);
});

test("deduplicates events and does not replace newer readings with old events", () => {
  const event = {
    eventId: "event-1",
    correlationId: "late",
    telemetry: {
      deviceId: "temp-001",
      occurredAt: "2026-08-06T09:00:00.000Z",
      readings: [{ metric: "temperature", value: 18, unit: "celsius" }],
    },
  };
  const first = applyPersistedTelemetry([initialReading], [], event);
  const duplicate = applyPersistedTelemetry(first.readings, first.seenEventIds, event);

  assert.deepEqual(first.readings, [initialReading]);
  assert.equal(first.applied, true);
  assert.equal(duplicate.applied, false);
});
