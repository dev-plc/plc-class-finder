// Google Apps Script — 시트에 붙이는 프로젝트용
//
// 이 파일은 웹 앱(doGet/doPost)과 **별개 프로젝트**다.
// 시트에서 [확장 프로그램 → Apps Script] 로 만든 프로젝트에 이것만 넣으면 된다.
// 그래야 onOpen 메뉴가 뜬다 (독립 프로젝트에서는 메뉴를 달 수 없다).
//
// 웹 앱 프로젝트(scripts/gas/doGet.js)는 건드리지 않는다.
//
// 이 파일은 배포가 필요 없다. 메뉴·편집기·트리거 실행은 늘 저장된 최신 코드가 돈다.
// (배포는 URL 로 부르는 웹 앱에만 필요하다 — 그건 doGet.js 쪽 이야기다)
//
// 핵심 변경 (v27):
//   - pushAttendanceToDb — 시트 → DB 로 다른 칸만 밀어넣는다. 자가 치유 장치다.
//     plcInstallPushTrigger 로 10분마다 자동 실행. doPost 의 DB 반영이 실패했거나
//     시트에 직접 친 값이 여기서 메워진다.
//   - 단계마다 Logger 로 진행 상황을 남긴다. 확인 창은 편집기가 아니라 시트 창에
//     뜨기 때문에, 로그가 없으면 '실행 중' 말고는 단서가 없었다.
//   - 컬럼마다 getValues() 를 부르던 것을 없앴다. 맨 위에서 읽어 둔 값을 쓴다.
//
// 핵심 변경 (v26):
//   - 상수 이름에 PLC_ 접두어. GAS 는 프로젝트의 .gs 를 한 덩어리로 이어 붙여서,
//     다른 파일에 같은 이름이 있으면 나중 것이 조용히 이긴다.
//     그 탓에 키가 멀쩡한데도 'Invalid API key' 가 났다.
//   - onOpen 을 정의하지 않는다. 한 프로젝트에 둘이면 하나가 조용히 지고
//     기존 메뉴가 통째로 사라진다. plcAddMenu 만 두고 기존 onOpen 에서 부른다.
//   - plcCheckKey — 키 길이·조각 수·연결을 한 번에 확인한다.

// ⚠️ 출결의 원본은 시트다. DB 는 조회를 빠르게 하려고 두는 사본이다.
//    평소 흐름은 시트 → DB (pushAttendanceToDb, 10분마다 자동).
//
// ═══════════════════════════════════════════════════════════════════════════
// DB → 시트 : 출석 내려받기 — 기수 시작 때만
//
// ⚠️ 평소에 돌리지 마세요. 시트를 DB 값으로 덮어씁니다.
//    원본을 사본으로 덮는 일이라, 시트에만 있는 입력이 사라집니다.
//
// 쓰임은 하나뿐이다: 기수를 시작할 때 이월한 ◎ 를 빈 시트에 심는 부트스트랩.
//   1) carry-over 스크립트가 지난 기수 이수분을 DB 에 ◎ 로 넣는다
//   2) 이 함수로 그 ◎ 를 시트에 내려받는다
//   3) 이후로는 시트가 원본. 앱과 시트에서 입력하고 push 로 DB 에 민다
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
//
// ⚠️ 이름에 PLC_ 를 붙인 이유
//    이 파일은 다른 코드가 이미 있는 프로젝트에 얹힌다.
//    GAS 는 프로젝트 안의 .gs 파일을 한 덩어리로 이어 붙이므로,
//    다른 파일에 같은 이름의 var 가 있으면 나중에 읽힌 쪽이 조용히 이긴다.
//    그러면 여기 적은 키가 아니라 그 파일의 키로 요청이 나가서
//    "Invalid API key" 가 뜬다 — 이 파일만 봐서는 원인을 찾을 수 없다.
//    PLC_ 접두어를 붙여 그 충돌 자체를 없앤다.
var PLC_SUPABASE_URL = "https://wvpqdicsqjozhxtxsnin.supabase.co";
var PLC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w";

