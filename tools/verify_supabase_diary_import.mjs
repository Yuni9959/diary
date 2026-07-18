import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

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

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("Auth token was returned in an unexpected format.");
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function restHeaders(key, token = null, extra = {}) {
  const headers = {
    apikey: key,
    "Accept-Profile": "diary",
    "Content-Profile": "diary",
    ...extra,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function signIn(env) {
  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
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

  const auth = await assertOk(response, "sign in");
  if (!auth?.access_token) {
    throw new Error("sign in failed: access token was not returned");
  }

  const payload = decodeJwtPayload(auth.access_token);
  if (!payload.sub) {
    throw new Error("sign in failed: user id was not present in token payload");
  }

  return auth.access_token;
}

async function queryDates(env, token = null) {
  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const response = await fetch(
    `${baseUrl}/rest/v1/entries?select=entry_date&order=entry_date.asc`,
    {
      headers: restHeaders(env.SUPABASE_PUBLISHABLE_KEY, token),
    },
  );
  const rows = await assertOk(response, "query diary entries");
  return rows.map((row) => row.entry_date);
}

async function assertAnonymousWriteAllowed(env, cleanupToken) {
  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const entryDate = "2099-12-31";
  const endpoint = `${baseUrl}/rest/v1/entries?on_conflict=entry_date&select=id,entry_date,title`;
  const cleanupEndpoint = `${baseUrl}/rest/v1/entries?entry_date=eq.${entryDate}`;

  await assertOk(
    await fetch(cleanupEndpoint, {
      method: "DELETE",
      headers: restHeaders(key, cleanupToken, { Prefer: "return=minimal" }),
    }),
    "clean anonymous write probe before test",
  );

  try {
    for (const title of ["Anonymous write probe", "Anonymous write probe updated"]) {
      const rows = await assertOk(
        await fetch(endpoint, {
          method: "POST",
          headers: restHeaders(key, null, {
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation",
          }),
          body: JSON.stringify({
            entry_date: entryDate,
            title,
            body: "Anonymous write probe.",
            body_format: "plain",
            metadata: {
              temporary: true,
              source: "tools/verify_supabase_diary_import.mjs",
            },
          }),
        }),
        `anonymous upsert (${title})`,
      );
      if (rows.length !== 1 || rows[0].entry_date !== entryDate) {
        throw new Error(`anonymous upsert returned an unexpected result (${title}).`);
      }
    }

    const rows = await assertOk(
      await fetch(`${baseUrl}/rest/v1/entries?entry_date=eq.${entryDate}&select=entry_date,title`, {
        headers: restHeaders(key),
      }),
      "query anonymous write probe",
    );
    if (rows.length !== 1 || rows[0].title !== "Anonymous write probe updated") {
      throw new Error("anonymous same-date upsert did not update exactly one row.");
    }
  } finally {
    await fetch(cleanupEndpoint, {
      method: "DELETE",
      headers: restHeaders(key, cleanupToken, { Prefer: "return=minimal" }),
    }).catch(() => undefined);
  }
}

function printDateSummary(label, dates) {
  console.log(`${label} visible count: ${dates.length}`);
  console.log(`${label} first date: ${dates[0] || "none"}`);
  console.log(`${label} last date: ${dates[dates.length - 1] || "none"}`);
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(".env.local was not found.");
  }

  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  requireEnv(env);

  const publicDates = await queryDates(env);
  console.log("anonymous read: ok");
  printDateSummary("anonymous", publicDates);

  const token = await signIn(env);
  console.log("sign in: ok");
  const signedInDates = await queryDates(env, token);

  if (signedInDates.join("|") !== publicDates.join("|")) {
    throw new Error("signed-in read does not match anonymous public read.");
  }

  await assertAnonymousWriteAllowed(env, token);
  console.log("anonymous create and same-date update: ok");

  console.log(`sample dates: ${publicDates.slice(0, 5).join(", ")}`);
  console.log("verification: ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
