-- ⚠️ 3기에서는 돌리지 않는다 (2026-11-09 결정).
--    11/08 을 시트 강의명 행에 '나눔' 그대로 두기로 했다 (12/13 은 '나눔2').
--    그래서 지금 '나눔' 행은 찌꺼기가 아니라 11/08 의 실제 김밥·과제다.
--    지우면 11/08 김밥 39개와 나눔 소감문이 화면에서 사라진다.
--    아래는 11/08 칸을 나중에 '나눔1' 로 고칠 때를 위한 기록이다.
--
-- '나눔' → '나눔1' 로 이름이 바뀌며 남은 옛 행을 치운다. (2026-11-08)
--
-- 왜 남는가
--   3기는 나눔이 11/08 · 12/13 두 번이라 시트를 나눔1 · 나눔2 로 고쳤다.
--   김밥(kimbap_signups)과 과제(homework_submissions)는 (사람, 라벨) 이 키라서,
--   동기화가 '나눔1' 행을 새로 만들어도 옛 '나눔' 행은 그 옆에 그대로 남는다.
--   그대로 두면 개인 조회의 김밥 요약 · 과제 목록에 같은 것이 두 번 뜬다.
--
-- 언제 돌리나
--   새 코드(v127)로 동기화를 한 번 돌린 **뒤에**. 그래야 '나눔1' 행이 먼저 생긴다.
--   동기화 로그의 비강의 줄이 `11/08=나눔1, 12/13=나눔2` 인지 먼저 확인할 것.
--
-- 다음 기수에서 시트가 그냥 '나눔' 하나만 쓰면 이 라벨이 정상이다 — 그때는 돌리지 않는다.

-- 1) 먼저 확인 — 같은 사람에게 '나눔' 과 '나눔1' 이 둘 다 있는지
select 'kimbap' as 표, count(*) filter (where k.session_label = '나눔')  as 옛_나눔,
                       count(*) filter (where k.session_label = '나눔1') as 새_나눔1
  from kimbap_signups k where k.cohort_id = '3기'
union all
select 'homework', count(*) filter (where h.session_label = '나눔'),
                   count(*) filter (where h.session_label = '나눔1')
  from homework_submissions h;
-- 새_나눔1 이 0 이면 아직 동기화 전이다. 아래를 돌리지 말 것.

-- 2) 지운다
delete from kimbap_signups       where session_label = '나눔' and cohort_id = '3기';
delete from homework_submissions where session_label = '나눔';
