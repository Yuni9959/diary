import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(".");
const ENV_PATH = ".env.local";
const DEFAULT_PORT = 4173;
const TEST_DATE = "2099-01-01";
const EXPECTED_COUNT = 22;
const EXPECTED_FIRST_DATE = "2026-02-27";
const EXPECTED_LAST_DATE = "2026-07-05";

const MIME_TYPES = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".webmanifest": "application/manifest+json;charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain;charset=utf-8",
};

function log(message) {
  console.log(message);
}

function parseArgs(argv) {
  return {
    live: argv.includes("--live"),
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

async function loadEnv() {
  const local = existsSync(ENV_PATH) ? parseEnv(await readFile(ENV_PATH, "utf8")) : {};
  return {
    ...local,
    SUPABASE_URL: process.env.SUPABASE_URL || local.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || local.SUPABASE_PUBLISHABLE_KEY,
    DIARY_TEST_EMAIL: process.env.DIARY_TEST_EMAIL || local.DIARY_TEST_EMAIL,
    DIARY_TEST_PASSWORD: process.env.DIARY_TEST_PASSWORD || local.DIARY_TEST_PASSWORD,
    DIARY_E2E_BASE_URL: process.env.DIARY_E2E_BASE_URL || local.DIARY_E2E_BASE_URL,
  };
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const cached = await importPlaywrightFromNpxCache();
    if (cached) {
      return cached;
    }

    throw new Error("Playwright is not available. Run `npx playwright install chromium`, then retry this script.");
  }
}

async function importPlaywrightFromNpxCache() {
  const cacheRoot = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "npm-cache", "_npx")
    : null;
  if (!cacheRoot || !existsSync(cacheRoot)) {
    return null;
  }

  const dirs = await readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) {
      continue;
    }

    const entry = join(cacheRoot, dir.name, "node_modules", "playwright", "index.mjs");
    if (existsSync(entry)) {
      try {
        return await import(pathToFileURL(entry).href);
      } catch {
        continue;
      }
    }
  }

  return null;
}

function checkWorkflowReadiness() {
  const workflowPath = ".github/workflows/diary-sync.yml";
  const text = existsSync(workflowPath) ? readFileSyncSafe(workflowPath) : "";

  assert(text.includes("node tools/write_supabase_runtime_config.mjs"), "workflow runs runtime config generator");
  assert(text.includes("SUPABASE_URL: ${{ vars.SUPABASE_URL }}"), "workflow uses SUPABASE_URL repository variable");
  assert(
    text.includes("SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PUBLISHABLE_KEY }}"),
    "workflow uses SUPABASE_PUBLISHABLE_KEY repository variable",
  );
  assert(!/service[_-]?role/i.test(text), "workflow does not reference service_role");
  assert(!/secret key/i.test(text), "workflow does not reference secret key");
  assert(!text.includes("DIARY_TEST_PASSWORD"), "workflow does not reference DIARY_TEST_PASSWORD");
  assert(!text.includes("DIARY_TEST_EMAIL"), "workflow does not reference DIARY_TEST_EMAIL");
  assert(text.includes("supabase-runtime-config.js"), "workflow includes runtime config artifact");
  assert(text.includes("supabase-client.js"), "workflow includes Supabase client artifact");
  assert(text.includes("diary-service.js"), "workflow includes diary service artifact");
  log("deployment readiness: ok");
}

