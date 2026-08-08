# DGfinder — Supabase 조회 전환 (인계 프롬프트)

아래 내용을 DGfinder 저장소의 Claude Code 대화에 그대로 붙여넣으세요.

---

## DGfinder 를 Supabase 로 옮기려고 해. 범위는 조회까지만.

### 배경

옆 프로젝트 `dev-plc/plc-class-finder` (교리교육 조배치 조회)에서
Google Sheet + Apps Script → Supabase 전환을 막 끝냈어.
같은 방식을 DGfinder 에 옮기되 **시간이 없어서 범위를 좁힌다.**

### 이번에 할 것 / 안 할 것

**할 것**
- Supabase 에 DGfinder 명단 테이블 만들기
- 시트 → Supabase 동기화 (GitHub Actions 에서 실행)
- 앱이 Supabase 에서 직접 읽어, 이름 + 전화 뒷 4자리로 조회
- 조·위치·배치도 이미지·단톡 링크 표시 (지금 앱이 보여주는 것 그대로)

**안 할 것 (이번엔 건드리지 마)**
- 출석 체크, 수료 판정, 과제·식사 신청, 관리자 화면
- 실시간 동기화, PWA, 통계

목표는 **"조회가 빨라지는 것"** 하나다. 지금 GAS 왕복이 느린 게 문제라서
읽기 경로만 Supabase 로 바꾸면 된다.

### 먼저 확인해 줘 (코드를 쓰기 전에)

1. **DGfinder 현재 구조**
   - GAS `doGet` 이 무엇을 반환하는지 (필드 이름·형태)
   - 시트 탭 구성과 컬럼 (특히 ID 열이 `이름+전화뒷4자리` 형식인지)
   - 앱이 화면에 실제로 쓰는 필드가 무엇인지
2. **Supabase 를 새로 팔지, plc-class-finder 가 쓰는 프로젝트에 테이블을 더할지**
   - 같은 프로젝트를 권하는 이유: 무료 티어 프로젝트 수 제한,
     7일 비활성 pause 관리가 한 곳으로 모임, 시크릿 재사용
   - 그 경우 테이블 이름을 `dg_` 로 시작해 충돌을 피할 것
   - 내가 알려줄 수 있는 값: `SUPABASE_URL`, `anon key`
     (`service_role` 키는 채팅에 붙이지 않고 GitHub Secrets 에만 넣을게)

### 참고할 저장소

`dev-plc/plc-class-finder` (main 브랜치). 그대로 베끼지 말고 **조회 전용으로 덜어내서** 가져와.

| 파일 | 쓸모 |
|---|---|
| `scripts/supabase-config.js` | anon 접속, `sbSelect`, 활성 기수 조회. **거의 그대로 쓸 수 있음** |
| `scripts/hangul.js` | 초성·자모 검색 (`ㄱㅁㅊ` → `김민철`). 그대로 |
| `scripts/members-data.js` | 데이터 접근 계층. **출석·과제·수료 부분은 다 걷어내고** 명단 조회만 남길 것 |
| `scripts/sync-sheet-to-db.mjs` | 시트 → DB 동기화. **세션·출석·과제·김밥 부분 전부 삭제**, 명단만 |
| `.github/workflows/sync-db.yml` | 수동 + 하루 1회. pause 방지 겸용 |
| `scripts/gas/doGet.js` | 시트 읽어 JSON 반환. DGfinder 것과 비교해서 필요한 부분만 |

**핵심 설계 하나만 지켜 줘**: UI 는 Supabase 를 몰라야 한다.
`members-data.js` 같은 데이터 계층 하나를 두고 화면은 그 함수만 쓴다.
그래야 나중에 백엔드를 바꿔도 화면을 안 건드린다.

### 제안 스키마 (조회 전용 최소 구성 — 실제 컬럼은 DGfinder 시트 보고 조정)

```sql
create table dg_members (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  text not null,              -- 'DG-1기' 등. 기수가 없으면 고정값 하나
  name       text not null,
  phone      text not null default '',   -- 뒷 4자리. null 금지 (아래 함정 2번)
  team       text,
  team_no    int,
  location   text,
  status     text default 'active',
  updated_at timestamptz default now(),
  unique (cohort_id, name, phone)
);

create table dg_locations (
  location   text primary key,
  image_url  text,
  detail_url text
);

create table dg_team_links (
  cohort_id text not null,
  team      text not null,
  chat_url  text,
  primary key (cohort_id, team)
);
```

읽기는 anon 으로 열고 쓰기는 막을 것:

