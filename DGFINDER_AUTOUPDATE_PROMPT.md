# DGfinder 인계 — 페이지 열면 항상 최신 코드가 뜨게

DGfinder Code 대화에 **아래 `---` 사이를 통째로** 붙여넣으세요.

---

# 작업: 접속하면 자동으로 최신 버전이 되게 만들기

## 배경

DGfinder는 정적 호스팅(GitHub Pages)에 올라간 프론트엔드 앱입니다.
코드를 고쳐 배포해도 사용자 브라우저가 옛 파일을 계속 쓰는 문제를 없애고 싶습니다.

자매 프로젝트 `plc-class-finder`에서 같은 작업을 이미 했습니다.
아래는 거기서 **실제로 사고를 겪은 뒤** 정착한 구성입니다.
한 번에 다 하지 않고 한 겹씩 붙였다가, 그때마다 새는 곳이 남아서 결국 세 겹이 됐습니다.
그대로 옮겨 주세요.

## 원하는 동작

사용자는 아무것도 누르지 않습니다.
페이지를 열거나(또는 탭으로 돌아오거나) 하면 새 버전을 감지해서
`🎉 새 버전을 적용하는 중이에요…` 토스트를 0.6초 보여주고 자동으로 리로드합니다.
"새로고침 하세요" 같은 안내 버튼은 만들지 마세요 — 고령 사용자가 많아서 누르지 않습니다.

## 먼저 확인해 주세요

작업 시작 전에 현재 상태를 파악하고 알려주세요.

1. `sw.js` / `manifest.webmanifest`가 이미 있는지
2. 호스팅 경로가 도메인 루트인지 서브패스(`/DGfinder/`)인지 — **Service Worker scope가 여기 걸립니다**
3. JS가 ES 모듈 `import`를 쓰는지, 아니면 `<script>` 태그만 쓰는지
4. 현재 캐시 전략이 있다면 무엇인지

## 만들 것 — 세 겹

한 겹만으로는 안 샌다는 보장이 없습니다. **셋 다 필요합니다.**

### 1겹. Service Worker를 네트워크 우선으로

앱 코드(HTML·JS·CSS·JSON)는 **네트워크 우선**, 아이콘·이미지만 **캐시 우선**.
외부 API(Supabase 등)는 아예 건드리지 않습니다.

```js
const CACHE_VERSION = 'dgf-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css?v=1',
  './script.js?v=1',
  // …모듈 파일 전부. 아래 2겹과 버전 번호가 같아야 합니다.
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' 로 브라우저 HTTP 캐시를 건너뛴다.
      // 이게 없으면 설치 시점에 옛 파일을 그대로 다시 저장한다.
      .then(cache => cache.addAll(
        PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' }))
      ).catch(err => console.warn('[SW] 일부 precache 실패:', err)))
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

  // 외부 API 는 건드리지 않는다 (실시간성)
  if (url.host.includes('supabase.co') || url.host.includes('script.google.com')) return;
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
        caches.match(req).then(c => c || Promise.reject(new Error('오프라인'))))
    );
  } else {
    // 아이콘·이미지: 캐시 우선 (잘 안 바뀌고 용량이 크다)
    event.respondWith(caches.match(req).then(c => c || fetch(req).then(save)));
  }
});
```

### 2겹. 모든 자원 URL에 `?v=NN`

버전이 바뀌면 URL이 바뀌므로 **어떤 캐시도 옛 파일을 내줄 수 없습니다.**

```html
<link rel="stylesheet" href="style.css?v=1">
<script type="module" src="script.js?v=1"></script>
```

**여기가 실제로 사고 난 곳입니다.** HTML의 `<script>` 태그에만 버전을 붙이고
JS 안의 `import` 문은 그냥 뒀더니, 진입점만 새 파일이고 그 아래 모듈 체인은
전부 옛 URL이라 캐시에서 나왔습니다. 배포해도 몇 시간씩 반영이 안 됐고
원인을 찾는 데 오래 걸렸습니다.

**`import` 문 안의 경로에도 똑같이 붙이세요.**

```js
import { sbSelect } from './supabase-config.js?v=1';
```

### 3겹. 새 버전 감지 → 즉시 적용 → 리로드

진입점 JS에 그대로 넣으세요.

