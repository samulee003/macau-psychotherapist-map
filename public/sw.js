/* ============================================================
   Service Worker：離線快取（stale-while-revalidate）
   ─ 同源 GET 資源（頁面、JS/CSS、data.json、圖示）優先回快取，
     同時在背景更新，下次載入即為新版。
   ─ /api/ 與跨網域請求（高德 SDK、字型）一律不攔截。
   ============================================================ */

const CACHE_NAME = 'mptm-cache-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨網域（高德/字型/analytics）不攔截
  if (url.pathname.startsWith('/api/')) return; // API 一律走網路

  event.respondWith(staleWhileRevalidate(req));
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const networkFetch = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // 回快取的同時在背景更新
    networkFetch.catch(() => {});
    return cached;
  }

  const network = await networkFetch;
  if (network) return network;
  return new Response('離線且無快取', { status: 503, statusText: 'Offline' });
}
