// 과제 탭 → 출석부(DB) 자동 반영 (시트에 붙는 스크립트)
//
// 과제+소감문을 낸 사람의 결석(X)과 옛 이월표시(◎)를 보충(과제)으로 바꾼다.
// 폼 제출(onFormSubmit)과 수기 입력(onEdit) 둘 다에서 돈다.
//
// ⚠️ 이 파일을 고쳐도 웹앱 재배포는 필요 없다. 트리거가 저장된 코드를 그대로 부른다.
//    (재배포가 필요한 것은 doGet/doPost 뿐이다)
//
// ── '과제' 는 출석으로 인정된다 ────────────────────────────────────────────
//
//   supabase/views.sql 에서
//     credited = present_count + least(결석이면서 과제 제출한 주차, 3)
//   이므로 '과제' 주차는 **수료 조건에 그대로 들어간다.** 다만 최대 3회다.
//
//   그러면 왜 '◎' 가 아니라 따로 두는가 —
//   '◎' 는 present 로 세어져 그 3회 한도를 **아예 안 거친다.** 예전에 이
//   스크립트가 '◎' 를 찍고 있어서, 여섯 번을 과제로 메워도 '관리자확인' 조차
//   뜨지 않았다. 게다가 '◎' 는 원래 '지난 기수 이수 이월' 의 표시라
//   한 글자가 두 뜻을 겸했고, 코드가 둘을 가릴 방법이 없었다.
//
//   '과제' 로 적으면 is_absent() 가 X 와 같이 잡아 3회 한도를 태우고,
//   인정 여부는 글자가 아니라 homework_submissions 가 정한다.
//   결과는 같은 '출석 인정' 이되 규정대로 세어진다.
//
//   ⚠️ 이 값이 DB 까지 가려면 Supabase 의 views.sql · rpc_attendance.sql 과
//      pullAttendance.js 의 PLC_PUSH_ALLOWED 가 '과제' 를 알아야 한다.
//      셋 중 하나라도 옛것이면 그 칸이 조용히 건너뛰어진다.
//
// ── 시트 배치는 찾아서 쓴다 ────────────────────────────────────────────────
//
//   열 번호를 박아 두지 않는다. doGet.js 가 헤더 글자로 찾아내는 것과 같은
//   규칙을 쓴다. 한동안 이 스크립트는 과제 탭 아이디를 C열로 고정해 두었는데
//   doGet.js 의 주석은 B열이라고 적고 있었다 — 둘 중 하나는 틀린 것이고,
//   틀린 쪽으로 쓰면 아무 오류 없이 엉뚱한 사람의 칸이 바뀐다.
//   열을 하나 끼워 넣는 것만으로 그렇게 된다. 그래서 찾아서 쓴다.

var HTA_STATUS_MAKEUP = '과제';
var HTA_TAB_HOMEWORK  = '과제';
var HTA_TAB_ROSTER    = '출석부(DB)';

// ============================================================================
// 아이디 정형화
// ============================================================================
/**
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

// ============================================================================
// 시트 배치 찾기
// ============================================================================

/** 과제 탭의 열 위치. doGet.js 의 과제 탭 파싱과 같은 규칙이다. */
function htaFindHomeworkCols_(header) {
  var out = { id: -1, lecture: -1, type: -1 };
  for (var k = 0; k < header.length; k++) {
    var lh = String(header[k] || '').trim().toLowerCase();
    if (lh === "아이디" || lh === "id") out.id = k;
    else if (lh.indexOf("몇 강") !== -1 || lh === "강") out.lecture = k;
    else if (lh.indexOf("어떤 과제") !== -1 || lh === "과제유형") out.type = k;
  }
  return out;
}

/** 'MM/DD' · 날짜값 · '2026. 9. 6' 을 날짜 헤더로 본다 (강의명 행을 고를 때 쓴다) */
function htaIsDateHeader_(v) {
  if (v instanceof Date) return true;
  var s = String(v || '').trim();
  return /^\d{1,2}[\/.\-]\d{1,2}$/.test(s) ||
         /^\d{4}[.\/\-]\s*\d{1,2}[.\/\-]\s*\d{1,2}\.?$/.test(s);
}

/** 강의명처럼 보이는가 (doGet.js 의 looksLikeSessionName 과 같은 규칙) */
function htaLooksLikeSessionName_(v) {
  var t = String(v || '').trim();
  return /^교리\s*\d+/.test(t) || /^성경적대화\s*\d+/.test(t) || /^대화\s*\d+/.test(t)
      || /^교제/.test(t) || /^교재/.test(t) || /^나눔/.test(t);
}

/**
 * 출석부(DB) 의 구조를 읽는다.
 *   headerRow  'id' 가 있는 행 (0-based)
 *   idIdx      그 행에서 'id' 열
 *   firstRow   데이터 시작 행 = headerRow + 1
 *   lecRow     강의명 행 — 헤더 행 위쪽에서, 날짜 열에 강의명이 둘 이상 있는 행
 *
 * 하나라도 못 찾으면 null 을 돌려준다. 짐작해서 쓰지 않는다 —
 * 틀린 자리에 쓰면 아무 오류 없이 남의 출결이 바뀐다.
 */
