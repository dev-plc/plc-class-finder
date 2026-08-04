#!/usr/bin/env node
// 지난 기수 이수분(◎)을 새 기수로 옮겨 적는다.
//
// 규칙 (사용자 확정):
//   ◎ 는 대체 출석이 아니라 "지난 기수에 이미 들은 주차"를 뜻하고,
//   수료 카운트에서 출석과 똑같이 인정된다.
//
// 지금까지는 관리자가 지난 기수 시트를 눈으로 훑어 손으로 찍었다.
// 이 스크립트가 그 일을 대신한다.
//
// 안전장치
//   - 기본이 dry-run 이다. 실제로 쓰려면 --apply 를 붙인다.
//   - 새 기수에서 이미 기록이 있는 칸은 절대 덮지 않는다 (빈칸만 채운다).
//   - 강의(is_class=true) 주차만 대상으로 한다. 교제·나눔은 건드리지 않는다.
//   - 짝은 (이름 + 전화 뒷4자리) 가 모두 같을 때만 맺는다.
//
// 사용법
//   node scripts/carry-over-attendance.mjs --from=2기 --to=3기
//   node scripts/carry-over-attendance.mjs --from=2기 --to=3기 --apply
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const args = process.argv.slice(2);
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];

const FROM  = getArg('from') || process.env.FROM_COHORT;
const TO    = getArg('to')   || process.env.TO_COHORT;
const APPLY = args.includes('--apply');

