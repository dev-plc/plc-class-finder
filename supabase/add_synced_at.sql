-- cohorts.synced_at — 동기화가 '끝난' 시각
--
-- 왜 필요한가
--   관리자 화면의 ⟳ 는 GAS 를 통해 GitHub Actions 실행을 요청만 하고 바로 돌아온다.
--   워크플로는 보통 23~46초 걸리는데 끝난 때를 알 방법이 없어서,
--   사람이 기다렸다가 [화면 새로 고침] 을 한 번 더 눌러야 했다.
--
--   이 값이 앞서면 끝난 것이다. 화면이 몇 초마다 확인하고 스스로 다시 그린다.
--
-- 채우는 곳
--   scripts/sync-sheet-to-db.mjs 가 **모든 upsert 를 마친 뒤** 한 번 쓴다.
--   cohorts upsert 자리(스크립트 앞부분)에 쓰면 명단·출석·과제가 들어오기 전에
--   '끝났다' 고 알리게 되므로 그 자리에 두면 안 된다.
--
-- 실행 후
--   동기화가 한 번 돌아야 값이 생긴다. 그 전까지는 null 이고,
--   화면은 폴링 대신 60초 뒤 한 번 새로고침하는 폴백으로 동작한다.

alter table cohorts add column if not exists synced_at timestamptz;

-- 확인
--   select id, is_active, synced_at from cohorts order by started_at desc;
