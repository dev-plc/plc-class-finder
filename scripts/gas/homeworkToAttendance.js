// 과제 탭 → 출석부(DB) 자동 반영 (시트에 붙는 스크립트)
//
// 과제+소감문을 낸 사람의 결석(X)을 보충 표시로 바꾼다.
// 폼 제출(onFormSubmit)과 수기 입력(onEdit) 둘 다에서 돈다.
//
// ⚠️ 이 파일을 고쳐도 웹앱 재배포는 필요 없다. 트리거가 저장된 코드를 그대로 부른다.
//    (재배포가 필요한 것은 doGet/doPost 뿐이다)
//
// 핵심 변경 (2026-09-03): '◎' 대신 '과제' 를 쓴다
//
//   이 스크립트가 '◎' 를 쓰고 있었던 것이 오랫동안 판정을 망가뜨린 원인이었다.
//   '◎' 는 supabase/views.sql 에서 present 로 세어진다. 그래서 과제로 메운
//   주차가 '출석' 이 되어 makeup_limit()(3회)을 아예 안 거쳤고, 여섯 번을
//   대체해도 '관리자확인' 조차 뜨지 않았다.
//
//   게다가 '◎' 는 원래 '지난 기수 이수 이월' 의 표시다. 한 글자가 두 뜻을
//   겸하니 코드가 둘을 가릴 방법이 없었다.
//
//   이제 보충은 '과제' 로 적는다. is_absent() 가 X 와 같이 결석으로 세고,
//   인정 여부는 글자가 아니라 homework_submissions 가 정한다 — 그래야 3회
//   한도가 제대로 붙는다. '◎' 는 이월 전용으로 남는다.
//
//   ⚠️ 이 값이 DB 까지 가려면 Supabase 의 views.sql · rpc_attendance.sql 과
//      pullAttendance.js 의 PLC_PUSH_ALLOWED 가 '과제' 를 알아야 한다.
//      셋 중 하나라도 옛것이면 그 칸이 조용히 건너뛰어진다.
//
// ── 시트 배치 (여기 상수로 둔다) ──────────────────────────────────────────
//   과제 탭      C열 아이디 · F열 강의명 · G열 과제유형
//   출석부(DB)   3행 강의명 · J열 아이디 · 5행부터 데이터
//
//   ⚠️ doGet.js 는 'id' 헤더를 찾아 열 위치를 스스로 알아내는데, 이 파일은
//      자리를 고정해 두고 있다. 열을 하나 끼워 넣으면 조용히 엉뚱한 칸에 쓴다.
//      지금 배치가 맞아서 도는 중이라 그대로 두지만, 시트 구조를 바꾸면
//      이 파일부터 확인할 것.

var HTA_STATUS_MAKEUP = '과제';    // 결석했지만 과제·소감문으로 메움
var HTA_TAB_HOMEWORK  = '과제';
var HTA_TAB_ROSTER    = '출석부(DB)';

var HTA_COL_ID       = 3;   // 과제 탭 C열
var HTA_COL_LECTURE  = 6;   // 과제 탭 F열
var HTA_COL_TYPE     = 7;   // 과제 탭 G열
var HTA_DB_ID_IDX    = 9;   // 출석부 J열 (0-based)
var HTA_DB_LEC_ROW   = 2;   // 출석부 3행 (0-based)
var HTA_DB_FIRST_ROW = 4;   // 출석부 5행 (0-based)

/**
 * 아이디 정형화.
 *
 * doGet.js 의 plcNormalizeId_ 와 같은 규칙을 쓴다 — 한 프로젝트 안에서 아이디를
 * 두 가지 규칙으로 다듬으면 반드시 어긋난다. 과제 탭 아이디는 손입력과 폼이
 * 섞여 '김도현 5326' · '김도현-5326' · '김도현(5326)' · '김도현５３２６' 처럼
 * 들어오는데, 공백만 지우던 옛 규칙은 기호가 붙은 건을 못 맞췄다.
 *
 * 소문자 변환은 남긴다. 이 함수는 시트끼리만 대조하므로(DB 아이디를 만들지
 * 않는다) 양쪽에 똑같이 걸리는 한 안전하고, 영문 이름의 대소문자를 흡수한다.
 */
