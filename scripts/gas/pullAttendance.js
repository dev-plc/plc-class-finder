// Google Apps Script — 시트에 붙이는 프로젝트용
//
// 이 파일은 웹 앱(doGet/doPost)과 **별개 프로젝트**다.
// 시트에서 [확장 프로그램 → Apps Script] 로 만든 프로젝트에 이것만 넣으면 된다.
// 그래야 onOpen 메뉴가 뜬다 (독립 프로젝트에서는 메뉴를 달 수 없다).
//
// 웹 앱 프로젝트(scripts/gas/doGet.js)는 건드리지 않는다.

// ═══════════════════════════════════════════════════════════════════════════
// DB → 시트 : 출석 내려받기 (v25)
//
// 출석은 DB 가 원본이다. 앱에서 찍고 시트는 그것을 비춰 보기만 한다.
// 이 함수는 Supabase 를 읽어 '출석부(DB)' 탭의 출석 칸을 채운다.
//
// 방향이 언제나 DB → 시트 하나뿐이라 양쪽이 어긋날 일이 없다.
// 시트에서 손으로 고쳐도 다음 실행에 덮어써진다 — 그게 의도한 동작이다.
//
// 쓰는 값: O(출석) ◎(지난 기수 이수) X(결석) −(집계 제외) 그리고 빈칸
// 범위:   출석부 헤더의 모든 날짜 컬럼 (지난 주차·앞으로의 주차 모두)
//
// 실행 방법
//   시트 상단 [PLC] 메뉴 → 'DB에서 출석 가져오기'
//   메뉴가 안 보이면 이 스크립트가 시트에 붙어 있지 않은 것이다.
//   그 경우 Apps Script 편집기에서 pullAttendanceFromDb 를 골라 ▶ 실행.
//
// 이 블록은 혼자서도 돈다. doGet 코드와 같은 프로젝트에 있어도 되고,
// 시트에 붙인 새 프로젝트에 이것만 넣어도 된다.
// ═══════════════════════════════════════════════════════════════════════════

// 이 블록만 따로 떼어 다른 파일·새 프로젝트에 붙여넣어도 돌아가야 한다.
// 위쪽 doGet 코드가 같이 있으면 그쪽 SHEET_ID / TAB_ROSTER 를 쓰고,
// 없으면 아래 값을 쓴다.
var PULL_SHEET_ID   = "12fuduQjWE00i3-t9vYe7eh0TEoQ9tsX2hb1TQzxmDQM";
var PULL_TAB_ROSTER = "출석부(DB)";

function pullTargets_() {
  return {
    sheetId: (typeof SHEET_ID   !== "undefined" && SHEET_ID)   ? SHEET_ID   : PULL_SHEET_ID,
    roster:  (typeof TAB_ROSTER !== "undefined" && TAB_ROSTER) ? TAB_ROSTER : PULL_TAB_ROSTER
  };
}

// anon 키는 공개돼도 안전하다. 읽기만 열려 있고 쓰기는 RLS 로 막혀 있다.
var SUPABASE_URL = "https://wvpqdicsqjozhxtxsnin.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w";

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PLC')
      .addItem('DB에서 출석 가져오기', 'pullAttendanceFromDb')
      .addToUi();
  } catch (e) {
    // 시트에 붙어 있지 않은 스크립트면 메뉴를 달 수 없다. 무시.
  }
}

