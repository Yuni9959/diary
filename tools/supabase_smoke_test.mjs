import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const ENV_PATH = ".env.local";
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "DIARY_TEST_EMAIL",
  "DIARY_TEST_PASSWORD",
];

function parseEnv(text) {
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function requireEnv(env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required .env.local values: ${missing.join(", ")}`);
  }
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function assertOk(response, step) {
  const body = await readJson(response);
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || response.statusText;
    throw new Error(`${step} failed (${response.status}): ${message}`);
  }

  return body;
}

function restHeaders(key, token, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept-Profile": "diary",
    "Content-Profile": "diary",
    ...extra,
  };
}

function makeTemporaryEntryDate() {
  const now = Date.now();
  const dayOffset = now % 3650;
  const date = new Date(Date.UTC(2090, 0, 1 + dayOffset));
  return date.toISOString().slice(0, 10);
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(".env.local was not found. Create it from .env.example before running this smoke test.");
  }

  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  requireEnv(env);

  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;

  const authResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: env.DIARY_TEST_EMAIL,
      password: env.DIARY_TEST_PASSWORD,
    }),
  });

  const authBody = await assertOk(authResponse, "sign in");
  const token = authBody?.access_token;
  if (!token) {
    throw new Error("sign in failed: access token was not returned");
  }
  console.log("sign in: ok");

  const marker = `smoke-${new Date().toISOString()}`;
  const entryDate = makeTemporaryEntryDate();
  let inserted;

  try {
    const insertResponse = await fetch(`${baseUrl}/rest/v1/entries?select=*`, {
      method: "POST",
      headers: restHeaders(key, token, { Prefer: "return=representation" }),
      body: JSON.stringify({
        entry_date: entryDate,
        title: "Temporary smoke test entry",
        body: "Temporary entry created by tools/supabase_smoke_test.mjs.",
        body_format: "plain",
        mood: "smoke-test",
        metadata: {
          temporary: true,
          marker,
          source: "tools/supabase_smoke_test.mjs",
        },
      }),
    });

    const insertedRows = await assertOk(insertResponse, "insert entry");
    inserted = insertedRows?.[0];
    if (!inserted?.id) {
      throw new Error("insert entry failed: inserted row id was not returned");
    }
    console.log("insert: ok");

    const selectResponse = await fetch(
      `${baseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(inserted.id)}&select=*`,
      {
        headers: restHeaders(key, token),
      },
    );
    const selectedRows = await assertOk(selectResponse, "select entry");
    if (selectedRows.length !== 1 || selectedRows[0].metadata?.marker !== marker) {
      throw new Error("select entry failed: temporary row was not returned");
    }
    console.log("select: ok");

    const updateResponse = await fetch(
      `${baseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(inserted.id)}&select=*`,
      {
        method: "PATCH",
        headers: restHeaders(key, token, { Prefer: "return=representation" }),
        body: JSON.stringify({
          title: "Temporary smoke test entry updated",
          metadata: {
            temporary: true,
            marker,
            updated: true,
            source: "tools/supabase_smoke_test.mjs",
          },
        }),
      },
    );
    const updatedRows = await assertOk(updateResponse, "update entry");
    if (updatedRows.length !== 1 || updatedRows[0].metadata?.updated !== true) {
      throw new Error("update entry failed: updated row was not returned");
    }
    console.log("update: ok");

    const deleteResponse = await fetch(
      `${baseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(inserted.id)}`,
      {
        method: "DELETE",
        headers: restHeaders(key, token, { Prefer: "return=minimal" }),
      },
    );
    await assertOk(deleteResponse, "delete entry");
    console.log("delete: ok");

    const confirmResponse = await fetch(
      `${baseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(inserted.id)}&select=id`,
      {
        headers: restHeaders(key, token),
      },
    );
    const confirmRows = await assertOk(confirmResponse, "confirm delete");
    if (confirmRows.length !== 0) {
      throw new Error("confirm delete failed: temporary row still exists");
    }
    console.log("confirm delete: ok");
  } catch (error) {
    if (inserted?.id) {
      await fetch(`${baseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(inserted.id)}`, {
        method: "DELETE",
        headers: restHeaders(key, token, { Prefer: "return=minimal" }),
      }).catch(() => undefined);
    }

    throw error;
  }

  console.log("supabase smoke test: ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