// 키가 온전한지 먼저 본다. 편집기에서 이 함수를 골라 ▶ 실행하면 된다.
//
// 붙여넣다가 키가 잘리는 일이 잦다 (JWT 는 208 자라 화면에서 줄이 접힌다).
// 잘린 키도 형태는 멀쩡해 보이는데 서버는 "Invalid API key" 만 돌려주므로,
// 길이를 눈으로 확인하는 게 가장 빠르다.
function plcCheckKey() {
  var k = PLC_SUPABASE_ANON_KEY;
  var parts = k.split(".");
  var msg =
    "URL       : " + PLC_SUPABASE_URL + "\n" +
    "키 길이   : " + k.length + "  (정상은 208)\n" +
    "키 조각   : " + parts.length + " 개  (JWT 는 3 개여야 한다)\n" +
    "앞 12 자  : " + k.slice(0, 12) + "\n" +
    "뒤 10 자  : " + k.slice(-10) + "  (정상은 KfBZ28qG0w)\n";

  try {
    sbGet_("cohorts?select=id&limit=1");
    msg += "\n연결 확인 : ✅ 정상입니다. pullAttendanceFromDb 를 실행하세요.";
  } catch (e) {
    msg += "\n연결 확인 : ❌ " + e.message +
           "\n\n길이가 208 이 아니면 키가 잘린 것입니다." +
           "\n저장소의 scripts/gas/pullAttendance.js 에서 45 번째 줄을 다시 복사하세요." +
           "\n길이가 208 인데도 실패하면 Supabase 에서 키가 교체된 것입니다.";
  }

  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert("PLC 키 점검", msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

// 메뉴 달기.
//
// onOpen 은 한 프로젝트에 하나만 산다. 두 개면 하나가 조용히 진다 —
// 기존 메뉴가 사라지거나 PLC 메뉴가 안 뜨거나, 어느 쪽인지도 알기 어렵다.
// 그래서 메뉴 만드는 일 자체는 plcAddMenu 로 떼어 놓았다.
//
//   · 프로젝트에 onOpen 이 없다  → 아래 onOpen 을 그대로 둔다
//   · 이미 onOpen 이 있다        → 아래 onOpen 을 지우고,
//                                  기존 onOpen 안에 plcAddMenu(); 한 줄만 넣는다
//
// 메뉴 없이 편집기에서 pullAttendanceFromDb 를 골라 ▶ 실행해도 똑같이 된다.
function plcAddMenu() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PLC')
      .addItem('지금 DB로 올리기', 'pushAttendanceToDb')
      .addSeparator()
      .addItem('자동 올리기 켜기 (10분마다)', 'plcInstallPushTrigger')
      .addItem('자동 올리기 끄기', 'plcRemovePushTrigger')
      .addSeparator()
      .addItem('연결 점검', 'plcCheckKey')
      .addItem('⚠️ DB에서 출석 가져오기 (기수 시작 때만)', 'pullAttendanceFromDb')
      .addToUi();
  } catch (e) {
    // 시트에 붙어 있지 않은 스크립트면 메뉴를 달 수 없다. 무시.
  }
}

// onOpen 은 일부러 비워 두었다.
//
// 이 파일은 이미 다른 코드가 도는 프로젝트에 얹힌다. 여기서 onOpen 을 정의하면
// 그 프로젝트의 onOpen 과 부딪히고, 둘 중 하나가 조용히 진다 —
// 기존 메뉴가 통째로 사라져도 아무 오류가 안 난다. 그게 더 위험하다.
//
//   · 프로젝트에 이미 onOpen 이 있다 → 그 안에 plcAddMenu(); 한 줄을 넣는다
//   · onOpen 이 하나도 없다          → 아래 세 줄의 주석을 푼다
//
// 메뉴 없이도 편집기에서 pullAttendanceFromDb / plcCheckKey 를 골라
// ▶ 실행하면 똑같이 동작한다.
//
// function onOpen() {
//   plcAddMenu();
// }

