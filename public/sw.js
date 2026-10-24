/* Dar Al Uloom — offline service worker (app shell + assets) */
/* v2: same-origin assets are network-first so every publish reaches users
   immediately; cross-origin fonts/images stay cache-first for offline. */
const SHELL = "dau-shell-v2";
const ASSETS = "dau-assets-v2";

// App shell: the HTML entry so the app can boot with no network at all.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/index.html", "/manifest.json"]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const isAsset = (url) =>
  /\.(js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|ico)$/i.test(url.pathname) ||
  url.pathname.startsWith("/assets/");

const cacheAndReturn = (cacheName, req, res) => {
  if (res.ok || res.type === "opaque") {
    caches.open(cacheName).then((c) => c.put(req, res.clone()));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache API / auth traffic — data offline is served from IndexedDB.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/functions/")) return;

  // Page navigations: network first, fall back to the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put("/index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (isAsset(url)) {
    // Same origin (app code): network first — a new publish must always win,
    // the cache is only the offline fallback.
    if (url.origin === self.location.origin) {
      event.respondWith(
        fetch(req)
          .then((res) => cacheAndReturn(ASSETS, req, res))
          .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
      );
      return;
    }
    // Cross-origin (fonts/images): cache first with network fallback.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => cacheAndReturn(ASSETS, req, res))
            .catch(() => hit)
      )
    );
  }
});
