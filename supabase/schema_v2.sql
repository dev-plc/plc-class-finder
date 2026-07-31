-- Phase C — 스키마 보강 (v2)
-- Supabase Dashboard → SQL Editor에서 실행.
-- 기존 테이블은 유지하고 컬럼·테이블만 추가하므로 데이터 손실 없음.

-- ===================================================================
-- 1. sessions — 실제 강의 여부 구분
--    교리1~12, 성경적대화1~4 = true (수료 분모)
--    교제, 나눔               = false (분모 제외)
-- ===================================================================
alter table sessions add column if not exists label_norm text;   -- '교리1', '성경적대화1'
alter table sessions add column if not exists is_class boolean default true;

-- ===================================================================
-- 2. members — 관리자 재량 판단용 필드
-- ===================================================================
alter table members add column if not exists admin_note text;
alter table members add column if not exists needs_review boolean default false;
alter table members add column if not exists status text default 'active';
  -- active | completed | withdrawn (수료·하차 처리용)

-- ===================================================================
-- 3. 김밥 신청 (세션별)
-- ===================================================================
create table if not exists kimbap_signups (
  cohort_id     text references cohorts(id) on delete cascade not null,
  member_id     uuid references members(id) on delete cascade not null,
  session_label text not null,              -- '교리1', '성경적대화2'
  session_date  date,
  applied       boolean default false,
  updated_at    timestamptz default now(),
  primary key (member_id, session_label)
);

create index if not exists kimbap_cohort_session_idx
  on kimbap_signups(cohort_id, session_label);

-- ===================================================================
-- 4. 과제 제출 로그 (한 사람이 여러 건)
-- ===================================================================
create table if not exists homework_submissions (
  id            uuid primary key default gen_random_uuid(),
  cohort_id     text references cohorts(id) on delete cascade not null,
  member_id     uuid references members(id) on delete cascade not null,
  session_label text not null,              -- 정규화된 세션명 '교리3'
  session_raw   text,                       -- 폼 원문 '3강 예수 그리스도는...'
  type          text,                       -- '과제' | '과제+소감문' | '소감문'
  url           text,
  submitted_at  timestamptz,
  created_at    timestamptz default now(),
  unique (member_id, session_label, type)
);

create index if not exists homework_member_idx  on homework_submissions(member_id);
create index if not exists homework_session_idx on homework_submissions(cohort_id, session_label);

-- ===================================================================
-- 5. GRANT
-- ===================================================================
grant select on public.kimbap_signups        to anon, authenticated;
grant select on public.homework_submissions  to anon, authenticated;
grant all    on public.kimbap_signups        to service_role;
grant all    on public.homework_submissions  to service_role;

-- ===================================================================
-- 6. RLS
-- ===================================================================
alter table kimbap_signups       enable row level security;
alter table homework_submissions enable row level security;

drop policy if exists "public read kimbap"   on kimbap_signups;
drop policy if exists "public read homework" on homework_submissions;

create policy "public read kimbap"   on kimbap_signups       for select using (true);
create policy "public read homework" on homework_submissions for select using (true);

-- ===================================================================
-- 7. updated_at 트리거
-- ===================================================================
drop trigger if exists kimbap_set_updated_at on kimbap_signups;
create trigger kimbap_set_updated_at
  before update on kimbap_signups
  for each row execute function set_updated_at();