function sbGet_(path) {
  var res = UrlFetchApp.fetch(PLC_SUPABASE_URL + "/rest/v1/" + path, {
    headers: {
      apikey: PLC_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + PLC_SUPABASE_ANON_KEY
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    var body = res.getContentText().slice(0, 300);
    // 401 은 열에 아홉이 키가 잘린 것이다. 원인을 메시지에 같이 실어 보낸다.
    if (code === 401) {
      throw new Error(
        "Supabase 401 (키가 거부됐습니다)\n" +
        "  지금 쓰는 키 길이: " + PLC_SUPABASE_ANON_KEY.length + " (정상은 208)\n" +
        "  뒤 10 자: " + PLC_SUPABASE_ANON_KEY.slice(-10) + " (정상은 KfBZ28qG0w)\n" +
        "  → 길이가 다르면 붙여넣을 때 키가 잘린 것입니다.\n" +
        "  → plcCheckKey 함수를 실행하면 더 자세히 알려줍니다.\n" +
        "  서버 응답: " + body);
    }
    throw new Error("Supabase " + code + ": " + body);
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

// 진행 상황을 로그에 남긴다.
//
// 이 함수는 중간에 확인 창에서 멈춰 서고, 그 창은 편집기가 아니라 시트 창에 뜬다.
// 편집기만 보고 있으면 '실행 중' 말고는 아무 단서가 없다 —
// 어디까지 갔는지 로그로 남겨 두면 멈춘 자리를 바로 알 수 있다.
function plcLog_(msg) {
  Logger.log(msg);
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
  plcLog_("활성 기수: " + cohortId + " — 시트를 읽습니다…");

  var data = sheet.getDataRange().getValues();
  plcLog_("시트 읽기 완료 — " + data.length + "행. DB 를 조회합니다…");

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

  plcLog_("DB 조회 완료 — 인원 " + members.length + "명 · 주차 " + sessions.length +
          "개 · 출결 " + attendance.length + "행. 바뀔 칸을 계산합니다…");

  // ---- 무엇이 바뀔지 먼저 다 계산한다.
  //      시트를 덮어쓰는 일이라, 몇 칸이 어떻게 바뀌는지 보고 나서 쓴다.
  //
  //      지금 값은 맨 위에서 읽어 둔 data 에서 꺼낸다. 컬럼마다 getValues() 를
  //      부르면 주차 수만큼 왕복이 생겨 느려진다 (그동안 화면은 그냥 '실행 중' 이다).
  var plan = [];        // [{range, values}]
  var changed = 0;
  var samples = [];
  for (var dj = 0; dj < dateCols.length; dj++) {
    var dc = dateCols[dj];
    var range = sheet.getRange(headerRowIdx + 2, dc.col + 1, rowCount, 1);
    var next = [];
    var colChanged = 0;
    var fill = byKey[dc.key] || {};
    for (var ri = 0; ri < rowCount; ri++) {
      var curRow = data[headerRowIdx + 1 + ri] || [];
      var before = String(curRow[dc.col] == null ? "" : curRow[dc.col]).trim();
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

  // 계산 결과를 먼저 로그에 남긴다.
  // alert 는 사용자가 누를 때까지 스크립트를 멈춰 세우는데, 그 창은 편집기가 아니라
  // 시트 창에 뜬다. 편집기만 보고 있으면 끝없이 '실행 중' 으로만 보인다.
  // 로그에 미리 적어 두면 적어도 무엇을 계산했는지는 확인할 수 있다.
  plcLog_("계산 완료. 확인 창을 띄웁니다 — 스프레드시트 창을 보세요.\n" + ask);

  try {
    var ui = SpreadsheetApp.getUi();
    if (ui.alert("DB에서 출석 가져오기", ask, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
      plcLog_("취소했습니다. 아무것도 쓰지 않았습니다.");
      return "취소했습니다.";
    }
  } catch (e) {
    // UI 를 띄울 수 없는 실행(트리거·독립 스크립트)은 묻지 않고 진행한다.
    plcLog_("확인 창을 띄울 수 없어 그대로 진행합니다: " + e.message);
  }
  plcLog_("시트에 씁니다…");

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

// ═══════════════════════════════════════════════════════════════════════════
// 시트 → DB 밀어넣기 (자가 치유)
//
// 출결의 원본은 시트다. DB 는 조회를 빠르게 하려고 두는 사본일 뿐이다.
// 앱에서 저장하면 doPost 가 시트와 DB 를 함께 갱신하지만,
//   · 시트에 사람이 직접 친 값
//   · doPost 의 DB 갱신이 실패한 경우
// 이 둘은 DB 에 반영되지 않는다. 이 함수가 그 차이를 메운다.
//
// 방향이 시트 → DB 하나뿐이라 충돌이 없다.
// 시트가 맞고 DB 가 틀렸다고 언제나 가정한다.
//
// 10 분마다 자동으로 돈다 (plcInstallPushTrigger 로 설치).
// 트리거 실행이라 UI 가 없고, 결과는 실행 로그에 남는다.
// ═══════════════════════════════════════════════════════════════════════════

function sbRpc_(fn, args) {
  var res = UrlFetchApp.fetch(PLC_SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: PLC_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + PLC_SUPABASE_ANON_KEY
    },
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    throw new Error("Supabase RPC " + code + ": " + res.getContentText().slice(0, 300));
  }
  var body = res.getContentText();
  return body ? JSON.parse(body) : null;
}

var PLC_PUSH_ALLOWED = { "O": 1, "X": 1, "\u25ce": 1, "-": 1, "": 1 };

function pushAttendanceToDb() {
  // doPost 와 같은 잠금을 쓴다. 저장이 진행 중일 때 끼어들어
  // 반쯤 써진 컬럼을 읽지 않도록.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    plcLog_("다른 작업이 진행 중이라 이번 차례는 건너뜁니다.");
    return "건너뜀";
  }

  try {
    var t = pullTargets_();
    var ss = null;
    try { ss = SpreadsheetApp.getActive(); } catch (e) {}
    if (!ss) ss = SpreadsheetApp.openById(t.sheetId);

    var sheet = ss.getSheetByName(t.roster);
    if (!sheet) throw new Error("'" + t.roster + "' 시트를 찾을 수 없습니다.");
    var tz = Session.getScriptTimeZone();

    var cohorts = sbGet_("cohorts?select=id&is_active=is.true&order=started_at.desc.nullslast&limit=1");
    if (!cohorts.length) throw new Error("활성 기수가 지정돼 있지 않습니다.");
    var cohortId = cohorts[0].id;
    var enc = encodeURIComponent(cohortId);

    var data = sheet.getDataRange().getValues();

    // 헤더 행
    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(5, data.length); i++) {
      var lowered = data[i].map(function (h) { return String(h).trim().toLowerCase(); });
      if (lowered.indexOf("id") !== -1) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");

    // 기수 표식 대조 — 다른 기수 시트를 이 기수 DB 로 밀어넣지 않도록
    var hint = "";
    for (var cr = 0; cr < Math.min(6, data.length) && !hint; cr++) {
      for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
        var cv = String(data[cr][cc] || "").trim();
        if (/^\d+\s*기$/.test(cv)) { hint = cv.replace(/\s+/g, ""); break; }
      }
    }
    if (hint && hint !== cohortId) {
      throw new Error("시트는 " + hint + " 인데 활성 기수는 " + cohortId +
                      " 입니다. 다른 기수 출결을 밀어넣지 않도록 중단합니다.");
    }

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

    // DB 쪽 현재 상태
    var members = sbGetAll_("members?select=id,name,phone&cohort_id=eq." + enc + "&order=name");
    var sessions = sbGetAll_("sessions?select=session_date&cohort_id=eq." + enc + "&order=session_date");
    var attendance = sbGetAll_(
      "attendance?select=member_id,session_date,status,members!inner(cohort_id)" +
      "&members.cohort_id=eq." + enc + "&order=member_id,session_date");

    var idToUuid = {};
    for (var mi = 0; mi < members.length; mi++) {
      var k = (String(members[mi].name || "") + String(members[mi].phone || "")).replace(/\s/g, "");
      if (k) idToUuid[k] = members[mi].id;
    }
    var keyToIso = {};   // MM/DD → YYYY-MM-DD
    for (var si = 0; si < sessions.length; si++) {
      var sd = String(sessions[si].session_date || "");
      var sm = sd.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (sm) keyToIso[sm[2] + "/" + sm[3]] = sd;
    }
    var dbNow = {};      // uuid|iso → 현재 값
    for (var ai = 0; ai < attendance.length; ai++) {
      var a = attendance[ai];
      dbNow[a.member_id + "|" + a.session_date] =
        String(a.status == null ? "" : a.status).trim();
    }

    // 시트와 DB 를 비교해 다른 칸만 모은다
    var rowCount = data.length - (headerRowIdx + 1);
    var bySession = {};          // iso → [{member_id, status}]
    var diffs = 0;
    var skippedBadValue = 0;
    var samples = [];

    for (var dj = 0; dj < dateCols.length; dj++) {
      var dc = dateCols[dj];
      var iso = keyToIso[dc.key];
      if (!iso) continue;                       // DB 에 없는 주차는 건드리지 않는다
      for (var r = 0; r < rowCount; r++) {
        var row = data[headerRowIdx + 1 + r] || [];
        var sheetId = String(row[idCol] || "").replace(/\s/g, "");
        if (!sheetId) continue;
        var uuid = idToUuid[sheetId];
        if (!uuid) continue;                    // 시트에만 있는 사람은 건너뛴다

        var want = String(row[dc.col] == null ? "" : row[dc.col]).trim().toUpperCase();
        if (!PLC_PUSH_ALLOWED.hasOwnProperty(want)) { skippedBadValue++; continue; }

        var have = (dbNow[uuid + "|" + iso] || "").toUpperCase();
        if (want === have) continue;

        (bySession[iso] || (bySession[iso] = [])).push({ member_id: uuid, status: want });
        diffs++;
        if (samples.length < 5) {
          samples.push(dc.key + " " + sheetId + " " +
            (have === "" ? "(빈칸)" : have) + " → " + (want === "" ? "(빈칸)" : want));
        }
      }
    }

    if (!diffs) {
      plcLog_(cohortId + " — DB 가 시트와 같습니다. 밀어넣을 것이 없습니다.");
      return "차이 없음";
    }

    var pushed = 0;
    for (var iso2 in bySession) {
      if (!bySession.hasOwnProperty(iso2)) continue;
      var res = sbRpc_("set_attendance_batch", { p_session_date: iso2, p_entries: bySession[iso2] });
      pushed += (res && res.updated) || bySession[iso2].length;
    }

    var msg = cohortId + " — 시트에서 DB 로 " + pushed + "칸 밀어넣었습니다.\n" + samples.join("\n");
    if (skippedBadValue) {
      msg += "\n⚠️ 허용되지 않는 값이 든 칸 " + skippedBadValue + "개는 건너뛰었습니다 (O ◎ X - 빈칸 만 됩니다).";
    }
    plcLog_(msg);
    return msg;

  } catch (err) {
    // 트리거 실행이라 화면에 뜨지 않는다. 로그에 남겨 두고 다음 차례에 다시 시도한다.
    plcLog_("❌ 밀어넣기 실패: " + err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ── 자동 실행 트리거 ────────────────────────────────────────────────────────
// 편집기에서 plcInstallPushTrigger 를 한 번 실행하면 10 분마다 돈다.
// 두 번 눌러도 중복 설치되지 않는다 (같은 이름의 기존 트리거를 먼저 지운다).

var PLC_PUSH_FN = "pushAttendanceToDb";

function plcInstallPushTrigger() {
  plcRemovePushTrigger();
  ScriptApp.newTrigger(PLC_PUSH_FN).timeBased().everyMinutes(10).create();
  var msg = "설치했습니다 — 10분마다 시트의 출결을 DB 로 밀어넣습니다.";
  plcLog_(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function plcRemovePushTrigger() {
  var all = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === PLC_PUSH_FN) { ScriptApp.deleteTrigger(all[i]); n++; }
  }
  if (n) plcLog_("기존 트리거 " + n + "개를 지웠습니다.");
  return n;
}
