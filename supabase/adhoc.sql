-- 3기에 결석(X)이 49개나 있다. 첫 강의가 08/09 인데 결석 9 인 사람도 있다.
-- 아직 하지도 않은 강의에 X 가 찍혀 있는 것으로 보인다.
--
-- 그대로 두면 두 가지가 틀어진다
--   · absent_count 가 부풀려진다
--   · v_homework_required 가 "결석했으니 과제를 내라" 고 안내한다
--     — 아직 열리지도 않은 강의의 과제를
--
-- 아마 시트에서 이월자에게 '2기에 안 들었음' 표시로 X 를 쓰셨고,
-- 그게 초기 동기화 때 들어온 것 같다.
-- 아직 안 한 강의는 X 가 아니라 빈칸이어야 한다.
--
-- 보는 법
--   ① 주차별 X   session_date 가 오늘보다 뒤면 아직 안 한 강의다
--   ② 사람별     누가 몇 개인지
--   ③ 과제 안내  지금 "제출 필요" 로 잡혀 있는 건수 (미래 주차면 잘못된 안내)

select '① 주차별 X' as 구분,
       s.session_date::text || ' ' || coalesce(s.label_norm, '') ||
       case when s.session_date > current_date then '  ← 아직 안 한 강의' else '' end as 항목,
       count(*)::text || '개' as 값
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 where upper(btrim(coalesce(a.status, ''))) = 'X'
 group by s.session_date, s.label_norm

union all
select '② 사람별 X',
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, ''),
       count(*)::text || '개 · ' || string_agg(coalesce(s.label_norm, ''), ', ' order by s.session_date)
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 where upper(btrim(coalesce(a.status, ''))) = 'X'
 group by m.team, m.name, m.phone

union all
select '③ 과제 안내 중',
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, ''),
       count(*)::text || '건 · ' || string_agg(h.session_label, ', ' order by h.session_date)
  from v_homework_required h
  join members m on m.id = h.member_id
 where h.cohort_id = '3기'
 group by m.team, m.name, m.phone

order by 1, 2;
