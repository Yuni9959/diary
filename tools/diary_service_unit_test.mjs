import assert from "node:assert/strict";

import { createDiaryService } from "../lib/diary-service.js";
import { createSupabaseClient } from "../lib/supabase-client.js";

const TEST_URL = "https://example.supabase.co";
const TEST_KEY = "sb_publishable_test";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function testToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString("base64url");
  return `e30.${payload}.signature`;
}

async function testPlainTextErrorsKeepHttpContext() {
  const client = createSupabaseClient({
    supabaseUrl: TEST_URL,
    publishableKey: TEST_KEY,
    fetchImpl: async () => new Response("gateway unavailable", { status: 502 }),
  });

  await assert.rejects(
    () => client.request("/rest/v1/entries"),
    /Supabase request failed \(502\): gateway unavailable/,
  );
}

async function testBlockedStorageDoesNotBreakSignIn() {
  const originalWindow = globalThis.window;
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() {
      throw new Error("storage blocked");
    },
  });
  globalThis.window = blockedWindow;

  try {
    const accessToken = testToken("user-1");
    const client = createSupabaseClient({
      supabaseUrl: TEST_URL,
      publishableKey: TEST_KEY,
      fetchImpl: async () => jsonResponse({ access_token: accessToken }),
    });
    const session = await client.signInWithPassword("wife@example.com", "test-password");

    assert.equal(session.access_token, accessToken);
    assert.equal(client.getUserId(), "user-1");
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

async function testServiceMethodsDoNotDependOnCallBinding() {
  const requests = [];
  const accessToken = testToken("user-2");
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({ url, method, body: options.body });

    if (url.includes("/auth/v1/token")) {
      return jsonResponse({ access_token: accessToken });
    }
    if (method === "GET" && url.includes("entry_date=eq.2099-01-01")) {
      return jsonResponse([{ id: "entry-1" }]);
    }
    if (method === "DELETE" && url.includes("id=eq.entry-1")) {
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.includes("/rest/v1/entry_comments")) {
      const body = JSON.parse(options.body);
      return jsonResponse([{
        id: "comment-1",
        entry_id: body.entry_id,
        body: body.body,
        created_at: "2026-07-19T00:00:00Z",
      }]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const service = createDiaryService({
    supabaseUrl: TEST_URL,
    publishableKey: TEST_KEY,
    fetchImpl,
  });
  assert.equal(service.isSupabaseConfigured(), true);
  await service.signInWithPassword("wife@example.com", "test-password");

  const deleteEntryByDate = service.deleteEntryByDate;
  assert.equal(await deleteEntryByDate("2099-01-01"), true);
  assert(requests.some((request) => request.method === "DELETE"));

  await assert.rejects(() => service.createEntryComment("entry-1", "   "), /body is required/);
  const comment = await service.createEntryComment("entry-1", "  short reply  ");
  assert.deepEqual(comment, {
    id: "comment-1",
    entryId: "entry-1",
    body: "short reply",
    createdAt: "2026-07-19T00:00:00Z",
  });
}

await testPlainTextErrorsKeepHttpContext();
await testBlockedStorageDoesNotBreakSignIn();
await testServiceMethodsDoNotDependOnCallBinding();

console.log("diary service unit test: ok");
