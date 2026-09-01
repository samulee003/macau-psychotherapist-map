/* ============================================================
   Service Worker：離線快取
   ─ App shell（HTML 導覽）與 data.json 走 network-first：
     網路可用時一定拿最新版，離線才回退快取。
     ★ 這兩者絕不可用 stale-while-revalidate —— 舊訪客會先拿到
       舊的 index.html，而它引用的是舊的 hashed JS bundle（同樣在
       快取裡），等於整個舊版 App 被端出來，改版要到下次載入才生效。
   ─ 其餘同源 GET（hashed JS/CSS、圖示）走 stale-while-revalidate：
     檔名帶內容 hash，內容不會變，回快取最快且必定正確。
   ─ 跨網域請求（底圖磚、字型、analytics）一律不攔截。
   ─ 改動快取策略時記得 bump CACHE_NAME，讓既有訪客的舊快取被清掉。
   ============================================================ */

const CACHE_NAME = 'mptm-cache-v2';

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
  if (url.origin !== self.location.origin) return; // 跨網域（底圖/字型/analytics）不攔截

  // App shell 與資料：永遠以網路為準，離線才回退快取
  if (isAppShell(req, url) || isData(url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

/** HTML 導覽請求（含直接開啟 index.html） */
function isAppShell(req, url) {
  return (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html')
  );
}

/** 治療師資料：每次更新名冊都要即時反映 */
function isData(url) {
  return url.pathname.endsWith('/data.json');
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response('離線且無快取', { status: 503, statusText: 'Offline' });
  }
}

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
