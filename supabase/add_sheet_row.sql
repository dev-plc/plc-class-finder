-- members.sheet_row — 시트 출석부 탭의 행 순서
--
-- 왜 필요한가
--   조 목록 순서를 이름으로 짐작하고 있었다. DB 문자 정렬은 라틴을 한글보다
--   앞세우므로('V3' < '새A') 'V3' 조를 만들자 맨 앞에 나왔다. 관리자 조별보기는
--   따로 접두 표(['새','남','여','DG','M','W'])를 썼는데, 표에 없는 이름은
--   indexOf 가 -1 이라 역시 맨 앞으로 튀었다.
--
--   이름을 보고 규칙을 만드는 한 새 조가 생길 때마다 코드를 고쳐야 한다.
--   시트에 적힌 순서를 그대로 옮겨 두면 시트 아래에 붙이는 것만으로 끝난다.
--
-- 채우는 곳
--   scripts/sync-sheet-to-db.mjs 가 GAS 응답 배열의 인덱스를 넣는다.
--   GAS 는 시트를 위에서 아래로 읽으므로 그 순서가 곧 시트 순서다.
--
-- 실행 후
--   관리자 화면의 '⟳ 시트에서 지금 가져오기' 를 한 번 눌러 값을 채운다.
--   그 전까지는 전부 null 이고, 앱 조회가 nullslast 로 예전 순서를 그대로 쓴다.

alter table members add column if not exists sheet_row int;

-- 확인: 채워졌는지 · 조 순서가 어떻게 나오는지
--   select sheet_row, team, team_no, name from members
--    where cohort_id = '3기' and status = 'active'
--    order by sheet_row nulls last, team, team_no, id limit 30;
