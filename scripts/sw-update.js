// scripts/sw-update.js
//
// 새 버전이 배포되면 알아서 갈아타게 한다.
//
// 이 코드는 index.html 과 admin.html 양쪽에 다 있어야 한다.
// 한때 script.js 에만 있어서, 관리자 페이지에 들어가면 갱신을 확인하지도
// 새 워커로 리로드하지도 않았다. 들어갈 때마다 옛 화면이 뜨고
// 강력 새로고침(서비스 워커를 건너뛴다)을 해야만 최신이 나왔다.
//
// 건드리면 안 되는 가드가 둘 있다.
//   reloading 플래그                     — 없으면 무한 리로드
//   navigator.serviceWorker.controller  — 없으면 첫 방문자 화면이 이유 없이 깜빡인다

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

export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return;
    }

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
