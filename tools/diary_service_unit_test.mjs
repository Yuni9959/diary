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
    if (method === "DELETE" && url.includes("entry_date=eq.2099-01-01")) {
      return jsonResponse([{ id: "entry-1" }]);
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
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  assert(!requests.some((request) => request.method === "GET"));

  await assert.rejects(() => service.createEntryComment("entry-1", "   "), /body is required/);
  const comment = await service.createEntryComment("entry-1", "  short reply  ");
  assert.deepEqual(comment, {
    id: "comment-1",
    entryId: "entry-1",
    body: "short reply",
    createdAt: "2026-07-19T00:00:00Z",
  });
}

async function testEntryWritesRequireOneReturnedRow() {
  const requests = [];
  const service = createDiaryService({
    supabaseUrl: TEST_URL,
    publishableKey: TEST_KEY,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    () => service.upsertEntryByDate({
      entry_date: "2099-01-02",
      title: "Test",
      body: "Test body",
    }),
    /upsert did not affect a diary entry/,
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /select=id,entry_date,title,body,body_format,mood,metadata,source/);
  assert(!requests[0].url.includes("select=*"));
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[0].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
}

async function testExpiredStoredSessionIsCleared() {
  const originalWindow = globalThis.window;
  const stored = new Map();
  const expiredToken = testToken("expired-user");
  stored.set("diary.supabase.session", JSON.stringify({
    access_token: expiredToken,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  }));
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };

  try {
    const client = createSupabaseClient({
      supabaseUrl: TEST_URL,
      publishableKey: TEST_KEY,
      fetchImpl: async () => jsonResponse([]),
    });

    assert.equal(client.getSession(), null);
    assert.equal(client.getUserId(), null);
    assert.equal(stored.has("diary.supabase.session"), false);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

await testPlainTextErrorsKeepHttpContext();
await testBlockedStorageDoesNotBreakSignIn();
await testServiceMethodsDoNotDependOnCallBinding();
await testEntryWritesRequireOneReturnedRow();
await testExpiredStoredSessionIsCleared();

console.log("diary service unit test: ok");
