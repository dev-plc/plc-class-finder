-- 3기의 '아직 하지 않은 강의' 에 찍힌 X 를 빈칸으로 되돌린다.
--
-- ⚠️ 2026-09-03 이후로는 이 스크립트를 그대로 돌리면 안 된다. 기록으로만 남긴다.
--
--    미래 주차의 X 는 이제 뜻이 있는 값이다 — '지난 기수에서 못 들어 아직 남은
--    주차'. 지난 기수 이수자는 들은 주차에 ◎, 못 들은 주차에 X 가 미리 찍힌다.
--    그 사람은 그 주차를 기다릴 것 없이 지금 과제·소감문으로 메울 수 있어야 한다.
--
--    그래서 v_homework_required 의 `session_date <= current_date` 를 걷어냈다.
--    아래 '나중에 잘못 나간다' 는 걱정은 이제 '지금 바로 나간다' 가 됐고,
--    그게 맞는 동작이다. 이걸 돌리면 안내가 필요한 사람의 근거가 지워진다.
--    (박예원 건 — 2·3기를 이어 듣는데 안내가 안 뜨던 것이 이 필터 때문이었다.)
--
--    동기화(`--import-attendance`)도 2026-09-04 부터 미래 주차를 지우지 않는다.
--    `X`·`과제` 는 그대로 넣고 `O` 만 `◎` 로 옮긴다 — 지우던 자리는 로그 경고로
--    바뀌었다 (sync-sheet-to-db.mjs 의 futureMarkSummary).
--
--    아래 내용은 3기 초기 동기화 때 넘어온 49개를 왜 치웠는지의 기록이다.
--
-- 무엇인가
--   지난 기수 결석을 시트에 X 로 적어 두신 것이 3기 초기 동기화 때 넘어왔다.
--   확인해 보니 49개 전부가 미래 주차였다 — 3기의 진짜 결석은 아직 하나도 없다.
--
-- 왜 지우나
--   · 지금:   결석 수가 부풀려져 화면에 잘못 나온다 (결석 9 인 사람까지 나왔다)
--   · 나중에: 그 주차가 지나면 "결석했으니 과제를 내라" 안내가 잘못 나간다
--             (v_homework_required 는 지난 세션만 보므로 지금은 조용하다)
--
-- 지워도 잃는 것이 없다. 지난 기수 결석 기록은 DB 에 cohort_id 로 남아 있고,
-- 새 기수 판정에는 쓰이지 않는다.
--
-- ⚠️ 동기화로는 못 지운다.
--    평소 동기화는 출석을 아예 가져오지 않는다.
--    그렇다고 '시트 출석 가져오기' 를 켜면 안 된다 —
--    시트 출석 칸이 비어 있으므로 방금 이월한 ◎ 140개까지 전부 지워진다.
--    아래 SQL 로만 정리한다.
--
-- Supabase SQL Editor 에서 PART 씩 선택해 실행.


-- ══════════════════════════════════════════════════════════════════
-- PART 1 — 확인 (선택해서 Run)
--
--   아직 하지 않은 강의에 O 나 X 가 몇 개 있는지 본다.
--   ◎(지난 기수 이수)와 -(집계 제외)는 미래 주차에도 정당하므로 대상이 아니다.
-- ══════════════════════════════════════════════════════════════════

select s.session_date::text || ' ' || coalesce(s.label_norm, '') as 주차,
       upper(btrim(a.status)) as 값,
       count(*) as 개수
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s
    on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 where s.session_date > current_date
   and upper(btrim(coalesce(a.status, ''))) in ('O', 'X')
 group by s.session_date, s.label_norm, upper(btrim(a.status))
 order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 2 — 되돌리기 (BEGIN 부터 COMMIT 까지 선택해서 Run)
--
--   미래 주차의 O·X 만 빈칸으로 바꾼다.
--   ◎ 와 - 는 건드리지 않는다. 지난 주차도 건드리지 않는다.
-- ══════════════════════════════════════════════════════════════════

begin;

update attendance a
   set status = ''
  from members m, sessions s
 where a.member_id = m.id
   and m.cohort_id = '3기'
   and s.cohort_id = '3기'
   and s.session_date = a.session_date
   and s.is_class is true
   and s.session_date > current_date
   and upper(btrim(coalesce(a.status, ''))) in ('O', 'X');

commit;


-- ══════════════════════════════════════════════════════════════════
-- PART 3 — 결과 확인 (선택해서 Run)
--
--   ① 미래 주차 O·X   아무 행도 안 나와야 합니다
--   ② 출결 분포        ◎ 543 은 그대로, X 는 0 이어야 합니다
--   ③ 결석 있는 사람   3기는 아직 시작 전이니 아무도 없어야 합니다
-- ══════════════════════════════════════════════════════════════════

select '① 미래 주차 O·X' as 구분,
       s.session_date::text || ' ' || coalesce(s.label_norm, ''),
       upper(btrim(a.status)) || ' ' || count(*)::text || '개'
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s
    on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 where s.session_date > current_date
   and upper(btrim(coalesce(a.status, ''))) in ('O', 'X')
 group by s.session_date, s.label_norm, upper(btrim(a.status))

union all
select '② 출결 분포',
       coalesce(nullif(btrim(a.status), ''), '(빈칸)'),
       count(*)::text
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s
    on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 group by 2

union all
select '③ 결석 있는 사람',
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, ''),
       '결석 ' || c.absent_count::text
  from v_completion_status c
  join members m on m.id = c.member_id
 where c.cohort_id = '3기' and c.absent_count > 0

order by 1, 2;
