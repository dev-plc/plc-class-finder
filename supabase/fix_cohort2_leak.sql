-- 3기 시트가 2기로 동기화되며 생긴 오염을 되돌린다.
--
-- 무슨 일이 있었나
--   기수 표식 가드가 생기기 전, 3기로 고쳐 가던 시트가 2기로 동기화됐다.
--   시트를 편집하는 중에 여러 번 돌아서 세 가지가 망가졌다.
--
--   (1) 없던 세션이 생겼다
--       2기는 07/12 에 끝났는데 08/09~09/27 세션 10개가 2기에 붙었다.
--       강의가 16개에서 26개가 됐다.
--
--   (2) 세션 라벨이 되감겼다
--       05/31~07/12 이 교리11·교리12·성경적대화1~4 여야 하는데
--       교리1~교리6 으로 덮였다. 그래서 교리1~교리10 이 두 번씩 있다.
--       과제 매칭이 엉뚱한 주차에 붙어 보충 인정이 부풀려졌다.
--
--   (3) 3기 인원이 2기에 생겼다
--       08-06 에 18명. 전부 2기 출석 기록이 0건이다.
--
-- 이 상태에서 나온 '2기 수료 85명' 은 믿을 수 없다.
-- 아래를 순서대로 실행하고 마지막 쿼리로 다시 세어야 한다.
--
-- Supabase SQL Editor 에서 한 블록씩 실행하세요.

-- ===================================================================
-- 0. 실행 전 확인 — 무엇이 지워지는지 눈으로 본다
-- ===================================================================
select '지울 세션' as 구분, session_date::text, coalesce(label_norm,'') as label
  from sessions
 where cohort_id = '2기' and session_date >= date '2026-08-01'
union all
select '지울 인원', m.name || coalesce(m.phone,''), m.created_at::date::text
  from members m
 where m.cohort_id = '2기'
   and m.created_at >= date '2026-08-06'
   and not exists (
     select 1 from attendance a
      where a.member_id = m.id and nullif(btrim(a.status), '') is not null
   )
 order by 1, 2;

-- ===================================================================
-- 1. 2기에 잘못 붙은 세션의 출결부터 지운다
--    attendance 에는 기수 구분이 없고 member_id 로만 갈린다.
--    같은 날짜를 3기 인원도 쓰므로 2기 인원 것만 골라야 한다.
-- ===================================================================
delete from attendance a
 where a.session_date >= date '2026-08-01'
   and a.member_id in (select id from members where cohort_id = '2기');

-- ===================================================================
-- 2. 2기의 08월 이후 세션을 지운다 (2기는 07/12 에 끝났다)
-- ===================================================================
delete from sessions
 where cohort_id = '2기' and session_date >= date '2026-08-01';

-- ===================================================================
-- 3. 2기 강의 라벨을 날짜 순서대로 다시 매긴다
--    교리1~12 → 성경적대화1~4. 교제·나눔(비강의)은 건드리지 않는다.
-- ===================================================================
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

-- ===================================================================
-- 4. 2기 출석 기록이 하나도 없는데 8/6 이후 생긴 인원을 지운다
--    3기 시트에서 새어 들어온 사람들이다. 3기 쪽 기록은 그대로 남는다.
--    (과제·김밥은 cascade 로 함께 정리된다)
-- ===================================================================
delete from members m
 where m.cohort_id = '2기'
   and m.created_at >= date '2026-08-06'
   and not exists (
     select 1 from attendance a
      where a.member_id = m.id and nullif(btrim(a.status), '') is not null
   );

-- ===================================================================
-- 5. 결과 확인
--    세션 16강 + 비강의 2, 라벨 중복 없음, 인원이 제자리인지.
--    그리고 이게 2기의 진짜 수료 현황이다.
-- ===================================================================
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

-- ===================================================================
-- 6. 따로 볼 것 — 강선형
--    전화번호가 비어 있어 unique (cohort_id, name, phone) 이 걸리지 않는다.
--    동기화할 때마다 새 행이 생겨 지금 2기에 5행이다.
--    어느 행을 남길지는 사람이 판단해야 하므로 여기서는 보여주기만 한다.
-- ===================================================================
select m.id,
       m.name,
       m.team,
       m.status,
       m.created_at::date as 생성일,
       count(a.*) filter (where nullif(btrim(a.status), '') is not null) as 출결기록,
       count(a.*) filter (where upper(btrim(a.status)) in ('O','◎')) as 출석
  from members m
  left join attendance a on a.member_id = m.id
 where m.cohort_id = '2기' and m.name = '강선형'
 group by m.id, m.name, m.team, m.status, m.created_at
 order by 출결기록 desc, 생성일;
