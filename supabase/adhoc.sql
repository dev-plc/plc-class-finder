-- 3기 명단이 2기로 샌 흔적을 확인한다.
--
-- 정황
--   3기 활성 78명이 전원 2기에도 있다 (③ 결과).
--   2기 인원이 142 → 165 로 늘었고, 08-06 에 18명 · 08-07 에 1명이 생겼다.
--   기수 표식 가드가 머지되기 전에 동기화가 3기 시트를 2기로 밀어넣었을 가능성.
--
--   (08-01 의 143명은 착시다. members.created_at 컬럼을 schema_v2 로 추가한 날이라
--    그 전에 있던 행 전부가 같은 시각을 갖는다. 실제 생성일이 아니다.)
--
-- 보는 법
--   ① 2기 세션    08/09 이후 날짜가 있으면 3기 일정이 2기로 샌 것이다
--   ② 늦게 생긴 2기 인원  출석 기록이 0건이면 2기를 들은 적 없는 사람 = 샌 것
--   ③ 2기 세션 수  원래 2기 강의는 16개였다. 그보다 많으면 샌 것
--   ④ 라벨 중복    같은 label_norm 이 2기에 두 번 있으면 3기 일정이 겹쳐 들어온 것

select '① 2기 세션' as 구분,
       session_date::text || ' · ' || coalesce(label_norm, '(없음)') as 항목,
       case when is_class then '강의' else '비강의' end as 값
  from sessions
 where cohort_id = '2기'

union all
select '② 늦게 생긴 2기 인원',
       m.name || coalesce(m.phone, '') || ' · ' || m.created_at::date::text,
       count(a.*) filter (where nullif(btrim(a.status), '') is not null)::text || '건 기록'
  from members m
  left join attendance a on a.member_id = m.id
 where m.cohort_id = '2기'
   and m.created_at >= date '2026-08-02'
 group by m.name, m.phone, m.created_at

union all
select '③ 2기 세션 수',
       case when is_class then '강의' else '비강의' end,
       count(*)::text
  from sessions
 where cohort_id = '2기'
 group by is_class

union all
select '④ 2기 라벨 중복',
       label_norm,
       count(*)::text || '번'
  from sessions
 where cohort_id = '2기' and label_norm is not null
 group by label_norm
having count(*) > 1

order by 1, 2