```sql
alter table dg_members    enable row level security;
alter table dg_locations  enable row level security;
alter table dg_team_links enable row level security;

create policy "public read" on dg_members    for select using (true);
create policy "public read" on dg_locations  for select using (true);
create policy "public read" on dg_team_links for select using (true);

grant select on dg_members, dg_locations, dg_team_links to anon, authenticated;
grant all    on dg_members, dg_locations, dg_team_links to service_role;
```

`service_role` 은 RLS 를 우회하지만 **auto-expose 가 꺼져 있으면 GRANT 를 따로 줘야 한다.**
(plc 에서 `permission denied for table cohorts` 로 한참 헤맸다)

---

## 반드시 지킬 것 — plc 에서 사고 나면서 배운 것들

시간을 아끼려면 이 8개만 처음부터 지켜 줘. 전부 실제로 터졌던 것들이다.

**1. 시트에 기수(또는 대상) 표식을 적고, 동기화가 대조하게 할 것**

plc 에서 새 기수 시트가 지난 기수로 동기화되면서
지난 기수 명단이 통째로 `inactive` 가 되고 세션 라벨까지 덮였다. 복구에 반나절 걸렸다.
시트 상단 아무 칸에 `3기` 처럼 적어 두고, 동기화가 대상과 다르면 **아무것도 쓰지 않고 중단**하게 했다.
DGfinder 도 시트가 어느 대상인지 스스로 밝히게 하면 같은 사고를 구조적으로 막는다.

**2. 전화번호를 `null` 로 저장하지 말 것 — 빈 문자열로**

Postgres 에서 `null` 은 서로 다른 값이라 `unique (cohort_id, name, phone)` 이 안 걸린다.
전화번호 없는 사람이 동기화할 때마다 새 행으로 쌓여서, 한 명이 7행이 됐다.

**3. 시트에서 오는 값은 전부 정규화할 것**

- 날짜 헤더: `9/6` · `09/06` · 진짜 Date 값이 섞여 온다 → `MM/DD` 로 통일
- ID: 공백·전각 문자가 섞인다 → `replace(/\s/g, '')`
- **`new Date(값).toISOString()` 을 바로 부르지 말 것.** 값이 날짜가 아니면 `RangeError` 로 죽는다.
  `Date.parse` 로 먼저 확인하고 쓸 것

**4. GAS 는 "새 배포" 말고 "기존 배포 → ✏️ → 새 버전"**

"새 배포"는 매번 새 URL 을 만든다. 시크릿에 든 옛 URL 이 404 가 나서
"코드가 잘못됐나" 하고 한참 헤맸다. 기존 배포를 수정하면 URL 이 유지된다.
그리고 URL 은 반드시 `/exec` 로 끝나야 한다 — `/dev` 는 본인만 접근 가능해서 Actions 에서 404 다.

**5. 동기화는 upsert 만 하고 삭제하지 않는다는 걸 기억할 것**

시트에서 지운 행이 DB 에 그대로 남는다. plc 에서 이미 없는 세션·신청이 계속 살아 있었다.
시트를 정리했으면 DB 쪽도 지우고 다시 동기화해야 맞는다.
반대로 **인원은 삭제하지 말고 `status='inactive'` 로** — 이력이 날아가면 안 된다.

**6. 로그는 `console.log` 로 통일할 것**

`console.warn` 은 stderr 라 GitHub Actions 로그에서 stdout 과 섞여
경고가 엉뚱한 단계 아래에 찍힌다. 어느 단계에서 난 문제인지 알 수 없다.

**7. 무시된 항목은 반드시 이름을 남길 것**

`명단에 없는 1명 무시` 만 찍혀서 누군지 알 수 없었다.
이름을 찍게 하니 곧바로 원인(폼에 적은 전화번호가 명단과 달랐다)이 보였다.
조용히 버리면 "다 들어갔다"로 읽힌다.

**8. 보안**

- 저장소가 public 이면 **실명·전화번호가 든 파일을 절대 커밋하지 말 것.** `.gitignore` 에 먼저 넣기
- 클라이언트에는 `anon` 키만. RLS 로 읽기만 열고 쓰기는 막는다
- `service_role` 키는 GitHub Secrets 에만. 채팅·코드·로그 어디에도 남기지 말 것

---

## 진행 방식

1. 위 "먼저 확인해 줘" 두 가지를 조사해서 알려주고, 스키마 초안을 제안해 줘
2. 내가 확인하면 그때 코드 작성
3. 동기화는 **dry-run 을 먼저** 돌려서 인원 수·필드가 맞는지 보고, 그다음 실제 반영
4. 컨테이너에서 Supabase·Google 로 직접 나가는 건 프록시가 막혀 있을 수 있어.
   그러면 plc 처럼 **GitHub Actions 를 실행 주체로** 삼고 결과를 로그로 확인하면 된다
