-- 과제 탭의 '김동완1789' 이 명단과 안 맞는 이유를 찾는다.
--
-- 단서: 폼 응답의 연락처는 010-9080-7730 인데 아이디는 김동완1789 다.
--       뒷 4자리가 7730 과 1789 로 다르다.
--
-- 짝짓기는 '이름 + 전화 뒷4자리' 가 글자 하나까지 같아야 맺어진다.
-- 출석부에 김동완7730 으로 들어 있으면 과제의 김동완1789 는 짝을 못 찾는다.
--
-- 보는 법
--   ① 명단의 김동완 이 실제로 어떤 아이디인지
--   ② 과제 탭에서 온 김동완 기록이 DB 에 있는지 (없으면 무시된 것)

select '① 명단' as 구분,
       cohort_id || ' · ' || name || coalesce(phone, '') as 아이디,
       coalesce(team, '-') || ' · ' || status as 비고
  from members
 where name like '%김동완%'

union all
select '② 저장된 과제',
       m.cohort_id || ' · ' || m.name || coalesce(m.phone, ''),
       h.session_label || ' · ' || coalesce(h.type, '')
  from homework_submissions h
  join members m on m.id = h.member_id
 where m.name like '%김동완%'

order by 1, 2;