function readFileSyncSafe(filePath) {
  return spawnSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(filePath)}, 'utf8'))`], {
    encoding: "utf8",
  }).stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDates(dates, expectedCount) {
  const sorted = [...dates].sort();
  assert(dates.length === expectedCount, `expected ${expectedCount} dates, got ${dates.length}`);
  assert(sorted[0] === EXPECTED_FIRST_DATE, `expected first date ${EXPECTED_FIRST_DATE}, got ${sorted[0] || "none"}`);
  assert(
    sorted[sorted.length - 1] === EXPECTED_LAST_DATE,
    `expected last date ${EXPECTED_LAST_DATE}, got ${sorted[sorted.length - 1] || "none"}`,
  );
}

async function generateRuntimeConfig() {
  const result = spawnSync(process.execPath, ["tools/write_supabase_runtime_config.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`runtime config generation failed: ${result.stderr || result.stdout}`);
  }

  log("runtime config generation: ok");
}

function safeResolveUrlPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const filePath = normalize(join(ROOT, cleanPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    return null;
  }
  return filePath;
}

async function serveFile(request, response) {
  try {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    let filePath = safeResolveUrlPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    let fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) {
      filePath = join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500);
    response.end("Server error");
  }
}

function startServer(preferredPort = DEFAULT_PORT) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer(serveFile);
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && preferredPort !== 0) {
        startServer(0).then(resolvePromise, reject);
      } else {
        reject(error);
      }
    });
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({
        server,
        baseUrl: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

async function clearBrowserState(context, page) {
  await context.clearCookies();
  await page.goto("about:blank");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => undefined);
}

async function waitForAdmin(page) {
  await page.waitForFunction(() => typeof window.diarySupabaseAdmin === "object", null, { timeout: 15000 });
}

async function status(page) {
  return page.evaluate(() => window.diarySupabaseAdmin.status());
}

async function listDates(page) {
  return page.evaluate(() => window.diarySupabaseAdmin.listEntries());
}

async function getEntry(page, date) {
  return page.evaluate((value) => window.diarySupabaseAdmin.getEntryByDate(value), date);
}

async function deleteEntry(page, date) {
  return page.evaluate((value) => window.diarySupabaseAdmin.deleteEntryByDate(value), date);
}

async function waitForAsync(check, message, { timeout = 15000, interval = 250 } = {}) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeout) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, interval));
  }
  throw new Error(message);
}

async function openWriterAndSave(page, bodySuffix) {
  await page.locator("#openWriterBtn").click();
  await page.locator("#writerModal.open").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#writerDate").fill(TEST_DATE);
  await page.locator("#writerTitleInput").fill("E2E test entry");
  await page.locator("#writerBody").fill(`E2E body ${bodySuffix}`);
  await page.locator("#uploadDraftBtn").click();
  await waitForAsync(
    async () => {
      const entry = await getEntry(page, TEST_DATE);
      return entry?.found === true;
    },
    "writer save did not create test entry",
  );
  await page.locator("#writerCloseBtn").click();
  await page.locator("#writerModal.open").waitFor({ state: "detached", timeout: 2000 }).catch(async () => {
    await page.waitForFunction(() => !document.querySelector("#writerModal").classList.contains("open"), null, {
      timeout: 5000,
    });
  });
}

async function runBrowserFlow({ playwright, baseUrl, env }) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const browserEvents = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserEvents.push(`console:${message.type()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    browserEvents.push(`requestfailed:${url.origin}${url.pathname}`);
  });
  let cleanupNeeded = false;

  try {
    await clearBrowserState(context, page);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForAdmin(page);
    let currentStatus = await status(page);
    assert(currentStatus.configured === true, "runtime config was not active");
    log("runtime config: ok");

    const authHiddenDefault = await page.evaluate(() => {
      const modal = document.querySelector("#authModal");
      const styles = getComputedStyle(modal);
      return !modal.classList.contains("open") && styles.opacity === "0" && styles.pointerEvents === "none";
    });
    assert(authHiddenDefault === true, "auth modal is open on default URL");
    const visibleAuthButtons = await page.evaluate(() => {
      return [...document.querySelectorAll("#authModal button")].filter((button) => {
        const rect = button.getBoundingClientRect();
        const styles = getComputedStyle(button);
        const modalStyles = getComputedStyle(document.querySelector("#authModal"));
        return rect.width > 0 && rect.height > 0 && styles.visibility !== "hidden" && modalStyles.opacity !== "0";
      }).length;
    });
    assert(visibleAuthButtons === 0, "visible auth buttons appeared on default UI");
    log("default visible UI auth state: ok");

    await page.goto(new URL("#auth", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForAdmin(page);
    await page.locator("#authModal.open").waitFor({ state: "visible", timeout: 5000 });
    log("auth modal: ok");

    await page.locator("#authEmail").fill(env.DIARY_TEST_EMAIL);
    await page.locator("#authPassword").fill(env.DIARY_TEST_PASSWORD);
    await page.locator("#authSignInBtn").click();
    await waitForAsync(
      async () => {
        const value = await status(page);
        return value.signedIn === true;
      },
      "sign in wait timed out",
    ).catch(async () => {
      const authStatus = await page.locator("#authStatus").textContent().catch(() => "");
      throw new Error(`sign in did not complete (${authStatus || "no status"}; ${browserEvents.slice(-3).join(", ") || "no browser errors"})`);
    });
    currentStatus = await status(page);
    if (currentStatus.signedIn !== true) {
      await page.waitForTimeout(500);
      currentStatus = await status(page);
    }
    if (currentStatus.signedIn !== true) {
      const authStatus = await page.locator("#authStatus").textContent().catch(() => "");
      throw new Error(`sign in did not complete (${authStatus || "no status"}; ${browserEvents.slice(-3).join(", ") || "no browser errors"})`);
    }
    await page.evaluate(() => window.diarySupabaseAdmin.closeAuth());
    log("sign in: ok");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAdmin(page);
    currentStatus = await status(page);
    assert(currentStatus.signedIn === true, "session did not persist after reload");
    await page.evaluate(() => window.diarySupabaseAdmin.closeAuth());
    log("session reload persistence: ok");

    let dates = await listDates(page);
    assertDates(dates, EXPECTED_COUNT);
    log(`pre-test entries: count=${dates.length}, first=${EXPECTED_FIRST_DATE}, last=${EXPECTED_LAST_DATE}`);

    await deleteEntry(page, TEST_DATE).catch(() => undefined);
    dates = await listDates(page);
    if (dates.includes(TEST_DATE)) {
      throw new Error("test date cleanup before writer test failed");
    }

    await openWriterAndSave(page, "one");
    cleanupNeeded = true;
    let entry = await getEntry(page, TEST_DATE);
    assert(entry.found === true, "writer save did not create test entry");
    dates = await listDates(page);
    assert(dates.length === EXPECTED_COUNT + 1, `expected ${EXPECTED_COUNT + 1} dates after create, got ${dates.length}`);
    log(`writer save: ok, count=${dates.length}`);

    await openWriterAndSave(page, "two");
    dates = await listDates(page);
    const testDateCount = dates.filter((date) => date === TEST_DATE).length;
    assert(dates.length === EXPECTED_COUNT + 1, `same-date save changed count to ${dates.length}`);
    assert(testDateCount === 1, `duplicate ${TEST_DATE} dates found`);
    log(`same-date upsert: ok, count=${dates.length}`);

    const deleted = await deleteEntry(page, TEST_DATE);
    cleanupNeeded = false;
    assert(deleted.deleted === true, "cleanup delete did not report deleted");
    entry = await getEntry(page, TEST_DATE);
    assert(entry.found === false, "test entry still exists after delete");
    dates = await listDates(page);
    assert(dates.length === EXPECTED_COUNT, `expected final count ${EXPECTED_COUNT}, got ${dates.length}`);
    log(`cleanup delete: ok, final count=${dates.length}`);

    await page.evaluate(() => window.diarySupabaseAdmin.signOut());
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAdmin(page);
    currentStatus = await status(page);
    assert(currentStatus.signedIn === false, "signed-out status was not false");
    await page.waitForFunction(() => document.querySelectorAll("#grid .day").length > 0, null, { timeout: 5000 });
    log("signed-out fallback: ok");
  } finally {
    if (cleanupNeeded) {
      await deleteEntry(page, TEST_DATE).catch(() => undefined);
    }
    await browser.close();
  }
}

function sanitizeBaseUrl(url) {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  requireEnv(env, ["DIARY_TEST_EMAIL", "DIARY_TEST_PASSWORD"]);
  checkWorkflowReadiness();

  const playwright = await importPlaywright();
  let serverInfo = null;
  let baseUrl;

  if (args.live) {
    if (!env.DIARY_E2E_BASE_URL) {
      throw new Error("--live requires DIARY_E2E_BASE_URL in .env.local or process.env.");
    }
    baseUrl = sanitizeBaseUrl(env.DIARY_E2E_BASE_URL);
    log("live mode: ok");
  } else {
    requireEnv(env, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
    await generateRuntimeConfig();
    serverInfo = await startServer(DEFAULT_PORT);
    baseUrl = serverInfo.baseUrl;
    log("local server: ok");
  }

  try {
    await runBrowserFlow({ playwright, baseUrl, env });
    log("e2e mobile supabase test: ok");
  } finally {
    if (serverInfo?.server) {
      await new Promise((resolveClose) => serverInfo.server.close(resolveClose));
    }
  }
}

main().catch((error) => {
  console.error(`e2e failed: ${error.message}`);
  process.exitCode = 1;
});
