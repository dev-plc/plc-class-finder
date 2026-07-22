#!/usr/bin/env node
// data.live.json (GAS 응답 형식) → Supabase 이관.
// upsert 기반이라 재실행 안전.
//
// 사용법:
//   npm run migrate:dry
//   npm run migrate
//   npm run migrate -- --cohort=3기 --start-year=2025
//
// 옵션:
//   --dry-run           : 실제 write 없이 변환 결과만 출력
//   --source=path.json  : 데이터 파일 경로 (기본: data.live.json → data.json 순)
//   --cohort=3기        : cohort ID (기본: 3기)
//   --start-year=2025   : 세션 날짜 연도 (기본: 2025)

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

// ---- 인자 파싱 ----------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const getArg = (name) =>
  args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const COHORT_ID   = getArg('cohort')     || process.env.COHORT_ID   || '2기';
const COHORT_NAME = getArg('cohort-name') || process.env.COHORT_NAME || COHORT_ID;
const START_YEAR  = parseInt(getArg('start-year') || process.env.START_YEAR || '2025', 10);
const SOURCE_FILE = getArg('source')
  || (existsSync('data.live.json') ? 'data.live.json' : 'data.json');

// ---- 환경변수 검사 ------------------------------------------------------------
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL 미설정');
  process.exit(1);
}
if (!dryRun && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 미설정. .env.local에 추가하거나 --dry-run 사용.');
  process.exit(1);
}

console.log(`📂 source:     ${SOURCE_FILE}`);
console.log(`🏷️  cohort:     ${COHORT_ID} (${COHORT_NAME})`);
console.log(`📅 start year: ${START_YEAR}`);
console.log(`🔧 mode:       ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log('');

// ---- 데이터 로드 --------------------------------------------------------------
const raw = JSON.parse(readFileSync(resolve(SOURCE_FILE), 'utf8'));

let rawRows, locationMapInput = null, teamLinksInput = null;
if (Array.isArray(raw)) {
  rawRows = raw;
} else if (raw && raw.success && Array.isArray(raw.data)) {
  rawRows = raw.data;
  locationMapInput = raw.locationMap || null;
  teamLinksInput = raw.teamLinks || null;
} else {
  console.error('❌ 알 수 없는 데이터 형식.');
  process.exit(1);
}

console.log(`📊 원본 행: ${rawRows.length}`);

// ---- 변환 유틸리티 ------------------------------------------------------------
const trim = (v) => (v == null ? null : String(v).trim() || null);
const toInt = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
};
// 원본 telegram: "true"/"false"/"" → boolean|null
const toTriBool = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'o' || s === '1' || s === 'y') return true;
  if (s === 'false' || s === 'x' || s === '0' || s === 'n') return false;
  return null;
};

const isHeaderRow = (r) =>
  r.name === 'ID' || r.location === 'Location' || r.team === 'Team';

// 세션 컬럼 자동 감지 (MM/DD 형식)
const SESSION_KEY_RE = /^\d{2}\/\d{2}$/;
const detectSessionKeys = (rows) => {
  const keys = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (SESSION_KEY_RE.test(k)) keys.add(k);
    }
  }
  return Array.from(keys).sort();
};
const sessionKeys = detectSessionKeys(rawRows);
console.log(`📅 세션 컬럼: ${sessionKeys.length}개 (${sessionKeys[0]}~${sessionKeys[sessionKeys.length-1]})`);

// MM/DD → YYYY-MM-DD (연도 rollover: 이전 세션보다 월/일이 뒤로 가면 다음 해)
const sessionDates = new Map(); // 'MM/DD' → 'YYYY-MM-DD'
{
  let year = START_YEAR;
  let prev = null;
  for (const k of sessionKeys) {
    const [mm, dd] = k.split('/').map(Number);
    if (prev && (mm < prev.mm || (mm === prev.mm && dd < prev.dd))) year += 1;
    sessionDates.set(k, `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
    prev = { mm, dd };
  }
}

// ---- Members / Attendance 변환 -----------------------------------------------
const members = [];
const attendance = [];
const skipped = [];
const seenKey = new Set();

for (const row of rawRows) {
  if (isHeaderRow(row)) { skipped.push({ reason: 'header', row }); continue; }
  const name = trim(row.name);
  const phone = trim(row.phone);
  if (!name) { skipped.push({ reason: 'missing name', row }); continue; }

  const key = `${name}|${phone || ''}`;
  if (seenKey.has(key)) { skipped.push({ reason: 'duplicate', row }); continue; }
  seenKey.add(key);

  const memberTempId = key; // 이관 후 실제 uuid로 교체
  members.push({
    _key: memberTempId,
    cohort_id: COHORT_ID,
    name,
    phone,
    full_phone: trim(row['연락처']),
    team: trim(row.team),
    team_no: toInt(row['no.']),
    location: trim(row.location),
    role: trim(row.role),
    gender: trim(row.gen),
    age: toInt(row.age),
    marital: trim(row['결혼']),
    pastor: trim(row['담당교역자']),
    telegram_ok: toTriBool(row.telegram),
    sms_ok: toTriBool(row['안내문자']),
    lunch1: trim(row['김밥1차']),
    lunch2: trim(row['김밥2차']),
    note: trim(row['.note']),
    completion: trim(row['수료']),
  });

  for (const k of sessionKeys) {
    const status = row[k];
    // 빈 값도 저장 (미기록 상태 유지) — 이관 후 UI에서 필터
    attendance.push({
      _memberKey: memberTempId,
      session_date: sessionDates.get(k),
      status: status == null ? '' : String(status).trim(),
    });
  }
}

