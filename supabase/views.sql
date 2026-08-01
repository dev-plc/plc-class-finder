-- Phase C — 판정 규칙 뷰
-- 수료·과제 기준을 여기 한 곳에만 정의한다. 기준이 바뀌면 이 파일만 수정.
--
-- 규칙 (2026-07-28 확정):
--   분모: 실제 강의 16강 = 교리1~12 + 성경적대화1~4 (교제·나눔 제외)
--   출석 인정: O(현장) / ◎(지난 기수 이수분)
--   보충: 결석(X)·미기록 주차에 과제·소감문 제출 시 출석 인정, 최대 3회
--         인정 건수는 makeup_used, 상세는 v_makeup_detail 에서 확인
--   수료: 인정 출석 = 16
--   보충 3회 초과: 원칙 미수료, 참작 사유 있으면 관리자 재량 → '관리자확인'
--   중도 합류: 합류 전 주차는 '-'. 이번 기수에 16강을 채울 수 없으므로 '진행중'.
--             이전 주차는 과제로 보충하거나 다음 기수에 이어서 듣는다.

-- ===================================================================
-- 상수: 수료 요건
-- ===================================================================
create or replace function completion_required_sessions()
returns int language sql immutable as $$ select 16 $$;

create or replace function makeup_limit()
returns int language sql immutable as $$ select 3 $$;

-- ===================================================================
-- 1. 인원별 출석 집계
-- ===================================================================
create or replace view v_attendance_summary as
with class_sessions as (
  -- 실제 강의만 (교제·나눔 제외)
  select cohort_id, session_date, label, label_norm
  from sessions
  where is_class is true
),
att as (
  select
    m.id            as member_id,
    m.cohort_id,
    m.name, m.phone, m.team, m.role, m.status,
    cs.label_norm   as session_label,
    cs.session_date,
    upper(trim(coalesce(a.status, ''))) as raw_status
  from members m
  cross join class_sessions cs
  left join attendance a
         on a.member_id = m.id and a.session_date = cs.session_date
  where m.cohort_id = cs.cohort_id
),
scored as (
  select
    att.*,
    -- 직접 출석 (현장 O / 지난 기수 이수 ◎)
    (raw_status in ('O', '◎'))                          as present,
    -- 결석 (미기록도 결석 취급, 단 수업없음 '-'은 제외)
    (raw_status not in ('O', '◎', '-'))                 as absent,
    -- 미참여 ('-'): 합류 전 주차이거나 해당 주 수업 없음
    (raw_status = '-')                                  as not_applicable,
    -- 해당 주차 과제 제출 여부
    exists (
      select 1 from homework_submissions h
      where h.member_id = att.member_id
        and h.session_label = att.session_label
    )                                                    as has_homework
  from att
)
select
  member_id, cohort_id, name, phone, team, role, status,
  count(*)                                        as total_sessions,
  count(*) filter (where present)                 as present_count,
  count(*) filter (where absent)                  as absent_count,
  -- 미참여 주차 (중도 합류 판단용)
  count(*) filter (where not_applicable)          as na_count,
  -- 결석했지만 과제 제출한 주차 = 보충 가능 건
  count(*) filter (where absent and has_homework) as makeup_available,
  -- 실제 인정되는 보충 (한도 내)
  least(
    count(*) filter (where absent and has_homework),
    makeup_limit()
  )                                               as makeup_used,
  -- 최종 인정 출석
  count(*) filter (where present)
    + least(count(*) filter (where absent and has_homework), makeup_limit())
                                                  as credited,
  -- 과제 제출했으나 한도 초과로 인정 못 받은 건
  greatest(
    count(*) filter (where absent and has_homework) - makeup_limit(),
    0
  )                                               as makeup_overflow
from scored
group by member_id, cohort_id, name, phone, team, role, status;

-- ===================================================================
-- 2. 수료 판정
-- ===================================================================
create or replace view v_completion_status as
select
  s.*,
  completion_required_sessions()          as required,
  greatest(completion_required_sessions() - s.credited, 0) as remaining_needed,
  -- 중도 합류: 합류 전 주차가 '-'로 남아 이번 기수에 16강을 채울 수 없는 경우.
  -- 이전 주차는 과제로 보충하거나 다음 기수에 이어서 듣는다.
  (s.na_count > 0
     and s.credited + s.na_count >= completion_required_sessions()
     and s.credited < completion_required_sessions())    as joined_midway,
  case
    when s.credited >= completion_required_sessions() then '수료'
    when s.makeup_overflow > 0                        then '관리자확인'
    when s.na_count > 0
     and s.credited + s.na_count >= completion_required_sessions()
                                                      then '진행중'
    else '미수료'
  end                                     as verdict,
  -- 관리자 재량 판단이 필요한 경우 (보충 한도 초과)
  (s.makeup_overflow > 0)                 as needs_admin_review,
  m.needs_review                          as flagged_by_admin,
  m.admin_note
from v_attendance_summary s
join members m on m.id = s.member_id;

-- ===================================================================
-- 3. 과제 제출이 필요한 건 (결석 주차만)
--    출석한 주차는 과제 안내 대상이 아니다.
-- ===================================================================
create or replace view v_homework_required as
select
  m.id           as member_id,
  m.cohort_id,
  m.name, m.phone, m.team,
  s.label_norm   as session_label,
  s.label        as session_raw,
  s.session_date
