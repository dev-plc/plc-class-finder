-- 3기 시트가 2기로 동기화되며 생긴 오염을 되돌린다.
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ 실행 방법                                                     │
-- │                                                              │
-- │ 아래에 PART 1~4 가 있습니다. 한 번에 다 돌리지 마세요.          │
-- │ Supabase SQL Editor 는 여러 문장을 돌리면 마지막 결과만 보여줘서 │
-- │ 확인용 쿼리가 묻힙니다.                                        │
-- │                                                              │
-- │ 한 PART 씩:                                                   │
-- │   그 PART 의 텍스트를 드래그해서 선택 → Run                     │
-- │   (선택된 부분만 실행됩니다)                                    │
-- │                                                              │
-- │ 순서: PART 1 (확인) → PART 2 (정리) → PART 3 (결과) → PART 4   │
-- └──────────────────────────────────────────────────────────────┘
--
-- 무슨 일이 있었나
--   기수 표식 가드가 생기기 전, 3기로 고쳐 가던 시트가 2기로 동기화됐다.
--   시트를 편집하는 중에 여러 번 돌아서 세 가지가 망가졌다.
--
--   (1) 없던 세션이 생겼다 — 2기는 07/12 에 끝났는데 08/09~09/27 이 붙어 26강이 됐다
--   (2) 세션 라벨이 되감겼다 — 05/31~07/12 이 교리1~교리6 으로 덮여 교리1~10 이 두 번씩 있다
--   (3) 3기 인원 18명이 2기에 생겼다 — 전부 2기 출석 기록이 0건이다
--
--   이 상태에서 나온 '2기 수료 85명' 은 믿을 수 없다.


-- ══════════════════════════════════════════════════════════════════
-- PART 1 — 확인 (여기부터 아래 세미콜론까지 선택해서 Run)
--
--   무엇이 지워지는지 눈으로 봅니다. 아무것도 바꾸지 않습니다.
--   세션 10개 + 인원 18명쯤 나오면 예상대로입니다.
-- ══════════════════════════════════════════════════════════════════

select '지울 세션' as 구분, session_date::text as 대상, coalesce(label_norm, '') as 비고
  from sessions
 where cohort_id = '2기' and session_date >= date '2026-08-01'
union all
select '지울 인원', m.name || coalesce(m.phone, ''), m.created_at::date::text
  from members m
 where m.cohort_id = '2기'
   and m.created_at >= date '2026-08-06'
   and not exists (
     select 1 from attendance a
      where a.member_id = m.id and nullif(btrim(a.status), '') is not null
   )
 order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 2 — 정리 (BEGIN 부터 COMMIT 까지 선택해서 Run)
--
--   네 가지를 한 트랜잭션으로 묶었습니다.
--   중간에 하나라도 실패하면 전부 되돌아가므로 반쯤 망가질 일이 없습니다.
--   성공하면 "Success. No rows returned" 가 뜹니다.
-- ══════════════════════════════════════════════════════════════════

begin;

-- (1) 2기에 잘못 붙은 세션의 출결부터 지운다.
--     attendance 에는 기수 구분이 없고 member_id 로만 갈린다.
--     같은 날짜를 3기 인원도 쓰므로 2기 인원 것만 골라야 한다.
delete from attendance a
 where a.session_date >= date '2026-08-01'
   and a.member_id in (select id from members where cohort_id = '2기');

-- (2) 2기의 08월 이후 세션을 지운다 (2기는 07/12 에 끝났다)
delete from sessions
 where cohort_id = '2기' and session_date >= date '2026-08-01';

-- (3) 2기 강의 라벨을 날짜 순서대로 다시 매긴다.
--     교리1~12 → 성경적대화1~4. 교제·나눔(비강의)은 건드리지 않는다.
with ordered as (
  select session_date,
         row_number() over (order by session_date) as n
    from sessions
   where cohort_id = '2기' and is_class is true
)
update sessions s
   set label_norm = case when o.n <= 12
                         then '교리' || o.n
                         else '성경적대화' || (o.n - 12) end
  from ordered o
 where s.cohort_id = '2기'
   and s.session_date = o.session_date;

