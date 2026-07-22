-- PLC Class Finder — Supabase schema (v2)
-- 라이브 시트 데이터 분석 기반. Supabase Dashboard → SQL Editor에서 실행.
-- 재실행 안전: 기존 테이블 있으면 DROP 후 재생성. **최초 이관 전에만 실행하세요.**

-- ===================================================================
-- Reset (개발 초기용 — 프로덕션 데이터 있으면 절대 실행 금지)
-- ===================================================================
drop table if exists attendance    cascade;
drop table if exists team_links    cascade;
drop table if exists location_maps cascade;
drop table if exists members       cascade;
drop table if exists sessions      cascade;
drop table if exists cohorts       cascade;

-- ===================================================================
-- 1. Tables
-- ===================================================================

create table cohorts (
  id           text primary key,           -- '3기', '25기' 등
  name         text not null,
  started_at   date,                       -- 첫 세션 날짜
  is_active    boolean default false,      -- 웹앱은 이 값이 true인 기수만 노출
  archived_at  timestamptz,
  created_at   timestamptz default now()
);

create table sessions (
  cohort_id     text references cohorts(id) on delete cascade,
  session_date  date,                      -- 2025-03-15
  label         text,                      -- '03/15' 원본 표기
  session_no    int,                       -- 1주차, 2주차 (자동 계산)
  primary key (cohort_id, session_date)
);

create table members (
  id            uuid primary key default gen_random_uuid(),
  cohort_id     text references cohorts(id) on delete restrict not null,
  name          text not null,
  phone         text,                      -- 뒷 4자리 (강선형 케이스 위해 nullable)
  full_phone    text,                      -- 연락처 원본 010-XXXX-XXXX
  team          text,
  team_no       int,                       -- 조 내 순번
  location      text,
  role          text,                      -- 튜터/서브튜터/바나바/null
  gender        text,                      -- 남/여
  age           int,
  marital       text,                      -- 미혼/기혼/이혼/기타/null
  pastor        text,                      -- 담당교역자
  telegram_ok   boolean,                   -- 원본 telegram: true/false/빈값
  sms_ok        boolean,                   -- 원본 안내문자
  lunch1        text,                      -- 김밥1차: O/X/null
  lunch2        text,                      -- 김밥2차
  note          text,                      -- .note (개인 메모)
  completion    text,                      -- 수료: O/△/X
  updated_at    timestamptz default now(),
  unique (cohort_id, name, phone)
);

create table attendance (
  member_id     uuid references members(id) on delete cascade,
  session_date  date,
  status        text,                      -- O/X/-/◎/빈값
  updated_at    timestamptz default now(),
  primary key (member_id, session_date)
);

create table team_links (
  cohort_id     text references cohorts(id) on delete cascade,
  team          text,
  chat_url      text,
  primary key (cohort_id, team)
);

create table location_maps (
  location      text primary key,
  image_url     text,                      -- thumbnail URL
  detail_url    text,                      -- 원본 이미지 링크
  updated_at    timestamptz default now()
);

-- ===================================================================
-- 2. Indexes
-- ===================================================================

create index members_cohort_team_idx on members(cohort_id, team);
create index members_cohort_name_idx on members(cohort_id, name);
create index attendance_session_idx on attendance(session_date);

-- ===================================================================
-- 3. GRANTs (auto-expose OFF 대응)
-- ===================================================================

grant select on public.cohorts       to anon, authenticated;
grant select on public.sessions      to anon, authenticated;
grant select on public.members       to anon, authenticated;
grant select on public.attendance    to anon, authenticated;
grant select on public.team_links    to anon, authenticated;
grant select on public.location_maps to anon, authenticated;

-- ===================================================================
-- 4. Row Level Security
-- ===================================================================

alter table cohorts       enable row level security;
alter table sessions      enable row level security;
alter table members       enable row level security;
alter table attendance    enable row level security;
alter table team_links    enable row level security;
alter table location_maps enable row level security;

create policy "public read cohorts"       on cohorts       for select using (true);
create policy "public read sessions"      on sessions      for select using (true);
create policy "public read members"       on members       for select using (true);
create policy "public read attendance"    on attendance    for select using (true);
create policy "public read team_links"    on team_links    for select using (true);
create policy "public read location_maps" on location_maps for select using (true);

-- 쓰기 정책은 Phase C-실시간 설계 시 별도 추가.
-- 지금은 service_role 키(RLS 우회)로만 데이터 이관/편집.

-- ===================================================================
-- 5. updated_at 자동 갱신 트리거
-- ===================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger members_set_updated_at
  before update on members
  for each row execute function set_updated_at();

create trigger attendance_set_updated_at
  before update on attendance
  for each row execute function set_updated_at();

create trigger location_maps_set_updated_at
  before update on location_maps
  for each row execute function set_updated_at();
