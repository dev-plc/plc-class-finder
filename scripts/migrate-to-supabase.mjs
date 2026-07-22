#!/usr/bin/env node
// data.live.json (또는 fallback: data.json) → Supabase 이관.
// upsert 기반이므로 재실행 안전.
//
// 사용법:
//   node scripts/migrate-to-supabase.mjs --dry-run
//   node scripts/migrate-to-supabase.mjs
//   COHORT_ID=25기 node scripts/migrate-to-supabase.mjs
//
// 옵션:
//   --dry-run           : 실제 write 없이 변환 결과만 출력
//   --source=path.json  : 데이터 파일 경로 override
//   --cohort=25기       : cohort ID override

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

// --- 인자 파싱 ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceArg = args.find(a => a.startsWith('--source='))?.split('=')[1];
const cohortArg = args.find(a => a.startsWith('--cohort='))?.split('=')[1];

const COHORT_ID = cohortArg || process.env.COHORT_ID || '25기';
const COHORT_NAME = process.env.COHORT_NAME || COHORT_ID;
const SOURCE_FILE = sourceArg
  || (existsSync('data.live.json') ? 'data.live.json' : 'data.json');

// --- 환경변수 검사 ---
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL 미설정');
  process.exit(1);
}
if (!dryRun && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 미설정. .env.local에 추가 후 재시도.');
  console.error('   또는 --dry-run 으로 변환 결과만 먼저 확인 가능.');
  process.exit(1);
}

console.log(`📂 source: ${SOURCE_FILE}`);
console.log(`🏷️  cohort: ${COHORT_ID} (${COHORT_NAME})`);
console.log(`🔧 mode:   ${dryRun ? 'DRY RUN (write 없음)' : 'LIVE (실제 이관)'}`);
console.log('');

// --- 데이터 로드 ---
const raw = JSON.parse(readFileSync(resolve(SOURCE_FILE), 'utf8'));

// GAS 응답과 data.json 두 형식 모두 지원
let rawRows;
let locationMapInput = null;
let teamLinksInput = null;
if (Array.isArray(raw)) {
  rawRows = raw;
} else if (raw && raw.success && Array.isArray(raw.data)) {
  rawRows = raw.data;
  locationMapInput = raw.locationMap || null;
  teamLinksInput = raw.teamLinks || null;
} else {
  console.error('❌ 알 수 없는 데이터 형식. Array 또는 { success, data } 기대.');
  process.exit(1);
}

console.log(`📊 원본 행 수: ${rawRows.length}`);

// --- 변환 ---
const normalizeBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'O' || s === 'TRUE' || s === '1' || s === 'Y';
};
const normalizeStr = (v) => (v == null ? null : String(v).trim() || null);
const normalizeInt = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const isHeaderRow = (r) =>
  r.name === 'ID' || r.location === 'Location' || r.team === 'Team';

const members = [];
const seen = new Set();
const skipped = [];
const uniqueLocations = new Map(); // location → mapImage

for (const row of rawRows) {
  if (isHeaderRow(row)) { skipped.push({ reason: 'header row', row }); continue; }
  const name = normalizeStr(row.name);
  const phone = normalizeStr(row.phone);
  if (!name || !phone) { skipped.push({ reason: 'missing name/phone', row }); continue; }

  const key = `${name}|${phone}`;
  if (seen.has(key)) { skipped.push({ reason: 'duplicate', row }); continue; }
  seen.add(key);

  const location = normalizeStr(row.location);
  const mapImage = normalizeStr(row.mapImage);
  if (location && mapImage && !uniqueLocations.has(location)) {
    uniqueLocations.set(location, mapImage.replace(/\\/g, '/'));
  }

  members.push({
    cohort_id: COHORT_ID,
    name,
    phone,
    team: normalizeStr(row.team),
    location,
    lunch: normalizeBool(row.lunch),
    age: normalizeInt(row.age),
    role: normalizeStr(row.role),
    attendance: normalizeBool(row.attendance),
  });
}

console.log(`✅ 변환 완료: 유효 ${members.length}행, 스킵 ${skipped.length}행`);
if (skipped.length) {
  const reasonCounts = skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {});
  console.log('   스킵 사유:', reasonCounts);
}
console.log('');

// --- Location maps 준비 ---
const locationMaps = [];
if (locationMapInput && typeof locationMapInput === 'object') {
  for (const [loc, url] of Object.entries(locationMapInput)) {
    if (loc && url) locationMaps.push({ location: loc, image_url: String(url).replace(/\\/g, '/') });
  }
} else {
  for (const [loc, url] of uniqueLocations) {
    locationMaps.push({ location: loc, image_url: url });
  }
}
console.log(`🗺️  location_maps: ${locationMaps.length}개`);

// --- Team links 준비 ---
const teamLinks = [];
if (teamLinksInput && typeof teamLinksInput === 'object') {
  for (const [team, url] of Object.entries(teamLinksInput)) {
    if (team && url) teamLinks.push({ cohort_id: COHORT_ID, team, chat_url: String(url) });
  }
}
console.log(`🔗 team_links: ${teamLinks.length}개`);
console.log('');

// --- Cohort 레코드 ---
const cohortRow = {
  id: COHORT_ID,
  name: COHORT_NAME,
  is_active: true,
};

// --- Dry run 종료 ---
if (dryRun) {
  console.log('🔍 DRY RUN — 실제 write 안 함.');
  console.log('첫 3개 member 미리보기:');
  console.log(JSON.stringify(members.slice(0, 3), null, 2));
  console.log('\ncohort 미리보기:', cohortRow);
  console.log('\nlocation_maps 미리보기:', locationMaps.slice(0, 3));
  process.exit(0);
}

// --- 실제 이관 ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return { count: 0 };
  const { data, error } = await supabase.from(table).upsert(rows, { onConflict }).select('*', { count: 'exact', head: false });
  if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
  return { count: data?.length ?? rows.length };
}

async function main() {
  console.log('▶ cohorts upsert...');
  const c = await upsert('cohorts', [cohortRow], 'id');
  console.log(`  ✅ ${c.count}행`);

  console.log('▶ members upsert (배치 100개씩)...');
  let total = 0;
  for (let i = 0; i < members.length; i += 100) {
    const batch = members.slice(i, i + 100);
    const r = await upsert('members', batch, 'cohort_id,name,phone');
    total += r.count;
    console.log(`  ✅ ${total}/${members.length}`);
  }

  if (locationMaps.length) {
    console.log('▶ location_maps upsert...');
    const l = await upsert('location_maps', locationMaps, 'location');
    console.log(`  ✅ ${l.count}행`);
  }

  if (teamLinks.length) {
    console.log('▶ team_links upsert...');
    const t = await upsert('team_links', teamLinks, 'cohort_id,team');
    console.log(`  ✅ ${t.count}행`);
  }

  console.log('\n🎉 이관 완료.');
  console.log('   Supabase Dashboard → Table Editor에서 확인하세요.');
}

main().catch((e) => {
  console.error('\n❌ 이관 중 오류:', e.message);
  process.exit(1);
});
