// Google Apps Script — doGet + doPost 확장 버전
// 기존 doGet · doPost 함수 전체를 이 코드로 교체.
//
// ⚠️ 이 파일을 고치면 웹 앱을 재배포해야 반영된다.
//    배포 → 배포 관리 → 연필 → 버전: 새 버전.
//    "새 배포" 는 URL 이 바뀌어 앱과 동기화가 한꺼번에 끊긴다.
//
// ⚠️ 처음 설치하거나 외부 요청 기능을 더한 뒤에는 편집기에서 plcAuthorize 를
//    한 번 ▶ 실행해 권한을 승인해야 한다. doGet/doPost 는 URL 로 불려서
//    승인 창을 띄울 자리가 없고, 권한이 없으면 조용히 실패한다.
//    승인 → 재배포 순서를 지킬 것.
//
// 핵심 변경 (v33): v32 의 '⟳ 가 출석까지' 를 물린다
//   GAS 프로젝트가 둘이라는 것을 몰랐다. 웹앱(이 파일)은 독립 프로젝트이고
//   pullAttendance.js 는 스프레드시트에 붙은 프로젝트에 있다. 전역을 공유하지
//   않으므로 pushAttendanceToDb 가 여기서는 존재하지 않는다.
//   typeof 가드가 걸려 '출석은 건너뜀' 만 매번 붙었다 — 설계상 정상인 상황을
//   경고처럼 보이게 하므로 기능째로 뺀다.
//
//   출석은 그대로 10분 트리거(pushAttendanceToDb)가 가져온다. 잘 돌고 있다.
//   ⟳ 가 그걸 즉시 하게 만드는 것은 편의일 뿐이고, 그러자고 600줄짜리 파일을
//   웹앱 프로젝트에 한 벌 더 두는 건 남는 장사가 아니다 —
//   같은 파일이 두 곳에 살면 한쪽만 고치는 사고가 난다.
//
// 핵심 변경 (v32, 되돌림): ⟳ 가 출석까지 가져온다
//   '시트에서 지금 가져오기' 인데 출석만 빠져 있었다. 워크플로(sync-db.yml)는
//   명단·편성·위치·과제 제출기록·김밥만 가져오고, 출결은 pushAttendanceToDb
//   한 길로만 온다 — 10분 트리거이거나 시트 메뉴뿐이었다.
//   그래서 시트에서 출결을 고치고 ⟳ 를 눌러도 화면이 안 바뀌었고, 버튼 이름
//   때문에 아무도 그걸 의심하지 않았다. 이제 plcRequestSync_ 가 워크플로를
//   부르기 전에 pushAttendanceToDb 를 먼저 돌린다.
//   ⚠️ --import-attendance 는 여전히 안 켠다. 그건 DB 를 통째로 덮어써서
//      아직 안 한 강의의 O/X 까지 빈칸으로 밀어 넣는다. push 는 다른 칸만 만진다.
//
// 핵심 변경 (v31): 출결 값 '과제' 를 화이트리스트에 넣는다
//   결석했지만 과제·소감문으로 메운 주차를 ◎ 와 가르기 위해 새로 둔 값이다.
//   ⚠️ 짝이 되는 pullAttendance.js 의 PLC_PUSH_ALLOWED 도 같이 열어야 한다.
//      시트의 '과제' 를 DB 로 올리는 것은 그쪽(pushAttendanceToDb)이고,
//      여기 PLC_ALLOWED_STATUS 는 앱이 쓸 때만 쓰인다 — 앱은 '과제' 를 보내지
//      않으므로(화면에서 잠겨 있다) 이 파일만 고치면 아무것도 달라지지 않는다.
//   ⚠️ 그리고 Supabase 의 rpc_attendance.sql · views.sql 을 먼저 돌려야 한다.
//      거꾸로 하면 set_attendance_batch 가 그 칸을 조용히 건너뛴다.
//
//   버전을 올리는 이유: v30 에서 '과제' 를 넣으면서 이 번호를 안 올렸다.
//   그래서 편집기의 코드가 옛것인지 새것인지 응답의 version 으로 가릴 수 없었고,
//   실제로 옛 코드가 배포된 채로 한참 갔다. 값이 바뀌면 번호도 바꾼다.
//
// 핵심 변경 (v30): 아이디를 한 규칙으로 다듬는다 (plcNormalizeId_)
//   과제 탭 아이디는 손입력과 폼 응답이 섞여 '김도현 5326' · '김도현-5326' ·
//   '김도현(5326)' · '김도현５３２６' 처럼 제각각 들어온다. 띄어쓰기만 지우고
//   있어서 기호가 붙은 건은 명단과 짝이 안 맞아 조용히 버려졌다.
//   한글·영문·숫자만 남기고 전각 숫자는 반각으로 바꾼다.
//   ⚠️ 한쪽만 다듬으면 오히려 어긋난다. 아이디를 만들고 맞추는 6곳에 모두 넣었다.
//
// 핵심 변경 (v29): plcAuthorize 가 GitHub 토큰·저장소·워크플로까지 실제로 확인한다
//
// 핵심 변경 (v28):
//   - plcAuthorize 추가. 실행하는 김에 권한 승인 창을 띄우고,
//     시트·Supabase·GitHub 토큰·저장소·워크플로를 한 번에 점검한다.
//     외부 요청 확인을 GitHub 미인증 주소로 하면 안 된다 — Google 서버 IP 는
//     공용이라 미인증 한도에 걸려 403 이 나고, 권한 문제로 오해하게 된다.
//
// 핵심 변경 (v27):
//   - doPost 가 { action: "sync" } 를 받으면 GitHub Actions 의 동기화
//     워크플로를 대신 실행한다. 관리자 페이지의 '시트에서 지금 가져오기' 버튼.
//     토큰은 코드가 아니라 스크립트 속성(GH_TOKEN)에 둔다 — 저장소가 공개다.
//     연타는 1분에 한 번으로 묶는다. 시트를 안 건드리므로 잠금 전에 처리한다.
//   - doGet 에 토큰 검사(plcCheckToken_). 명단 전체를 돌려주는데 이 URL 은
//     인증이 없고 주소가 저장소에 적혀 있다. 스크립트 속성 API_TOKEN 을
//     설정하기 전에는 검사를 건너뛰므로 기존 동작에 영향이 없다.
//
// 핵심 변경 (v26):
//   - 헤더의 'id' 열을 찾을 때 폭을 26(A~Z)으로 고정하던 것을 시트 전체로 넓혔다.
//     출석부는 정보 16칸 + 주차 18칸이라 금방 Z 를 넘는다.
//
// 핵심 변경 (v25) — doPost 를 크게 손봤다:
//   - LockService 로 잠근다. 컬럼을 통째로 읽고 다시 쓰는 구조라,
//     두 사람이 같은 시각에 저장하면 나중 사람이 먼저 사람의 변경을 덮어썼다.
//     오류도 안 나서 사라진 줄도 몰랐다.
//   - session(YYYY-MM-DD) 인자를 받는다. 전에는 늘 '가장 최근 지난 강의' 에만 써서
//     지난 주차를 고쳐도 이번 주에 기록됐다.
//   - 값을 검증한다 (O X ◎ 과제 - 빈칸). 배포 URL 은 공개라 아무 문자열이나 들어갔다.
//   - 시트에 쓴 뒤 같은 값을 set_attendance_batch 로 DB 에도 민다.
//     DB 반영이 실패해도 저장은 성공으로 친다 — 원본(시트)에 들어갔고
//     pushAttendanceToDb 트리거가 다음 차례에 맞춘다.
//
// 핵심 변경 (v24):
//   - 출석부 상단의 '기수 표식'(예: 3기)을 cohortHint 로 반환
//     동기화가 엉뚱한 기수에 시트 내용을 밀어넣지 못하게 막는 안전장치
//
// 핵심 변경 (v23):
//   - 출석부(DB) 의 날짜 헤더 바로 윗줄을 '강의명 행'으로 읽어 sessionLabels 로 반환
//     (김밥 탭이 빈 새 기수에서도 교제·나눔 주차를 정확히 알 수 있다)
//   - 날짜 헤더를 항상 MM/DD 로 정규화 ('9/6' 도 '09/06' 으로)
//
// 핵심 변경 (v22): 시트 ID·탭 이름을 상단 상수로 분리 (기수 전환 시 한 줄만 수정)
//
// 핵심 변경 (v21):
//   - doPost가 배치 저장 지원: { batch: [{name, phone, status}, ...] }
//     ID→행 인덱스를 한 번만 만들고 컬럼 전체를 1회 read/write → 조 단위 저장이 빠름
//     기존 단건 { name, phone, status } 형식도 그대로 동작
//
//   - 출석체크·조회는 '가장 최근 지난 강의' 컬럼 기준으로 동작
//     예) 3/15와 3/22 세션이 있고 오늘이 3/18이면 → 3/15에 기록·조회
//     예) 오늘이 3/22면 → 3/22에 기록·조회
//     예) 오늘이 7/22이고 시트의 마지막 컬럼이 7/12면 → 7/12에 기록·조회
//   - 세션 목록의 유일 기준은 '출석부(DB)' 시트의 헤더 행
//     (팬텀 컬럼을 남기지 않으려면 관리자가 시트에서 삭제)
//   - 강의 없는 날 새 컬럼을 자동 생성하지 않음
//
// 신규 반환 필드 (v18~):
//   - kimbap:   { id: { "교리1": {applied, date}, "교리2": {...}, ... } }
//   - homework: { id: [ {session, type, url, completion, submittedAt}, ... ] }
//
// 김밥 시트 구조:
//   Row N (index kbHeaderRow):  A-F=meta(1차,2차,수량,Team,ID,role), G+=세션명(교리1..)
//   Row N+1:                    G+=날짜 (03/15, 03/21, ...)
//   Row N+2 이후:                실제 인원 데이터
//
// 과제 시트 구조:
//   Row 1: 헤더 (타임스탬프, 아이디, 연락처, 성별, 몇 강, 어떤 과제, 제출 URL, 수료여부)
//   Row 2+: 폼 응답 (한 사람이 여러 행 가능)