if (!FROM || !TO) {
  console.error('❌ --from=<지난 기수> --to=<새 기수> 가 필요합니다.');
  console.error('   예: node scripts/carry-over-attendance.mjs --from=2기 --to=3기');
  process.exit(1);
}
if (FROM === TO) { console.error('❌ from 과 to 가 같습니다.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log(`🏷️  ${FROM} → ${TO}`);
console.log(`🔧 mode: ${APPLY ? 'APPLY (실제 기록)' : 'DRY RUN (쓰기 없음)'}\n`);

// ---------------------------------------------------------------- load
const key = (m) => `${String(m.name).trim()}|${String(m.phone ?? '').trim()}`;

async function loadCohort(cohortId, { activeOnly }) {
  let q = sb.from('members').select('id,name,phone,team,status').eq('cohort_id', cohortId);
  if (activeOnly) q = q.eq('status', 'active');
  const { data: members, error: e1 } = await q;
  if (e1) throw new Error(`${cohortId} members: ${e1.message}`);

  const { data: sessions, error: e2 } = await sb
    .from('sessions').select('session_date,label,label_norm,is_class')
    .eq('cohort_id', cohortId).order('session_date');
  if (e2) throw new Error(`${cohortId} sessions: ${e2.message}`);

  const ids = members.map(m => m.id);
  const attendance = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from('attendance').select('member_id,session_date,status')
      .in('member_id', ids.slice(i, i + 200));
    if (error) throw new Error(`${cohortId} attendance: ${error.message}`);
    attendance.push(...(data || []));
  }
  return { members, sessions, attendance };
}

const prev = await loadCohort(FROM, { activeOnly: false });   // 지난 기수는 하차자도 본다
const next = await loadCohort(TO,   { activeOnly: true });

console.log(`   ${FROM}: ${prev.members.length}명 · 강의 ${prev.sessions.filter(s => s.is_class).length}개`);
console.log(`   ${TO}:   ${next.members.length}명 · 강의 ${next.sessions.filter(s => s.is_class).length}개\n`);

if (!next.members.length) {
  console.error(`❌ ${TO} 에 인원이 없습니다. 먼저 시트 → DB 동기화를 돌리세요.`);
  process.exit(1);
}
if (!next.sessions.some(s => s.is_class)) {
  console.error(`❌ ${TO} 에 강의 세션이 없습니다. 출석부 탭의 날짜 컬럼을 확인하세요.`);
  process.exit(1);
}

// ---------------------------------------------------------------- index
// 지난 기수에서 "이수한" 주차 = 출석(O) 또는 지난 기수 이수(◎)
const PASSED = new Set(['O', '◎']);

const prevDateToLabel = new Map(
  prev.sessions.filter(s => s.is_class && s.label_norm).map(s => [s.session_date, s.label_norm]));

const prevAttByMember = new Map();
for (const a of prev.attendance) {
  const label = prevDateToLabel.get(a.session_date);
  if (!label) continue;                                   // 교제·나눔·미매핑은 제외
  if (!PASSED.has(String(a.status ?? '').trim().toUpperCase())) continue;
  if (!prevAttByMember.has(a.member_id)) prevAttByMember.set(a.member_id, new Set());
  prevAttByMember.get(a.member_id).add(label);
}

// 같은 사람이 지난 기수에 두 번 등장할 수 있다(재등록). 이수 주차를 합친다.
const prevPassedByKey = new Map();
for (const m of prev.members) {
  const passed = prevAttByMember.get(m.id);
  if (!passed?.size) continue;
  const k = key(m);
  if (!prevPassedByKey.has(k)) prevPassedByKey.set(k, new Set());
  for (const label of passed) prevPassedByKey.get(k).add(label);
}

// 새 기수에서 이미 기록이 있는 칸 (덮지 않기 위해)
const nextFilled = new Set();
for (const a of next.attendance) {
  if (String(a.status ?? '').trim() !== '') nextFilled.add(`${a.member_id}|${a.session_date}`);
}

const nextClassSessions = next.sessions.filter(s => s.is_class && s.label_norm);

// ---------------------------------------------------------------- plan
const rows = [];
const report = [];
let matched = 0;

for (const m of next.members) {
  const passed = prevPassedByKey.get(key(m));
  if (!passed?.size) continue;
  matched++;

  const marks = [];
  for (const s of nextClassSessions) {
    if (!passed.has(s.label_norm)) continue;
    if (nextFilled.has(`${m.id}|${s.session_date}`)) continue;   // 이미 뭔가 적혀 있으면 그대로 둔다
    rows.push({ member_id: m.id, session_date: s.session_date, status: '◎' });
    marks.push(s.label_norm);
  }
  if (marks.length) report.push({ name: m.name, phone: m.phone, team: m.team, marks });
}

console.log(`👥 ${TO} 인원 중 ${FROM} 이수 이력이 있는 사람: ${matched}명`);
console.log(`◎  새로 찍을 칸: ${rows.length}개 (이미 기록된 칸은 건너뜀)\n`);

if (report.length) {
  console.log('상세:');
  for (const r of report.slice(0, 60)) {
    console.log(`   ${r.team || '-'} ${r.name}${r.phone || ''}  ${r.marks.length}개 · ${r.marks.join(', ')}`);
  }
  if (report.length > 60) console.log(`   … 외 ${report.length - 60}명`);
  console.log('');
}

// 이수 이력은 있는데 새 기수 커리큘럼에 없는 주차 → 커리큘럼이 바뀐 신호
const nextLabels = new Set(nextClassSessions.map(s => s.label_norm));
const orphan = new Set();
for (const passed of prevPassedByKey.values()) {
  for (const label of passed) if (!nextLabels.has(label)) orphan.add(label);
}
if (orphan.size) {
  console.warn(`⚠️  ${FROM} 에는 있으나 ${TO} 커리큘럼에 없는 강의 ${orphan.size}종: ${[...orphan].join(', ')}`);
  console.warn('    커리큘럼이 바뀌었다면 그대로 두는 게 맞습니다. 아니면 세션 매핑을 확인하세요.\n');
}

if (!APPLY) {
  console.log('🔍 DRY RUN — 아무것도 쓰지 않았습니다. 실제 반영은 --apply 를 붙이세요.');
  process.exit(0);
}
if (!rows.length) {
  console.log('반영할 것이 없습니다.');
  process.exit(0);
}

// ---------------------------------------------------------------- apply
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from('attendance')
    .upsert(rows.slice(i, i + 500), { onConflict: 'member_id,session_date' });
  if (error) throw new Error(`attendance upsert: ${error.message}`);
}
console.log(`🎉 ${rows.length}개 칸에 ◎ 를 기록했습니다.`);
