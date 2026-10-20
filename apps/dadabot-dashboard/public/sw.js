// sw.js — DadaBot PWA service worker
// Bump CACHE_NAME on each release to invalidate stale app shells.
const CACHE_NAME = "dadabot-shell-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // bypass /api/dadabot/ping etc.

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const c = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, c)); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, c)); } return res; })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
