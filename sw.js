const CACHE_VERSION = 'diary-pwa-v3';
const APP_CACHE = `${CACHE_VERSION}-app`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './img/bouquet.png',
  './img/spring.png',
  './img/summer.png',
  './img/maple.png',
  './img/ginkgo.png',
  './img/winter.png'
];

const EXCLUDED_PREFIXES = [
  '/inbox/',
  '/obsidian/',
  '/backups/',
  '/tools/',
  '/Diary_formyWife/inbox/',
  '/Diary_formyWife/obsidian/',
  '/Diary_formyWife/backups/',
  '/Diary_formyWife/tools/'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const response = await fetch(url, {cache: 'no-cache'});
        if (response.ok) await cache.put(url, response);
      } catch (_error) {
        // Optional shell assets should not break service worker installation.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('diary-pwa-') && !key.startsWith(CACHE_VERSION))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isExcluded(pathname) {
  return EXCLUDED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function isDataRequest(pathname) {
  return pathname.includes('/data/') || pathname.startsWith('/data/') || pathname.startsWith('/Diary_formyWife/data/');
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw _error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(APP_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcluded(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_CACHE, './index.html'));
    return;
  }

  if (isDataRequest(url.pathname)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request));
});
