#!/usr/bin/env node
// 시트(GAS) → Supabase 전량 동기화.
// GitHub Actions에서 실행되므로 프록시 allowlist 불필요.
//
// 사용법:
//   node scripts/sync-sheet-to-db.mjs --dry-run
//   node scripts/sync-sheet-to-db.mjs                    (활성 기수 자동)
//   node scripts/sync-sheet-to-db.mjs --cohort=3기
//   node scripts/sync-sheet-to-db.mjs --cohort=3기 --activate   (기수 전환)
//   node scripts/sync-sheet-to-db.mjs --homework-since=2026-07-31  (과제 기준일 직접 지정)
//   node scripts/sync-sheet-to-db.mjs --include-undated-homework   (제출 시각 없는 과제도 반영)
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GAS_API_URL(선택)

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];

// 기수를 이 파일에 박아두면 3기·4기로 넘어갈 때마다 코드를 고쳐야 한다.
// 지정이 없으면 DB의 활성 기수(cohorts.is_active)를 따라간다.
const COHORT_ARG = getArg('cohort') || (process.env.COHORT_ID || '').trim();
// --activate: 이 기수를 활성 기수로 지정하고 나머지를 비활성으로 내린다.
// 기수 전환 때만 쓴다. 매일 도는 동기화가 활성 기수를 건드리면 안 된다.
const ACTIVATE = args.includes('--activate');
// 제출 시각이 없는 과제(오프라인·사후 제출 수기 입력)를 넣을지.
// 기본은 제외 — 지금 시트에 남은 것은 전부 지난 기수 것이다.
const INCLUDE_UNDATED_HW = args.includes('--include-undated-homework');
// 기수 시작 연도. 명시하지 않으면 DB의 cohorts.started_at 에서 읽고,
// 그것도 없으면 현재 연도를 쓴다.
// (하드코딩하면 기수가 바뀔 때 세션이 두 연도로 갈라져 집계가 깨진다)
const START_YEAR_ARG = getArg('start-year') || process.env.START_YEAR;
const GAS_API_URL = process.env.GAS_API_URL
  || 'https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL) { console.error('❌ SUPABASE_URL 없음'); process.exit(1); }
if (!dryRun && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 없음 (--dry-run 은 가능)');
  process.exit(1);
}

const sb = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;


// ---------------------------------------------------------------- helpers
const trim   = (v) => (v == null ? null : String(v).trim() || null);
const toInt  = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };
const toBool = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['true','o','1','y'].includes(s)) return true;
  if (['false','x','0','n'].includes(s)) return false;
  return null;
};
// 시트에 '9/6' 로 적혀 있을 수도, 진짜 날짜값이라 '9/6' 으로 넘어올 수도 있다.
// 두 자리로만 받으면 그 세션을 통째로 놓친다.
const SESSION_KEY_RE = /^(\d{1,2})\/(\d{1,2})$/;

// 커리큘럼 구성. 수료 분모(16강)의 정의이기도 하다.
const DOCTRINE_COUNT = 12;   // 교리1~12
const DIALOG_COUNT   = 4;    // 성경적대화1~4

// 과제 폼은 '13강' 처럼 1~16 통합 번호를 쓰는데,
// 시트·DB 는 교리N / 성경적대화N 으로 쓴다.
// 13강은 교리13(없는 강의)이 아니라 성경적대화1 이다.
function labelFromSerial(n) {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= DOCTRINE_COUNT) return `교리${n}`;
  if (n <= DOCTRINE_COUNT + DIALOG_COUNT) return `성경적대화${n - DOCTRINE_COUNT}`;
  return null;
}

// 세션명 정규화: '3강 예수...' → '교리3', '13강 ...' → '성경적대화1'
function normalizeSession(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^성경적대화\s*(\d+)/) || s.match(/^대화\s*(\d+)/);
  if (m) return '성경적대화' + m[1];
  m = s.match(/^(\d+)\s*강/) || s.match(/^교리\s*(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    return labelFromSerial(n) || ('교리' + n);   // 범위 밖은 그대로 두고 상위에서 경고
  }
  if (/^교제/.test(s) || /^교재/.test(s)) return '교제';
  if (/^나눔/.test(s)) return '나눔';
  return s;
}

// 실제 강의 여부 (수료 분모에 들어가는가)
const isClassSession = (norm) =>
  /^교리\d+$/.test(norm) || /^성경적대화\d+$/.test(norm);