// ---------------------------------------------------------------------------
// 이 기수의 스프레드시트 ID.
// 기수가 바뀌어 새 시트를 쓰게 되면 이 한 줄만 바꾸고 재배포하면 된다.
// (지난 기수 시트는 건드리지 않고 그대로 얼려 둔다)
// ---------------------------------------------------------------------------
var SHEET_ID = "12fuduQjWE00i3-t9vYe7eh0TEoQ9tsX2hb1TQzxmDQM";

// 탭 이름
var TAB_ROSTER   = "출석부(DB)";
var TAB_KIMBAP   = "김밥";
var TAB_HOMEWORK = "과제";

// ============================================================================
// 아이디 정형화
//
// 아이디는 '이름 + 전화 뒷 4자리' 다. 사람이 손으로도 적고 구글 폼으로도
// 들어와서 실제로는 제각각이다 —
//   '김도현 5326'  '김도현-5326'  '김도현(5326)'  '김도현.5326'  '김도현５３２６'
//
// 한글·영문·숫자만 남기고 나머지는 버린다. 전각 숫자는 반각으로 바꾼다.
//
// ⚠️ 양쪽을 같은 규칙으로 다듬어야 한다.
//    한쪽(과제 탭)만 다듬으면 명단 쪽 아이디에 기호가 있을 때 오히려 어긋난다.
//    그래서 이 함수를 아이디를 만들고 맞추는 모든 자리에서 쓴다.
// ============================================================================
function plcNormalizeId_(v) {
  return String(v == null ? "" : v)
    .replace(/[\uFF10-\uFF19]/g, function (d) {          // 전각 0-9 → 반각
      return String.fromCharCode(d.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[^0-9A-Za-z\uAC00-\uD7A3]/g, "");          // 한글·영문·숫자만
}


var TAB_LINKS    = "새가족링크";

// 가장 최근 지난 (오늘 포함) 세션 컬럼 index. 없으면 -1.
// 유일 기준: '출석부(DB)' 시트의 헤더 행 (외부 필터 없음).
function findRecentPastSessionCol_(headers, todayNorm) {
  var bestIdx = -1;
  var bestDate = null;
  for (var k = 0; k < headers.length; k++) {
    var hValue = headers[k];
    var dateObj = null;
    if (hValue instanceof Date) {
      dateObj = new Date(hValue.getFullYear(), hValue.getMonth(), hValue.getDate());
    } else {
      var s = String(hValue || '').trim();
      var m1 = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      var m2 = s.match(/(\d{1,2})[\/\.\-](\d{1,2})/);
      if (m1) {
        dateObj = new Date(parseInt(m1[1],10), parseInt(m1[2],10)-1, parseInt(m1[3],10));
      } else if (m2) {
        dateObj = new Date(todayNorm.getFullYear(), parseInt(m2[1],10)-1, parseInt(m2[2],10));
      }
    }
    if (!dateObj) continue;
    if (dateObj.getTime() <= todayNorm.getTime()) {
      if (!bestDate || dateObj.getTime() > bestDate.getTime()) {
        bestDate = dateObj;
        bestIdx = k;
      }
    }
  }
  return bestIdx;
}

// ═══════════════════════════════════════════════════════════════════════════
// 출석 쓰기 (앱 → 시트 → DB)
//
// 출결의 원본은 시트다. 앱은 DB 를 직접 쓰지 않고 이 함수를 부른다.
// 그래야 앱과 시트 양쪽에서 입력해도 저장소가 하나로 유지된다 —
// 두 곳에서 같은 값을 쓰면 어느 쪽이 최신인지 판단할 근거가 없어 반드시 어긋난다.
//
// 순서가 중요하다.
//   1) 시트에 쓴다        ← 원본. 여기까지 됐으면 데이터는 안전하다.
//   2) DB 에 밀어넣는다   ← 사본. 실패해도 잃는 것이 없다.
// 2 가 실패하면 pushAttendanceToDb 트리거가 다음 차례에 맞춰 준다.
// 그래서 2 의 실패는 저장 실패로 치지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

// pullAttendance.js 와 같은 값이어야 한다.
// 두 파일이 한 프로젝트에 있으면 var 가 겹치는데, 값이 같으면 어느 쪽이 이기든 같다.
var PLC_SUPABASE_URL = "https://wvpqdicsqjozhxtxsnin.supabase.co";
var PLC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w";

// DB(set_attendance_batch)가 받는 값과 같아야 한다.
var PLC_ALLOWED_STATUS = { "O": 1, "X": 1, "\u25ce": 1, "\uacfc\uc81c": 1, "-": 1, "": 1 };

function plcSbHeaders_() {
  return {
    apikey: PLC_SUPABASE_ANON_KEY,
    Authorization: "Bearer " + PLC_SUPABASE_ANON_KEY
  };
}

function plcSbGet_(path) {
  var res = UrlFetchApp.fetch(PLC_SUPABASE_URL + "/rest/v1/" + path, {
    headers: plcSbHeaders_(), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("Supabase " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

function plcSbRpc_(fn, args) {
  var res = UrlFetchApp.fetch(PLC_SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "post",
    contentType: "application/json",
    headers: plcSbHeaders_(),
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    throw new Error("Supabase RPC " + code + ": " + res.getContentText().slice(0, 200));
  }
  var body = res.getContentText();
  return body ? JSON.parse(body) : null;
}

// 기수·인원·세션. 저장할 때마다 받으면 왕복이 늘어 느려지므로 10분 캐시한다.
// 명단이 바뀌어도 10분이면 따라잡는다.
function plcRefs_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("plc_refs");
  if (hit) return JSON.parse(hit);

  var cohorts = plcSbGet_("cohorts?select=id&is_active=is.true&order=started_at.desc.nullslast&limit=1");
  if (!cohorts.length) throw new Error("활성 기수가 지정돼 있지 않습니다 (cohorts.is_active).");
  var cohortId = cohorts[0].id;
  var enc = encodeURIComponent(cohortId);

  var members  = plcSbGet_("members?select=id,name,phone&cohort_id=eq." + enc + "&limit=2000");
  var sessions = plcSbGet_("sessions?select=session_date&cohort_id=eq." + enc + "&limit=2000");

  var byId = {};
  for (var i = 0; i < members.length; i++) {
    var k = plcNormalizeId_(String(members[i].name || "") + String(members[i].phone || ""));
    if (k) byId[k] = members[i].id;
  }
  var dates = {};   // MM/DD → YYYY-MM-DD
  for (var j = 0; j < sessions.length; j++) {
    var d = String(sessions[j].session_date || "");
    var m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) dates[m[2] + "/" + m[3]] = d;
  }

  var refs = { cohortId: cohortId, byId: byId, dates: dates };
  cache.put("plc_refs", JSON.stringify(refs), 600);
  return refs;
}

// 헤더 칸을 MM/DD 로 통일한다.
function plcHeaderKey_(raw, tz) {
  var v = (raw instanceof Date ? Utilities.formatDate(raw, tz, "MM/dd") : String(raw || "")).trim();
  var pad = function (n) { return ("0" + n).slice(-2); };
  var m = v.match(/^(\d{1,2})[\/\.\-](\d{1,2})$/);
  if (m) return pad(m[1]) + "/" + pad(m[2]);
  var m3 = v.match(/^(\d{4})[.\/\-]\s*(\d{1,2})[.\/\-]\s*(\d{1,2})\.?$/);
  if (m3) return pad(m3[2]) + "/" + pad(m3[3]);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 시트 → DB 동기화를 앱에서 요청받는다
//
// 명단·편성·위치·과제·김밥은 하루 한 번(정오)만 들어온다. 시트에서 고친 것을
// 바로 보려면 GitHub Actions 의 워크플로를 돌려야 하는데, 그러려면 토큰이 있어야 한다.
// 그 토큰을 앱에 넣을 수는 없다 — 공개 저장소의 JS 는 누구나 읽는다.
//
// 그래서 GAS 가 대신 부른다. 토큰은 코드가 아니라 스크립트 속성에 둔다.
//   Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성
//     GH_TOKEN  = GitHub 파인그레인드 토큰 (이 저장소의 Actions: read and write)
//     GH_REPO   = dev-plc/plc-class-finder      (없으면 아래 기본값)
//     GH_WORKFLOW = sync-db.yml                 (없으면 아래 기본값)
//
// 이 URL 은 인증이 없으므로 누구나 부를 수 있다. 다만 이 동작이 하는 일은
// 시트를 DB 로 옮기는 것뿐이고 워크플로에 동시성 제한이 걸려 있어 겹치지 않는다.
// 그래도 실수로 연타하는 것은 막는다 — 1분에 한 번으로 묶는다.
// ═══════════════════════════════════════════════════════════════════════════
var PLC_GH_REPO_DEFAULT = "dev-plc/plc-class-finder";
var PLC_GH_WORKFLOW_DEFAULT = "sync-db.yml";
var PLC_SYNC_MIN_INTERVAL_MS = 60 * 1000;

// 출석은 여기서 다루지 않는다. 시트에 붙은 프로젝트의 10분 트리거
// (pushAttendanceToDb)가 가져온다 — 이 파일과는 다른 프로젝트라 부를 수도 없다.
// 여기가 요청하는 것은 명단·편성·위치·과제 제출기록·김밥이다.
function plcRequestSync_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GH_TOKEN");
  if (!token) {
    return { success: false, message: "GH_TOKEN 이 없습니다. Apps Script → 프로젝트 설정 → 스크립트 속성에 넣어 주세요." };
  }

  // 연타 방지. 마지막 요청 시각을 캐시에 둔다 (스크립트 속성은 쓰기가 느리다).
  var cache = CacheService.getScriptCache();
  if (cache.get("plc_sync_recent")) {
    return { success: false, message: "방금 요청했습니다. 1분 뒤에 다시 눌러 주세요." };
  }

  var repo = props.getProperty("GH_REPO") || PLC_GH_REPO_DEFAULT;
  var wf = props.getProperty("GH_WORKFLOW") || PLC_GH_WORKFLOW_DEFAULT;

  var res = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + repo + "/actions/workflows/" + wf + "/dispatches", {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      // 입력은 비운다 — 기본값(기수 자동, 출석 가져오기 꺼짐)이 평소 설정이다
      payload: JSON.stringify({ ref: "main", inputs: {} }),
      muteHttpExceptions: true
    });

  var code = res.getResponseCode();
  if (code === 204) {
    cache.put("plc_sync_recent", "1", Math.ceil(PLC_SYNC_MIN_INTERVAL_MS / 1000));
    return { success: true, message: "동기화를 요청했습니다. 보통 1~2분 걸립니다." };
  }
  if (code === 401 || code === 403) {
    return { success: false, message: "GitHub 토큰이 거부됐습니다 (" + code + "). 권한(Actions: read and write)과 만료일을 확인하세요." };
  }
  if (code === 404) {
    return { success: false, message: "워크플로를 찾지 못했습니다. GH_REPO / GH_WORKFLOW 를 확인하세요 (" + repo + " · " + wf + ")." };
  }
  return { success: false, message: "GitHub " + code + ": " + res.getContentText().slice(0, 200) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 권한 승인용 — 편집기에서 한 번 실행하세요
//
// GAS 는 코드가 쓰는 기능에 맞춰 권한을 요구하는데, 그 승인은 사람이
// 편집기에서 함수를 실행할 때만 받을 수 있다. doGet/doPost 는 URL 로 불리므로
// 승인 창을 띄울 자리가 없다 — 그래서 권한 없이 배포되면 조용히 실패한다.
//
// 증상: "UrlFetchApp.fetch 을 호출할 수 있는 권한이 없습니다"
//       또는 앱에서 출석은 저장되는데 DB 반영만 계속 늦는다
//       (doPost 는 DB 실패를 삼키므로 눈에 안 띈다)
//
// 이 함수를 편집기에서 ▶ 실행 → 승인 창에서 허용 → 그다음 웹 앱을 재배포.
// 순서가 중요하다. 승인 없이 재배포하면 그대로다.
function plcAuthorize() {
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty("GH_REPO") || PLC_GH_REPO_DEFAULT;
  var wf = props.getProperty("GH_WORKFLOW") || PLC_GH_WORKFLOW_DEFAULT;
  var token = props.getProperty("GH_TOKEN");
  var lines = [];

  // ── 시트
  try {
    lines.push("시트 접근    : ✅ " + SpreadsheetApp.openById(SHEET_ID).getName());
  } catch (e) {
    lines.push("시트 접근    : ❌ " + e.message);
  }

  // ── 외부 요청 (Supabase 로 확인한다)
  //    GitHub 의 미인증 주소로 확인하면 안 된다 — Google 서버 IP 는 공용이라
  //    미인증 한도에 걸려 403 이 나고, 권한 문제로 오해하게 된다.
  try {
    var sb = UrlFetchApp.fetch(PLC_SUPABASE_URL + "/rest/v1/cohorts?select=id&limit=1", {
      headers: plcSbHeaders_(), muteHttpExceptions: true
    });
    lines.push("외부 요청    : " + (sb.getResponseCode() === 200
      ? "✅ Supabase 응답 정상"
      : "❌ Supabase " + sb.getResponseCode() + " — " + sb.getContentText().slice(0, 120)));
  } catch (e) {
    lines.push("외부 요청    : ❌ " + e.message);
  }

  // ── GitHub 토큰·저장소·워크플로 (동기화 버튼이 실제로 쓰는 길)
  if (!token) {
    lines.push("GitHub       : ❌ GH_TOKEN 이 없습니다 (스크립트 속성에 넣으세요)");
  } else {
    var gh = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28" };
    try {
      var r1 = UrlFetchApp.fetch("https://api.github.com/repos/" + repo,
                                 { headers: gh, muteHttpExceptions: true });
      if (r1.getResponseCode() === 200) {
        lines.push("GitHub 저장소: ✅ " + repo);
        var r2 = UrlFetchApp.fetch(
          "https://api.github.com/repos/" + repo + "/actions/workflows/" + wf,
          { headers: gh, muteHttpExceptions: true });
        lines.push("GitHub 워크플로: " + (r2.getResponseCode() === 200
          ? "✅ " + wf
          : "❌ " + r2.getResponseCode() + " — " + wf + " 를 찾지 못했습니다"));
      } else if (r1.getResponseCode() === 401) {
        lines.push("GitHub 저장소: ❌ 401 — 토큰이 잘못됐거나 만료됐습니다");
      } else if (r1.getResponseCode() === 404) {
        lines.push("GitHub 저장소: ❌ 404 — " + repo + " 가 없거나 토큰에 포함되지 않았습니다");
      } else {
        lines.push("GitHub 저장소: ❌ " + r1.getResponseCode() + " — " + r1.getContentText().slice(0, 120));
      }
    } catch (e) {
      lines.push("GitHub       : ❌ " + e.message);
    }
  }

  lines.push("");
  lines.push("설정값  GH_REPO=" + repo + "  GH_WORKFLOW=" + wf);
  lines.push("전부 ✅ 면 웹 앱을 재배포하세요 (배포 관리 → 연필 → 버전: 새 버전).");

  var msg = lines.join("\n");
  Logger.log(msg);
  return msg;
}

function doPost(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 33;
  var fail = function (msg) {
    return output.setContent(JSON.stringify({ success: false, version: currentVersion, message: msg }));
  };

  // 동기화 요청은 시트를 건드리지 않는다. 잠금을 잡기 전에 처리한다 —
  // 출석 저장이 진행 중이어도 막힐 이유가 없다.
  try {
    var probe = JSON.parse(e.postData.contents);
    if (probe && probe.action === "sync") {
      var r = plcRequestSync_();
      return output.setContent(JSON.stringify({
        success: r.success, version: currentVersion, message: r.message
      }));
    }
  } catch (probeErr) {
    return fail("요청을 읽지 못했습니다: " + probeErr.message);
  }

  // 컬럼을 통째로 읽어 메모리에서 고치고 다시 쓴다.
  // 두 튜터가 같은 시각에 저장하면 나중 사람이 먼저 사람의 변경을 덮어쓰고,
  // 오류도 나지 않아 사라진 줄도 모른다. 그래서 잠근다.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return fail("다른 저장이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.");
  }

  try {
    var postData = JSON.parse(e.postData.contents);

    var entries = Array.isArray(postData.batch)
      ? postData.batch
      : [{ name: postData.name, phone: postData.phone, status: postData.status }];
    if (!entries.length) return fail("변경할 항목이 없습니다.");

    // 값 검증. 배포 URL 은 공개돼 있으므로 아무 문자열이나 시트에 들어가면 안 된다.
    for (var v = 0; v < entries.length; v++) {
      var st = String((entries[v] || {}).status == null ? "" : entries[v].status).trim().toUpperCase();
      if (!PLC_ALLOWED_STATUS.hasOwnProperty(st)) {
        return fail("허용되지 않는 출석 값입니다: " + st);
      }
      entries[v].status = st;
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_ROSTER);
    if (!sheet) throw new Error("'" + TAB_ROSTER + "' 시트를 찾을 수 없습니다.");
    var tz = Session.getScriptTimeZone();

    // 헤더 행의 'id' 칸을 찾는다. 컬럼 순서가 바뀌어도 따라간다.
    // 폭을 26(A~Z)으로 고정하면 ID 열이 그 뒤로 밀렸을 때 못 찾는다 —
    // 출석부는 정보 16칸 + 주차 18칸이라 금방 Z 를 넘는다.
    var idCell = sheet.getRange(1, 1, 5, Math.max(sheet.getLastColumn(), 1))
      .createTextFinder("id").matchCase(false).matchEntireCell(true).findNext();
    if (!idCell) throw new Error("'id' 열을 찾을 수 없습니다.");

    var headerRow = idCell.getRow();
    var idCol = idCell.getColumn();
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var originalHeaders = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

    // 어느 주차에 쓸지. 앱이 session(YYYY-MM-DD) 을 보내면 그 주차,
    // 없으면 예전처럼 '가장 최근 지난 강의' 로 떨어진다.
    var wantIso = String(postData.session || "").trim();
    var attendanceCol = -1;
    if (wantIso) {
      var wm = wantIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!wm) return fail("session 은 YYYY-MM-DD 형식이어야 합니다: " + wantIso);
      var wantKey = wm[2] + "/" + wm[3];
      for (var c = 0; c < originalHeaders.length; c++) {
        if (plcHeaderKey_(originalHeaders[c], tz) === wantKey) { attendanceCol = c; break; }
      }
      if (attendanceCol === -1) return fail("시트에서 " + wantKey + " 컬럼을 찾지 못했습니다.");
    } else {
      var today = new Date();
      attendanceCol = findRecentPastSessionCol_(
        originalHeaders, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
      if (attendanceCol === -1) return fail("출석 대상 강의를 찾지 못했습니다.");
    }
    var sessionKey = plcHeaderKey_(originalHeaders[attendanceCol], tz);
    attendanceCol = attendanceCol + 1; // 1-based

    var lastRow = sheet.getLastRow();
    if (lastRow <= headerRow) return fail("데이터 행이 없습니다.");

    // ── 1) 시트에 쓴다 (원본)
    var rowCount = lastRow - headerRow;
    var idValues = sheet.getRange(headerRow + 1, idCol, rowCount, 1).getValues();
    var idToRow = {};
    for (var i = 0; i < idValues.length; i++) {
      var key = plcNormalizeId_(idValues[i][0]);
      if (key) idToRow[key] = headerRow + 1 + i;
    }

    var colValues = sheet.getRange(headerRow + 1, attendanceCol, rowCount, 1).getValues();
    var updated = 0;
    var notFound = [];
    var wrote = [];       // DB 로 넘길 목록
    for (var j = 0; j < entries.length; j++) {
      var en = entries[j] || {};
      var targetId = plcNormalizeId_(String(en.name || "") + String(en.phone || ""));
      var rowNum = idToRow[targetId];
      if (!rowNum) { notFound.push(targetId); continue; }
      colValues[rowNum - (headerRow + 1)][0] = en.status;
      wrote.push({ id: targetId, status: en.status });
      updated++;
    }

    if (updated > 0) {
      sheet.getRange(headerRow + 1, attendanceCol, rowCount, 1).setValues(colValues);
    }

    // ── 2) DB 에 밀어넣는다 (사본). 실패해도 저장 자체는 성공이다.
    var dbSynced = 0;
    var dbError = "";
    if (updated > 0) {
      try {
        var refs = plcRefs_();
        var iso = wantIso || refs.dates[sessionKey];
        if (!iso) throw new Error(sessionKey + " 에 해당하는 세션이 DB 에 없습니다.");
        var payload = [];
        for (var w = 0; w < wrote.length; w++) {
          var uuid = refs.byId[wrote[w].id];
          if (uuid) payload.push({ member_id: uuid, status: wrote[w].status });
        }
        if (payload.length) {
          var r = plcSbRpc_("set_attendance_batch", { p_session_date: iso, p_entries: payload });
          dbSynced = (r && r.updated) || payload.length;
        }
      } catch (dbErr) {
        dbError = dbErr.message;   // 트리거가 다음 차례에 맞춰 준다
      }
    }

    return output.setContent(JSON.stringify({
      success: updated > 0,
      version: currentVersion,
      updated: updated,
      total: entries.length,
      notFound: notFound,
      session: sessionKey,
      sessionDate: wantIso || sessionKey,
      dbSynced: dbSynced,
      dbError: dbError,
      message: updated > 0
        ? (sessionKey + " 출석 " + updated + "건 저장" + (dbError ? " (DB 반영은 잠시 뒤)" : ""))
        : "일치하는 ID가 없습니다."
    }));
  } catch (err) {
    return fail(err.message);
  } finally {
    lock.releaseLock();
  }
}

// 이 응답을 아무나 받으면 안 된다.
//
// doGet 은 명단 전체를 돌려준다 — 이름·연락처·나이·조·위치까지.
// 웹앱 URL 은 인증이 없고, 그 URL 은 공개 저장소에 적혀 있다.
// 토큰을 모르면 아무것도 주지 않는다.
//
// 토큰은 코드에 적지 않는다 (이 파일도 공개 저장소에 있다).
// Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에
//   API_TOKEN = <아무 긴 문자열>
// 을 넣고, 같은 값을 GitHub Secrets 의 GAS_API_TOKEN 에 넣는다.
//
// 속성을 설정하지 않으면 검사를 건너뛴다 — 설정 전에 동기화가 죽지 않게.
// 설정한 뒤에는 반드시 맞아야 한다.
function plcCheckToken_(e) {
  var want = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  if (!want) return true;                       // 아직 설정 전
  var got = (e && e.parameter && e.parameter.token) || "";
  return got === want;
}

function doGet(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 33; // + doGet 토큰 · 권한 점검 · 아이디 정형화 · '과제' 값

  if (!plcCheckToken_(e)) {
    return output.setContent(JSON.stringify({
      success: false, version: currentVersion,
      message: "토큰이 필요합니다. GAS 스크립트 속성 API_TOKEN 과 GitHub Secrets GAS_API_TOKEN 을 맞추세요."
    }));
  }

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var tz = Session.getScriptTimeZone();
    var today = new Date();
    var todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // =========================================================
    // 김밥 탭 — 세션별 신청 현황 + 오늘의 요약
    // =========================================================
    var kimbapMap = {};    // 기존 호환: { id: "O"|"X" } (가장 가까운 예정 세션)
    var kimbapDetail = {}; // 신규: { id: { "교리1": {applied, date}, ... } }
    var kimbapSheet = ss.getSheetByName(TAB_KIMBAP);
    if (kimbapSheet) {
      var kbData = kimbapSheet.getDataRange().getValues();

      // "ID" 라벨이 있는 행 = 세션명 행
      var kbHeaderRow = -1;
      for (var i = 0; i < Math.min(6, kbData.length); i++) {
        var idPos = kbData[i]
          .map(function(h){ return String(h).trim().toLowerCase(); })
          .indexOf("id");
        if (idPos !== -1) { kbHeaderRow = i; break; }
      }

      if (kbHeaderRow !== -1) {
        var idCol = kbData[kbHeaderRow]
          .map(function(h){ return String(h).trim().toLowerCase(); })
          .indexOf("id");

        // "ID" 라벨이 있는 행이 세션명 행인지 날짜 행인지 판별 필요.
        // 3개 후보 행 (idRow-1, idRow, idRow+1) 중 세션명·날짜 패턴 스코어 최대인 행 선택.
        var isSessionValue = function(v) {
          var s = String(v || '').trim();
          return /^교리\s*\d+/.test(s) || /^대화\s*\d+/.test(s)
              || /^성경적대화\s*\d+/.test(s) || /^교제/.test(s)
              || /^교재/.test(s) || /^나눔/.test(s);
        };
        var isDateValue = function(v) {
          if (v instanceof Date) return true;
          var s = String(v || '').trim();
          return /^\d{1,2}[\/\.\-]\d{1,2}/.test(s);
        };

        var candidates = [kbHeaderRow - 1, kbHeaderRow, kbHeaderRow + 1];
        var bestSessionIdx = kbHeaderRow, bestSessionScore = -1;
        var bestDateIdx    = kbHeaderRow + 1, bestDateScore = -1;
        candidates.forEach(function(ri) {
          if (ri < 0 || ri >= kbData.length) return;
          var row = kbData[ri];
          var sScore = 0, dScore = 0;
          for (var c = idCol + 1; c < row.length; c++) {
            if (isSessionValue(row[c])) sScore++;
            if (isDateValue(row[c])) dScore++;
          }
          if (sScore > bestSessionScore) { bestSessionScore = sScore; bestSessionIdx = ri; }
          if (dScore > bestDateScore) { bestDateScore = dScore; bestDateIdx = ri; }
        });
        // 세션 행과 날짜 행이 겹치면 안 됨 — 겹치면 다른 후보 선택
        if (bestSessionIdx === bestDateIdx) {
          if (bestSessionIdx > 0) bestSessionIdx--; else bestSessionIdx++;
        }

        var sessionRow = kbData[bestSessionIdx];
        var dateRow    = kbData[bestDateIdx] || [];

        // 세션 컬럼 목록 (세션명이 있는 컬럼만)
        var sessionCols = [];
        for (var c = idCol + 1; c < sessionRow.length; c++) {
          var sRaw = sessionRow[c];
          var sName = "";
          if (sRaw instanceof Date) {
            // Date를 라벨로 쓰지 않음 — 정규화 실패 신호
            sName = Utilities.formatDate(sRaw, tz, "M/d");
          } else {
            sName = String(sRaw || "").trim();
          }
          if (!sName) continue;
          if (sName.toLowerCase() === "role") continue;

          var dv = dateRow[c];
          var dateStr = "";
          if (dv instanceof Date) {
            dateStr = Utilities.formatDate(dv, tz, "M/d");
          } else if (dv) {
            var s = String(dv).trim();
            // Date를 toString한 문자열이라면 파싱해서 M/d로
            var asDate = new Date(s);
            if (!isNaN(asDate.getTime()) && s.length > 15) {
              dateStr = Utilities.formatDate(asDate, tz, "M/d");
            } else {
              dateStr = s;
            }
          }
          sessionCols.push({ col: c, name: sName, date: dateStr });
        }

        // 오늘 이후 가장 가까운 세션 인덱스 (기존 호환)
        var targetIdx = -1;
        var minDiff = Infinity;
        for (var i = 0; i < sessionCols.length; i++) {
          var dstr = sessionCols[i].date;
          if (!dstr) continue;
          var m1 = dstr.match(/(\d{4})[.\/\-]\s*(\d{1,2})[.\/\-]\s*(\d{1,2})/);
          var m2 = dstr.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
          var d = null;
          if (m1) {
            d = new Date(parseInt(m1[1],10), parseInt(m1[2],10)-1, parseInt(m1[3],10));
          } else if (m2) {
            d = new Date(todayNorm.getFullYear(), parseInt(m2[1],10)-1, parseInt(m2[2],10));
          }
          if (!d) continue;
          var diff = d.getTime() - todayNorm.getTime();
          if (diff >= 0 && diff < minDiff) {
            minDiff = diff;
            targetIdx = i;
          }
        }

        // 데이터 행은 세 행(session, date, id) 중 가장 큰 index 다음부터
        var dataStartRow = Math.max(kbHeaderRow, bestSessionIdx, bestDateIdx) + 1;
        for (var r = dataStartRow; r < kbData.length; r++) {
          var row = kbData[r];
          var id = plcNormalizeId_(row[idCol]);
          if (!id) continue;

          var detail = {};
          for (var i = 0; i < sessionCols.length; i++) {
            var sc = sessionCols[i];
            var v = row[sc.col];
            var applied = (v === 1 || String(v).trim() === "1") ? 1 : 0;
            detail[sc.name] = { applied: applied, date: sc.date };
          }
          kimbapDetail[id] = detail;

          if (targetIdx !== -1) {
            var tv = row[sessionCols[targetIdx].col];
            kimbapMap[id] = (tv === 1 || String(tv).trim() === "1") ? "O" : "X";
          } else {
            kimbapMap[id] = "X";
          }
        }
      }
    }

    // =========================================================
    // 과제 탭 — 폼 응답 로그 (사람당 여러 행 가능)
    // =========================================================
    var homeworkMap = {}; // { id: [ {session, type, url, submittedAt}, ... ] }
    var hwSheet = ss.getSheetByName(TAB_HOMEWORK);
    if (hwSheet) {
      var hwData = hwSheet.getDataRange().getValues();
      if (hwData.length > 1) {
        var hwHeaders = hwData[0].map(function(h){ return String(h).trim(); });
        var hwLower = hwHeaders.map(function(h){ return h.toLowerCase(); });

        var idIdx = -1, sessionIdx = -1, typeIdx = -1, urlIdx = -1, tsIdx = -1, completionIdx = -1;
        for (var k = 0; k < hwHeaders.length; k++) {
          var lh = hwLower[k];
          if (lh === "아이디" || lh === "id") idIdx = k;
          else if (lh.indexOf("몇 강") !== -1 || lh === "강") sessionIdx = k;
          else if (lh.indexOf("어떤 과제") !== -1 || lh === "과제유형") typeIdx = k;
          else if (lh.indexOf("제출") !== -1 && urlIdx === -1) urlIdx = k;
          else if (lh === "타임스탬프" || lh.indexOf("timestamp") !== -1) tsIdx = k;
          else if (lh.indexOf("수료") !== -1) completionIdx = k;
        }

        if (idIdx !== -1) {
          for (var i = 1; i < hwData.length; i++) {
            var row = hwData[i];
            var id = plcNormalizeId_(row[idIdx]);
            if (!id) continue;

            var sub = {
              session: sessionIdx !== -1 ? String(row[sessionIdx] || "").trim() : "",
              type:    typeIdx    !== -1 ? String(row[typeIdx]    || "").trim() : "",
              url:     urlIdx     !== -1 ? String(row[urlIdx]     || "").trim() : "",
              completion: completionIdx !== -1 ? String(row[completionIdx] || "").trim() : "",
              submittedAt: tsIdx !== -1
                ? (row[tsIdx] instanceof Date
                    ? Utilities.formatDate(row[tsIdx], tz, "yyyy-MM-dd HH:mm")
                    : String(row[tsIdx] || ""))
                : ""
            };
            if (!homeworkMap[id]) homeworkMap[id] = [];
            homeworkMap[id].push(sub);
          }
        }
      }
    }

    // =========================================================
    // 새가족링크 탭 (기존 그대로)
    // =========================================================
    var telegramSheet = ss.getSheetByName(TAB_LINKS);
    var telegramMap = {};
    var locationMap = {};
    if (telegramSheet) {
      var telValues = telegramSheet.getDataRange().getValues();
      if (telValues.length > 0) {
        var telHeaderIdx = -1, tTeamIdx = -1, tLinkIdx = -1, tLocIdx = -1, tMapIdx = -1;
        for (var i = 0; i < Math.min(5, telValues.length); i++) {
          var tempHeaders = telValues[i].map(function(h){ return String(h).trim().toLowerCase(); });
          tTeamIdx = tempHeaders.indexOf("team");
          tLinkIdx = tempHeaders.indexOf("link");
          tLocIdx  = tempHeaders.indexOf("location");
          tMapIdx  = tempHeaders.indexOf("map");
          if (tTeamIdx !== -1 || tLinkIdx !== -1 || tLocIdx !== -1 || tMapIdx !== -1) {
            telHeaderIdx = i; break;
          }
        }
        if (telHeaderIdx !== -1) {
          for (var r = telHeaderIdx + 1; r < telValues.length; r++) {
            if (tTeamIdx !== -1 && tLinkIdx !== -1) {
              var tName = String(telValues[r][tTeamIdx]).trim();
              if (tName) telegramMap[tName] = String(telValues[r][tLinkIdx]).trim();
            }
            if (tLocIdx !== -1 && tMapIdx !== -1) {
              var locName = String(telValues[r][tLocIdx]).trim();
              if (locName) locationMap[locName] = String(telValues[r][tMapIdx]).trim();
            }
          }
        }
      }
    }

    // =========================================================
    // 출석부(DB) 탭 (기존 그대로)
    // =========================================================
    var sheet = ss.getSheetByName(TAB_ROSTER);
    if (!sheet) throw new Error("'출석부(DB)' 시트를 찾을 수 없습니다.");
    var data = sheet.getDataRange().getValues();

    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(5, data.length); i++) {
      var tempStrs = data[i].map(function(h){ return String(h).trim().toLowerCase(); });
      if (tempStrs.indexOf("id") !== -1) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");

    var originalHeadersRaw = data[headerRowIdx];
    // 날짜 헤더는 항상 MM/DD 로 통일한다.
    // 시트에 '9/6' 로 적혀 있든 진짜 날짜값이든 같은 키가 나오게 해야
    // 동기화 쪽에서 세션을 놓치지 않는다.
    var pad2_ = function(n){ return ("0" + n).slice(-2); };
    var headers = originalHeadersRaw.map(function(h){
      var v = (h instanceof Date ? Utilities.formatDate(h, tz, "MM/dd") : String(h)).trim();
      // '9/6', '09/06', '9-6'
      var m = v.match(/^(\d{1,2})[\/\.\-](\d{1,2})$/);
      if (m) return pad2_(m[1]) + "/" + pad2_(m[2]);
      // '2026. 9. 6' 처럼 연도까지 적힌 텍스트
      var m3 = v.match(/^(\d{4})[.\/\-]\s*(\d{1,2})[.\/\-]\s*(\d{1,2})\.?$/);
      if (m3) return pad2_(m3[2]) + "/" + pad2_(m3[3]);
      return v.toLowerCase();
    });
    var idIdx = headers.indexOf("id");

    // ---------------------------------------------------------
    // 기수 표식 — 출석부 상단 아무 칸에 '3기' 처럼 적어 두면 그 값을 넘긴다.
    // 동기화 쪽에서 대상 기수와 다르면 멈춘다.
    // (시트는 3기로 갈아엎었는데 동기화가 2기로 돌아 명단을 엉뚱한 기수에
    //  밀어넣는 사고를 구조적으로 막는다)
    // ---------------------------------------------------------
    var cohortHint = "";
    for (var cr = 0; cr < Math.min(6, data.length) && !cohortHint; cr++) {
      for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
        var cv = String(data[cr][cc] || '').trim();
        if (/^\d+\s*기$/.test(cv)) { cohortHint = cv.replace(/\s+/g, ''); break; }
      }
    }

    // ---------------------------------------------------------
    // 강의명 행 — 날짜 헤더 바로 위에 '교리1, 교리2, 교제, …' 를 적어 두면
    // 그 값을 그대로 쓴다.
    //
    // 예전에는 김밥 탭에서 세션명을 유추했는데, 김밥 탭이 비어 있는
    // 새 기수에서는 교제·나눔 주차를 알 수 없어 라벨이 밀린다.
    // 출석부에 직접 적는 쪽이 명확하고 기수마다 안전하다.
    // ---------------------------------------------------------
    var sessionLabels = {};
    var looksLikeSessionName = function(v) {
      var t = String(v || '').trim();
      return /^교리\s*\d+/.test(t) || /^성경적대화\s*\d+/.test(t) || /^대화\s*\d+/.test(t)
          || /^교제/.test(t) || /^교재/.test(t) || /^나눔/.test(t);
    };
    for (var nr = headerRowIdx - 1; nr >= 0; nr--) {
      var nameRow = data[nr];
      var hits = 0;
      for (var nc = 0; nc < headers.length; nc++) {
        if (/^\d{2}\/\d{2}$/.test(headers[nc]) && looksLikeSessionName(nameRow[nc])) hits++;
      }
      if (hits >= 2) {
        for (var nc2 = 0; nc2 < headers.length; nc2++) {
          if (/^\d{2}\/\d{2}$/.test(headers[nc2])) {
            var nm = String(nameRow[nc2] || '').trim();
            if (nm) sessionLabels[headers[nc2]] = nm;
          }
        }
        break;
      }
    }

    // '가장 최근 지난 강의' 컬럼 (출석부(DB) 헤더 기준)
    var todayIdx = findRecentPastSessionCol_(originalHeadersRaw, todayNorm);

    var jsonData = [];
    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var rawId = plcNormalizeId_(data[i][idIdx]);
      if (!rawId) continue;

      var obj = {};
      if (rawId.length > 4) {
        obj["name"] = rawId.slice(0, -4);
        obj["phone"] = rawId.slice(-4);
      } else {
        obj["name"] = rawId; obj["phone"] = "";
      }
      obj["id"] = rawId;

      var attVal = (todayIdx !== -1) ? data[i][todayIdx] : "";
      obj["attendance"] = attVal instanceof Date ? Utilities.formatDate(attVal, tz, "yyyy-MM-dd") : String(attVal).trim();

      headers.forEach(function(h, idx){
        if (h && h !== "id") {
          var cellVal = data[i][idx];
          obj[h] = cellVal instanceof Date ? Utilities.formatDate(cellVal, tz, "yyyy-MM-dd") : String(cellVal).trim();
        }
      });
      obj["telegramLink"] = telegramMap[obj["team"]] || "";
      obj["lunch"] = kimbapMap[obj["id"]] || "X";

      jsonData.push(obj);
    }

    return output.setContent(JSON.stringify({
      success: true,
      version: currentVersion,
      data: jsonData,
      locationMap: locationMap,
      teamLinks: telegramMap,
      kimbap: kimbapDetail,     // 신규
      homework: homeworkMap,    // 신규
      sessionLabels: sessionLabels, // { "03/15": "교리1", ... } 출석부의 강의명 행
      cohortHint: cohortHint        // '3기' — 시트가 어느 기수인지
    }));
  } catch (e) {
    return output.setContent(JSON.stringify({
      success: false, version: currentVersion, message: e.message
    }));
  }
}
