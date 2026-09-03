-- Phase C — 판정 규칙 뷰
-- 수료·과제 기준을 여기 한 곳에만 정의한다. 기준이 바뀌면 이 파일만 수정.
--
-- 규칙 (2026-07-28 확정):
--   분모: 실제 강의 16강 = 교리1~12 + 성경적대화1~4 (교제·나눔 제외)
--   출석 인정: O(현장) / ◎(지난 기수 이수 이월)
--   보충: 결석(X·과제) 주차에 과제·소감문 제출 시 출석 인정, 최대 3회
--         '과제' 는 사람이 읽으라고 붙이는 라벨이고, 인정 근거는 제출 기록이다
--         인정 건수는 makeup_used, 상세는 v_makeup_detail 에서 확인
--   수료: 인정 출석 = 16
--   보충 3회 초과: 원칙 미수료, 참작 사유 있으면 관리자 재량 → '관리자확인'
--   '-' 는 사유(하차·중도합류·휴강)를 구분하지 않고 집계에서 제외한다.
--   결국 출석으로 인정되지 않으면 수료가 아니므로, 출석(O/◎)과 결석(X·과제)만 센다.
--   빈칸(미기록)도 결석으로 치지 않는다 — 아직 기록되지 않았을 뿐이다.

-- ===================================================================
-- 기존 뷰 정리
--   create or replace view 는 컬럼을 중간에 추가하지 못한다
--   ("cannot change name of view column ..." 오류).
--   컬럼 구성이 바뀌었으므로 의존 역순으로 먼저 제거한다.
--   데이터는 테이블에 있으므로 뷰를 지워도 손실 없음.
-- ===================================================================
drop view if exists v_team_report;
drop view if exists v_completion_risk;
drop view if exists v_inactive_members;
drop view if exists v_recent_members;
drop view if exists v_makeup_detail;
drop view if exists v_homework_required;
drop view if exists v_completion_status;
drop view if exists v_attendance_summary;

-- ===================================================================
-- 상수: 수료 요건
-- ===================================================================
create or replace function completion_required_sessions()
returns int language sql immutable as $$ select 16 $$;

create or replace function makeup_limit()
returns int language sql immutable as $$ select 3 $$;

-- 결석으로 세는 값.
--
-- '과제' 는 '결석했지만 과제·소감문으로 메웠다' 는 뜻이라 결석 쪽이다.
-- present 로 옮기면 makeup_limit() 을 안 거쳐 3회 한도가 우회된다 —
-- 시트에서 ◎ 로 바꿔 적던 시절에 실제로 그랬다.
--
-- 인정 여부를 정하는 것은 이 값이 아니라 homework_submissions 다.
-- '과제' 라고 적혀 있어도 제출 기록이 없으면 그냥 결석이다.
--
-- 세 곳(v_attendance_summary · v_homework_required · v_makeup_detail)이
-- 같은 판정을 쓰므로 함수로 모은다. 손으로 세 곳을 맞추면 언젠가 하나를
-- 빠뜨리고, 그 실패는 다음 기수 이월 때가 되어서야 조용히 드러난다.
create or replace function is_absent(s text)
returns boolean language sql immutable as $$
  select upper(btrim(coalesce(s, ''))) in ('X', '과제')
$$;

-- 보충으로 인정되는 제출인가.
--
-- 과제 탭의 유형은 둘뿐이다 — '과제' · '과제+소감문'.
-- 규정은 둘 다 낸 경우만 출석으로 인정하므로 '과제만' 은 여기서 떨어진다.
--
-- 한동안 이 판정이 없어서, 유형을 안 보고 '그 주차에 제출 기록이 있으면 인정'
-- 이었다. 시트 자동화는 '과제+소감문' 만 라벨을 붙이는데 DB 는 아무거나 세니
-- 기준이 둘로 갈렸다 — 화면에는 '과제+소감문 대체' 라고 뜨는데 실제로는
-- 과제만 낸 사람이 있었다.
--
-- 시트 쪽 htaIsMakeup_(homeworkToAttendance.js) 와 같은 규칙이다.
-- position(...) > 0 은 그쪽 indexOf(...) !== -1 과 같아서, 유형에 다른 말이
-- 붙어도('과제+소감문 제출' 등) 견딘다.
--
-- ⚠️ 유형이 빈 제출은 인정되지 않는다. 수기 입력에서 유형을 안 적으면
--    그 사람이 조용히 손해를 본다 — 유형 분포를 가끔 확인할 것.
create or replace function is_makeup_type(t text)
returns boolean language sql immutable as $$
  select position('과제+소감문' in coalesce(t, '')) > 0
