import assert from "node:assert/strict";
import test from "node:test";
import { getOrganizations, UnauthorizedApiError } from "./api.ts";

test("reports a 401 organization request as an expired session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });

  try {
    await assert.rejects(getOrganizations("expired"), UnauthorizedApiError);
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