-- (4) 2기 출석 기록이 하나도 없는데 8/6 이후 생긴 인원을 지운다.
--     3기 시트에서 새어 들어온 사람들이다. 3기 쪽 기록은 그대로 남는다.
--     (과제·김밥은 cascade 로 함께 정리된다)
delete from members m
 where m.cohort_id = '2기'
   and m.created_at >= date '2026-08-06'
   and not exists (
     select 1 from attendance a
      where a.member_id = m.id and nullif(btrim(a.status), '') is not null
   );

commit;


-- ══════════════════════════════════════════════════════════════════
-- PART 3 — 결과 확인 (여기부터 아래 세미콜론까지 선택해서 Run)
--
--   ① 강의 16 · 비강의 2 여야 합니다
--   ② 아무 행도 안 나와야 합니다 (라벨 중복 없음)
--   ③ 03/15 교리1 … 07/12 성경적대화4 로 이어져야 합니다
--   ④ 인원
--   ⑤ ← 이게 2기의 진짜 수료 현황입니다
-- ══════════════════════════════════════════════════════════════════

select '① 세션 수' as 구분,
       case when is_class then '강의' else '비강의' end as 항목,
       count(*)::text as 값
  from sessions where cohort_id = '2기'
 group by is_class

union all
select '② 라벨 중복', label_norm, count(*)::text || '번'
  from sessions
 where cohort_id = '2기' and label_norm is not null
 group by label_norm having count(*) > 1

union all
select '③ 세션 목록', session_date::text, coalesce(label_norm, '(없음)')
  from sessions where cohort_id = '2기'

union all
select '④ 인원', case when status = 'active' then '활성' else '비활성' end, count(*)::text
  from members where cohort_id = '2기' group by status

union all
select '⑤ 수료 판정', coalesce(verdict, '(없음)'), count(*)::text
  from v_completion_status where cohort_id = '2기' group by verdict

order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 4 — 강선형 (여기부터 아래 세미콜론까지 선택해서 Run)
--
--   전화번호가 비어 있어 unique (cohort_id, name, phone) 이 걸리지 않았다.
--   null 은 서로 다른 값으로 취급돼 동기화할 때마다 새 행이 생겼고 지금 5행이다.
--   (동기화 코드는 고쳤다 — 이제 null 대신 빈 문자열로 저장한다)
--
--   어느 행이 진짜인지는 사람이 판단해야 하므로 보여주기만 합니다.
--   출결기록·출석이 가장 많은 행 하나만 남기고 나머지를 지우면 됩니다.
--   지울 때: delete from members where id in ('...', '...');
-- ══════════════════════════════════════════════════════════════════

select m.id,
       m.name,
       m.team,
       m.status,
       m.created_at::date as 생성일,
       count(a.*) filter (where nullif(btrim(a.status), '') is not null) as 출결기록,
       count(a.*) filter (where upper(btrim(a.status)) in ('O', '◎')) as 출석
  from members m
  left join attendance a on a.member_id = m.id
 where m.cohort_id = '2기' and m.name = '강선형'
 group by m.id, m.name, m.team, m.status, m.created_at
 order by 출결기록 desc, 생성일;


-- ══════════════════════════════════════════════════════════════════
-- PART 5 — 강선형 중복 정리 + 빈 전화번호 통일
--
--   PART 4 에서 7행이 나왔고 전부 출석 0 이었다.
--   출결기록 5건짜리 중 가장 오래된 행 하나만 남기고 나머지 6개를 지운다.
--   어느 행을 남겨도 판정은 같다 (출석 0 → 미수료).
--
--   그리고 남은 null 전화번호를 빈 문자열로 바꾼다.
--   unique (cohort_id, name, phone) 은 null 에 걸리지 않아
--   동기화할 때마다 새 행이 생겼다. 빈 문자열이면 걸린다.
--   (동기화 코드도 이제 빈 문자열로 넣는다)
--
--   BEGIN 부터 COMMIT 까지 선택해서 Run.
-- ══════════════════════════════════════════════════════════════════

