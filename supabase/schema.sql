-- PLC Class Finder — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor before migration.

-- ===================================================================
-- 1. Tables
-- ===================================================================

create table if not exists cohorts (
  id           text primary key,
  name         text not null,
  started_at   date,
  is_active    boolean default false,
  archived_at  timestamptz,
  created_at   timestamptz default now()
);

create table if not exists members (
  id           uuid primary key default gen_random_uuid(),
  cohort_id    text references cohorts(id) on delete restrict not null,
  name         text not null,
  phone        text not null,
  team         text,
  location     text,
  lunch        boolean default false,
  age          int,
  role         text,
  attendance   boolean default false,
  updated_at   timestamptz default now(),
  unique (cohort_id, name, phone)
);

create table if not exists team_links (
  cohort_id    text references cohorts(id) on delete cascade not null,
  team         text not null,
  chat_url     text,
  primary key (cohort_id, team)
);

create table if not exists location_maps (
  location     text primary key,
  image_url    text not null,
  updated_at   timestamptz default now()
);

-- ===================================================================
-- 2. Indexes
-- ===================================================================

create index if not exists members_cohort_team_idx on members(cohort_id, team);
create index if not exists members_cohort_name_idx on members(cohort_id, name);

-- ===================================================================
-- 3. GRANTs (auto-expose OFF 대응)
-- ===================================================================

grant select on public.cohorts       to anon, authenticated;
grant select on public.members       to anon, authenticated;
grant select on public.team_links    to anon, authenticated;
grant select on public.location_maps to anon, authenticated;

-- ===================================================================
-- 4. Row Level Security
-- ===================================================================

alter table cohorts       enable row level security;
alter table members       enable row level security;
alter table team_links    enable row level security;
alter table location_maps enable row level security;

drop policy if exists "public read cohorts"       on cohorts;
drop policy if exists "public read members"       on members;
drop policy if exists "public read team_links"    on team_links;
drop policy if exists "public read location_maps" on location_maps;

create policy "public read cohorts"       on cohorts       for select using (true);
create policy "public read members"       on members       for select using (true);
create policy "public read team_links"    on team_links    for select using (true);
create policy "public read location_maps" on location_maps for select using (true);

-- 쓰기 정책은 Phase C-실시간 설계 시점에 별도 추가.
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

drop trigger if exists members_set_updated_at on members;
create trigger members_set_updated_at
  before update on members
  for each row execute function set_updated_at();

drop trigger if exists location_maps_set_updated_at on location_maps;
create trigger location_maps_set_updated_at
  before update on location_maps
  for each row execute function set_updated_at();
