import assert from "node:assert/strict";
import test from "node:test";
import { mergeAlertStatus, parseAlertStatusEvent } from "./alert-realtime.ts";

const event = {
  eventId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  alert: { id: "22222222-2222-4222-8222-222222222222", ruleId: "55555555-5555-4555-8555-555555555555", deviceId: "44444444-4444-4444-8444-444444444444", metric: "temperature", observedValue: 31, observedAt: "2026-01-01T00:00:00.000Z", message: "High temperature", severity: "high" as const, state: "acknowledged" as const, openedAt: "2026-01-01T00:00:00.000Z", resolvedAt: null },
};

test("validates and reconciles alert status events by alert ID", () => {
  const parsed = parseAlertStatusEvent(event);
  assert.ok(parsed);
  assert.deepEqual(mergeAlertStatus([{ ...event.alert, state: "open" }], parsed), [event.alert]);
});

test("rejects malformed alert status events", () => {
  assert.equal(parseAlertStatusEvent({ eventId: "not-a-uuid" }), null);
});