begin;

delete from members
 where id in (
   'e0142c37-c997-4a60-96d1-ad377afb78fb',  -- 08-02
   '3e18afac-9e6e-449e-841e-285ea182ba30',  -- 08-04
   'f579bdd5-a638-44c0-a3c5-b5b44fa28842',  -- 08-05
   '2214edbe-700b-43d6-8869-c06daf0c05b0',  -- 08-06
   '7263d5f2-5b0d-4a6f-a091-8c87c6f647a9',  -- 08-07
   'ab289e1c-763f-46e9-ac79-b39bf4dadf95'   -- 08-01, 기록 0건
 );
-- 남기는 행: 784cf7a0-bf6e-4f8c-8535-cef0dccffbc5 (08-01, 기록 5건)

update members set phone = '' where phone is null;

commit;


-- ══════════════════════════════════════════════════════════════════
-- PART 6 — 최종 확인 (선택해서 Run)
--
--   ① 전화번호 없음 → 아무 행도 안 나와야 합니다
--   ② 이름 중복 → 아무 행도 안 나와야 합니다
--   ③ 2기 인원 · ④ 2기 수료 판정 (강선형 6행이 빠진 최종값)
-- ══════════════════════════════════════════════════════════════════

select '① 전화번호 없음' as 구분, cohort_id || ' ' || name as 항목, ''::text as 값
  from members where phone is null

union all
select '② 같은 기수 이름 중복', cohort_id || ' ' || name, count(*)::text || '행'
  from members group by cohort_id, name having count(*) > 1

union all
select '③ 인원', cohort_id || ' ' || case when status = 'active' then '활성' else '비활성' end,
       count(*)::text
  from members group by cohort_id, status

union all
select '④ 2기 수료 판정', coalesce(verdict, '(없음)'), count(*)::text
  from v_completion_status where cohort_id = '2기' group by verdict

order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 7 — 이름 중복 5건 확인 (선택해서 Run)
--
--   PART 6 ② 에 5건이 나왔다. 둘 중 하나다.
--
--   (가) 진짜 동명이인 — 전화번호가 다르다. 정상이니 그대로 둔다.
--   (나) 같은 사람이 두 번 — 한쪽 전화번호가 비어 있다.
--        시트 ID 에 전화번호가 없던 시절에 들어간 행이 남은 것이다.
--        출결·과제가 없는 쪽을 지우면 된다.
--
--   전화번호 칸이 비어 있는 행이 있으면 (나) 다.
-- ══════════════════════════════════════════════════════════════════

-- ⚠️ attendance 와 homework 를 한꺼번에 left join 하면 곱집합이 된다.
--    (출결 18건 × 과제 17건 = 306 처럼 부풀려진다)
--    각각 서브쿼리로 세야 한다.
select m.cohort_id as 기수,
       m.name as 이름,
       case when btrim(coalesce(m.phone, '')) = '' then '(비어있음)' else m.phone end as 전화,
       coalesce(m.team, '-') as 조,
       m.status as 상태,
       m.created_at::date as 생성일,
       (select count(*) from attendance a
         where a.member_id = m.id
           and nullif(btrim(a.status), '') is not null) as 출결기록,
       (select count(*) from homework_submissions h
         where h.member_id = m.id) as 과제,
       m.id
  from members m
 where (m.cohort_id, m.name) in (
   select cohort_id, name from members group by cohort_id, name having count(*) > 1
 )
 order by m.cohort_id, m.name, 출결기록 desc;


-- ══════════════════════════════════════════════════════════════════
-- PART 8 — 3기 잔여 행 정리 (BEGIN 부터 COMMIT 까지 선택해서 Run)
--
--   PART 7 결과
--     2기 김강민·이진아·이현주 → 전화번호도 조도 다르다. 진짜 동명이인이니 둔다.
--     3기 박민수·이수민       → 한쪽 전화번호가 비어 있다. 같은 사람이 두 번이다.
--                              시트 ID 에 번호가 없던 시절 행이 남은 것.
--                              inactive 이고 출결·과제 모두 0건이라 지워도 잃을 게 없다.
-- ══════════════════════════════════════════════════════════════════

