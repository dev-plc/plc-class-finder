-- v_makeup_detail 의 주차 중복을 없앤다.
--
-- 한 주차에 '과제' 와 '과제+소감문' 을 따로 내면
-- homework_submissions 에 두 행이 생긴다 (unique 키가 member_id, session_label, type).
-- 그러면 v_makeup_detail 에서 그 주차가 두 번 나오고,
-- seq <= makeup_limit() 판정에서 보충 3회 중 2회를 한 주차가 먹어버린다.
--
-- 진단 쿼리에서 '교리10=X, 교리10=X' 처럼 같은 라벨이 두 번 찍혀 드러났다.
--
-- 수료 판정(v_completion_status)은 v_attendance_summary 를 쓰고
-- 그쪽은 주차 단위로 세므로 영향이 없다. 이 뷰의 표시와,
-- 이월 스크립트가 이 뷰를 읽는 부분만 바로잡힌다.
--
-- Supabase SQL Editor 에서 실행. 컬럼 구성은 그대로라 replace 로 충분하다.

create or replace view v_makeup_detail as
with base as (
  -- 주차당 한 행으로 줄인다. 제출이 여러 건이면 가장 이른 것을 남긴다.
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
  where upper(trim(coalesce(a.status, ''))) = 'X'
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

-- 확인: 같은 (인원, 주차) 가 두 번 나오면 안 된다. 아무 행도 안 나와야 정상.
select cohort_id, name, phone, session_label, count(*) as 행수
  from v_makeup_detail
 group by cohort_id, name, phone, session_label
having count(*) > 1
 order by 1, 2;
