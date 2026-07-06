import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_PATH = ".env.local";
const DEFAULT_OUTPUT_PATH = path.join("lib", "supabase-runtime-config.js");
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  if (outputIndex !== -1) {
    const output = argv[outputIndex + 1];
    if (!output) {
      throw new Error("--output requires a path.");
    }
    return { outputPath: output };
  }

  return {
    outputPath: process.env.DIARY_RUNTIME_CONFIG_OUTPUT || DEFAULT_OUTPUT_PATH,
  };
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
    throw new Error(`Missing required Supabase runtime config values: ${missing.join(", ")}`);
  }
}

async function loadRuntimeEnv() {
  const ciEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  };

  if (ciEnv.SUPABASE_URL || ciEnv.SUPABASE_PUBLISHABLE_KEY) {
    requireEnv(ciEnv);
    return ciEnv;
  }

  if (!existsSync(ENV_PATH)) {
    throw new Error(".env.local was not found and CI environment variables were not provided.");
  }

  const localEnv = parseEnv(await readFile(ENV_PATH, "utf8"));
  requireEnv(localEnv);
  return localEnv;
}

async function main() {
  const { outputPath } = parseArgs(process.argv.slice(2));
  const env = await loadRuntimeEnv();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `window.DIARY_SUPABASE_CONFIG = ${JSON.stringify({
      enabled: true,
      url: env.SUPABASE_URL,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    }, null, 2)};\n`,
    "utf8",
  );

  console.log(`runtime config written: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
