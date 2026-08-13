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

const CACHE_VERSION = 'plc-v45';

const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './style.css?v=58',
  './admin.css?v=58',
  './script.js?v=58',
  './admin.js?v=58',
  './scripts/members-data.js?v=58',
  './scripts/supabase-config.js?v=58',
  './scripts/hangul.js?v=58',
  './scripts/sw-update.js?v=58',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg'
];

// 앱이 보낸 SKIP_WAITING 메시지를 받으면 즉시 활성화
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' 로 브라우저 HTTP 캐시를 건너뛴다.
      // 이게 없으면 설치 시점에 옛 파일을 그대로 다시 저장할 수 있다.
      .then(cache => Promise.all(
        PRECACHE_URLS.map(u =>
          // 받아올 때만 쿼리를 붙이고, 저장은 원래 주소로 한다.
          // 그래야 나중에 caches.match(요청) 이 그대로 찾는다.
          fetch(new Request(bustEdge(u), { cache: 'reload' }))
            .then(res => (res && res.ok) ? cache.put(u, res) : null))
      ).catch(err => {
        console.warn('[SW] 일부 precache 실패:', err);
      }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// HTML 은 주소에 버전 쿼리를 붙여서 받아온다.
//
// 앞단 CDN 이 /admin.html 을 오래 붙들고 있어서, 배포는 됐는데 몇 주 전 화면이
// 나오는 일이 있었다. 브라우저 캐시가 아니라 엣지 캐시라 강력 새로고침·시크릿·
// 다른 브라우저 어느 것으로도 안 지워졌다. CDN 관리 권한이 없으면 손쓸 방법도 없다.
//
// 쿼리를 붙이면 그 캐시가 한 번도 본 적 없는 주소가 되어 원본까지 간다.
// CACHE_VERSION 이 바뀔 때만 주소가 바뀌므로 평소에는 정상적으로 캐시된다.
//
// CSS·JS 는 이미 ?v=NN 이 붙어 있어 이 처리가 필요 없다.
function isDocument(pathname) {
  return pathname.endsWith('/') || pathname.endsWith('.html');
}

function bustEdge(u) {
  const bare = u.split('?')[0];
  if (!isDocument(bare)) return u;
  return u + (u.includes('?') ? '&' : '?') + '_sw=' + CACHE_VERSION;
}

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
    // 앱 코드는 전부 HTTP 캐시를 건너뛰고 원본에서 확인한다.
    //
    // HTML 만 우회하면 부족하다. ?v= 를 한 군데라도 빠뜨리면 URL 이 그대로라
    // 브라우저 HTTP 캐시가 옛 파일을 그대로 내준다.
    // 실제로 admin.css 가 v44 에 남아 있어서, 배포는 됐는데 웹에서만
    // 출석 관리 탭이 안 뜨는 일이 있었다 (로컬은 그 캐시가 없어 정상이었다).
    // 여기서 막으면 버전을 빠뜨려도 옛 파일이 나오지 않는다.
    const fetchReq = new Request(bustEdge(req.url), { cache: 'no-cache' });

    // 네트워크 우선. 끊겼을 때만 캐시로 버틴다.
    event.respondWith(
      fetch(fetchReq).then(save).catch(() =>
        caches.match(req).then(cached => cached || Promise.reject(new Error('오프라인'))))
    );
  } else {
    // 아이콘·이미지: 캐시 우선 (잘 안 바뀌고 용량이 크다)
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(save))
    );
  }
});
