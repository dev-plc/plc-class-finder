-- 2기에서 과제로 보충 인정받은 주차가 3기로 이월되지 않은 범위를 본다.
--
-- 이월 스크립트는 2기의 O(출석)·◎(지난 기수 이수) 만 옮긴다.
-- 2기에 결석(X)했지만 과제로 인정받은 주차는 옮기지 않는다.
-- 그래서 그 주차가 3기에서 빈칸이 되고, 다시 들어야 하는 것으로 보인다.
--
-- 이 쿼리는 규칙을 바꾸기 전에 '몇 명이 몇 주차나 걸리는지' 를 보여준다.
--
-- 보는 법
--   ① 합계     영향받는 인원 수와 주차 수
--   ② 사람별   누가 어느 주차인지 (2기에서 counted=true 인 것만)
--   ③ 3기 상태 그 주차가 지금 3기에서 어떤 값인지
--              빈칸이면 다시 들어야 하는 것으로 잡혀 있다

with carried as (            -- 2기·3기 양쪽에 있는 사람 (이름+전화 일치)
  select p.id  as prev_id,
         n.id  as next_id,
         n.name, n.phone, n.team
    from members p
    join members n
      on n.cohort_id = '3기'
     and n.name = p.name
     and coalesce(n.phone, '') = coalesce(p.phone, '')
   where p.cohort_id = '2기'
),
makeup as (                  -- 2기에서 과제로 인정받은 주차
  select c.next_id, c.name, c.phone, c.team, d.session_label
    from carried c
    join v_makeup_detail d on d.member_id = c.prev_id
   where d.cohort_id = '2기' and d.counted is true
),
now3 as (                    -- 그 주차가 3기에서 지금 어떤 값인가
  select m.next_id, m.name, m.phone, m.team, m.session_label,
         coalesce(nullif(btrim(a.status), ''), '(빈칸)') as status_3기
    from makeup m
    join sessions s
      on s.cohort_id = '3기' and s.label_norm = m.session_label and s.is_class is true
    left join attendance a
      on a.member_id = m.next_id and a.session_date = s.session_date
)
select '① 합계' as 구분,
       '대상 인원 / 주차 수' as 항목,
       count(distinct next_id)::text || '명 / ' || count(*)::text || '주차' as 값
  from now3

union all
select '② 사람별',
       coalesce(team, '-') || ' ' || name || coalesce(phone, ''),
       count(*)::text || '주차: ' || string_agg(session_label, ', ' order by session_label)
  from now3
 group by team, name, phone

union all
select '③ 3기 현재값', status_3기, count(*)::text || '주차'
  from now3
 group by status_3기

order by 1, 2;
