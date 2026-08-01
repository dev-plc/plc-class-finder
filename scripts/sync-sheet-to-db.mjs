#!/usr/bin/env node
// 시트(GAS) → Supabase 전량 동기화.
// GitHub Actions에서 실행되므로 프록시 allowlist 불필요.
//
// 사용법:
//   node scripts/sync-sheet-to-db.mjs --dry-run
//   node scripts/sync-sheet-to-db.mjs
//   COHORT_ID=2기 node scripts/sync-sheet-to-db.mjs
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GAS_API_URL(선택)

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];

const COHORT_ID  = getArg('cohort') || process.env.COHORT_ID || '2기';
const START_YEAR = parseInt(getArg('start-year') || process.env.START_YEAR || '2026', 10);
const GAS_API_URL = process.env.GAS_API_URL
  || 'https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL) { console.error('❌ SUPABASE_URL 없음'); process.exit(1); }
if (!dryRun && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 없음 (--dry-run 은 가능)');
  process.exit(1);
}

console.log(`🏷️  cohort: ${COHORT_ID} / 기준 연도 ${START_YEAR}`);
console.log(`🔧 mode:   ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

// ---------------------------------------------------------------- helpers
const trim   = (v) => (v == null ? null : String(v).trim() || null);
const toInt  = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };
const toBool = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['true','o','1','y'].includes(s)) return true;
  if (['false','x','0','n'].includes(s)) return false;
  return null;
};
const SESSION_KEY_RE = /^\d{2}\/\d{2}$/;

// 세션명 정규화: '3강 예수...' → '교리3', '성경적대화1' → '성경적대화1'
function normalizeSession(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^성경적대화\s*(\d+)/) || s.match(/^대화\s*(\d+)/);
  if (m) return '성경적대화' + m[1];
  m = s.match(/^교리\s*(\d+)/) || s.match(/^(\d+)\s*강/);
  if (m) return '교리' + m[1];
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
const res = await fetch(GAS_API_URL + '?t=' + Date.now());
if (!res.ok) { console.error(`❌ GAS 응답 실패: HTTP ${res.status}`); process.exit(1); }
const gas = await res.json();
if (!gas.success) { console.error('❌ GAS success=false:', gas.message); process.exit(1); }

const rows       = Array.isArray(gas.data) ? gas.data : [];
const kimbapIn   = gas.kimbap   || {};
const homeworkIn = gas.homework || {};
console.log(`   GAS v${gas.version} · ${rows.length}명 · kimbap ${Object.keys(kimbapIn).length} · homework ${Object.keys(homeworkIn).length}\n`);

if (gas.version < 21) {
  console.warn(`⚠️  GAS 버전이 ${gas.version}입니다. v21 이상 권장 (김밥·과제 필드 포함).\n`);
}

// ---------------------------------------------------------------- transform
// 세션 목록 (출석부 MM/DD 컬럼)
const mmddKeys = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => SESSION_KEY_RE.test(k))))]
  .sort((a, b) => {
    const [am, ad] = a.split('/').map(Number);
    const [bm, bd] = b.split('/').map(Number);
    return am === bm ? ad - bd : am - bm;
  });
const dateOf = buildSessionDates(mmddKeys, START_YEAR);

// 'M/d' · 'MM/dd' · '3/22' 등 표기 차이를 흡수하는 정규 키
function mmddKey(v) {
  const m = String(v ?? '').match(/(\d{1,2})[\/\.\-](\d{1,2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2,'0')}/${String(m[2]).padStart(2,'0')}`;
}

// 커리큘럼 세션인지 (김밥 탭에는 '신규', '수료자 김밥' 같은 운영용 컬럼도 섞여 있다)
const isCurriculumLabel = (norm) =>
  /^교리\d+$/.test(norm) || /^성경적대화\d+$/.test(norm) || norm === '교제' || norm === '나눔';

// 김밥 데이터에서 MM/DD → 세션명 매핑.
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
  ...Array.from({ length: 12 }, (_, i) => `교리${i + 1}`),
  ...Array.from({ length: 4 },  (_, i) => `성경적대화${i + 1}`),
];

// 김밥 탭에서 확인된 비강의 주차 (교제·나눔)
const nonClassKeys = new Set(
  [...mmddToLabel].filter(([, v]) => v === '교제' || v === '나눔').map(([k]) => k)
);

const sessions = [];
let curriculumIdx = 0;
mmddKeys.forEach((k, i) => {
  let norm;
  if (nonClassKeys.has(k)) {
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
    name, phone,
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
      status: r[k] == null ? '' : String(r[k]).trim(),
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
const homeworkRows = [];
for (const [gasId, list] of Object.entries(homeworkIn)) {
  for (const h of (list || [])) {
    const norm = normalizeSession(h.session);
    if (!norm) continue;
    homeworkRows.push({
      _gasId: gasId,
      cohort_id: COHORT_ID,
      session_label: norm,
      session_raw: trim(h.session),
      type: trim(h.type),
      url: trim(h.url),
      submitted_at: h.submittedAt ? new Date(h.submittedAt).toISOString() : null,
    });
  }
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
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function upsert(table, data, onConflict) {
  if (!data.length) return [];
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
await upsert('cohorts', [{
  id: COHORT_ID, name: COHORT_ID, is_active: true,
  started_at: sessions[0]?.session_date ?? null,
}], 'id');

console.log('▶ sessions');
await upsert('sessions', sessions, 'cohort_id,session_date');

console.log('▶ members');
const savedMembers = await upsert(
  'members',
  members.map(({ _key, _id, ...m }) => m).map(m => ({ ...m, status: 'active' })),
  'cohort_id,name,phone'
);

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
  console.log(`   ${kb.length}건`);
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
  console.log(`   ${hw.length}건`);
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
