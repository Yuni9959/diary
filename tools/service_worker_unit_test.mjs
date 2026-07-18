import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ORIGIN = "https://diary.example/";
const handlers = new Map();
const cacheStores = new Map();
const fetchedUrls = [];
let online = true;
let cacheWritesFail = false;

function absoluteUrl(input) {
  const value = typeof input === "string" ? input : input.url;
  return new URL(value, ORIGIN).href;
}

function cacheFor(name) {
  if (!cacheStores.has(name)) {
    cacheStores.set(name, new Map());
  }
  const entries = cacheStores.get(name);
  return {
    async match(request) {
      return entries.get(absoluteUrl(request))?.clone();
    },
    async put(request, response) {
      if (cacheWritesFail) throw new Error("cache full");
      entries.set(absoluteUrl(request), response.clone());
    },
  };
}

const context = {
  URL,
  Request,
  Response,
  console,
  self: {
    location: { origin: new URL(ORIGIN).origin },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  },
  caches: {
    open: async (name) => cacheFor(name),
    keys: async () => [...cacheStores.keys()],
    delete: async (name) => cacheStores.delete(name),
    async match(request) {
      for (const name of cacheStores.keys()) {
        const response = await cacheFor(name).match(request);
        if (response) return response;
      }
      return undefined;
    },
  },
  async fetch(input) {
    const url = absoluteUrl(input);
    fetchedUrls.push(url);
    if (!online) throw new Error("offline");
    return new Response(`network:${new URL(url).pathname}`, { status: 200 });
  },
};

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
vm.runInNewContext(source, context, { filename: "sw.js" });

assert(handlers.has("install"), "service worker install handler was not registered");
assert(handlers.has("fetch"), "service worker fetch handler was not registered");

async function dispatchFetch(url) {
  let responsePromise;
  handlers.get("fetch")({
    request: new Request(url),
    respondWith(value) {
      responsePromise = Promise.resolve(value);
    },
  });
  assert(responsePromise, `service worker did not handle ${url}`);
  return responsePromise;
}

const runtimeUrl = `${ORIGIN}lib/diary-service.js`;
await cacheFor("diary-pwa-v4-app").put(runtimeUrl, new Response("stale"));

const onlineResponse = await dispatchFetch(runtimeUrl);
assert.equal(await onlineResponse.text(), "network:/lib/diary-service.js");
assert(fetchedUrls.includes(runtimeUrl), "runtime library did not use network-first fetching");

online = false;
const offlineResponse = await dispatchFetch(runtimeUrl);
assert.equal(await offlineResponse.text(), "network:/lib/diary-service.js");

online = true;
cacheWritesFail = true;
const cacheFailureResponse = await dispatchFetch(`${ORIGIN}lib/supabase-client.js`);
assert.equal(await cacheFailureResponse.text(), "network:/lib/supabase-client.js");
cacheWritesFail = false;

let installPromise;
handlers.get("install")({
  waitUntil(value) {
    installPromise = Promise.resolve(value);
  },
});
await installPromise;

for (const path of [
  "lib/supabase-runtime-config.js",
  "lib/supabase-client.js",
  "lib/diary-service.js",
]) {
  assert(fetchedUrls.includes(`${ORIGIN}${path}`), `${path} was not pre-cached during install`);
}

console.log("service worker unit test: ok");
