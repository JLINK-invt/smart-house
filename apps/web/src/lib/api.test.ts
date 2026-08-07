import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceCommand, getOrganizations, UnauthorizedApiError } from "./api.ts";

test("reports a 401 organization request as an expired session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });

  try {
    await assert.rejects(getOrganizations("expired"), UnauthorizedApiError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends an explicitly confirmed relay command only once per request", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return Response.json({
      id: "command-1",
      type: "relay.set",
      status: "pending",
      expiresAt: "2026-08-07T10:30:00.000Z",
    });
  };

  try {
    await createDeviceCommand("token", "organization-1", "device-1", {
      type: "relay.set",
      payload: { state: "on" },
      confirmed: true,
    });
    assert.equal(request?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.body)), {
      type: "relay.set",
      payload: { state: "on" },
      confirmed: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a 403 organization request distinct from an expired session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 403 });

  try {
    assert.deepEqual(await getOrganizations("forbidden"), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
