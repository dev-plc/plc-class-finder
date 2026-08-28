-- 출석 기록 RPC
--
-- 웹앱은 anon 키로 접속하고 그 키는 공개되므로,
-- 테이블에 직접 UPDATE 권한을 주지 않는다.
-- 대신 출석 상태만 바꿀 수 있는 함수를 열어 쓰기 범위를 좁힌다.
--
-- 허용 상태: O(출석) X(결석) ◎(지난 기수 이수 이월)
--            과제(결석했지만 과제·소감문으로 메움) -(집계 제외) ''(기록 취소)
-- 그 외 값이나 없는 세션·인원은 거부한다.

-- ===================================================================
-- 1. 단건 기록
-- ===================================================================
create or replace function set_attendance(
  p_member_id    uuid,
  p_session_date date,
  p_status       text
)
returns jsonb
language plpgsql
security definer            -- 테이블 권한 없이도 함수 안에서만 쓰기 허용
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_cohort text;
begin
  if v_status not in ('O', 'X', '◎', '과제', '-', '') then
    raise exception '허용되지 않는 출석 상태: %', p_status;
  end if;

  -- 존재하는 인원인지 (없는 id로 행을 만들지 않도록)
  select cohort_id into v_cohort from members where id = p_member_id;
  if v_cohort is null then
    raise exception '존재하지 않는 인원입니다';
  end if;

  -- 해당 기수에 실제로 있는 세션인지
  if not exists (
    select 1 from sessions
    where cohort_id = v_cohort and session_date = p_session_date
  ) then
    raise exception '해당 기수에 없는 세션입니다: %', p_session_date;
  end if;

  insert into attendance (member_id, session_date, status)
  values (p_member_id, p_session_date, v_status)
  on conflict (member_id, session_date)
  do update set status = excluded.status, updated_at = now();

  return jsonb_build_object('ok', true, 'member_id', p_member_id,
                            'session_date', p_session_date, 'status', v_status);
end;
$$;

-- ===================================================================
-- 2. 조 단위 일괄 기록
--    entries: [{"member_id":"...","status":"O"}, ...]
-- ===================================================================
create or replace function set_attendance_batch(
  p_session_date date,
  p_entries      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec        jsonb;
  v_status   text;
  v_member   uuid;
  v_cohort   text;
  v_updated  int := 0;
  v_skipped  jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries 는 배열이어야 합니다';
  end if;

  for rec in select * from jsonb_array_elements(p_entries)
  loop
    v_member := (rec ->> 'member_id')::uuid;
    v_status := upper(btrim(coalesce(rec ->> 'status', '')));

    if v_status not in ('O', 'X', '◎', '과제', '-', '') then
      v_skipped := v_skipped || jsonb_build_object(
        'member_id', v_member, 'reason', '허용되지 않는 상태: ' || v_status);
      continue;
    end if;

    select cohort_id into v_cohort from members where id = v_member;
    if v_cohort is null then
      v_skipped := v_skipped || jsonb_build_object(
        'member_id', v_member, 'reason', '존재하지 않는 인원');
      continue;
    end if;

    if not exists (
      select 1 from sessions
      where cohort_id = v_cohort and session_date = p_session_date
    ) then
      v_skipped := v_skipped || jsonb_build_object(
        'member_id', v_member, 'reason', '해당 기수에 없는 세션');
      continue;
    end if;

    insert into attendance (member_id, session_date, status)
    values (v_member, p_session_date, v_status)
    on conflict (member_id, session_date)
    do update set status = excluded.status, updated_at = now();

    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'total', jsonb_array_length(p_entries),
    'skipped', v_skipped,
    'session_date', p_session_date
  );
end;
$$;

-- ===================================================================
-- 3. 권한
--    함수 실행만 열고, attendance 테이블 직접 쓰기는 계속 막는다.
-- ===================================================================
revoke all on function set_attendance(uuid, date, text) from public;
revoke all on function set_attendance_batch(date, jsonb) from public;

grant execute on function set_attendance(uuid, date, text)
  to anon, authenticated, service_role;
grant execute on function set_attendance_batch(date, jsonb)
  to anon, authenticated, service_role;

-- attendance 테이블은 읽기만 (쓰기는 위 함수를 통해서만)
grant select on public.attendance to anon, authenticated;
