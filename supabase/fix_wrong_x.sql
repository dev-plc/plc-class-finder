-- 08/09 교리1 에 잘못 찍힌 X 를 ◎ 로 되돌린다.
--
-- 무엇이 있었나
--   시트에 손으로 적은 ◎ 는 DB 로 오지 않는다 (평소 동기화는 출석을 안 가져온다).
--   그래서 앱에는 그 사람이 미기록으로 보였고, 튜터가 '빈칸 → 결석' 을 누르자
--   안 나와도 되는 사람까지 X 가 됐다. 새A 6명 · 새I 2명, 모두 교리1.
--
-- 무엇을 되돌리나
--   8명 전부가 아니다. 그냥 안 온 신규 참여자라면 X 가 맞다.
--   되돌릴 대상은 '2기에 교리1 을 이수한 사람' 뿐이다.
--   PART 1 로 갈라 보고, PART 2 로 그 사람들만 바꾼다.
--
-- Supabase SQL Editor 에서 PART 씩 선택해 실행.


-- ══════════════════════════════════════════════════════════════════
-- PART 1 — 8명을 두 갈래로 나눈다 (선택해서 Run)
--
--   '◎ 여야 함'  → 2기에 교리1 을 이수했다. X 는 잘못이다.
--   'X 가 맞음'   → 2기 기록이 없다. 그냥 결석이다. 건드리지 않는다.
--
--   2기 이수의 뜻: 그 주차에 출석(O)했거나, ◎ 였거나, 과제로 인정받았다.
-- ══════════════════════════════════════════════════════════════════

with x3 as (
  select m.id                                as member_id,
         m.team,
         m.name || coalesce(m.phone, '')     as 대상,
         a.session_date,
         s.label_norm
    from attendance a
    join members  m on m.id = a.member_id and m.cohort_id = '3기'
    join sessions s on s.cohort_id = '3기'
                   and s.session_date = a.session_date
                   and s.is_class is true
   where upper(btrim(coalesce(a.status, ''))) = 'X'
),
done2 as (
  -- 2기에 출석했거나 ◎ 였던 주차
  select m.name || coalesce(m.phone, '') as 대상, s.label_norm, '출석' as 근거
    from attendance a
    join members  m on m.id = a.member_id and m.cohort_id = '2기'
    join sessions s on s.cohort_id = '2기'
                   and s.session_date = a.session_date
                   and s.is_class is true
   where btrim(coalesce(a.status, '')) in ('O', 'o', '◎')
  union
  -- 2기에 과제로 인정받은 주차
  select m.name || coalesce(m.phone, ''), v.session_label, '과제 인정'
    from v_makeup_detail v
    join members m on m.id = v.member_id
   where v.cohort_id = '2기' and v.counted is true
)
select case when d.대상 is null then 'X 가 맞음 (2기 기록 없음)'
            else '◎ 여야 함 (2기 ' || d.근거 || ')' end as 판정,
       x3.team as 조,
       x3.대상,
       x3.session_date::text || ' ' || coalesce(x3.label_norm, '') as 주차
  from x3
  left join done2 d
    on d.대상 = x3.대상 and d.label_norm = x3.label_norm
 order by 판정, x3.team, x3.대상;


-- ══════════════════════════════════════════════════════════════════
-- PART 2 — 되돌리기 (BEGIN 부터 COMMIT 까지 선택해서 Run)
--
--   PART 1 에서 '◎ 여야 함' 으로 나온 사람만 바꾼다.
--   조건이 PART 1 과 똑같으므로, 본 것과 바뀌는 것이 어긋나지 않는다.
--
--   ⚠️ PART 1 결과를 먼저 눈으로 확인한 뒤에 실행하세요.
-- ══════════════════════════════════════════════════════════════════

begin;

with done2 as (
  select m.name || coalesce(m.phone, '') as 대상, s.label_norm
    from attendance a
    join members  m on m.id = a.member_id and m.cohort_id = '2기'
    join sessions s on s.cohort_id = '2기'
                   and s.session_date = a.session_date
                   and s.is_class is true
   where btrim(coalesce(a.status, '')) in ('O', 'o', '◎')
  union
  select m.name || coalesce(m.phone, ''), v.session_label
    from v_makeup_detail v
    join members m on m.id = v.member_id
   where v.cohort_id = '2기' and v.counted is true
)
update attendance a
   set status = '◎', updated_at = now()
  from members m, sessions s
 where a.member_id = m.id
   and m.cohort_id = '3기'
   and s.cohort_id = '3기'
   and s.session_date = a.session_date
   and s.is_class is true
   and upper(btrim(coalesce(a.status, ''))) = 'X'
   and exists (
     select 1 from done2 d
      where d.대상 = m.name || coalesce(m.phone, '')
        and d.label_norm = s.label_norm
   );

commit;


-- ══════════════════════════════════════════════════════════════════
-- PART 3 — 결과 확인 (선택해서 Run)
--
--   ① 남은 X        되돌리지 않기로 한 사람만 남아야 합니다
--   ② 과제 안내 대상 되돌린 사람은 여기서 사라져야 합니다
--   ③ 출결 분포      ◎ 가 되돌린 수만큼 늘어야 합니다
-- ══════════════════════════════════════════════════════════════════

select '① 남은 X' as 구분,
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, '') as 대상,
       s.session_date::text || ' ' || coalesce(s.label_norm, '') as 내용
  from attendance a
  join members  m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s on s.cohort_id = '3기'
                 and s.session_date = a.session_date
                 and s.is_class is true
 where upper(btrim(coalesce(a.status, ''))) = 'X'

union all

select '② 과제 안내 대상',
       coalesce(m.team, '-') || ' ' || m.name || coalesce(m.phone, ''),
       h.session_label
  from v_homework_required h
  join members m on m.id = h.member_id
 where h.cohort_id = '3기'

union all

select '③ 출결 분포',
       coalesce(nullif(btrim(a.status), ''), '(빈칸)'),
       count(*)::text
  from attendance a
  join members  m on m.id = a.member_id and m.cohort_id = '3기'
  join sessions s on s.cohort_id = '3기'
                 and s.session_date = a.session_date
                 and s.is_class is true
 group by 2

 order by 1, 2, 3;