// 'M/d' 또는 'MM/dd' → 'YYYY-MM-DD' (연도 rollover 고려)
function buildSessionDates(keys, startYear) {
  const map = new Map();
  let year = startYear, prev = null;
  for (const k of keys) {
    const [mm, dd] = k.split('/').map(Number);
    if (prev && (mm < prev.mm || (mm === prev.mm && dd < prev.dd))) year += 1;
    map.set(k, `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
    prev = { mm, dd };
  }
  return map;
}

// ---------------------------------------------------------------- fetch
console.log('▶ GAS 응답 가져오는 중…');

// 배포 ID 는 URL 에 그대로 드러나므로 로그에는 앞뒤만 남긴다
function maskGas(url) {
  return String(url).replace(/\/s\/([\w-]{12})[\w-]+([\w-]{6})\//, '/s/$1…$2/');
}
function gasFailHint(status) {
  console.error(`   요청 URL: ${maskGas(GAS_API_URL)}`);
  console.error(`   출처:     ${process.env.GAS_API_URL ? 'GAS_API_URL 시크릿' : '스크립트 안의 기본 URL'}`);
  if (status === 404) {
    console.error('');
    console.error('   404 는 그 배포가 더 이상 존재하지 않는다는 뜻입니다. 대개 둘 중 하나입니다.');
    console.error('     1) "새 배포"를 만들어 URL 이 바뀌었는데 시크릿이 옛 URL 그대로');
    console.error('     2) 기존 배포를 보관처리(archive)했다');
    console.error('');
    console.error('   Apps Script → 배포 → 배포 관리 에서 활성 배포의 웹 앱 URL 을 복사해');
    console.error('   GitHub → Settings → Secrets → GAS_API_URL 을 갱신하세요.');
    console.error('   ※ 다음부터는 "새 배포" 대신 기존 배포의 ✏️ → 버전: 새 버전 → 배포 를 쓰면');
    console.error('     URL 이 그대로 유지돼 시크릿을 다시 만질 일이 없습니다.');
  } else if (status === 401 || status === 403) {
    console.error('   배포의 "액세스 권한이 있는 사용자"가 모든 사용자인지 확인하세요.');
  }
}

const res = await fetch(GAS_API_URL + '?t=' + Date.now());
if (!res.ok) {
  console.error(`❌ GAS 응답 실패: HTTP ${res.status}`);
  gasFailHint(res.status);
  process.exit(1);
}

// 배포가 로그인 페이지로 넘기면 200 + HTML 이 돌아온다. JSON 파싱 오류보다 먼저 잡는다.
const raw = await res.text();
let gas;
try {
  gas = JSON.parse(raw);
} catch {
  console.error('❌ GAS 응답이 JSON 이 아닙니다 (로그인 페이지일 가능성이 큽니다).');
  console.error(`   앞부분: ${raw.slice(0, 120).replace(/\s+/g, ' ')}`);
  gasFailHint(res.status);
  process.exit(1);
}
if (!gas.success) { console.error('❌ GAS success=false:', gas.message); process.exit(1); }

const rows       = Array.isArray(gas.data) ? gas.data : [];
const kimbapIn   = gas.kimbap   || {};
const homeworkIn = gas.homework || {};
console.log(`   GAS v${gas.version} · ${rows.length}명 · kimbap ${Object.keys(kimbapIn).length} · homework ${Object.keys(homeworkIn).length}\n`);

// ---------------------------------------------------------------- 기수 결정
// 우선순위
//   1) 명시한 값 (워크플로우 입력 · --cohort · COHORT_ID)
//   2) 시트가 스스로 밝힌 기수 (출석부 상단의 'N기' 표식)
//      읽어온 데이터가 그 기수 것이므로 거기에 쓰는 게 언제나 맞다
//   3) DB의 활성 기수
//   4) 2기
let COHORT_ID = COHORT_ARG;

if (COHORT_ID && gas.cohortHint && gas.cohortHint !== COHORT_ID) {
  // 명시했는데 시트와 다르다 — 엉뚱한 기수에 명단을 밀어넣기 직전이다.
  // 새 명단이 지난 기수로 들어가고 지난 기수 인원은 전부 inactive 가 된다.
  console.error(`❌ 시트는 ${gas.cohortHint} 인데 ${COHORT_ID} 로 동기화하려 합니다. 중단합니다.`);
  console.error('');
  console.error(`   그대로 진행하면 ${gas.cohortHint} 명단이 ${COHORT_ID} 로 들어가고,`);
  console.error(`   기존 ${COHORT_ID} 인원은 전부 inactive 로 내려갑니다.`);
  console.error('');
  console.error(`   시트대로 넣으시려면 기수 ID 를 비우거나 ${gas.cohortHint} 로 지정하세요.`);
  process.exit(1);
}

if (!COHORT_ID) {
  if (gas.cohortHint) {
    COHORT_ID = gas.cohortHint;
    console.log(`ℹ️  기수 자동 결정: ${COHORT_ID} (시트의 기수 표식)`);
  } else {
    console.warn('⚠️  시트에 기수 표식이 없습니다.');
    console.warn("    출석부(DB) 상단 아무 칸에 '3기' 처럼 적어 두시면");
    console.warn('    엉뚱한 기수로 동기화되는 사고를 자동으로 막습니다.');
    if (sb) {
      const { data } = await sb.from('cohorts')
        .select('id').eq('is_active', true)
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (data?.id) {
        COHORT_ID = data.id;
        console.log(`ℹ️  기수 자동 결정: ${COHORT_ID} (cohorts.is_active)`);
      }
    }
    if (!COHORT_ID) {
      COHORT_ID = '2기';
      console.log('ℹ️  활성 기수를 찾지 못해 기본값 사용: 2기');
    }
  }
}

// 아직 활성 기수가 아니면 앱에 안 보인다. 조용히 넘어가면 "왜 안 바뀌지" 가 된다.
if (!ACTIVATE && sb) {
  const { data } = await sb.from('cohorts')
    .select('id').eq('is_active', true).limit(1).maybeSingle();
  if (data?.id && data.id !== COHORT_ID) {
    console.log(`ℹ️  활성 기수는 아직 ${data.id} 입니다 — 앱에는 ${COHORT_ID} 가 보이지 않습니다.`);
    console.log('    전환하려면 "이 기수를 활성 기수로 지정" 을 체크하고 다시 실행하세요.');
  }
}

// 기수 시작 연도 결정: 인자 > DB의 cohorts.started_at > 현재 연도
let START_YEAR;
if (START_YEAR_ARG) {
  START_YEAR = parseInt(START_YEAR_ARG, 10);
} else {
  let fromDb = null;
  if (sb) {
    const { data } = await sb.from('cohorts').select('started_at').eq('id', COHORT_ID).maybeSingle();
    if (data?.started_at) fromDb = new Date(data.started_at).getFullYear();
  }
  START_YEAR = fromDb ?? new Date().getFullYear();
  console.log(`\u2139\uFE0F  기준 연도 자동 결정: ${START_YEAR} (${fromDb ? 'cohorts.started_at' : '현재 연도'})`);
}

console.log(`\n\uD83C\uDFF7\uFE0F  cohort: ${COHORT_ID} / 기준 연도 ${START_YEAR}`);
console.log(`\uD83D\uDD27 mode:   ${dryRun ? 'DRY RUN' : 'LIVE'}${ACTIVATE ? ' \u00B7 활성 기수로 지정' : ''}\n`);

if (gas.version < 21) {
  console.warn(`⚠️  GAS 버전이 ${gas.version}입니다. v21 이상 권장 (김밥·과제 필드 포함).\n`);
}

// ---------------------------------------------------------------- transform
// 세션 목록 (출석부 날짜 컬럼).
// GAS 가 넘긴 원본 키('9/6' 또는 '09/06')를 MM/DD 로 모으고,
// 값을 읽을 때 쓸 원본 키는 따로 기억해 둔다.
const mmddToRawKeys = new Map();
for (const r of rows) {
  for (const k of Object.keys(r)) {
    const m = k.match(SESSION_KEY_RE);
    if (!m) continue;
    const norm = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`;
    const list = mmddToRawKeys.get(norm) || [];
    if (!list.includes(k)) list.push(k);
    mmddToRawKeys.set(norm, list);
  }
}
const mmddKeys = [...mmddToRawKeys.keys()].sort((a, b) => {
  const [am, ad] = a.split('/').map(Number);
  const [bm, bd] = b.split('/').map(Number);
  return am === bm ? ad - bd : am - bm;
});
const dateOf = buildSessionDates(mmddKeys, START_YEAR);

// 한 세션의 출결 값. 표기가 섞여 원본 키가 둘일 수 있어 채워진 쪽을 택한다.
function attendanceValue(row, mmdd) {
  for (const raw of mmddToRawKeys.get(mmdd) || []) {
    const v = row[raw];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// 'M/d' · 'MM/dd' · '3/22' 등 표기 차이를 흡수하는 정규 키
function mmddKey(v) {
  const m = String(v ?? '').match(/(\d{1,2})[\/\.\-](\d{1,2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2,'0')}/${String(m[2]).padStart(2,'0')}`;
}

// 커리큘럼 세션인지 (김밥 탭에는 '신규', '수료자 김밥' 같은 운영용 컬럼도 섞여 있다)
const isCurriculumLabel = (norm) =>
  /^교리\d+$/.test(norm) || /^성경적대화\d+$/.test(norm) || norm === '교제' || norm === '나눔';

// 세션명의 1순위는 출석부(DB) 의 '강의명 행' (GAS v23+).
// 김밥 탭은 인원 데이터에서 유추하는 방식이라 새 기수처럼 탭이 비면 아무것도 못 준다.
const explicitLabels = new Map();
for (const [rawKey, rawName] of Object.entries(gas.sessionLabels || {})) {
  const key = mmddKey(rawKey);
  const norm = normalizeSession(rawName);
  if (key && norm) explicitLabels.set(key, norm);
}

// 2순위: 김밥 데이터에서 MM/DD → 세션명 매핑.
// 인원마다 비어 있는 칸이 있을 수 있으므로 전원을 훑어 채운다.
const mmddToLabel = new Map();
for (const detail of Object.values(kimbapIn)) {
  for (const [rawName, info] of Object.entries(detail || {})) {
    const key = mmddKey(info?.date);
    if (!key || mmddToLabel.has(key)) continue;
    const norm = normalizeSession(rawName);
    if (norm && isCurriculumLabel(norm)) mmddToLabel.set(key, norm);
  }
}

// 커리큘럼 표준 순서 (교리1~12 → 교제·나눔 → 성경적대화1~4)
function sessionOrder(norm) {
  let m = String(norm).match(/^성경적대화(\d+)$/);
  if (m) return 200 + parseInt(m[1], 10);
  m = String(norm).match(/^교리(\d+)$/);
  if (m) return parseInt(m[1], 10);
  if (norm === '교제') return 100;
  if (norm === '나눔') return 101;
  return 999;
}

// 세션명 배정
//
// 김밥 탭 매핑만으로는 취약하다 (날짜 누락·운영용 컬럼 혼재).
// 커리큘럼은 고정 순서이므로 출석부 컬럼 순서를 기준으로 직접 배정하고,
// 김밥 탭에서 얻은 매핑은 '교제'·'나눔'의 위치 파악에만 쓴다.
//
// 커리큘럼: 교리1~12 → (중간에 교제·나눔이 낀 주가 있음) → 성경적대화1~4
const CURRICULUM = [
  ...Array.from({ length: DOCTRINE_COUNT }, (_, i) => `교리${i + 1}`),
  ...Array.from({ length: DIALOG_COUNT },  (_, i) => `성경적대화${i + 1}`),
];

// 김밥 탭에서 확인된 비강의 주차 (교제·나눔)
const nonClassKeys = new Set(
  [...mmddToLabel].filter(([, v]) => v === '교제' || v === '나눔').map(([k]) => k)
);

if (explicitLabels.size) {
  console.log(`ℹ️  세션명 출처: 출석부(DB) 강의명 행 ${explicitLabels.size}개`);
} else if (mmddToLabel.size) {
  console.log(`ℹ️  세션명 출처: 김밥 탭 ${mmddToLabel.size}개 (출석부에 강의명 행이 없음)`);
} else {
  console.warn('⚠️  세션명 정보가 없습니다 — 출석부 강의명 행도, 김밥 탭 데이터도 없습니다.');
  console.warn('    커리큘럼 순서대로만 배정하므로, 교제·나눔 주가 끼어 있으면 라벨이 밀립니다.');
  console.warn('    출석부(DB) 의 날짜 헤더 바로 윗줄에 교리1, 교리2, 교제 … 를 적어 주세요.');
  if ((gas.version || 0) < 23) {
    console.warn(`    (강의명 행을 읽으려면 GAS v23 이상이 필요합니다. 지금 v${gas.version})`);
  }
  console.warn('');
}

const sessions = [];
let curriculumIdx = 0;
mmddKeys.forEach((k, i) => {
  let norm;
  if (explicitLabels.has(k)) {
    norm = explicitLabels.get(k);                    // 시트에 적힌 값이 최우선
    const at = CURRICULUM.indexOf(norm);
    if (at !== -1) curriculumIdx = at + 1;           // 순서 포인터를 그 다음으로 맞춘다
  } else if (nonClassKeys.has(k)) {
    norm = mmddToLabel.get(k);                       // 교제 / 나눔
  } else if (curriculumIdx < CURRICULUM.length) {
    norm = CURRICULUM[curriculumIdx++];              // 강의 순서대로 배정
  } else {
    norm = mmddToLabel.get(k) || null;               // 커리큘럼 초과분 (팬텀 컬럼 등)
  }
  sessions.push({
    cohort_id: COHORT_ID,
    session_date: dateOf.get(k),
    label: k,
    label_norm: norm,
    session_no: i + 1,
    is_class: norm ? isClassSession(norm) : false,
  });
});

// 김밥 탭 매핑과 어긋나는 곳이 있으면 알린다 (시트 구조 변경 감지)
const conflicts = sessions.filter(s => {
  if (explicitLabels.has(s.label)) return false;     // 시트에 적힌 값이 우선이므로 비교 불필요
  const fromKimbap = mmddToLabel.get(s.label);
  return fromKimbap && s.label_norm && fromKimbap !== s.label_norm;
});
if (conflicts.length) {
  console.warn(`⚠️  김밥 탭 세션명과 불일치 ${conflicts.length}건:`);
  for (const c of conflicts) {
    console.warn(`    ${c.label}: 순서기준 ${c.label_norm} / 김밥탭 ${mmddToLabel.get(c.label)}`);
  }
  console.warn('    커리큘럼 순서가 바뀌었는지 확인하세요.\n');
}

const unmapped = sessions.filter(s => !s.label_norm);
if (unmapped.length) {
  console.warn(`⚠️  커리큘럼 범위 밖 세션 ${unmapped.length}건: ${unmapped.map(s => s.label).join(', ')}`);
  console.warn('    강의 카운트에서 제외됩니다 (팬텀 컬럼일 수 있음).\n');
}

const classList = sessions.filter(s => s.is_class);
console.log(`ℹ️  강의 ${classList.length}개: ${classList.map(s => `${s.label}=${s.label_norm}`).join(', ')}`);
const nonClass = sessions.filter(s => s.label_norm && !s.is_class);
if (nonClass.length) {
  console.log(`ℹ️  비강의 ${nonClass.length}개: ${nonClass.map(s => `${s.label}=${s.label_norm}`).join(', ')}`);
}
console.log('');

const members = [];
const attendance = [];   // member key 기준, uuid는 이관 후 매핑
const seen = new Set();

for (const r of rows) {
  const name  = trim(r.name);
  const phone = trim(r.phone);
  if (!name) continue;
  const key = `${name}|${phone || ''}`;
  if (seen.has(key)) continue;
  seen.add(key);

  members.push({
    _key: key,
    _id: r.id,
    cohort_id: COHORT_ID,
    name,
    // unique (cohort_id, name, phone) 은 phone 이 null 이면 걸리지 않는다.
    // null 로 두면 동기화할 때마다 같은 사람의 새 행이 생긴다.
    phone: phone ?? '',
    full_phone: trim(r['연락처']),
    team: trim(r.team),
    team_no: toInt(r['no.']),
    location: trim(r.location),
    role: trim(r.role),
    gender: trim(r.gen),
    age: toInt(r.age),
    marital: trim(r['결혼']),
    pastor: trim(r['담당교역자']),
    telegram_ok: toBool(r.telegram),
    sms_ok: toBool(r['안내문자']),
    lunch1: trim(r['김밥1차']),
    lunch2: trim(r['김밥2차']),
    note: trim(r['.note']),
    completion: trim(r['수료']),
  });

  for (const k of mmddKeys) {
    attendance.push({
      _key: key,
      session_date: dateOf.get(k),
      status: attendanceValue(r, k),
    });
  }
}

// 김밥 신청
// 세션명 → 날짜 역매핑 (김밥 칸에 날짜가 비어 있어도 세션명으로 보완)
const labelToDate = new Map();
for (const s of sessions) {
  if (s.label_norm && s.session_date) labelToDate.set(s.label_norm, s.session_date);
}

const kimbapRows = [];
const kimbapOpsLabels = new Set();   // '신규', '수료자 김밥' 등 운영용
const kimbapExtraLabels = new Set(); // 커리큘럼이지만 출석부에 없는 것
for (const [gasId, detail] of Object.entries(kimbapIn)) {
  for (const [rawName, info] of Object.entries(detail || {})) {
    const norm = normalizeSession(rawName);
    if (!norm) continue;
    if (!isCurriculumLabel(norm)) { kimbapOpsLabels.add(norm); }
    else if (!labelToDate.has(norm)) { kimbapExtraLabels.add(norm); }
    const key = mmddKey(info?.date);
    const date = (key && dateOf.get(key)) || labelToDate.get(norm) || null;
    kimbapRows.push({
      _gasId: gasId,
      cohort_id: COHORT_ID,
      session_label: norm,
      session_date: date,
      applied: info?.applied === 1,
    });
  }
}

if (kimbapOpsLabels.size) {
  console.log(`ℹ️  김밥 운영용 항목 ${kimbapOpsLabels.size}종 (강의 아님, 신청 기록은 보존): ${[...kimbapOpsLabels].join(', ')}`);
}
if (kimbapExtraLabels.size) {
  console.warn(`⚠️  출석부에 없는 커리큘럼 세션 ${kimbapExtraLabels.size}종: ${[...kimbapExtraLabels].join(', ')}`);
  console.warn('    김밥 탭에만 있는 세션입니다. 확인이 필요합니다.\n');
}

// 과제 제출
// 같은 사람이 같은 강의·유형으로 여러 번 제출할 수 있다 (재제출·수정 제출).
// upsert 키가 (member_id, session_label, type) 이므로 최신 1건만 남긴다.
//
// 과제 탭은 폼 응답이 계속 쌓이는 곳이라 지난 기수 응답이 남아 있기 쉽다.
// 대부분은 그 사람이 새 기수 명단에 없어 자연히 걸러지지만,
// 지난 기수에서 이월된 사람은 ID(이름+전화)가 같아 그대로 붙어 버린다.
// 그러면 내지도 않은 과제로 결석 보충을 인정받는다.
// 이 기수 첫 강의보다 먼저 제출된 건은 지난 기수 것으로 보고 뺀다.
const cohortStart = sessions[0]?.session_date || null;

// 어느 기수 응답인지 가르는 기준은 '이 기수가 시작하는 달의 1일' 이다.
//
// 과제는 강의 전에 미리 내는 것이 기본이고 사후 제출도 된다.
// 그래서 '이 기수 첫 강의' 나 '아직 안 한 강의' 로는 가를 수 없다.
// 기수와 기수 사이에는 빈 달이 있으므로, 시작 달 1일부터 들어온 것은
// 전부 이번 기수 것으로 본다.
//   3기 첫 강의 08/09 → 기준일 2026-07-31 → 8월 이후 제출은 전부 3기
//
// 달 경계와 다르게 잡아야 하면 --homework-since 로 지정한다.
function prevMonthEnd(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(1);   // 그 달 1일
  d.setUTCDate(0);   // 전월 말일
  return d.toISOString().slice(0, 10);
}
const homeworkCutoff = getArg('homework-since')
  || (cohortStart ? prevMonthEnd(cohortStart) : null);

if (homeworkCutoff) {
  const src = getArg('homework-since') ? '직접 지정' : '기수 시작 달의 1일 기준';
  console.log(`ℹ️  과제 기준일: ${homeworkCutoff} (${src}). 그 뒤 제출만 이 기수 것으로 본다`);
} else {
  console.warn('⚠️  세션이 없어 과제를 제출 시각으로 거르지 않습니다.\n');
}

// 제출 시각 칸 해석
//   '2026-08-05 18:39'  → 날짜. 기준일과 비교한다
//   '3기'                → 기수 표기. 오프라인·사후 제출을 손으로 적을 때 쓴다
//   빈 값 · 알 수 없는 값 → 판별 불가
//
// new Date('3기').toISOString() 은 예외를 던지므로 반드시 여기서 걸러야 한다.
function readSubmittedAt(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { kind: 'none' };
  const tag = v.match(/^(\d+)\s*기$/);
  if (tag) return { kind: 'cohort', cohort: `${tag[1]}기` };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { kind: 'unparsed', raw: v };
  return { kind: 'date', iso: new Date(t).toISOString() };
}

const homeworkByKey = new Map();
let homeworkDupes = 0;
let homeworkStale = 0;
let homeworkNoDate = 0;
let homeworkTagged = 0;
const homeworkNoDateSample = new Set();
for (const [gasId, list] of Object.entries(homeworkIn)) {
  for (const h of (list || [])) {
    const norm = normalizeSession(h.session);
    if (!norm) continue;
    const ts = readSubmittedAt(h.submittedAt);
    const row = {
      _gasId: gasId,
      cohort_id: COHORT_ID,
      session_label: norm,
      session_raw: trim(h.session),
      type: trim(h.type),
      url: trim(h.url),
      submitted_at: ts.kind === 'date' ? ts.iso : null,
    };
    if (ts.kind === 'cohort') {
      // 기수를 직접 적어 둔 건 — 날짜보다 확실하다
      if (ts.cohort !== COHORT_ID) { homeworkStale++; continue; }
      homeworkTagged++;
    } else if (ts.kind === 'date') {
      if (homeworkCutoff && ts.iso.slice(0, 10) <= homeworkCutoff) { homeworkStale++; continue; }
    } else {
      // 빈 값이거나 해석할 수 없는 값 — 어느 기수인지 가릴 수 없다.
      // 넣으면 내지도 않은 과제로 보충을 인정받으므로 기본은 제외한다.
      homeworkNoDate++;
      if (homeworkNoDateSample.size < 5) {
        homeworkNoDateSample.add(`${gasId} ${norm}${ts.raw ? ` ("${ts.raw}")` : ''}`);
      }
      if (!INCLUDE_UNDATED_HW) continue;
    }

    const key = `${gasId}|${norm}|${row.type ?? ''}`;
    const prev = homeworkByKey.get(key);
    if (!prev) { homeworkByKey.set(key, row); continue; }
    homeworkDupes++;
    // 제출 시각이 늦은 쪽을 채택 (시각 없으면 나중에 나온 것)
    const prevAt = prev.submitted_at ? Date.parse(prev.submitted_at) : -Infinity;
    const curAt  = row.submitted_at  ? Date.parse(row.submitted_at)  : -Infinity;
    if (curAt >= prevAt) homeworkByKey.set(key, row);
  }
}
const homeworkRows = [...homeworkByKey.values()];
if (homeworkDupes) {
  console.log(`ℹ️  과제 중복 제출 ${homeworkDupes}건 → 최신 제출만 반영`);
}
if (homeworkStale) {
  console.log(`ℹ️  ${homeworkCutoff} 이전 제출 ${homeworkStale}건 제외 (지난 기수 응답)`);
}
if (homeworkTagged) {
  console.log(`ℹ️  제출 시각 칸에 '${COHORT_ID}' 라고 적힌 과제 ${homeworkTagged}건 반영 (오프라인·사후 제출)`);
}
if (homeworkNoDate) {
  if (INCLUDE_UNDATED_HW) {
    console.log(`ℹ️  제출 시각이 없는 과제 ${homeworkNoDate}건 반영 (--include-undated-homework)`);
  } else {
    console.log(`ℹ️  제출 시각이 없는 과제 ${homeworkNoDate}건 제외 (어느 기수인지 가릴 수 없음)`);
  }
  console.log(`    예: ${[...homeworkNoDateSample].join(' / ')}`);
  console.log(`    이번 기수 것이라면 시트 과제 탭의 타임스탬프 칸에 '${COHORT_ID}' 라고 적어 주세요.`);
}

console.log('📊 변환 결과');
console.log(`   sessions   ${sessions.length} (실제 강의 ${sessions.filter(s => s.is_class).length})`);
console.log(`   members    ${members.length}`);
console.log(`   attendance ${attendance.length}`);
console.log(`   kimbap     ${kimbapRows.length} (신청 ${kimbapRows.filter(k => k.applied).length})`);
console.log(`   homework   ${homeworkRows.length}\n`);

if (dryRun) {
  console.log('🔍 DRY RUN — write 없음\n');
  console.log('sessions 샘플:', sessions.slice(0, 3));
  console.log('member 샘플:', (({_key,_id,...r}) => r)(members[0] || {}));
  console.log('kimbap 샘플:', kimbapRows.slice(0, 2));
  console.log('homework 샘플:', homeworkRows.slice(0, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- upsert

async function upsert(table, data, onConflict) {
  if (!data.length) return [];

  // 같은 배치에 conflict 키가 중복되면 Postgres가 거부한다
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  // 뒤에 오는 행을 최신으로 보고 앞의 것을 덮어쓴다.
  if (onConflict) {
    const cols = onConflict.split(',').map(c => c.trim());
    const byKey = new Map();
    for (const row of data) byKey.set(cols.map(c => row[c] ?? '').join('||'), row);
    if (byKey.size !== data.length) {
      console.log(`   ℹ️ ${table}: 배치 내 중복 ${data.length - byKey.size}건 제거`);
      data = [...byKey.values()];
    }
  }

  const out = [];
  for (let i = 0; i < data.length; i += 500) {
    const batch = data.slice(i, i + 500);
    const { data: ret, error } = await sb.from(table).upsert(batch, { onConflict }).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(ret || []));
  }
  return out;
}

console.log('▶ cohorts');
// is_active 는 --activate 일 때만 건드린다.
// 매일 도는 동기화가 활성 기수를 되돌려 놓으면 기수 전환이 무너진다.
const cohortRow = {
  id: COHORT_ID, name: COHORT_ID,
  started_at: sessions[0]?.session_date ?? null,
};
if (ACTIVATE) cohortRow.is_active = true;
await upsert('cohorts', [cohortRow], 'id');

if (ACTIVATE) {
  const { error } = await sb.from('cohorts')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .neq('id', COHORT_ID).eq('is_active', true);
  if (error) throw new Error(`활성 기수 전환 실패: ${error.message}`);
  console.log(`   ${COHORT_ID} → 활성 기수 (나머지 기수는 비활성)`);
}

console.log('▶ sessions');
await upsert('sessions', sessions, 'cohort_id,session_date');

console.log('▶ members');
const savedMembers = await upsert(
  'members',
  members.map(({ _key, _id, ...m }) => m).map(m => ({ ...m, status: 'active' })),
  'cohort_id,name,phone'
);

// 시트에 없는데 DB 에만 남아 있는 세션
//
// 기수 일정이 바뀌거나 다른 기수 시트가 잘못 들어오면 세션이 쌓인다.
// 지우면 그 날짜의 출결도 함께 사라지므로 자동으로 처리하지 않고 알리기만 한다.
{
  const sheetDates = new Set(sessions.map(s => s.session_date));
  const { data: dbSessions } = await sb
    .from('sessions').select('session_date,label_norm')
    .eq('cohort_id', COHORT_ID);
  const orphan = (dbSessions || []).filter(s => !sheetDates.has(s.session_date));
  if (orphan.length) {
    console.warn(`⚠️  시트에 없는 세션이 DB 에 ${orphan.length}개 남아 있습니다:`);
    console.warn('    ' + orphan.map(s => `${s.session_date}(${s.label_norm || '?'})`).join(', '));
    console.warn('    일정이 바뀐 것이면 그대로 두시고,');
    console.warn('    다른 기수가 잘못 들어온 것이면 SQL 로 정리해야 합니다.\n');
  }
}

// 시트에서 사라진 인원 처리
// 매주 수료·하차가 발생하므로 DB에만 남은 사람을 표시해야 한다.
// 삭제하지 않고 status만 바꿔 이력(출석·과제)을 보존한다.
{
  const sheetKeys = new Set(members.map(m => `${m.name}|${m.phone || ''}`));
  const { data: dbMembers, error } = await sb
    .from('members')
    .select('id, name, phone, status')
    .eq('cohort_id', COHORT_ID);
  if (error) throw new Error(`members 조회 실패: ${error.message}`);

  const gone = (dbMembers || []).filter(
    m => m.status === 'active' && !sheetKeys.has(`${m.name}|${m.phone || ''}`)
  );
  if (gone.length) {
    const { error: upErr } = await sb
      .from('members')
      .update({ status: 'inactive' })
      .in('id', gone.map(m => m.id));
    if (upErr) throw new Error(`inactive 처리 실패: ${upErr.message}`);
    console.log(`   시트에서 빠진 ${gone.length}명 → status=inactive: ${gone.map(m => m.name).join(', ')}`);
  }

  // 다시 시트에 나타난 사람은 위 upsert에서 status='active'로 복귀됨
}
const keyToUuid = new Map();
const gasIdToUuid = new Map();
for (const m of savedMembers) {
  keyToUuid.set(`${m.name}|${m.phone || ''}`, m.id);
  gasIdToUuid.set(`${m.name}${m.phone || ''}`, m.id);
}
console.log(`   ${savedMembers.length}명`);

console.log('▶ attendance');
const attRows = attendance
  .map(a => {
    const uuid = keyToUuid.get(a._key);
    return uuid ? { member_id: uuid, session_date: a.session_date, status: a.status } : null;
  })
  .filter(Boolean);
await upsert('attendance', attRows, 'member_id,session_date');
console.log(`   ${attRows.length}건`);

if (kimbapRows.length) {
  console.log('▶ kimbap_signups');
  const kb = kimbapRows
    .map(({ _gasId, ...k }) => {
      const uuid = gasIdToUuid.get(String(_gasId).replace(/\s/g, ''));
      return uuid ? { ...k, member_id: uuid } : null;
    })
    .filter(Boolean);
  await upsert('kimbap_signups', kb, 'member_id,session_label');
  console.log(`   ${kb.length}건` +
    (kimbapRows.length > kb.length
      ? ` (명단에 없는 인원 ${kimbapRows.length - kb.length}건 무시)` : ''));
}

if (homeworkRows.length) {
  console.log('▶ homework_submissions');
  const hw = homeworkRows
    .map(({ _gasId, ...h }) => {
      const uuid = gasIdToUuid.get(String(_gasId).replace(/\s/g, ''));
      return uuid ? { ...h, member_id: uuid } : null;
    })
    .filter(Boolean);
  await upsert('homework_submissions', hw, 'member_id,session_label,type');
  console.log(`   ${hw.length}건` +
    (homeworkRows.length > hw.length
      ? ` (명단에 없는 인원 ${homeworkRows.length - hw.length}건 무시)` : ''));
}

if (gas.locationMap && Object.keys(gas.locationMap).length) {
  console.log('▶ location_maps');
  const base = {}, links = {};
  for (const [k, v] of Object.entries(gas.locationMap)) {
    if (!k || !v) continue;
    if (k.endsWith('링크')) links[k.slice(0, -2)] = v; else base[k] = v;
  }
  const lm = Object.entries(base).map(([loc, url]) => ({
    location: loc, image_url: url, detail_url: links[loc] || null,
  }));
  await upsert('location_maps', lm, 'location');
  console.log(`   ${lm.length}개`);
}

if (gas.teamLinks && Object.keys(gas.teamLinks).length) {
  console.log('▶ team_links');
  const tl = Object.entries(gas.teamLinks).map(([team, url]) => ({
    cohort_id: COHORT_ID, team, chat_url: url || null,
  }));
  await upsert('team_links', tl, 'cohort_id,team');
  console.log(`   ${tl.length}개`);
}

console.log('\n🎉 동기화 완료');