begin;

delete from members
 where id in (
   '825640c1-d940-4560-aad7-f9cbe6908839',  -- 3기 박민수 (전화 비어있음, inactive)
   'c04a0eca-565c-4cff-bb74-00f40e4a6d2f'   -- 3기 이수민 (전화 비어있음, inactive)
 )
   and btrim(coalesce(phone, '')) = ''      -- 안전장치: 번호 있는 행은 절대 안 지운다
   and status = 'inactive'
   and not exists (select 1 from attendance a
                    where a.member_id = members.id
                      and nullif(btrim(a.status), '') is not null);

commit;


-- ══════════════════════════════════════════════════════════════════
-- PART 9 — 마무리 확인 (선택해서 Run)
--
--   전화번호가 비어 있는 행이 더 없는지, 기수별 인원이 맞는지.
--   2기 142 (활성 103) · 3기 80 (활성 78) 이면 정리 끝입니다.
-- ══════════════════════════════════════════════════════════════════

select '① 전화 비어있음' as 구분,
       cohort_id || ' ' || name || ' (' || status || ')' as 항목,
       ''::text as 값
  from members where btrim(coalesce(phone, '')) = ''

union all
select '② 인원',
       cohort_id || ' ' || case when status = 'active' then '활성' else '비활성' end,
       count(*)::text
  from members group by cohort_id, status

union all
select '③ 2기 수료 판정', coalesce(verdict, '(없음)'), count(*)::text
  from v_completion_status where cohort_id = '2기' group by verdict

order by 1, 2;


-- ══════════════════════════════════════════════════════════════════
-- PART 10 — 3기에 남은 지난 기수 과제 정리
--
--   지금 3기에 들어 있는 과제는 잘못된 기준으로 걸러진 결과다.
--   (동기화가 '아직 안 한 강의는 지난 기수 것' 이라고 봤는데,
--    실제로는 강의 전에 미리 내는 구조라 이 전제가 틀렸다)
--
--   그래서 진짜 3기 제출은 빠지고 지난 기수 것이 들어와 있다.
--   통째로 지우고 동기화를 다시 돌리면 고쳐진 기준으로 정확히 채워진다.
--
--   삭제해도 잃는 것은 없다 — 원본은 시트 과제 탭에 그대로 있다.
-- ══════════════════════════════════════════════════════════════════

-- 먼저 확인
select session_label, count(*) as 건수, min(submitted_at)::date as 가장이른제출
  from homework_submissions
 where cohort_id = '3기'
 group by session_label
 order by 1;

-- 확인 후 실행. 그다음 Actions 에서 동기화를 다시 돌리면 제대로 채워진다.
delete from homework_submissions where cohort_id = '3기';


-- ══════════════════════════════════════════════════════════════════
-- PART 11 — 3기 김밥 신청 확인 (선택해서 Run)
--
--   김밥은 사전 신청이라 '아직 안 한 강의' 로는 거를 수 없다.
--   교리1~4 에 46~47명씩 균일하면 3기 신규 신청일 가능성이 크고,
--   산발적인 수(2~13명)나 3기 일정에 없는 라벨(교제 등)은 지난 기수 잔여다.
--
--   지우려면:  delete from kimbap_signups
--               where cohort_id = '3기' and session_label = '교제';
-- ══════════════════════════════════════════════════════════════════

select k.session_label as 라벨,
       count(*) filter (where k.applied) as 신청,
       case when s.session_date is null then '⚠️ 3기 일정에 없음'
            else s.session_date::text end as 강의일
  from kimbap_signups k
  left join sessions s
    on s.cohort_id = k.cohort_id and s.label_norm = k.session_label
 where k.cohort_id = '3기'
 group by k.session_label, s.session_date
having count(*) filter (where k.applied) > 0
 order by s.session_date nulls first;
