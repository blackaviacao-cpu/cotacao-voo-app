self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("black-cotacao-v1").then(cache => {
      return cache.addAll([
        "./",
        "./index.html",
        "./manifest.json",
        "./airports-br.json",
        "./basereal.csv"
      ]);
    })
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
