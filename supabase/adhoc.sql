-- [이름] 의 ◎ 가 X 로 바뀐 경로를 찾는다.
--
-- 내려받기(GAS)는 DB 값을 시트로 옮기기만 한다. ◎ → X 로 바꾸는 경로가 없다.
-- 그러므로 DB 가 이미 X 를 갖고 있다. 언제 그렇게 됐는지가 관건이다.
--
-- 후보는 셋이고, updated_at 이 셋을 갈라 준다.
--   · 이월 스크립트가 애초에 ◎ 를 못 넣었다   → updated_at 이 이월 시각
--   · 시트 동기화가 덮었다 (--import-attendance) → updated_at 이 동기화 시각
--   · 앱에서 튜터가 출석을 찍었다               → updated_at 이 오늘, 그것도 제각각
--
-- Supabase SQL Editor 에서 PART 씩 선택해 실행.


-- ══════════════════════════════════════════════════════════════════
-- PART 1 — [이름] 의 전 주차 기록과 기록 시각
--
--   ◎ 인 주차와 X 인 주차의 updated_at 이 다르면,
--   나중에 무언가가 이 사람의 특정 주차만 건드린 것이다.
-- ══════════════════════════════════════════════════════════════════

select s.session_date::text || ' ' || coalesce(s.label_norm, '') as 주차,
       s.is_class as 수료반영,
       coalesce(nullif(btrim(a.status), ''), '(빈칸)') as 값,
       a.updated_at
  from members m
  join sessions s on s.cohort_id = m.cohort_id
  left join attendance a
    on a.member_id = m.id and a.session_date = s.session_date
 where m.cohort_id = '3기'
   and m.name || coalesce(m.phone, '') = '[이름]'
 order by s.session_date;


-- ══════════════════════════════════════════════════════════════════
-- PART 2 — 3기 전체에 X 가 몇 개나 있고, 언제 찍혔나
--
--   ① 값별 개수와 기록 시각 범위
--   ② X 가 찍힌 시각을 분 단위로 묶어서 — 한 번에 우르르 들어왔는지 본다
--      (한 시각에 몰려 있으면 스크립트·동기화, 흩어져 있으면 앱에서 사람이 찍은 것)
-- ══════════════════════════════════════════════════════════════════

select '① 값별' as 구분,
       coalesce(nullif(btrim(a.status), ''), '(빈칸)') as 값,
       count(*)::text as 개수,
       min(a.updated_at)::text as 가장_이른,
       max(a.updated_at)::text as 가장_늦은
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
 group by 2

union all

select '② X 가 찍힌 시각',
       date_trunc('minute', a.updated_at)::text,
       count(*)::text,
       '', ''
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
 where upper(btrim(coalesce(a.status, ''))) = 'X'
 group by 2

 order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 3 — X 를 갖고 있는 사람이 지난 기수에 그 주차를 이수했나
--
--   여기 행이 나오면 "지난 기수에 이수했는데 이번 기수에 결석 처리된" 사람이다.
--   [이름] 만의 일인지, 여러 명인지가 여기서 갈린다.
-- ══════════════════════════════════════════════════════════════════

with x3 as (
  select m.id as member_id,
         m.name || coalesce(m.phone, '') as 대상,
         m.team,
         s.label_norm,
         s.session_date,
         a.updated_at
    from attendance a
    join members m on m.id = a.member_id and m.cohort_id = '3기'
    join sessions s
      on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
   where upper(btrim(coalesce(a.status, ''))) = 'X'
),
done2 as (
  -- 2기에 출석(O·◎)했거나 과제로 인정받은 주차
  select m.name || coalesce(m.phone, '') as 대상, s.label_norm
    from attendance a
    join members m on m.id = a.member_id and m.cohort_id = '2기'
    join sessions s
      on s.cohort_id = '2기' and s.session_date = a.session_date and s.is_class is true
   where btrim(coalesce(a.status, '')) in ('O', 'o', '◎')
  union
  select m.name || coalesce(m.phone, ''), v.session_label
    from v_makeup_detail v
    join members m on m.id = v.member_id
   where v.cohort_id = '2기' and v.counted is true
)
select x3.team as 조,
       x3.대상,
       x3.session_date::text || ' ' || coalesce(x3.label_norm, '') as 주차,
       x3.updated_at,
       case when done2.대상 is null then '2기에도 안 함' else '⚠️ 2기에 이수함 (◎ 여야 함)' end as 판정
  from x3
  left join done2
    on done2.대상 = x3.대상 and done2.label_norm = x3.label_norm
 order by 판정 desc, x3.team, x3.대상, x3.session_date;
