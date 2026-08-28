/* 96th Predictor Engine — service worker.
   App shell: cache-first (works offline). Config: network-first with cache fallback. */
'use strict';

const VERSION = 'v3.2.0';
const SHELL_CACHE = 'p96-shell-' + VERSION;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // /api/config: network-first, keep last known copy for offline opens
  if (url.pathname === '/api/config') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/api/config', clone));
          return res;
        })
        .catch(() => caches.match('/api/config'))
    );
    return;
  }

  // App shell: cache-first, then network, navigation falls back to index.html
  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit ||
      fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => (event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
    )
  );
});
