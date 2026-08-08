-- 13~16강 과제가 '교리13'~'교리16' 으로 저장돼 있는 것을 바로잡는다.
--
-- 원인
--   과제 폼은 '13강 …' 처럼 1~16 통합 번호를 쓴다.
--   그런데 세션명 정규화가 '(\d+)강' 을 전부 '교리N' 으로 붙였다.
--   실제 커리큘럼에 교리13~16 은 없다. 13강부터는 성경적대화1~4 다.
--
-- 영향
--   성경적대화 주차에 결석하고 과제를 낸 사람이 '미제출' 로 잡혔다.
--   → 보충(최대 3회) 인정을 못 받아 수료 판정이 실제보다 박했다.
--   2기·3기 모두 해당한다.
--
-- 동기화 코드(scripts/sync-sheet-to-db.mjs)는 고쳤다.
-- 이 스크립트는 이미 들어간 행을 옮긴다. Supabase SQL Editor 에서 실행.
-- 재실행해도 안전하다 (두 번째부터는 대상이 0건).

-- ===================================================================
-- 1. 실행 전 확인 — 몇 건이 대상인가
-- ===================================================================
select cohort_id, session_label, count(*) as 건수
  from homework_submissions
 where session_label ~ '^교리\d+$'
   and substring(session_label from 3)::int > 12
 group by 1, 2
 order by 1, 2;

-- ===================================================================
-- 2. 올바른 라벨이 이미 있으면 중복이 되므로 그 쪽을 먼저 지운다
--    (unique (member_id, session_label, type) 충돌 방지)
-- ===================================================================
delete from homework_submissions h
 where h.session_label ~ '^교리1[3-6]$'
   and exists (
     select 1
       from homework_submissions x
      where x.member_id = h.member_id
        and x.type is not distinct from h.type
        and x.session_label = '성경적대화' || (substring(h.session_label from 3)::int - 12)
   );

-- ===================================================================
-- 3. 나머지를 성경적대화로 옮긴다
-- ===================================================================
update homework_submissions
   set session_label = '성경적대화' || (substring(session_label from 3)::int - 12)
 where session_label ~ '^교리1[3-6]$';

-- ===================================================================
-- 4. 결과 확인 — 교리13~16 이 0건, 성경적대화1~4 가 늘었는지
-- ===================================================================
select cohort_id, session_label, count(*) as 건수
  from homework_submissions
 where session_label like '성경적대화%'
    or (session_label ~ '^교리\d+$' and substring(session_label from 3)::int > 12)
 group by 1, 2
 order by 1, 2;

-- ===================================================================
-- 5. 2기 수료 판정이 바뀌었는지
--    이 스크립트 실행 전 41명 수료였다. 늘었다면 그동안 보충을 못 받던 분들이다.
-- ===================================================================
select verdict, count(*) as 인원
  from v_completion_status
 where cohort_id = '2기'
 group by 1
 order by 1;
