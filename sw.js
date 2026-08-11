// PLC Class Finder — Service Worker
//
// 목적
//   앱 코드(HTML·JS·CSS)는 언제나 최신을 쓴다. 네트워크가 죽었을 때만 캐시로 버틴다.
//   아이콘·이미지는 잘 안 바뀌고 용량이 크니 캐시를 먼저 쓴다.
//   Supabase·Google 같은 외부 API 는 캐시하지 않는다 (실시간성).
//
// 새 코드가 반영되지 않던 문제를 두 겹으로 막는다
//   (1) 앱 코드는 네트워크 우선. 캐시는 오프라인일 때만 쓴다.
//   (2) 모든 모듈 import 에 ?v=NN 을 붙였다. 버전이 바뀌면 URL 이 바뀌므로
//       어떤 캐시도 옛 파일을 내줄 수 없다.
//   한 겹만으로는 새지 않는다는 보장이 없어 둘 다 둔다.
//   실제로 members-data 가 v33 에서 안 올라가는 일이 있었다.

const CACHE_VERSION = 'plc-v27';

const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './style.css?v=42',
  './admin.css?v=42',
  './script.js?v=42',
  './admin.js?v=42',
  './scripts/members-data.js?v=42',
  './scripts/supabase-config.js?v=42',
  './scripts/hangul.js?v=42',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
];

// 앱이 보낸 SKIP_WAITING 메시지를 받으면 즉시 활성화
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' 로 브라우저 HTTP 캐시를 건너뛴다.
      // 이게 없으면 설치 시점에 옛 파일을 그대로 다시 저장할 수 있다.
      .then(cache => cache.addAll(
        PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' }))
      ).catch(err => {
        console.warn('[SW] 일부 precache 실패:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 앱 코드인가 (바뀌면 즉시 반영돼야 하는 것)
function isAppCode(url) {
  const p = url.pathname;
  return p.endsWith('/') || /\.(html|js|mjs|css|webmanifest|json)$/i.test(p);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 API 는 건드리지 않는다 (실시간·용량)
  const isExternalApi =
    url.host.includes('script.google.com') ||
    url.host.includes('supabase.co') ||
    url.host.includes('drive.google.com') ||
    url.host.includes('googleusercontent.com') ||
    url.host.includes('docs.google.com');
  if (isExternalApi) return;

  if (url.origin !== self.location.origin) return;

  const save = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
    }
    return res;
  };

  if (isAppCode(url)) {
    // 네트워크 우선. 끊겼을 때만 캐시로 버틴다.
    event.respondWith(
      fetch(req).then(save).catch(() =>
        caches.match(req).then(cached => cached || Promise.reject(new Error('오프라인'))))
    );
  } else {
    // 아이콘·이미지: 캐시 우선 (잘 안 바뀌고 용량이 크다)
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(save))
    );
  }
});