function htaReadRosterLayout_(dbData) {
  var headerRow = -1, idIdx = -1;
  for (var i = 0; i < Math.min(6, dbData.length) && headerRow === -1; i++) {
    for (var c = 0; c < dbData[i].length; c++) {
      if (String(dbData[i][c] || '').trim().toLowerCase() === 'id') {
        headerRow = i; idIdx = c; break;
      }
    }
  }
  if (headerRow === -1) return null;

  var header = dbData[headerRow];
  var lecRow = -1;
  for (var nr = headerRow - 1; nr >= 0 && lecRow === -1; nr--) {
    var hits = 0;
    for (var nc = 0; nc < header.length; nc++) {
      if (htaIsDateHeader_(header[nc]) && htaLooksLikeSessionName_(dbData[nr][nc])) hits++;
    }
    if (hits >= 2) lecRow = nr;
  }
  if (lecRow === -1) return null;

  return { headerRow: headerRow, idIdx: idIdx, firstRow: headerRow + 1, lecRow: lecRow };
}

/** 아이디 → 시트 행번호(1-based) */
function htaIdRowMap_(dbData, layout) {
  var map = {};
  for (var i = layout.firstRow; i < dbData.length; i++) {
    var nId = normalizeString(dbData[i][layout.idIdx]);
    if (nId) map[nId] = i + 1;
  }
  return map;
}

/** 강의명 → 시트 열번호(1-based) */
function htaLectureColMap_(dbData, layout) {
  var map = {};
  var row = dbData[layout.lecRow];
  for (var j = 0; j < row.length; j++) {
    var lec = String(row[j] || '').trim();
    if (lec) map[lec] = j + 1;
  }
  return map;
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
 * 이 칸을 '과제' 로 바꿔야 하는가.
 *
 * X  결석. 근거가 있으면 보충으로 바꾼다
 * ◎  옛 자동화가 찍어 둔 보충이거나 진짜 이월이다. 근거가 있으면 보충 —
 *    '◎' 는 present 로 세어져 3회 한도를 통째로 우회하므로, 근거가 있는데
 *    '◎' 로 두면 규정보다 후하게 인정된다.
 *    근거가 없는 '◎' 는 진짜 이월이라 이 함수가 false 를 준다 (호출부가
 *    이미 과제+소감문 제출을 확인한 뒤에만 부른다).
 * O  이미 출석. 안 건드린다
 * 빈칸 아직 안 찍었을 뿐 결석이 아니다. 그 주차 출석체크를 하면 X 로 채워진다
 */
function htaShouldReplace_(current) {
  var v = String(current || '').trim();
  return v === 'X' || v === 'x' || v === '◎';
}

// ============================================================================
// 트리거
// ============================================================================

/** 수기 입력 (단순 트리거) */
function onEdit(e) {
  if (!e) return;
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== HTA_TAB_HOMEWORK) return;

  var row = e.range.getRow();
  if (row === 1) return; // 헤더 행

  processAttendance(sheet, row);
}

/** 구글 폼 제출 (설치형 트리거) */
function onFormSubmit(e) {
  if (!e) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== HTA_TAB_HOMEWORK) return;

  processAttendance(sheet, e.range.getRow());
}

/**
 * 출석부(DB) 한 칸 업데이트
 *
 * 트리거에서 불리므로 화면에 아무것도 못 띄운다. 못 찾은 것은 로그로 남긴다 —
 * 조용히 지나가면 왜 안 바뀌는지 알아낼 방법이 없다.
 */
function processAttendance(sheet, row) {
  var hwHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var cols = htaFindHomeworkCols_(hwHeader);
  if (cols.id === -1 || cols.lecture === -1 || cols.type === -1) {
    Logger.log("과제 탭 헤더를 못 찾았습니다 (아이디 · 몇 강 · 어떤 과제).");
    return;
  }

  var rowVals = sheet.getRange(row, 1, 1, hwHeader.length).getValues()[0];
  var rawId      = rowVals[cols.id];
  var rawLecture = rowVals[cols.lecture];
  var assignment = rowVals[cols.type];

  if (!rawId || !rawLecture || !assignment) return;
  if (!htaIsMakeup_(assignment)) return;

  var dbSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HTA_TAB_ROSTER);
  if (!dbSheet) { Logger.log("'" + HTA_TAB_ROSTER + "' 시트가 없습니다."); return; }

  var dbData = dbSheet.getDataRange().getValues();
  var layout = htaReadRosterLayout_(dbData);
  if (!layout) {
    Logger.log("출석부 구조를 못 읽었습니다 ('id' 행 또는 강의명 행). 자리를 짐작하지 않고 멈춥니다.");
    return;
  }

  var targetRow = htaIdRowMap_(dbData, layout)[normalizeString(rawId)];
  var targetCol = htaLectureColMap_(dbData, layout)[htaLectureKey_(rawLecture)];
  if (!targetRow || !targetCol) {
    Logger.log("짝을 못 찾음: " + String(rawId).trim() + " · " + htaLectureKey_(rawLecture));
    return;
  }

  var cell = dbSheet.getRange(targetRow, targetCol);
  if (htaShouldReplace_(cell.getValue())) {
    cell.setValue(HTA_STATUS_MAKEUP);
  }
}

