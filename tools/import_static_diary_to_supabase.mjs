import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ENV_PATH = ".env.local";
const SCRIPT_VERSION = "1.0.0";
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "DIARY_TEST_EMAIL",
  "DIARY_TEST_PASSWORD",
];

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");

  if (dryRun && apply) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

  if (!dryRun && !apply) {
    throw new Error("Refusing to run without --dry-run or --apply.");
  }

  return { dryRun, apply };
}

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

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "")) {
    throw new Error(`${label} is not a valid UUID.`);
  }
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
  assertUuid(payload.sub, "authenticated user id");
  return { accessToken: auth.access_token, userId: payload.sub };
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

async function detectDataRoot() {
  const candidates = ["data", path.join("Diary_formyWife", "data")];

  for (const root of candidates) {
    const indexPath = path.join(root, "diary-index.json");
    const entriesPath = path.join(root, "entries");
    const textsPath = path.join(root, "texts");

    if (existsSync(indexPath) && existsSync(entriesPath) && existsSync(textsPath)) {
      return { root, indexPath, entriesPath, textsPath };
    }
  }

  throw new Error("Could not find static diary data root.");
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function normalizeIndexDates(indexData) {
  if (Array.isArray(indexData)) {
    return indexData.map((item) => item.date || item.entry_date).filter(Boolean);
  }

  if (Array.isArray(indexData.entries)) {
    return indexData.entries.map((item) => item.date || item.entry_date).filter(Boolean);
  }

  return Object.keys(indexData);
}

async function loadEntry(dataRoot, date) {
  const entryPath = path.join(dataRoot.entriesPath, `${date}.json`);
  const textPath = path.join(dataRoot.textsPath, `${date}.txt`);

  if (!existsSync(entryPath)) {
    throw new Error(`Missing entry JSON for ${date}: ${entryPath}`);
  }

  if (!existsSync(textPath)) {
    throw new Error(`Missing entry text for ${date}: ${textPath}`);
  }

  const entry = JSON.parse(await readFile(entryPath, "utf8"));
  const body = (await readFile(textPath, "utf8")).trim();
  const sourceMd = typeof entry.sourceMd === "string" ? entry.sourceMd : null;
  const bodyFormat = sourceMd && sourceMd.endsWith(".md") ? "markdown" : "plain";
  const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : date;

  return {
    date,
    record: {
      entry_date: date,
      title,
      body,
      body_format: bodyFormat,
      mood: typeof entry.mood === "string" && entry.mood.trim() ? entry.mood.trim() : null,
      source: "static_import",
      metadata: {
        source_paths: {
          entry_json: entryPath.replace(/\\/g, "/"),
          body_text: textPath.replace(/\\/g, "/"),
          source_md: sourceMd,
        },
        import_script: "tools/import_static_diary_to_supabase.mjs",
        import_script_version: SCRIPT_VERSION,
        imported_at: new Date().toISOString(),
        original_entry_id: entry.id || null,
      },
    },
    sourcePaths: [entryPath, textPath],
  };
}

async function buildRecords(userId) {
  const dataRoot = await detectDataRoot();
  const indexData = JSON.parse(await readFile(dataRoot.indexPath, "utf8"));
  const indexDates = normalizeIndexDates(indexData);
  const entryFiles = (await readdir(dataRoot.entriesPath))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => file.slice(0, 10));
  const dates = [...new Set([...indexDates, ...entryFiles])].sort();

  if (dates.length === 0) {
    throw new Error("No diary entries were found.");
  }

  const invalidDates = dates.filter((date) => !isDate(date));
  if (invalidDates.length > 0) {
    throw new Error(`Invalid entry dates found: ${invalidDates.join(", ")}`);
  }

  const duplicateDates = dates.filter((date, index) => dates.indexOf(date) !== index);
  if (duplicateDates.length > 0) {
    throw new Error(`Duplicate dates found: ${[...new Set(duplicateDates)].join(", ")}`);
  }

  const records = [];
  for (const date of dates) {
    const entry = await loadEntry(dataRoot, date);
    if (!entry.record.entry_date) {
      throw new Error(`Missing entry_date for ${date}`);
    }
    if (!entry.record.title) {
      entry.record.title = date;
    }
    if (!entry.record.body) {
      throw new Error(`Empty body for ${date}`);
    }

    records.push({
      ...entry,
      record: {
        ...entry.record,
        owner_id: userId,
        created_by: userId,
      },
    });
  }

  return { dataRoot, records };
}

async function upsertRecords(env, token, records) {
  const baseUrl = normalizeUrl(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${baseUrl}/rest/v1/entries?on_conflict=entry_date`, {
    method: "POST",
    headers: restHeaders(key, token, {
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(records.map((item) => item.record)),
  });

  const rows = await assertOk(response, "upsert diary entries");
  if (!Array.isArray(rows) || rows.length !== records.length) {
    throw new Error(`upsert returned ${Array.isArray(rows) ? rows.length : 0} rows for ${records.length} records`);
  }

  return rows.length;
}

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  if (!existsSync(ENV_PATH)) {
    throw new Error(".env.local was not found.");
  }

  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  requireEnv(env);

  const auth = await signIn(env);
  console.log("sign in: ok");

  const { dataRoot, records } = await buildRecords(auth.userId);
  const dates = records.map((entry) => entry.date);
  console.log(`data root: ${dataRoot.root}`);
  console.log(`entries found: ${records.length}`);
  console.log(`first date: ${dates[0]}`);
  console.log(`last date: ${dates[dates.length - 1]}`);
  console.log("validation: ok");

  if (mode.dryRun) {
    console.log("dry run: ok");
    return;
  }

  const changed = await upsertRecords(env, auth.accessToken, records);
  console.log(`upserted: ${changed}`);
  console.log("import: ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
