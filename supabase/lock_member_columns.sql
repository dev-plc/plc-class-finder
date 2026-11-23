-- 안 쓰는 민감 열을 공개 키(anon)에서 닫는다. (2026-11-23 · 앱 v129)
--
-- 왜
--   앱이 쓰는 공개 키(anon)는 저장소에 적혀 있고, members 는 'for select using (true)' 다.
--   그래서 누구나 REST 로 members 를 읽을 수 있었고, 연락처 전체(full_phone)·결혼·메모까지
--   2기·3기 전원 것이 열려 있었다. 그 열들은 **어느 화면도 쓰지 않는다.**
--   나이·담당교역자는 관리자 화면이 쓰므로 아직 열어 둔다 (관리자 로그인 단계에서 잠근다).
--
-- 어떻게
--   표 단위 grant 가 있으면 열 하나를 revoke 해도 효과가 없다. 표 권한을 거두고
--   **쓸 열만** 다시 준다. 그러면 select=* 는 통째로 거절된다.
--   뷰는 만든 사람 권한으로 돌아 표 권한을 건너뛴다 — v_completion_status 가 admin_note 를
--   내보내므로 그 뷰도 같은 방식으로 admin_note 만 뺀다.
--
-- ⚠️ 차례: 앱 v129 가 main 에 올라가 사이트에 뜬 **뒤에** 실행한다.
--    v128 이하는 members 를 select=* 로 받으므로, 이걸 먼저 돌리면 조회 화면이 죽는다.
--    (사이트 오른쪽 아래·관리자 배지의 버전이 v129 인지 시크릿 창에서 확인)
--
-- 영향 없음
--   - 동기화·조회 워크플로: service_role 로 돈다 (이 grant 와 무관)
--   - GAS 두 프로젝트: members?select=id,name,phone 만 읽는다 (아래 목록에 있다)
--
-- 새 열을 화면에서 쓰려면: 아래 grant 목록과 scripts/members-data.js 의 MEMBER_COLS 에 같이 넣는다.
-- views.sql 을 다시 돌려도 v_completion_status 의 잠금은 유지된다 (거기에도 같은 grant 를 넣었다).

-- ===================================================================
-- 1. members — 화면이 쓰는 열만
-- ===================================================================
revoke select on public.members from anon, authenticated;
grant select (id, cohort_id, name, phone, team, team_no, sheet_row, location, role,
              age, pastor, lunch1, lunch2, completion, status)
  on public.members to anon, authenticated;

-- ===================================================================
-- 2. v_completion_status — admin_note 만 빼고
-- ===================================================================
revoke select on public.v_completion_status from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'v_completion_status'
     and column_name <> 'admin_note';
  execute format('grant select (%s) on public.v_completion_status to anon, authenticated', cols);
end $$;

-- ===================================================================
-- 3. 확인 — 전부 '닫힘' / '열림' 이 기대대로면 끝
-- ===================================================================
select c.column_name,
       case when has_column_privilege('anon', 'public.members', c.column_name, 'select')
            then '열림' else '닫힘' end as anon
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'members'
 order by c.ordinal_position;
-- 기대: full_phone · gender · marital · note · telegram_ok · sms_ok · admin_note · needs_review · updated_at = 닫힘

select has_column_privilege('anon', 'public.v_completion_status', 'admin_note', 'select') as admin_note_열림;
-- 기대: false

-- ===================================================================
-- 되돌리기 (문제가 생겼을 때만 — 아래 세 줄의 주석을 풀고 실행)
-- ===================================================================
-- grant select on public.members             to anon, authenticated;
-- grant select on public.v_completion_status to anon, authenticated;
-- select 'reverted';
