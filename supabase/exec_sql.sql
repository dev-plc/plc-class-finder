-- 조회 전용 SQL 실행 함수
-- Supabase SQL Editor에서 한 번만 실행해두면, 이후 GitHub Actions에서
-- 임의 SELECT 를 돌려 데이터를 확인할 수 있다.
--
-- 안전장치:
--   - SELECT / WITH 로 시작하는 조회만 허용
--   - 세미콜론 포함 시 거부 (다중 문장 차단)
--   - service_role 에게만 실행 권한 부여 (anon 은 호출 불가)

create or replace function exec_sql(query text)
returns jsonb
language plpgsql
security invoker          -- 호출자 권한으로 실행 (권한 상승 없음)
set search_path = public
as $$
declare
  result jsonb;
  cleaned text := btrim(query);
  body    text;
begin
  -- 선행 주석·공백을 걷어낸 뒤 검사 (설명 주석으로 시작하는 경우가 많다)
  body := regexp_replace(cleaned, '^(\s*(--[^\n]*\n|/\*.*?\*/))*\s*', '', 'ns');

  -- 조회만 허용
  if body !~* '^(select|with)\s' then
    raise exception '조회(SELECT/WITH)만 실행할 수 있습니다. 받은 구문: %',
      left(body, 60);
  end if;

  -- 다중 문장 차단
  if position(';' in body) > 0 then
    raise exception '세미콜론은 허용되지 않습니다 (한 번에 한 조회만)';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', body)
    into result;

  return result;
end;
$$;

revoke all on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;