// ============================================================================
// 기존 제출 내역 일괄 반영
// ============================================================================
//
// plcPreviewAttendance  아무것도 안 바꾸고 몇 칸이 바뀔지만 센다
// syncAllAttendance     실제로 바꾼다
//
// 미리보기를 먼저 두는 이유: '◎' 를 '과제' 로 바꾸면 그 사람의 인정 방식이
// 달라진다. '◎' 는 present 로 세어져 3회 한도를 안 거치는데, '과제' 는 거친다.
// 네 번 이상 보충한 사람은 이 변경으로 관리자확인 대상이 될 수 있다 —
// 몇 명인지 모르고 누르면 안 된다.

function plcPreviewAttendance() { return htaApply_(false); }
function syncAllAttendance()    { return htaApply_(true); }

function htaApply_(apply) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var submitSheet = ss.getSheetByName(HTA_TAB_HOMEWORK);
  var dbSheet     = ss.getSheetByName(HTA_TAB_ROSTER);

  if (!submitSheet || !dbSheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다. 탭 이름을 확인해 주세요.');
    return;
  }

  var submitData = submitSheet.getDataRange().getValues();
  var dbData     = dbSheet.getDataRange().getValues();

  var cols = htaFindHomeworkCols_(submitData[0] || []);
  if (cols.id === -1 || cols.lecture === -1 || cols.type === -1) {
    SpreadsheetApp.getUi().alert(
      "과제 탭에서 '아이디' · '몇 강' · '어떤 과제' 열을 찾지 못했습니다.\n" +
      '헤더 이름을 확인해 주세요.');
    return;
  }

  var layout = htaReadRosterLayout_(dbData);
  if (!layout) {
    SpreadsheetApp.getUi().alert(
      "출석부(DB) 에서 'id' 행이나 강의명 행을 찾지 못했습니다.\n" +
      '자리를 짐작하면 남의 출결을 바꿀 수 있어 멈춥니다.');
    return;
  }

  var idToRowMap      = htaIdRowMap_(dbData, layout);
  var lectureToColMap = htaLectureColMap_(dbData, layout);

  var fromX = 0, fromCarry = 0, unmatched = 0;
  var samples = [];
  var seen = {};

  for (var r = 1; r < submitData.length; r++) {
    var rawId      = submitData[r][cols.id];
    var rawLecture = submitData[r][cols.lecture];
    var assignment = submitData[r][cols.type];

    if (!rawId || !rawLecture || !assignment) continue;
    if (!htaIsMakeup_(assignment)) continue;

    var lectureKey = htaLectureKey_(rawLecture);
    var targetRow = idToRowMap[normalizeString(rawId)];
    var targetCol = lectureToColMap[lectureKey];
    if (!targetRow || !targetCol) { unmatched++; continue; }

    // 같은 사람이 같은 주차에 여러 번 낸 경우 한 번만 센다
    var cellKey = targetRow + ':' + targetCol;
    if (seen[cellKey]) continue;
    seen[cellKey] = 1;

    var current = String(dbData[targetRow - 1][targetCol - 1]).trim();
    if (!htaShouldReplace_(current)) continue;

    if (current === '◎') fromCarry++; else fromX++;
    if (samples.length < 10) {
      samples.push(lectureKey + ' ' + String(rawId).trim() + ' ' + current + '→과제');
    }

    if (apply) {
      dbSheet.getRange(targetRow, targetCol).setValue(HTA_STATUS_MAKEUP);
      dbData[targetRow - 1][targetCol - 1] = HTA_STATUS_MAKEUP;
    }
  }

  var total = fromX + fromCarry;
  var msg = apply
    ? total + '칸을 과제로 바꿨습니다.'
    : total + '칸이 바뀝니다. (아무것도 바꾸지 않았습니다)';
  msg += '\n  결석(X) → 과제 : ' + fromX +
         '\n  이월(◎) → 과제 : ' + fromCarry;

  if (fromCarry > 0) {
    msg += "\n\n⚠️ ◎ 였던 " + fromCarry + '칸은 인정 방식이 달라집니다.\n' +
           '◎ 는 3회 한도를 안 거치지만 과제는 거칩니다 —\n' +
           '네 번 이상 보충한 사람은 관리자확인 대상이 될 수 있습니다.';
  }
  msg += '\n\n제출 기록이 없는 ◎ 는 진짜 이월이라 건드리지 않았습니다.';
  if (unmatched) msg += '\n명단·강의명에서 짝을 못 찾은 제출 ' + unmatched + '건은 건너뛰었습니다.';
  if (samples.length) msg += '\n\n예: ' + samples.join(' / ');
  if (!apply && total > 0) msg += '\n\n이대로 바꾸려면 syncAllAttendance 를 실행하세요.';

  SpreadsheetApp.getUi().alert(msg);
  return msg;
}
