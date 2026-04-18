const CACHE_NAME = "puhunanph-v20";
const ASSETS = [
  "./",
  "./index.html",
  "./login.html",
  "./register.html",
  "./dashboard.html",
  "./product.html",
  "./team.html",
  "./profile.html",
  "./deposit.html",
  "./withdraw.html",
  "./deposit-history.html",
  "./withdraw-history.html",
  "./logs.html",
  "./admin.html",
  "./assets/css/styles.css",
  "./assets/js/pages.js",
  "./assets/js/app.js",
  "./assets/js/utils.js",
  "./assets/js/products.js",
  "./assets/js/api.js",
  "./assets/js/firebase-config.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const isFreshCritical = req.destination === "document" || req.destination === "script" || req.destination === "style";
  if (isFreshCritical) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (req.method === "GET" && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./dashboard.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((networkResponse) => {
          if (req.method === "GET" && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match("./dashboard.html"));
    })
  );
});