console.log(`✅ 변환: 유효 member ${members.length}행, attendance ${attendance.length}행, 스킵 ${skipped.length}행`);
if (skipped.length) {
  const rc = skipped.reduce((a,s) => (a[s.reason]=(a[s.reason]||0)+1, a), {});
  console.log('   스킵 사유:', rc);
}

// ---- Sessions / Cohort --------------------------------------------------------
const cohortRow = {
  id: COHORT_ID,
  name: COHORT_NAME,
  started_at: sessionDates.get(sessionKeys[0]),
  is_active: true,
};
const sessions = sessionKeys.map((k, i) => ({
  cohort_id: COHORT_ID,
  session_date: sessionDates.get(k),
  label: k,
  session_no: i + 1,
}));

// ---- Location maps ------------------------------------------------------------
const locationMaps = [];
if (locationMapInput && typeof locationMapInput === 'object') {
  const base = {}, links = {};
  for (const [key, url] of Object.entries(locationMapInput)) {
    if (!key || !url) continue;
    if (key.endsWith('링크')) links[key.slice(0, -2)] = url;
    else base[key] = url;
  }
  for (const [loc, imgUrl] of Object.entries(base)) {
    locationMaps.push({
      location: loc,
      image_url: imgUrl,
      detail_url: links[loc] || null,
    });
  }
}
console.log(`🗺️  location_maps: ${locationMaps.length}개`);

// ---- Team links ---------------------------------------------------------------
const teamLinks = [];
if (teamLinksInput && typeof teamLinksInput === 'object') {
  for (const [team, url] of Object.entries(teamLinksInput)) {
    if (!team) continue;
    teamLinks.push({ cohort_id: COHORT_ID, team, chat_url: url || null });
  }
}
console.log(`🔗 team_links: ${teamLinks.length}개`);
console.log('');

// ---- Dry run 종료 -------------------------------------------------------------
if (dryRun) {
  console.log('🔍 DRY RUN — 실제 write 없음.\n');
  console.log('cohort:', cohortRow);
  console.log(`\nsessions 처음 3개:`, sessions.slice(0, 3));
  console.log(`\nmember 처음 2개:`);
  members.slice(0, 2).forEach((m) => {
    const { _key, ...rest } = m;
    console.log(JSON.stringify(rest, null, 2));
  });
  console.log(`\nattendance 처음 3개:`, attendance.slice(0, 3).map(({_memberKey, ...r}) => r));
  console.log(`\nlocation_maps:`, locationMaps);
  console.log(`\nteam_links 처음 3개:`, teamLinks.slice(0, 3));
  process.exit(0);
}

// ---- 실제 이관 ----------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return { count: 0, data: [] };
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict })
    .select();
  if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
  return { count: data?.length ?? rows.length, data };
}

async function main() {
  console.log('▶ cohorts upsert...');
  await upsert('cohorts', [cohortRow], 'id');

  console.log('▶ sessions upsert...');
  await upsert('sessions', sessions, 'cohort_id,session_date');

  console.log('▶ members upsert (배치 100개씩)...');
  // insert with _key stripped, then map _key → returned uuid for attendance
  const keyToUuid = new Map();
  for (let i = 0; i < members.length; i += 100) {
    const batch = members.slice(i, i + 100).map(({ _key, ...m }) => m);
    const r = await upsert('members', batch, 'cohort_id,name,phone');
    // 반환된 데이터에서 uuid 매핑
    for (const returned of r.data) {
      const k = `${returned.name}|${returned.phone || ''}`;
      keyToUuid.set(k, returned.id);
    }
    console.log(`  ${Math.min(i + 100, members.length)}/${members.length}`);
  }

  console.log('▶ attendance upsert (배치 500개씩)...');
  const attRows = attendance
    .map(a => {
      const uuid = keyToUuid.get(a._memberKey);
      if (!uuid) return null;
      return { member_id: uuid, session_date: a.session_date, status: a.status };
    })
    .filter(Boolean);
  for (let i = 0; i < attRows.length; i += 500) {
    const batch = attRows.slice(i, i + 500);
    await upsert('attendance', batch, 'member_id,session_date');
    console.log(`  ${Math.min(i + 500, attRows.length)}/${attRows.length}`);
  }

  if (locationMaps.length) {
    console.log('▶ location_maps upsert...');
    await upsert('location_maps', locationMaps, 'location');
  }
  if (teamLinks.length) {
    console.log('▶ team_links upsert...');
    await upsert('team_links', teamLinks, 'cohort_id,team');
  }

  console.log('\n🎉 이관 완료.');
  console.log('   Supabase Dashboard → Table Editor에서 확인하세요.');
}

main().catch((e) => {
  console.error('\n❌ 이관 중 오류:', e.message);
  process.exit(1);
});