function normalizeString(str) {
  if (!str) return "";
  if (typeof plcNormalizeId_ === "function") {
    return plcNormalizeId_(str).toLowerCase();
  }
  // doGet.js 가 없는 프로젝트를 위한 폴백 (같은 규칙을 그대로 적는다)
  return String(str)
    .replace(/[０-９]/g, function (d) {
      return String.fromCharCode(d.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
}

/**
 * 강의명 → 출석부 헤더 이름. '9강 …' → '교리9'.
 * 숫자+강 이 없으면 적힌 그대로 쓴다 ('대화1' · '교제' 등은 헤더와 같은 말이다).
 */
function htaLectureKey_(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/(\d+)강/);
  return m ? ('교리' + m[1]) : s;
}

/** 과제유형이 보충 인정 대상인가 — 과제와 소감문을 둘 다 낸 것만 */
function htaIsMakeup_(assignment) {
  return String(assignment || '').indexOf('과제+소감문') !== -1;
}

/**
 * 수기 입력 시 작동하는 단순 트리거 (onEdit)
 */
function onEdit(e) {
  if (!e) return;
  var sheet = e.source.getActiveSheet();

  if (sheet.getName() !== HTA_TAB_HOMEWORK) return;

  var row = e.range.getRow();
  if (row === 1) return; // 1행(헤더) 수정 시 제외

  processAttendance(sheet, row);
}

/**
 * 구글 폼 제출 시 작동하는 트리거 (onFormSubmit)
 */
function onFormSubmit(e) {
  if (!e) return;
  var sheet = e.range.getSheet();

  if (sheet.getName() !== HTA_TAB_HOMEWORK) return;

  processAttendance(sheet, e.range.getRow());
}

/**
 * 출석부(DB) 한 칸 업데이트
 */
function processAttendance(sheet, row) {
  var rawId      = sheet.getRange(row, HTA_COL_ID).getValue();
  var rawLecture = sheet.getRange(row, HTA_COL_LECTURE).getValue();
  var assignment = sheet.getRange(row, HTA_COL_TYPE).getValue();

  if (!rawId || !rawLecture || !assignment) return;
  if (!htaIsMakeup_(assignment)) return;

  var targetLecture = htaLectureKey_(rawLecture);
  var normalizedInputId = normalizeString(rawId);

  var dbSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HTA_TAB_ROSTER);
  if (!dbSheet) return;

  var dbData = dbSheet.getDataRange().getValues();

  var targetRow = -1;
  for (var i = HTA_DB_FIRST_ROW; i < dbData.length; i++) {
    var normalizedDbId = normalizeString(dbData[i][HTA_DB_ID_IDX]);
    if (normalizedDbId !== "" && normalizedDbId === normalizedInputId) {
      targetRow = i + 1;
      break;
    }
  }

  var targetCol = -1;
  for (var j = 0; j < dbData[HTA_DB_LEC_ROW].length; j++) {
    if (String(dbData[HTA_DB_LEC_ROW][j]).trim() === targetLecture) {
      targetCol = j + 1;
      break;
    }
  }

  if (targetRow === -1 || targetCol === -1) return;

  // 결석(X)일 때만 바꾼다. 이미 출석(O)인 사람을 건드리지 않는다 —
  // 빈칸도 그대로 둔다. 빈칸은 '아직 안 찍음' 이지 결석이 아니다.
  var cell = dbSheet.getRange(targetRow, targetCol);
  var currentValue = String(cell.getValue()).trim();
  if (currentValue === 'X' || currentValue === 'x') {
    cell.setValue(HTA_STATUS_MAKEUP);
  }
}

/**
 * =======================================================================
 * 기존 과제 제출 내역 전체를 읽어 출석부(DB)에 일괄 반영
 * =======================================================================
 */
function syncAllAttendance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var submitSheet = ss.getSheetByName(HTA_TAB_HOMEWORK);
  var dbSheet     = ss.getSheetByName(HTA_TAB_ROSTER);

  if (!submitSheet || !dbSheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다. 탭 이름을 확인해 주세요.');
    return;
  }

  var submitData = submitSheet.getDataRange().getValues();
  var dbData     = dbSheet.getDataRange().getValues();

  var idToRowMap = {};
  for (var i = HTA_DB_FIRST_ROW; i < dbData.length; i++) {
    var nId = normalizeString(dbData[i][HTA_DB_ID_IDX]);
    if (nId) idToRowMap[nId] = i + 1;
  }

  var lectureToColMap = {};
  for (var j = 0; j < dbData[HTA_DB_LEC_ROW].length; j++) {
    var lec = String(dbData[HTA_DB_LEC_ROW][j]).trim();
    if (lec) lectureToColMap[lec] = j + 1;
  }

  var updateCount = 0;

  for (var r = 1; r < submitData.length; r++) {
    var rawId      = submitData[r][HTA_COL_ID - 1];
    var rawLecture = submitData[r][HTA_COL_LECTURE - 1];
    var assignment = submitData[r][HTA_COL_TYPE - 1];

    if (!rawId || !rawLecture || !assignment) continue;
    if (!htaIsMakeup_(assignment)) continue;

    var targetRow = idToRowMap[normalizeString(rawId)];
    var targetCol = lectureToColMap[htaLectureKey_(rawLecture)];
    if (!targetRow || !targetCol) continue;

    var currentValue = String(dbData[targetRow - 1][targetCol - 1]).trim();
    if (currentValue === 'X' || currentValue === 'x') {
      dbSheet.getRange(targetRow, targetCol).setValue(HTA_STATUS_MAKEUP);
      dbData[targetRow - 1][targetCol - 1] = HTA_STATUS_MAKEUP;
      updateCount++;
    }
  }

  var msg = updateCount + '개의 결석(X)을 보충(과제)으로 바꿨습니다.\n\n' +
            "'과제' 는 출석이 아니라 '결석했지만 과제·소감문으로 메움' 입니다.\n" +
            '인정 3회 한도는 그대로 적용됩니다.';
  SpreadsheetApp.getUi().alert(msg);
  return msg;
}

