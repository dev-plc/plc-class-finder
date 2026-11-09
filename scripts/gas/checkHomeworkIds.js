// 과제 아이디 점검 — 시트에 붙은 프로젝트용 (DGfinder v29 에서 가져왔다)
//
// 붙이는 곳: 출석부 스프레드시트 → 확장 프로그램 → Apps Script →
//   pullAttendance.js · homeworkToAttendance.js 가 있는 **그 프로젝트**에 새 파일로.
//   웹앱 프로젝트(doGet.js)가 아니다. 재배포는 필요 없다 — 저장만 하면 된다.
//   이 파일은 homeworkToAttendance.js 의 도우미(normalizeString · htaReadRosterLayout_ ·
//   htaFindHomeworkCols_ · htaHomeworkId_)를 쓴다. 같은 프로젝트에 있어야 한다.
//
// 메뉴: PLC → 과제 아이디 점검  (pullAttendance.js 의 plcAddMenu)
//
// 왜 시트인가
//   아이디가 명단과 안 맞으면 그 사람의 과제가 **조용히** 버려진다. 오류가 안 나서
//   아무도 모르고, 본인은 냈다고 알고 있다. 지금까지는 동기화 로그에 이름을 적었는데
//   저장소가 public 이라 그 로그는 누구나 본다. 이름을 봐도 되는 곳은 시트이고,
//   고칠 대상(과제 탭 · 명단)도 여기 있다. 동기화 로그에는 이제 건수만 남는다.
//
// 갈래 — 손볼 곳이 달라서 나눈다
//   번호가 다름          이름은 명단에 있는데 뒤 4자리가 다르다 → 과제 탭 아이디를 고친다
//   이름 한 글자 차이     뒤 4자리는 맞는다 ('조헤진' vs '조혜진') → 오타다
//   명단에 없음          이번 기수 기간에 냈는데 명단에 없다 → 명단 누락이거나 아이디를 잘못 적었다
//   지난 기수 제출       기수 시작 전에 냈고 명단에 없다 → 대개 그대로 두면 된다
//   제출 시각을 못 읽음   '260920' 처럼 날짜로 읽을 수 없다 → 2026-09-20 처럼 고친다
//                        (명단과 맞는 줄이라도 적는다 — 동기화가 기수를 못 정한다)

var CHK_REPORT_TAB = '과제ID점검';

function plcCheckHomeworkIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();

  // --- 명단 -----------------------------------------------------------------
  var roster = ss.getSheetByName(HTA_TAB_ROSTER);
  if (!roster) return htaTell_("'" + HTA_TAB_ROSTER + "' 탭이 없습니다.");
  var rv = roster.getDataRange().getValues();
  var layout = htaReadRosterLayout_(rv);
  if (!layout) return htaTell_("'" + HTA_TAB_ROSTER + "' 에서 'id' 행이나 강의명 행을 찾지 못했습니다.");

  var known = {};     // 정규화한 아이디 → true
  var byName = {};    // 이름 → [뒤 4자리]
  var byPhone = {};   // 뒤 4자리 → [이름]
  for (var r = layout.firstRow; r < rv.length; r++) {
    var rid = normalizeString(rv[r][layout.idIdx]);
    if (!rid) continue;
    known[rid] = true;
    var m = rid.match(/^(.*?)(\d{4})$/);
    if (!m) continue;
    (byName[m[1]] = byName[m[1]] || []).push(m[2]);
    (byPhone[m[2]] = byPhone[m[2]] || []).push(m[1]);
  }

  // 이 기수가 시작한 달의 1일 — 그 전에 낸 것은 지난 기수 제출로 본다
  // (동기화의 '과제 기준일' 과 같은 기준)
  var boundary = chkCohortStart_(rv[layout.headerRow]);

  // --- 과제 탭 --------------------------------------------------------------
  var hw = ss.getSheetByName(HTA_TAB_HOMEWORK);
  if (!hw) return htaTell_("'" + HTA_TAB_HOMEWORK + "' 탭이 없습니다.");
  var hv = hw.getDataRange().getValues();
  var cols = htaFindHomeworkCols_(hv[0] || []);
  if (cols.id === -1) return htaTell_("'" + HTA_TAB_HOMEWORK + "' 탭에 아이디 열이 없습니다.");

  var rows = [];
  var okCount = 0;
  for (var h = 1; h < hv.length; h++) {
    var raw = String(hv[h][cols.id] == null ? '' : hv[h][cols.id]).trim();
    var id = htaHomeworkId_(hv[h], cols);   // 앱·동기화와 같은 보완 (연락처 뒤 4자리)
    if (!id) continue;

    var when = cols.time !== -1 ? chkReadWhen_(hv[h][cols.time], tz) : { kind: 'none' };
    var lecture = cols.lecture !== -1 ? String(hv[h][cols.lecture] == null ? '' : hv[h][cols.lecture]).trim() : '';
    var shown = when.kind === 'date' ? when.text : when.kind === 'bad' ? '"' + when.raw + '"' : (when.raw || '');

    if (when.kind === 'bad') {
      rows.push(['제출 시각을 못 읽음', h + 1, raw, '날짜로 적어 주세요 (예: 2026-09-20)', lecture, shown]);
    }

    if (known[id]) { okCount++; continue; }

    var mm = id.match(/^(.*?)(\d{4})$/);
    var name = mm ? mm[1] : id;
    var phone = mm ? mm[2] : '';
    var kind, hint = '';

    if (mm && byName[name]) {
      kind = '번호가 다름';
      hint = '명단은 ' + byName[name].map(function (p) { return name + p; }).join(' / ');
    } else {
      var near = (mm && byPhone[phone] || []).filter(function (n) { return chkOneApart_(n, name); });
      if (near.length) {
        kind = '이름 한 글자 차이';
        hint = '명단은 ' + near.map(function (n) { return n + phone; }).join(' / ');
      } else if (when.kind === 'date' && boundary && when.iso < boundary) {
        kind = '지난 기수 제출';
        hint = boundary + ' 전에 냄';
      } else {
        kind = '명단에 없음';
        hint = mm ? '' : '아이디 꼴이 아닙니다 (이름+전화 뒷 4자리)';
      }
    }
    rows.push([kind, h + 1, raw, hint, lecture, shown]);
  }

  // 갈래로 묶는다. 섞여 있으면 무엇부터 볼지 알 수 없다.
  var order = { '번호가 다름': 0, '이름 한 글자 차이': 1, '명단에 없음': 2,
                '제출 시각을 못 읽음': 3, '지난 기수 제출': 4 };
  rows.sort(function (a, b) { return (order[a[0]] - order[b[0]]) || (a[1] - b[1]); });

  chkWriteReport_(ss, tz, rows, okCount, boundary);
}

