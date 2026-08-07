import assert from "node:assert/strict";
import test from "node:test";
import { mergeCommandStatus, parseCommandStatusEvent } from "./command-realtime.ts";

const event = {
  eventId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  command: {
    id: "22222222-2222-4222-8222-222222222222",
    type: "relay.set",
    status: "acknowledged" as const,
    expiresAt: "2026-08-06T10:05:00.000Z",
    createdAt: "2026-08-06T10:00:00.000Z",
    error: null,
  },
};

test("validates and reconciles a command status event by command ID", () => {
  const parsed = parseCommandStatusEvent(event);
  assert.deepEqual(parsed, event);
  assert.deepEqual(
    mergeCommandStatus(
      [{ ...event.command, status: "sent" as const }],
      parsed!,
    ),
    [event.command],
  );
});

test("rejects malformed command status events", () => {
  assert.equal(parseCommandStatusEvent({ organizationId: event.organizationId }), null);
});
