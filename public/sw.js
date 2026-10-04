/* ほしのたからじま service worker
 * - ビルドじに vite.config.ts の プラグインが BUILD_ID と PRECACHE を うめこむ
 * - ページ（navigate）: ネットワークゆうせん → オフラインなら キャッシュの index.html
 * - ハッシュつき /assets/: キャッシュゆうせん（なかみが かわると なまえも かわる）
 * - そのほか おなじ オリジン: キャッシュを すぐ かえしつつ うらで こうしん
 * - Google Fonts: うらで こうしん（オフラインでも フォントが つかえる）
 */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = self.__PRECACHE_MANIFEST || [];
const CACHE_PREFIX = 'hoshi-takarajima-';
const APP_CACHE = `${CACHE_PREFIX}app-${BUILD_ID}`;
const FONT_CACHE = `${CACHE_PREFIX}fonts`;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(['./', ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== APP_CACHE && key !== FONT_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

function putInCache(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return response;
  const copy = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, copy));
  return response;
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => putInCache(cacheName, request, response))
        .catch(() => cached);
      return cached || network;
    }),
  );
}

function networkFirstNavigation(request) {
  const network = fetch(request).then((response) => putInCache(APP_CACHE, './', response));
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });

  return Promise.race([network, timeout])
    .then((response) => response || caches.match('./', { ignoreSearch: true }).then((cached) => cached || network))
    .catch(() =>
      caches
        .match('./', { ignoreSearch: true })
        .then((cached) => cached || caches.match('./index.html', { ignoreSearch: true })),
    );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);

  if (isFontRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.includes('/assets/') && /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => putInCache(APP_CACHE, request, response))),
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request, APP_CACHE));
});
