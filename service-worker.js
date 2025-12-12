self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // ❗ NÃO intercepta navegação HTML
  if (req.mode === "navigate") {
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
