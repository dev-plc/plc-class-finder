# PL교회 새가족교육 조 배치 검색기

새가족교육(교리교육) 참여자가 자기 조·장소·출결을 스스로 확인하고,
튜터가 현장에서 출석을 찍고, 관리자가 결석자·출석부를 관리하는 웹앱.

- 배포: `main` → GitHub Pages → **classfinder.plch.kr**
- 참여자 화면 `index.html` · 관리자 화면 `admin.html`

---

## 데이터가 어디서 어디로 가나

**출결의 원본은 스프레드시트다. DB(Supabase)는 조회를 빠르게 하려고 두는 사본이다.**

```
앱에서 출석 체크 ─→ GAS doPost ─┬─→ ① 출석부(DB) 탭      ← 원본
                                └─→ ② set_attendance_batch ← 사본, 즉시

시트에 직접 입력 ─→ pushAttendanceToDb (10분 트리거) ─→ DB   ← 자가 치유

명단·편성·위치·과제·김밥 ─→ 일 1회(정오) 동기화 ─→ DB
```

- **앱은 DB 를 직접 쓰지 않는다.** 쓰기는 `sbPostGas`(GAS) 로만 나간다
- 읽기는 Supabase 에서 바로 한다 (빠르다)
- ② 가 실패해도 저장은 성공이다 — 원본에 들어갔고 트리거가 곧 맞춘다

> 한때 DB 를 원본으로 두고 앱이 직접 썼다. 시트에서도 손으로 고치니 두 곳에서
> 쓰는 꼴이 됐고, 시트에만 있던 `◎` 를 앱이 몰라 이수자가 결석으로 저장된 일이
> 있었다. 그래서 뒤집었다. 자세한 규칙은 `CLAUDE.md`.

---

## 화면

### 참여자 (`index.html`)

이름 + 전화 뒷 4자리로 조회한다.

- 조 · 장소 · 배치도 · 김밥 신청 여부
- **수료 진행률** 과 제출해야 할 과제 (결석한 주차 중 미제출만)
- 주차별 출석 그리드 · 김밥 · 과제 (최근순, 5개 + 더보기)
- **안내방** — 전체방(현장/온라인) 과 조별방
- 초성 검색 (`ㄱㄷㅎ` → 김도현) · 글씨 크기 토글 · PWA 설치

**튜터 · 서브튜터 · 바나바 · 관리자**로 등록된 사람에게는 조원 명단이 더 보인다.

- 주차를 골라 출석 체크 → 바뀐 사람만 저장
- `◎`(출석 인정) · `−`(수업 없음) 은 **잠겨 있다** — 시트에서만 고친다
- 📊 전체 출석표 — 조 전체를 주차 × 사람 표로

### 관리자 (`admin.html`)

| 탭 | 하는 일 |
|---|---|
| **출석 관리** | 주차·조를 골라 `O` `X` 입력 → 바뀐 사람만 저장 |
| **조별 보기** | 조 카드 → 조원 명단 |
| **개인별 보기** | 카드를 누르면 그 사람의 출석·김밥·과제 |
| **결석 현황** | 이 주차 결석자 / 누적 결석자(2·3·4회 이상) · 담당교역자별 · 명단 복사 |
| **출석부 출력** | 조별 A4 인쇄 |

위쪽 **⟳ 시트에서 지금 가져오기** 는 일 1회 동기화를 지금 돌린다
(GAS → GitHub Actions).

오른쪽 위 배지에 **지금 도는 버전**이 뜬다 (`3기 · 관리자 · v93`).
고친 게 안 보이면 여기부터 본다.

---

## 규칙

```
분모: 16강 = 교리1~12 + 성경적대화1~4   (교제·나눔은 is_class=false 로 제외)

O   출석          ◎  출석 인정 — 지난 기수 이수 또는 과제·소감문 대체
X   결석          −  수업 없음 (집계 제외)
빈칸  아직 기록되지 않음 — 결석이 아니다

보충   결석한 주차에 과제·소감문을 내면 출석 인정, 최대 3회
수료   present + makeup_used >= 16
재수강 4회 결석
```

**판정 규칙은 `supabase/views.sql` 한 곳에만 있다.** 앱은 읽어서 보여 줄 뿐이다.

---

## 파일

```
index.html · script.js · style.css        참여자 화면
admin.html · admin.js  · admin.css        관리자 화면
sw.js · manifest.webmanifest              PWA · 자동 업데이트

scripts/
  members-data.js       데이터 계층. 백엔드는 이 파일 안에만 있다
  supabase-config.js    접속 설정 · sbPostGas(쓰기 창구)
  hangul.js             초성·자모 매칭
  sw-update.js          새 버전 감지 → 리로드
  sync-sheet-to-db.mjs  시트 → DB 동기화 (Actions 에서 실행)
  carry-over-attendance.mjs  지난 기수 이수분 ◎ 이월
  gas/                  Apps Script 원본 (doGet.js · pullAttendance.js)

supabase/
  schema.sql · views.sql · rpc_attendance.sql
  fix_*.sql             사고 복구 기록

.github/workflows/
  sync-db.yml   수동 + 일 1회 (Supabase pause 방지 겸용)
  query-db.yml  preset 조회
  run-sql.yml   임의 SELECT (진단용)
  carry-over.yml
```

---

## 고칠 때

프론트를 고쳤으면 **버전 네 자리를 같은 값으로** 올린다. 예외 없다.
안 올리면 배포는 됐는데 화면이 안 바뀐다. `CLAUDE.md` 에 절차가 있다.

```bash
git grep -o '?v=[0-9]*' -- '*.html' '*.js' | sort -u   # 한 종류만 나와야 한다
git grep -n "from '\./[^']*\.js'" -- '*.js'            # 아무것도 안 나와야 한다
```

GAS 의 `doPost` 를 고치면 **웹앱을 재배포**해야 한다
(URL 을 유지하려면 기존 배포의 버전만 올린다).

---

## 알아 둘 것

- **저장소가 public 이다.** 실명·전화번호가 든 파일을 커밋하지 않는다
  (`data.live.json` 등은 `.gitignore` 에 있다).
  `service_role` 키는 GitHub Secrets 에만 둔다.
  `anon` 키는 공개돼도 안전하다 — RLS 가 막고, 쓰기는 RPC 로만 된다
- **관리자 로그인은 접근 제어가 아니다.** 아이디·비밀번호가 `script.js` 에
  그대로 있고 그 파일은 공개돼 있다. 화면을 나누는 칸막이일 뿐이다
- 앞단 CDN 이 HTML 을 오래 붙들면 배포가 반영되지 않는다.
  호스팅 쪽 요청 문구는 `HOSTING_REQUEST.md`

---

## 문서

| 파일 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙 — 버전 올리기 · 자동 업데이트 · 출결 원본 |
| `NEXT_TASKS.md` | 작업 내역과 남은 일 |
| `COHORT_SWITCH.md` | 기수 전환 절차 |
| `UPDATE_GUIDE.md` | 데이터 갱신 |
| `HOSTING_REQUEST.md` | 호스팅 업체 요청 문구 (엣지 캐시) |
| `DGFINDER_*.md` | 자매 프로젝트(DGfinder) 인계 프롬프트 |
