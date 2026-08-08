# plc-class-finder — 작업 규칙

## 프론트엔드를 고쳤으면 버전을 올린다 (예외 없음)

사용자는 코드를 직접 고치지 않는다. **버전 올리기는 전적으로 이쪽 책임이다.**
"다음에 올리자"는 없다. 고친 커밋에서 같이 올린다.

대상 파일: `index.html` · `admin.html` · `script.js` · `admin.js` ·
`style.css` · `admin.css` · `scripts/*.js` · `sw.js`

이 중 **하나라도** 내용이 바뀌면, 커밋 전에 네 자리를 전부 손본다.

1. `sw.js` 의 `CACHE_VERSION` (`plc-v21` → `plc-v22`)
2. `sw.js` 의 `PRECACHE_URLS` 안 `?v=`
3. `index.html` · `admin.html` 의 `<script>` · `<link>` 태그 `?v=`
4. **`scripts/*.js` 의 `import` 문 안 `?v=`** ← 여기를 빠뜨려 사고가 났다

숫자는 파일별로 따로 관리하지 말고 **한 번에 같은 값으로** 올린다.
지금 `36`/`32`/`2` 로 갈려 있는 건 파일별로 올리던 시절의 흔적이고,
그 방식이라서 4번을 놓쳤다. 앞으로는 전부 같은 숫자로 맞춘다.

커밋 전 확인:

```bash
git grep -o '?v=[0-9]*' -- '*.html' '*.js' | sort -u   # 한 종류만 나와야 한다
git grep -n "from '\./[^']*\.js'" -- '*.js'             # 아무것도 안 나와야 한다
```

두 번째가 왜 중요한가: HTML `<script>` 태그에만 버전을 붙이고 `import` 문을
그냥 두면, 진입점만 새 파일이고 그 아래 모듈 체인은 전부 옛 URL 이라
캐시에서 나온다. 실제로 `members-data.js` 가 `v33` 에서 며칠 멈춰 있었다.
배포는 됐는데 화면이 안 바뀌어서 원인을 찾는 데 오래 걸렸다.

## 자동 업데이트는 세 겹으로 서 있다

한 겹씩 붙였다가 그때마다 새는 곳이 남아서 셋이 됐다. 하나라도 빼지 않는다.

1. `sw.js` — 앱 코드는 **네트워크 우선**, 아이콘·이미지만 캐시 우선,
   외부 API(`supabase.co` 등)는 아예 통과
2. 모든 자원 URL 에 `?v=NN` (위 규칙)
3. `script.js` 의 `registerServiceWorker()` — 새 버전 감지 →
   `SKIP_WAITING` → `controllerchange` → 리로드

3번에는 건드리면 안 되는 가드가 둘 있다.
`reloading` 플래그(없으면 무한 리로드)와 `navigator.serviceWorker.controller`
검사(없으면 첫 방문자 화면이 이유 없이 깜빡인다).

## 저장소가 public 이다

- 실명·전화번호가 든 파일(`data.live.json` 등)을 커밋하지 않는다 (`.gitignore` 등록됨)
- `service_role` 키는 GitHub Secrets 에만 둔다. 채팅·코드·로그 어디에도 남기지 않는다
- `anon` 키는 공개돼도 안전하다 — RLS 가 막고, 쓰기는 `set_attendance_batch` RPC 로만 된다