$$;

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
    -- 출석 인정 (현장 O / ◎ = 지난 기수 이수 또는 과제·소감문 대체)
    (raw_status in ('O', '◎'))                          as present,
    -- 결석 (X · 과제). 빈칸은 아직 기록되지 않은 것이라 unrecorded_count 로 따로 센다
    -- ('-' 는 어느 쪽도 아님 → 무시)
    is_absent(raw_status)                               as absent,
    -- '-' : 하차·중도합류·휴강 등 사유를 구분하지 않고 집계에서 제외
    (raw_status = '-')                                  as skipped,
    -- 해당 주차 과제 제출 여부
    exists (
      select 1 from homework_submissions h
      where h.member_id = att.member_id
        and h.session_label = att.session_label
        and is_makeup_type(h.type)
    )                                                    as has_homework
  from att
)
select
  member_id, cohort_id, name, phone, team, role, status,
  count(*)                                        as total_sessions,
  -- 아직 기록되지 않은 주차 (빈칸)
  count(*) filter (where raw_status = '')         as unrecorded_count,
  count(*) filter (where present)                 as present_count,
  count(*) filter (where absent)                  as absent_count,
  -- '-' 주차 (집계 제외, 참고용)
  count(*) filter (where skipped)                 as skipped_count,
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
  completion_required_sessions()                          as required,
  greatest(completion_required_sessions() - s.credited, 0) as remaining_needed,
  case
    when s.credited >= completion_required_sessions() then '수료'
    when s.makeup_overflow > 0                        then '관리자확인'
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
-- 조건을 on 절에 둔다. where 로 옮기면 left join 이 무의미해져
-- 안내 대상이 통째로 사라진다 (h 가 없는 행이 먼저 걸러진다).
-- 여기 걸리지 않은 사람 = 아직 낼 것이 남은 사람이고, 이제 '과제만 낸 사람' 도
-- 그 안에 남아야 한다.
left join homework_submissions h
       on h.member_id = m.id and h.session_label = s.label_norm
      and is_makeup_type(h.type)
where
  -- 결석한 주차만 ('-'와 빈칸은 안내 대상이 아니다). 미래 주차라도 'X'가 찍혀있으면 안내한다.
  -- '과제' 라고 적혔는데 제출 기록이 없으면 아래 h.id is null 로 걸려 안내된다.
  is_absent(a.status)
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
  c.credited, c.required, c.absent_count, c.skipped_count,
  c.makeup_used, c.makeup_available, c.makeup_overflow,
  r.sessions_left,
  -- 남은 세션을 전부 출석해도 도달 가능한 최대치
  c.credited + r.sessions_left as max_possible,
  c.verdict
from v_completion_status c
join remaining r on r.member_id = c.member_id
where c.verdict <> '수료'
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
  -- 한 주차에 과제와 소감문을 따로 내면 homework_submissions 에 두 행이 생긴다
  -- (unique 키가 member_id, session_label, type 이라서).
  -- 그대로 두면 한 주차가 보충 횟수를 두 번 잡아먹는다. 주차당 한 행으로 줄인다.
  select distinct on (m.id, s.session_date)
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
   and is_makeup_type(h.type)
  where is_absent(a.status)
  order by m.id, s.session_date, h.submitted_at nulls last
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