/**
 * =======================================================================
 * 옛 '◎' 가르기 — 이 스크립트가 예전에 찍어 둔 보충분만 '과제' 로
 * =======================================================================
 *
 * 2026-09-03 이전에는 이 스크립트가 보충을 '◎' 로 적었다. 그 값들이 아직
 * 시트에 남아 present 로 세어지고 있어 3회 한도를 우회한다.
 *
 * 그런데 '◎' 에는 진짜 '지난 기수 이수 이월' 도 섞여 있다. 둘을 눈으로는
 * 못 가른다. 가를 수 있는 유일한 근거는 **그 주차에 과제+소감문 제출 기록이
 * 있는가** 다 — 있으면 이 스크립트가 찍은 것이고, 없으면 이월이다.
 *
 * 먼저 plcCountLegacyCarryOver 로 몇 개인지 세어 보고(아무것도 안 바꾼다),
 * 숫자를 확인한 뒤에 plcSplitLegacyCarryOver 를 돌린다.
 */
function plcCountLegacyCarryOver() {
  return htaLegacyCarryOver_(false);
}

function plcSplitLegacyCarryOver() {
  return htaLegacyCarryOver_(true);
}

function htaLegacyCarryOver_(apply) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var submitSheet = ss.getSheetByName(HTA_TAB_HOMEWORK);
  var dbSheet     = ss.getSheetByName(HTA_TAB_ROSTER);
  if (!submitSheet || !dbSheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다.');
    return;
  }

  var submitData = submitSheet.getDataRange().getValues();
  var dbData     = dbSheet.getDataRange().getValues();

  var idToRowMap = {};
  for (var i = HTA_DB_FIRST_ROW; i < dbData.length; i++) {
    var nId = normalizeString(dbData[i][HTA_DB_ID_IDX]);
    if (nId) idToRowMap[nId] = i + 1;
  }
  var lectureToColMap = {};
  for (var j = 0; j < dbData[HTA_DB_LEC_ROW].length; j++) {
    var lec = String(dbData[HTA_DB_LEC_ROW][j]).trim();
    if (lec) lectureToColMap[lec] = j + 1;
  }

  var hits = 0;
  var samples = [];
  var seen = {};

  for (var r = 1; r < submitData.length; r++) {
    var rawId      = submitData[r][HTA_COL_ID - 1];
    var rawLecture = submitData[r][HTA_COL_LECTURE - 1];
    var assignment = submitData[r][HTA_COL_TYPE - 1];

    if (!rawId || !rawLecture || !assignment) continue;
    if (!htaIsMakeup_(assignment)) continue;

    var lectureKey = htaLectureKey_(rawLecture);
    var targetRow = idToRowMap[normalizeString(rawId)];
    var targetCol = lectureToColMap[lectureKey];
    if (!targetRow || !targetCol) continue;

    var cellKey = targetRow + ':' + targetCol;
    if (seen[cellKey]) continue;          // 같은 사람이 같은 주차에 여러 번 낸 경우
    seen[cellKey] = 1;

    if (String(dbData[targetRow - 1][targetCol - 1]).trim() !== '◎') continue;

    hits++;
    if (samples.length < 10) samples.push(lectureKey + ' ' + String(rawId).trim());
    if (apply) {
      dbSheet.getRange(targetRow, targetCol).setValue(HTA_STATUS_MAKEUP);
      dbData[targetRow - 1][targetCol - 1] = HTA_STATUS_MAKEUP;
    }
  }

  var msg = apply
    ? '◎ ' + hits + '개를 과제로 바꿨습니다.'
    : '바꿀 대상 ◎ 는 ' + hits + '개입니다. (아무것도 바꾸지 않았습니다)';
  msg += '\n\n제출 기록이 없는 ◎ 는 진짜 이월이므로 건드리지 않았습니다.';
  if (samples.length) msg += '\n\n예: ' + samples.join(' / ');
  if (!apply && hits > 0) msg += '\n\n이대로 바꾸려면 plcSplitLegacyCarryOver 를 실행하세요.';

  SpreadsheetApp.getUi().alert(msg);
  return msg;
}
