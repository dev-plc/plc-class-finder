-- 이월 미리보기에서 걸리는 두 가지를 확인한다.
--
-- (1) 8명에게 15~16개 주차를 찍으려 한다. 16개면 3기 첫 강의도 하기 전에
--     '수료' 로 잡힌다. 2기를 다 이수한 사람이 3기에 왜 있는지(튜터인지)
--     역할을 봐야 판단할 수 있다.
--
-- (2) 2기 과제 보충이 30건인데 새로 찍힌 것은 0개다.
--     그 주차가 3기에서 이미 'X' 로 채워져 있으면 이월이 건드리지 않는다.
--     그러면 "2기에서 과제로 인정받았으니 3기에서도 이수" 규칙이 실제로는
--     적용되지 않는다.
--
-- 보는 법
--   ① 2기 수료자인데 3기에 있는 사람 — role 이 튜터/서브튜터면 정상
--   ② 2기 과제 보충 주차가 3기에서 지금 무슨 값인가
--        (빈칸) 이면 이월이 채운다 · X 면 막혀서 안 채워진다
--   ③ ② 를 사람별로

with pair as (                  -- 2기·3기 양쪽에 있는 사람
  select p.id as prev_id, n.id as next_id,
         n.name, n.phone, n.team, coalesce(n.role, '') as role
    from members p
    join members n
      on n.cohort_id = '3기'
     and n.name = p.name
     and coalesce(n.phone, '') = coalesce(p.phone, '')
   where p.cohort_id = '2기'
),
makeup3 as (                    -- 2기 과제 보충 주차가 3기에서 지금 어떤 값인가
  select pr.next_id, pr.name, pr.phone, pr.team,
         d.session_label,
         coalesce(nullif(btrim(a.status), ''), '(빈칸)') as now3
    from pair pr
    join v_makeup_detail d
      on d.member_id = pr.prev_id and d.cohort_id = '2기' and d.counted is true
    join sessions s
      on s.cohort_id = '3기' and s.label_norm = d.session_label and s.is_class is true
    left join attendance a
      on a.member_id = pr.next_id and a.session_date = s.session_date
)
select '① 2기 수료자가 3기에' as 구분,
       coalesce(pr.team, '-') || ' ' || pr.name || coalesce(pr.phone, '') as 대상,
       '이수 ' || c.credited::text || ' · 역할 ' ||
       case when pr.role = '' then '(없음)' else pr.role end as 값
  from pair pr
  join v_completion_status c on c.member_id = pr.prev_id
 where c.verdict = '수료'

union all
select '② 보충 주차의 3기 값', now3, count(*)::text || '주차'
  from makeup3
 group by now3

union all
select '③ 보충 주차 사람별',
       coalesce(team, '-') || ' ' || name || coalesce(phone, ''),
       string_agg(session_label || '=' || now3, ', ' order by session_label)
  from makeup3
 group by team, name, phone

order by 1, 2;