```js
function showUpdateToast(message) {
    let toast = document.getElementById('swUpdateToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'swUpdateToast';
        toast.className = 'sw-update-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
}

function applyUpdate(worker) {
    showUpdateToast('🎉 새 버전을 적용하는 중이에요…');
    // 잠깐 보여준 뒤 적용 (controllerchange → 자동 리로드)
    setTimeout(() => worker.postMessage({ type: 'SKIP_WAITING' }), 600);
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:'
        && location.hostname !== 'localhost'
        && location.hostname !== '127.0.0.1') return;

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');

            // 이미 대기 중인 새 버전이 있으면 바로 적용
            if (registration.waiting && navigator.serviceWorker.controller) {
                applyUpdate(registration.waiting);
            }

            // 새 버전이 설치되는 즉시 적용
            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    // controller가 있어야 '업데이트'(첫 설치가 아님)
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        applyUpdate(newSW);
                    }
                });
            });

            // 주기적·포커스 시 업데이트 확인 (브라우저 HTTP 캐시 우회)
            setInterval(() => registration.update(), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update();
            });

            // 새 SW가 페이지를 넘겨받으면 리로드
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloading) return;
                reloading = true;
                window.location.reload();
            });
        } catch (err) {
            console.warn('SW 등록 실패:', err);
        }
    });
}
registerServiceWorker();
```

토스트 CSS:

```css
.sw-update-toast {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translate(-50%, 120%);
    padding: 10px 18px;
    background: #2563eb;
    color: #fff;
    border-radius: 24px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    z-index: 10001;
    opacity: 0;
    transition: transform 0.3s ease, opacity 0.3s ease;
    pointer-events: none;
    max-width: calc(100vw - 40px);
    text-align: center;
}
.sw-update-toast.visible {
    transform: translate(-50%, 0);
    opacity: 1;
}
```

## 함정 (전부 실제로 밟았습니다)

1. **`controllerchange` 무한 리로드** — `reloading` 플래그가 없으면 리로드 → 새 SW가 또 넘겨받음 → 리로드… 로 돕니다. 플래그는 장식이 아닙니다.
2. **첫 설치에 리로드하면 안 됨** — `navigator.serviceWorker.controller`가 `null`이면 첫 방문입니다. 이때 리로드하면 처음 들어온 사람이 이유 없이 화면이 깜빡입니다. `controller` 확인은 필수입니다.
3. **precache에 `cache: 'reload'` 빠뜨리기** — 브라우저 HTTP 캐시에 있던 옛 파일을 그대로 SW 캐시에 복사합니다. 새 SW가 설치됐는데 내용은 옛것인 최악의 상태가 됩니다.
4. **`sw.js` 자체도 캐시됨** — GitHub Pages는 짧게 캐시합니다. `registration.update()`가 이걸 우회하므로 주기 호출과 `visibilitychange` 호출을 반드시 넣으세요.
5. **외부 API를 캐시** — Supabase 응답이 캐시되면 데이터가 안 바뀝니다. `fetch` 핸들러 맨 위에서 걸러내세요.
6. **`activate`에서 옛 캐시 삭제 + `clients.claim()` 누락** — 캐시가 계속 쌓이고, 새 SW가 열려 있는 탭을 넘겨받지 못합니다.
7. **서브패스 호스팅의 scope** — `/DGfinder/`에 올린다면 `sw.js`도 그 아래 있어야 하고 `register('sw.js')`는 상대경로여야 합니다. 루트에 두면 상위 경로를 제어하지 못해 조용히 아무것도 안 합니다.

## 꼭 같이 해 주세요 — 버전 올리는 스크립트

위 구성의 유일한 약점은 **버전 번호를 손으로 고쳐야 하는 자리가 많다**는 겁니다.

- `sw.js`의 `CACHE_VERSION`
- `sw.js`의 `PRECACHE_URLS` 안 `?v=`
- HTML의 `<script>` · `<link>` 태그
- JS `import` 문 안의 `?v=`

`plc-class-finder`는 이걸 손으로 했고, **`import` 한 곳을 빠뜨려서 위의 사고가 났습니다.**
DGfinder는 처음부터 스크립트로 만들어 주세요. `node scripts/bump-version.mjs` 한 번에
저장소 전체의 `?v=NN`과 `CACHE_VERSION`을 함께 올리고, 바뀐 파일 목록을 출력하면 됩니다.
빌드 도구를 새로 들이지 말고 Node 스크립트 하나로 끝내세요.

## 검증

작업을 마치면 아래를 실제로 확인하고 결과를 알려주세요.

1. 배포 → 기존 탭을 열어둔 채로 다시 배포 → 탭으로 돌아오면 토스트가 뜨고 리로드되는가
2. 리로드가 **한 번만** 되는가 (무한 루프 없음)
3. 시크릿 창 첫 방문에서 리로드가 **일어나지 않는가**
4. DevTools → Network를 offline으로 두고 새로고침 → 페이지가 캐시로 뜨는가
5. `bump-version` 실행 후 `git grep '?v='`로 옛 버전이 하나도 안 남았는가

---
