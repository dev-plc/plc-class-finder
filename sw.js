// PLC Class Finder — Service Worker
// 목적:
// - 정적 자산(HTML, CSS, JS, 아이콘)을 캐시해 오프라인·저속 네트워크에서도 즉시 응답
// - GAS API 응답은 캐시하지 않음 (실시간성 우선)
//
// 캐시 무효화: CACHE_VERSION 숫자 bump

const CACHE_VERSION = 'plc-v11';
const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './style.css?v=28',
  './admin.css?v=1',
  './script.js?v=28',
  './admin.js?v=4',
  './scripts/members-data.js',
  './scripts/hangul.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => {
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // GAS·Supabase·Google Drive 등 외부 API는 캐시 안 함 (실시간·용량)
  const isExternalApi =
    url.host.includes('script.google.com') ||
    url.host.includes('supabase.co') ||
    url.host.includes('drive.google.com') ||
    url.host.includes('googleusercontent.com') ||
    url.host.includes('docs.google.com');
  if (isExternalApi) {
    // 네트워크만 사용 (실시간). 실패 시 정상 에러 반환.
    return;
  }

  // 같은 도메인 정적 자산: cache-first, 실패 시 네트워크
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          // 성공적 GET만 캐시에 추가
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});
