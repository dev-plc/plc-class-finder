-- 3기 첫 동기화 점검
--
-- 3기는 08/09 시작이라 아직 한 주도 지나지 않았다.
-- 그런데 과제 36건과 김밥 신청 273건이 들어왔다.
-- 지난 기수 잔여인지 정상인지 여기서 가려낸다.
--
-- 보는 법
--   ① 과제       세션명이 3기 커리큘럼(교리1~12·성경적대화1~4)에 없으면 지난 기수 잔여다
--   ② 김밥신청   3기 강의 라벨에 신청이 잡혀 있으면 김밥 탭에 지난 기수 값이 남은 것
--   ③ 전화번호   비어 있으면 그 사람은 앱에서 조회할 수 없다 (0건이어야 정상)
--   ④ 인원수     3기 78 / 2기 142 여야 정상 (2기가 줄었으면 사고)

select '① 과제' as 구분,
       session_label as 항목,
       count(*)::text as 건수,
       count(distinct member_id)::text as 인원
  from homework_submissions
 where cohort_id = '3기'
 group by session_label

union all
select '② 김밥신청',
       session_label,
       count(*) filter (where applied)::text,
       count(distinct member_id) filter (where applied)::text
  from kimbap_signups
 where cohort_id = '3기'
 group by session_label
having count(*) filter (where applied) > 0

union all
select '③ 전화번호없음',
       name,
       coalesce(team, '(조없음)'),
       status
  from members
 where cohort_id = '3기'
   and (phone is null or btrim(phone) = '')

union all
select '④ 인원수',
       cohort_id,
       count(*) filter (where status = 'active')::text,
       count(*)::text
  from members
 group by cohort_id

order by 1, 2
