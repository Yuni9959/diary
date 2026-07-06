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

function restHeaders(key, token) {
  return {
    apikey: key,
    Authorization: `Bearer ${token}`,
    "Accept-Profile": "diary",
    "Content-Profile": "diary",
  };
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

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(".env.local was not found.");
  }

  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  requireEnv(env);

  const token = await signIn(env);
  console.log("sign in: ok");

  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const response = await fetch(
    `${baseUrl}/rest/v1/entries?select=entry_date&order=entry_date.asc`,
    {
      headers: restHeaders(env.SUPABASE_PUBLISHABLE_KEY, token),
    },
  );
  const rows = await assertOk(response, "query diary entries");
  const dates = rows.map((row) => row.entry_date);

  console.log(`visible count: ${dates.length}`);
  console.log(`first date: ${dates[0] || "none"}`);
  console.log(`last date: ${dates[dates.length - 1] || "none"}`);
  console.log(`sample dates: ${dates.slice(0, 5).join(", ")}`);
  console.log("verification: ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
