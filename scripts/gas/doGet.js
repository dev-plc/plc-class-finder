// Google Apps Script — doGet + doPost 확장 버전
// 기존 doGet · doPost 함수 전체를 이 코드로 교체.
//
// 핵심 변경 (v20):
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

function doPost(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 20;

  try {
    var postData = JSON.parse(e.postData.contents);
    var name = String(postData.name || "").replace(/\s/g, '');
    var phone = String(postData.phone || "").replace(/[^0-9]/g, '');
    var targetId = name + phone;
    var status = postData.status;

    var ss = SpreadsheetApp.openById("12fuduQjWE00i3-t9vYe7eh0TEoQ9tsX2hb1TQzxmDQM");
    var sheet = ss.getSheetByName("출석부(DB)");
    if (!sheet) throw new Error("'출석부(DB)' 시트를 찾을 수 없습니다.");

    var idCell = sheet.getRange(1, 1, 5, 26).createTextFinder("id").matchCase(false).matchEntireCell(true).findNext();
    if (!idCell) throw new Error("'id' 열을 찾을 수 없습니다.");

    var headerRow = idCell.getRow();
    var idCol = idCell.getColumn();
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var originalHeaders = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

    var tz = Session.getScriptTimeZone();
    var today = new Date();
    var todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // 출석부(DB) 헤더 기준으로 가장 최근 지난 강의 컬럼 찾기
    var attendanceCol = findRecentPastSessionCol_(originalHeaders, todayNorm);
    if (attendanceCol === -1) {
      return output.setContent(JSON.stringify({
        success: false, version: currentVersion,
        message: "출석 대상 강의를 찾지 못했습니다."
      }));
    }
    attendanceCol = attendanceCol + 1; // 1-based

    var lastRow = sheet.getLastRow();
    var isUpdated = false;
    if (lastRow > headerRow) {
      var idRange = sheet.getRange(headerRow + 1, idCol, lastRow - headerRow, 1);
      var foundCell = idRange.createTextFinder(targetId).matchEntireCell(true).findNext();
      if (foundCell) {
        sheet.getRange(foundCell.getRow(), attendanceCol).setValue(status);
        isUpdated = true;
      }
    }

    return output.setContent(JSON.stringify({
      success: isUpdated, version: currentVersion,
      message: isUpdated ? "출석 완료" : "ID 불일치"
    }));
  } catch (e) {
    return output.setContent(JSON.stringify({
      success: false, version: 20, message: e.message
    }));
  }
}

function doGet(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 20; // 최근 지난 강의 기준 + 김밥/과제

  try {
    var ss = SpreadsheetApp.openById("12fuduQjWE00i3-t9vYe7eh0TEoQ9tsX2hb1TQzxmDQM");
    var tz = Session.getScriptTimeZone();
    var today = new Date();
    var todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // =========================================================
    // 김밥 탭 — 세션별 신청 현황 + 오늘의 요약
    // =========================================================
    var kimbapMap = {};    // 기존 호환: { id: "O"|"X" } (가장 가까운 예정 세션)
    var kimbapDetail = {}; // 신규: { id: { "교리1": {applied, date}, ... } }
    var kimbapSheet = ss.getSheetByName("김밥");
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
          var id = String(row[idCol] || "").replace(/\s/g, '');
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
    var hwSheet = ss.getSheetByName("과제");
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
            var id = String(row[idIdx] || "").replace(/\s/g, '');
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
    var telegramSheet = ss.getSheetByName("새가족링크");
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
    var sheet = ss.getSheetByName("출석부(DB)");
    if (!sheet) throw new Error("'출석부(DB)' 시트를 찾을 수 없습니다.");
    var data = sheet.getDataRange().getValues();

    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(5, data.length); i++) {
      var tempStrs = data[i].map(function(h){ return String(h).trim().toLowerCase(); });
      if (tempStrs.indexOf("id") !== -1) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");

    var originalHeadersRaw = data[headerRowIdx];
    var headers = originalHeadersRaw.map(function(h){
      return (h instanceof Date ? Utilities.formatDate(h, tz, "M/d") : String(h)).trim().toLowerCase();
    });
    var idIdx = headers.indexOf("id");

    // '가장 최근 지난 강의' 컬럼 (출석부(DB) 헤더 기준)
    var todayIdx = findRecentPastSessionCol_(originalHeadersRaw, todayNorm);

    var jsonData = [];
    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var rawId = String(data[i][idIdx]).replace(/\s/g, '');
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
      kimbap: kimbapDetail,   // 신규
      homework: homeworkMap   // 신규
    }));
  } catch (e) {
    return output.setContent(JSON.stringify({
      success: false, version: 20, message: e.message
    }));
  }
}
