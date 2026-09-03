# plc-class-finder — 작업 규칙

## 프론트엔드를 고쳤으면 버전을 올린다 (예외 없음)

사용자는 코드를 직접 고치지 않는다. **버전 올리기는 전적으로 이쪽 책임이다.**
"다음에 올리자"는 없다. 고친 커밋에서 같이 올린다.

대상 파일: `index.html` · `admin.html` · `script.js` · `admin.js` ·
`style.css` · `admin.css` · `scripts/*.js` · `sw.js`
(`scripts/*.js` 가 늘면 `sw.js` 의 `PRECACHE_URLS` 에도 넣는다)

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
3. `scripts/sw-update.js` 의 `registerServiceWorker()` — 새 버전 감지 →
   `SKIP_WAITING` → `controllerchange` → 리로드.
   **`script.js` 와 `admin.js` 양쪽에서 다 불러야 한다.**
   한때 `script.js` 에만 있어서, 관리자 페이지는 들어갈 때마다 옛 화면이 뜨고
   강력 새로고침(서비스 워커를 건너뛴다)을 해야만 최신이 나왔다.

3번에는 건드리면 안 되는 가드가 둘 있다.
`reloading` 플래그(없으면 무한 리로드)와 `navigator.serviceWorker.controller`
검사(없으면 첫 방문자 화면이 이유 없이 깜빡인다).

## 출결의 원본은 시트다 (DB 는 사본)

한때 DB 를 원본으로 두고 앱에서 직접 썼다. 시트에서도 손으로 고치니
두 곳에서 쓰는 꼴이 됐고, 어느 쪽이 최신인지 판단할 근거가 없어 어긋났다.
시트에만 있던 ◎ 를 앱이 몰라서 이수자가 결석으로 저장된 일이 실제로 있었다.

지금 흐름:

```
앱에서 체크 → GAS doPost → ① 출석부(DB) 탭에 쓴다  ← 원본
                        └→ ② set_attendance_batch  ← 사본, 즉시
시트에 직접 입력 → pushAttendanceToDb (10분 트리거) → DB   ← 자가 치유
```

- **앱은 DB 를 직접 쓰지 않는다.** `updateAttendanceBatch` 는 `sbPostGas` 로만 간다
- ② 가 실패해도 저장은 성공이다. 원본에 들어갔고 트리거가 곧 맞춘다
- `pullAttendanceFromDb`(DB → 시트)는 **기수 시작 때만**. 평소에 돌리면 원본을 덮는다
- 일 1회 동기화의 `--import-attendance` 는 계속 꺼 둔다. 트리거가 그 일을 대신한다

읽기는 Supabase 에서 바로 한다 (빠르다). 쓰기만 GAS 를 거친다.

## 출결 값은 다섯 가지다

```
O     출석
◎     지난 기수 이수 이월       ← 이월 스크립트만 찍는다
과제   결석했지만 과제·소감문으로 메움
X     결석
−     수업 없음 (집계 제외)
빈칸   아직 기록되지 않음 — 결석이 아니다
```

한때 `◎` 하나가 '이월' 과 '과제 대체' 를 겸했다. 시트가 둘을 같은 글자로 주니
코드가 가릴 수 없었고, 더 나쁘게는 **3회 한도가 우회됐다** — `◎` 는 `present`
로 세어져 `makeup_limit()` 을 안 거치므로, 손으로 `◎` 를 적으면 6번을 대체해도
관리자확인조차 안 떴다. 그래서 `과제` 를 따로 뒀다.

- **`과제` 는 결석이다.** `views.sql` 의 `is_absent()` 가 `X` 와 같이 센다.
  인정 여부를 정하는 것은 적힌 글자가 아니라 `homework_submissions` 다 —
  '과제' 라고 적혀 있어도 제출 기록이 없으면 그냥 결석이고, 그래야 3회 한도가 붙는다
- **앱은 `◎ 과제 −` 를 쓰지 않는다.** 셋 다 보기 전용이고 시트에서만 고친다.
  화면에서 잠겨 있어 일괄 처리에도 안 걸린다
- 결석 판정은 `supabase/views.sql` 의 `is_absent()` **한 곳**에만 있다.
  세 뷰(`v_attendance_summary` · `v_homework_required` · `v_makeup_detail`)가
  그걸 쓴다. 손으로 세 곳을 맞추던 시절에 하나를 빠뜨리면 다음 기수 이월 때가
  되어서야 조용히 드러났다
- 값을 하나 더 늘리려면 **화이트리스트 세 곳**을 같이 연다:
  `rpc_attendance.sql` · `gas/doGet.js` · `gas/pullAttendance.js`
  (뒤 둘은 **재배포**해야 한다. 안 하면 그 값이 조용히 건너뛰어진다)

GAS 웹앱은 `application/json` 을 받으면 preflight 때문에 CORS 로 막힌다.
반드시 `text/plain;charset=utf-8` 로 보낼 것.
그리고 `doPost` 를 고치면 **웹앱을 재배포**해야 한다 (URL 유지하려면 기존 배포의 버전만 올린다).

## 저장소가 public 이다

- 실명·전화번호가 든 파일(`data.live.json` 등)을 커밋하지 않는다 (`.gitignore` 등록됨)
- **문서의 예시도 마찬가지다.** `UPDATE_GUIDE.md` 의 CSV 샘플이 진짜 사람이었다
  (이름+전화뒷4+나이+조). 예시는 `홍길동1234` 처럼 가짜로 쓴다
- 한 번 커밋하면 지워도 이력에 남는다. 2026-09-03 에 CSV 7개·`data.json`·
  실명 토큰 319개를 `git filter-repo` 로 잘라내고 `main` 을 재작성했다.
  **재작성해도 GitHub 은 옛 커밋을 SHA 로 한동안 돌려준다** — 지원팀에 gc 를
  따로 요청해야 한다. 애초에 안 올리는 것 말고 싸게 되돌리는 방법은 없다
- `service_role` 키는 GitHub Secrets 에만 둔다. 채팅·코드·로그 어디에도 남기지 않는다
- `anon` 키는 공개돼도 안전하다 — RLS 가 막고, 쓰기는 `set_attendance_batch` RPC 로만 된다

## 개발 기록 (옵시디언 연동)

이 저장소의 과거 개발 기록, 트러블슈팅 노트, 설계 결정 사항은 아래 경로에
정리되어 있습니다:

G:\내 드라이브\EleaZar\dev-notes\plc-class-finder\

과거에 겪었던 문제, 설계 이유, 트러블슈팅 이력이 필요한 작업을 할 때는
먼저 위 경로를 확인하세요.