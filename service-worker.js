self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  // 🚫 NÃO intercepta navegação (HTML / redirects)
  if (event.request.mode === "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