/** 출석부 머리글의 날짜 칸 중 가장 이른 날의 그 달 1일 ('2026-08-01'). 모르면 '' */
function chkCohortStart_(headerRow) {
  var today = new Date();
  var first = null;
  for (var c = 0; c < headerRow.length; c++) {
    var v = headerRow[c], d = null;
    if (v instanceof Date) {
      d = v;
    } else {
      var m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
      if (m) {
        // 연도가 없으면 올해로 보되, 오늘보다 뒤면 작년 것으로 본다
        d = new Date(today.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
        if (d > today) d = new Date(today.getFullYear() - 1, d.getMonth(), d.getDate());
      }
    }
    if (d && (!first || d < first)) first = d;
  }
  if (!first) return '';
  return first.getFullYear() + '-' + ('0' + (first.getMonth() + 1)).slice(-2) + '-01';
}

/**
 * 제출 시각 칸 읽기.
 *   date   진짜 날짜이거나 '2026-09-20' · '2026. 9. 20 오후 …' 처럼 읽을 수 있는 것
 *   none   비었거나 '3기' 처럼 기수를 적은 것 (수기 입력 — 동기화가 그대로 받는다)
 *   bad    그 밖의 것 ('260920' 등) — 동기화가 날짜를 못 정한다
 */
function chkReadWhen_(v, tz) {
  if (v instanceof Date) {
    var t = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
    return { kind: 'date', iso: t.slice(0, 10), text: t };
  }
  var s = String(v == null ? '' : v).trim();
  if (!s || /^\d+\s*기$/.test(s)) return { kind: 'none', raw: s };
  var m = s.match(/^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if (m) {
    var y = parseInt(m[1], 10);
    if (y >= 2000 && y <= 2100) {
      var iso = y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
      return { kind: 'date', iso: iso, text: s };
    }
  }
  return { kind: 'bad', raw: s };
}

/** 한 글자만 다른가 (바뀜·빠짐·더해짐 한 번까지) */
function chkOneApart_(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/**
 * 결과를 '과제ID점검' 탭에 적는다. 있으면 지우고 다시 쓴다 —
 * 지난 결과가 남아 있으면 이미 고친 건까지 다시 고치려 들게 된다.
 */
function chkWriteReport_(ss, tz, rows, okCount, boundary) {
  var sheet = ss.getSheetByName(CHK_REPORT_TAB) || ss.insertSheet(CHK_REPORT_TAB);
  sheet.clear();

  var summary = {};
  rows.forEach(function (r) { summary[r[0]] = (summary[r[0]] || 0) + 1; });
  var parts = Object.keys(summary).map(function (k) { return k + ' ' + summary[k] + '건'; });

  var when = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  var head = [
    [when + ' 점검 · 명단과 맞은 제출 ' + okCount + '건', '', '', '', '', ''],
    [parts.length ? parts.join(' · ') : '고칠 것이 없습니다.', '', '', '', '', ''],
    ['아이디가 안 맞으면 그 사람의 과제가 조용히 버려집니다. ' +
     (boundary ? boundary + ' 전에 낸 것은 지난 기수 제출로 따로 모았습니다.' : ''), '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['갈래', '과제 탭 줄', '적힌 아이디', '명단 후보 · 안내', '몇 강', '제출 시각']
  ];
  var body = rows.length ? rows : [['', '', '(없음)', '', '', '']];
  sheet.getRange(1, 1, head.length, 6).setValues(head);
  sheet.getRange(head.length + 1, 1, body.length, 6).setValues(body);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(head.length, 1, 1, 6).setFontWeight('bold');
  sheet.setFrozenRows(head.length);
  sheet.autoResizeColumns(1, 6);

  htaTell_('과제 아이디 점검\n\n맞음 ' + okCount + '건' +
           (parts.length ? '\n' + parts.join('\n') : '\n고칠 것이 없습니다.') +
           "\n\n자세한 내용은 '" + CHK_REPORT_TAB + "' 탭에 적었습니다.");
}