function sbGet_(path) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error("Supabase " + code + ": " + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

// PostgREST 는 한 번에 돌려주는 행 수에 상한이 있을 수 있다.
// 인원이 늘어도 빠짐없이 받도록 나눠 가져온다.
function sbGetAll_(path) {
  var out = [];
  var step = 1000;
  for (var offset = 0; offset < 200000; offset += step) {
    var sep = path.indexOf("?") === -1 ? "?" : "&";
    var page = sbGet_(path + sep + "limit=" + step + "&offset=" + offset);
    out = out.concat(page);
    if (page.length < step) break;
  }
  return out;
}

// 날짜 헤더를 MM/DD 로 통일한다 (doGet 과 같은 규칙).
function toMMDD_(raw, tz) {
  var v = (raw instanceof Date ? Utilities.formatDate(raw, tz, "MM/dd") : String(raw)).trim();
  var pad = function (n) { return ("0" + n).slice(-2); };
  var m = v.match(/^(\d{1,2})[\/\.\-](\d{1,2})$/);
  if (m) return pad(m[1]) + "/" + pad(m[2]);
  var m3 = v.match(/^(\d{4})[.\/\-]\s*(\d{1,2})[.\/\-]\s*(\d{1,2})\.?$/);
  if (m3) return pad(m3[2]) + "/" + pad(m3[3]);
  return null;
}

function pullAttendanceFromDb() {
  var t = pullTargets_();

  // 시트에 붙어 있는 스크립트면 그 시트를, 아니면 ID 로 연다.
  var ss = null;
  try { ss = SpreadsheetApp.getActive(); } catch (e) { /* 독립 스크립트 */ }
  if (!ss) ss = SpreadsheetApp.openById(t.sheetId);

  var sheet = ss.getSheetByName(t.roster);
  if (!sheet) throw new Error("'" + t.roster + "' 시트를 찾을 수 없습니다.");
  var tz = Session.getScriptTimeZone();

  // ---- 활성 기수
  var cohorts = sbGet_("cohorts?select=id&is_active=is.true&order=started_at.desc.nullslast&limit=1");
  if (!cohorts.length) throw new Error("활성 기수가 지정돼 있지 않습니다 (cohorts.is_active).");
  var cohortId = cohorts[0].id;
  var enc = encodeURIComponent(cohortId);

  var data = sheet.getDataRange().getValues();

  // ---- 헤더 행 찾기
  var headerRowIdx = -1;
  for (var i = 0; i < Math.min(5, data.length); i++) {
    var lowered = data[i].map(function (h) { return String(h).trim().toLowerCase(); });
    if (lowered.indexOf("id") !== -1) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");

  // ---- 기수 표식 대조 — 다른 기수 시트에 쓰지 않도록
  var hint = "";
  for (var cr = 0; cr < Math.min(6, data.length) && !hint; cr++) {
    for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
      var cv = String(data[cr][cc] || "").trim();
      if (/^\d+\s*기$/.test(cv)) { hint = cv.replace(/\s+/g, ""); break; }
    }
  }
  if (hint && hint !== cohortId) {
    throw new Error(
      "시트는 " + hint + " 인데 활성 기수는 " + cohortId + " 입니다.\n" +
      "다른 기수 출석을 이 시트에 쓰지 않도록 중단합니다."
    );
  }

  // ---- 날짜 컬럼 (0-based index → MM/DD)
  var headerRaw = data[headerRowIdx];
  var idCol = -1;
  var dateCols = [];
  for (var c = 0; c < headerRaw.length; c++) {
    if (String(headerRaw[c]).trim().toLowerCase() === "id") { idCol = c; continue; }
    var key = toMMDD_(headerRaw[c], tz);
    if (key) dateCols.push({ col: c, key: key });
  }
  if (idCol === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");
  if (!dateCols.length) throw new Error("날짜 컬럼(MM/DD)을 찾을 수 없습니다.");

  // ---- 시트 인원: ID → 행 offset (헤더 다음 행이 0)
  var lastRow = sheet.getLastRow();
  var rowCount = lastRow - (headerRowIdx + 1);
  if (rowCount <= 0) throw new Error("데이터 행이 없습니다.");

  var idToOffset = {};
  for (var r = 0; r < rowCount; r++) {
    var rawId = String(data[headerRowIdx + 1 + r][idCol] || "").replace(/\s/g, "");
    if (rawId) idToOffset[rawId] = r;
  }

  // ---- DB 에서 인원·세션·출결
  var members = sbGetAll_(
    "members?select=id,name,phone&cohort_id=eq." + enc + "&order=name");
  var sessions = sbGetAll_(
    "sessions?select=session_date,label&cohort_id=eq." + enc + "&order=session_date");
  var attendance = sbGetAll_(
    "attendance?select=member_id,session_date,status,members!inner(cohort_id)" +
    "&members.cohort_id=eq." + enc + "&order=member_id,session_date");

  var uuidToOffset = {};
  var knownOffset = {};      // DB 에 있는 인원이 앉은 행 (시트에만 있는 행은 안 건드리려고)
  var unmatched = [];
  for (var mi = 0; mi < members.length; mi++) {
    var m = members[mi];
    var sheetId = (String(m.name || "") + String(m.phone || "")).replace(/\s/g, "");
    if (idToOffset.hasOwnProperty(sheetId)) {
      uuidToOffset[m.id] = idToOffset[sheetId];
      knownOffset[idToOffset[sheetId]] = true;
    } else {
      unmatched.push(sheetId);
    }
  }

  // 세션 날짜(YYYY-MM-DD) → MM/DD
  var dateToKey = {};
  for (var si = 0; si < sessions.length; si++) {
    var sd = String(sessions[si].session_date || "");
    var mm = sd.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mm) dateToKey[sd] = mm[2] + "/" + mm[3];
  }

  // ---- 채울 값 모으기: key(MM/DD) → offset → 값
  var byKey = {};
  for (var di = 0; di < dateCols.length; di++) byKey[dateCols[di].key] = {};
  for (var ai = 0; ai < attendance.length; ai++) {
    var a = attendance[ai];
    var off = uuidToOffset[a.member_id];
    if (off === undefined) continue;
    var key = dateToKey[a.session_date];
    if (!key || !byKey.hasOwnProperty(key)) continue;
    byKey[key][off] = String(a.status == null ? "" : a.status).trim();
  }

  // ---- 무엇이 바뀔지 먼저 다 계산한다.
  //      시트를 덮어쓰는 일이라, 몇 칸이 어떻게 바뀌는지 보고 나서 쓴다.
  var plan = [];        // [{col, values, changed}]
  var changed = 0;
  var samples = [];
  for (var dj = 0; dj < dateCols.length; dj++) {
    var dc = dateCols[dj];
    var range = sheet.getRange(headerRowIdx + 2, dc.col + 1, rowCount, 1);
    var cur = range.getValues();
    var next = [];
    var colChanged = 0;
    var fill = byKey[dc.key] || {};
    for (var ri = 0; ri < rowCount; ri++) {
      var before = String(cur[ri][0] == null ? "" : cur[ri][0]).trim();
      var after;
      if (fill.hasOwnProperty(ri)) {
        after = fill[ri];                       // DB 기록 그대로 (O ◎ X − 빈칸)
      } else if (knownOffset[ri]) {
        after = "";                             // DB 에 있는 사람인데 그 주차 기록이 없음
      } else {
        after = before;                         // 시트에만 있는 행 — 건드리지 않는다
      }
      if (after !== before) {
        colChanged++;
        changed++;
        if (samples.length < 5) {
          samples.push(dc.key + " " +
            String(data[headerRowIdx + 1 + ri][idCol] || "").replace(/\s/g, "") + " " +
            (before === "" ? "(빈칸)" : before) + " → " + (after === "" ? "(빈칸)" : after));
        }
      }
      next.push([after]);
    }
    if (colChanged) plan.push({ range: range, values: next });
  }

  if (!changed) {
    var same = cohortId + " — 시트가 이미 DB 와 같습니다. 바꾼 것이 없습니다.";
    Logger.log(same);
    try { SpreadsheetApp.getUi().alert(same); } catch (e) {}
    return same;
  }

  // ---- 쓰기 전에 묻는다 (메뉴에서 실행할 때만. 트리거 실행이면 그냥 진행)
  var ask =
    cohortId + " 출석을 DB 에서 가져옵니다.\n\n" +
    "인원 " + members.length + "명 · 주차 " + dateCols.length + "개\n" +
    "바뀔 칸 " + changed + "개\n\n" +
    samples.join("\n") + (changed > samples.length ? "\n…" : "") +
    "\n\n시트의 출석 칸을 DB 값으로 덮어씁니다. 진행할까요?";
  try {
    var ui = SpreadsheetApp.getUi();
    if (ui.alert("DB에서 출석 가져오기", ask, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
      return "취소했습니다.";
    }
  } catch (e) { /* UI 없는 실행 — 그대로 진행 */ }

  // ---- 쓴다. 컬럼별로 나눠 쓴다.
  //      한 덩어리로 읽고 쓰면 사이에 낀 수식 칸까지 값으로 굳어버린다.
  for (var pi = 0; pi < plan.length; pi++) {
    plan[pi].range.setValues(plan[pi].values);
  }

  var msg =
    cohortId + " 출석을 DB 에서 가져왔습니다.\n\n" +
    "인원 " + members.length + "명 · 주차 " + dateCols.length + "개\n" +
    "바뀐 칸 " + changed + "개";
  if (unmatched.length) {
    msg += "\n\n⚠️ 시트에서 못 찾은 인원 " + unmatched.length + "명:\n" +
           unmatched.slice(0, 10).join(", ") + (unmatched.length > 10 ? " 외" : "");
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 트리거 실행이면 UI 없음 */ }
  return msg;
}