from members m
join sessions s on s.cohort_id = m.cohort_id and s.is_class is true
left join attendance a
       on a.member_id = m.id and a.session_date = s.session_date
left join homework_submissions h
       on h.member_id = m.id and h.session_label = s.label_norm
where
  -- 이미 지난 세션만
  s.session_date <= current_date
  -- 결석한 주차만 (출석·수업없음 제외)
  and upper(trim(coalesce(a.status, ''))) not in ('O', '◎', '-')
  -- 아직 제출 안 한 건만
  and h.id is null
  and m.status = 'active';

-- ===================================================================
-- 4. 수료 위험자
--    남은 강의를 다 나와도 수료 요건을 못 채우는 인원
-- ===================================================================
create or replace view v_completion_risk as
with remaining as (
  select m.id as member_id,
         count(*) filter (where s.session_date > current_date) as sessions_left
  from members m
  join sessions s on s.cohort_id = m.cohort_id and s.is_class is true
  group by m.id
)
select
  c.member_id, c.cohort_id, c.name, c.phone, c.team, c.role,
  c.credited, c.required, c.absent_count,
  c.makeup_used, c.makeup_available, c.makeup_overflow,
  r.sessions_left,
  -- 남은 세션을 전부 출석해도 도달 가능한 최대치
  c.credited + r.sessions_left as max_possible,
  c.verdict
from v_completion_status c
join remaining r on r.member_id = c.member_id
where c.verdict not in ('수료', '진행중')
  and c.credited + r.sessions_left < c.required
  and c.status = 'active';

-- ===================================================================
-- 5. 조별 리포트 요약
-- ===================================================================
create or replace view v_team_report as
select
  team,
  cohort_id,
  count(*)                                        as member_count,
  count(*) filter (where verdict = '수료')         as completed,
  count(*) filter (where verdict = '진행중')       as in_progress,
  count(*) filter (where verdict = '관리자확인')    as needs_review,
  count(*) filter (where verdict = '미수료')       as incomplete,
  -- 과제로 출석 인정받은 총 건수 (조 단위)
  sum(makeup_used)                                as makeup_total,
  round(avg(credited)::numeric, 1)                as avg_credited,
  round(100.0 * avg(credited) / nullif(max(required), 0), 1) as avg_pct
from v_completion_status
where status = 'active'
group by team, cohort_id;

-- ===================================================================
-- GRANT
-- ===================================================================
grant select on v_attendance_summary to anon, authenticated, service_role;
grant select on v_completion_status  to anon, authenticated, service_role;
grant select on v_homework_required  to anon, authenticated, service_role;
grant select on v_completion_risk    to anon, authenticated, service_role;
grant select on v_team_report        to anon, authenticated, service_role;


-- ===================================================================
-- 6. 최근 편성된 신규 인원
--    매주 수료·추가가 발생하므로 '누가 새로 왔는지' 빠르게 파악
-- ===================================================================
create or replace view v_recent_members as
select
  m.id, m.cohort_id, m.name, m.phone, m.team, m.role,
  m.location, m.status, m.created_at,
  -- 첫 출석 기록이 있는 세션
  (select min(s.session_date)
     from attendance a
     join sessions s on s.session_date = a.session_date and s.cohort_id = m.cohort_id
    where a.member_id = m.id
      and upper(trim(coalesce(a.status,''))) in ('O','◎')) as first_attended
from members m
where m.status = 'active'
order by m.created_at desc nulls last;

-- ===================================================================
-- 7. 비활성 인원 (시트에서 빠진 사람 = 수료·하차)
-- ===================================================================
create or replace view v_inactive_members as
select
  m.id, m.cohort_id, m.name, m.phone, m.team, m.role,
  m.completion, m.updated_at,
  c.credited, c.required, c.verdict
from members m
left join v_completion_status c on c.member_id = m.id
where m.status <> 'active';

grant select on v_recent_members   to anon, authenticated, service_role;
grant select on v_inactive_members to anon, authenticated, service_role;


-- ===================================================================
-- 8. 과제로 출석 인정받은 내역 (보충 상세)
--    결석·미기록 주차에 과제·소감문을 제출해 출석으로 인정된 건.
--    인정 한도(3회)를 넘은 건은 counted=false 로 구분한다.
-- ===================================================================
create or replace view v_makeup_detail as
with base as (
  select
    m.id            as member_id,
    m.cohort_id,
    m.name, m.phone, m.team, m.status,
    s.label_norm    as session_label,
    s.session_date,
    upper(trim(coalesce(a.status, ''))) as att_status,
    h.type          as homework_type,
    h.url           as homework_url,
    h.submitted_at
  from members m
  join sessions s
    on s.cohort_id = m.cohort_id and s.is_class is true
  left join attendance a
    on a.member_id = m.id and a.session_date = s.session_date
  join homework_submissions h
    on h.member_id = m.id and h.session_label = s.label_norm
  where upper(trim(coalesce(a.status, ''))) not in ('O', '◎', '-')
),
ranked as (
  select
    base.*,
    row_number() over (
      partition by member_id
      order by session_date, submitted_at nulls last
    ) as seq
  from base
)
select
  member_id, cohort_id, name, phone, team, status,
  session_label, session_date,
  att_status, homework_type, homework_url, submitted_at,
  seq,
  (seq <= makeup_limit()) as counted   -- 한도 내면 출석 인정
from ranked;

grant select on v_makeup_detail to anon, authenticated, service_role;
