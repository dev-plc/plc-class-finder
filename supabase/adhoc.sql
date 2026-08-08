-- 이월(--apply) 뒤 확인.
--
-- 보는 법
--   ① 3기 판정      튜터 5명이 '수료' 로 잡히는 건 정상 (2기 수료자가 섬기러 옴)
--   ② 출결 분포      ◎ 가 늘었는지. X 는 보충분만큼 줄었어야 한다
--   ③ 보충 주차 상태  전부 ◎ 여야 한다. X 가 남아 있으면 이월이 덜 된 것
--   ④ 카드 대조용    사람별 이수/결석 — 앱 화면 숫자와 맞는지 볼 때 쓴다

with pair as (
  select p.id as prev_id, n.id as next_id, n.name, n.phone, n.team
    from members p
    join members n
      on n.cohort_id = '3기'
     and n.name = p.name
     and coalesce(n.phone, '') = coalesce(p.phone, '')
   where p.cohort_id = '2기'
),
makeup3 as (
  select pr.name, pr.phone, pr.team, d.session_label,
         coalesce(nullif(btrim(a.status), ''), '(빈칸)') as now3
    from pair pr
    join v_makeup_detail d
      on d.member_id = pr.prev_id and d.cohort_id = '2기' and d.counted is true
    join sessions s
      on s.cohort_id = '3기' and s.label_norm = d.session_label and s.is_class is true
    left join attendance a
      on a.member_id = pr.next_id and a.session_date = s.session_date
)
select '① 3기 판정' as 구분, coalesce(verdict, '(없음)') as 항목, count(*)::text as 값
  from v_completion_status where cohort_id = '3기' group by verdict

union all
select '② 3기 출결 분포',
       coalesce(nullif(btrim(a.status), ''), '(빈칸)'),
       count(*)::text
  from attendance a
  join members m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s on s.cohort_id = '3기' and s.session_date = a.session_date and s.is_class is true
 group by 2

union all
select '③ 보충 주차 상태', now3, count(*)::text || '주차'
  from makeup3 group by now3

union all
select '④ 이수 상위',
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, ''),
       '이수 ' || c.credited::text || ' · 결석 ' || c.absent_count::text ||
       ' · ' || coalesce(c.verdict, '')
  from v_completion_status c
  join members m on m.id = c.member_id
 where c.cohort_id = '3기' and c.credited > 0

order by 1, 2;
