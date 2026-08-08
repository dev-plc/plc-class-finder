-- 2기 인원이 165명(활성 126)으로 나왔다. 최초 이관 때는 142명이었다.
-- 정상 증가인지, 3기 명단이 새어 들어간 것인지 가린다.
--
-- 보는 법
--   ① 생성일별   3기 시트로 바꾼 날짜에 2기 인원이 생겼다면 샌 것이다
--   ② 수료 판정   합계가 165여야 하고, 최초 검증값(수료 41)과 견줘 본다
--   ③ 양쪽 중복   2기·3기에 같은 사람(이름+전화)이 있는 수 = 이월자 수
--   ④ 잘못된 라벨 교리13~16 은 없는 강의다 (fix_homework_labels.sql 로 정리)

select '① 2기 생성일별' as 구분,
       to_char(created_at, 'YYYY-MM-DD') as 항목,
       count(*)::text as 값
  from members
 where cohort_id = '2기'
 group by 1, 2

union all
select '② 2기 수료판정',
       coalesce(verdict, '(없음)'),
       count(*)::text
  from v_completion_status
 where cohort_id = '2기'
 group by 1, 2

union all
select '③ 2기·3기 양쪽',
       '같은 사람(이름+전화)',
       count(*)::text
  from members a
 where a.cohort_id = '2기'
   and exists (
     select 1 from members b
      where b.cohort_id = '3기'
        and b.name = a.name
        and coalesce(b.phone, '') = coalesce(a.phone, '')
   )

union all
select '④ 없는 강의 라벨',
       cohort_id || ' ' || session_label,
       count(*)::text
  from homework_submissions
 where session_label ~ '^교리\d+$'
   and substring(session_label from 3)::int > 12
 group by 1, 2

order by 1, 2
