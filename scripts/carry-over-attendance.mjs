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
//   - 새 기수에서 이미 기록이 있는 칸은 덮지 않는다 (빈칸만 채운다).
//     딱 하나 예외: 지난 기수에 과제로 인정받은 주차가 X 로 잡혀 있으면 ◎ 로 바꾼다.
//     이미 인정받은 주차를 다시 들으라는 게 되어 규칙과 어긋나기 때문이다.
//     O·◎·- 는 어떤 경우에도 건드리지 않는다.
//   - 지난 기수에 결석했지만 과제로 인정받은 주차도 이수로 친다.
//     그 기수에서 이미 인정된 것을 새 기수에서 다시 들으라고 할 수는 없다.
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

// PostgREST 는 한 번에 돌려주는 행 수에 상한이 있다 (Supabase 기본 1000).
// 출석은 인원 × 주차라 금방 넘는다 — 2기만 해도 142명 × 18주차 = 2556행이다.
// 넘으면 오류 없이 조용히 잘려서, 이월 대상이 실제보다 적게 잡힌다.
// range 로 나눠 받는다. 페이지 순서가 흔들리지 않도록 order 는 필수다.
async function selectAll(build, label) {
  const out = [];
  const step = 1000;
  for (let from = 0; from < 500000; from += step) {
    const { data, error } = await build().range(from, from + step - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < step) break;
  }
  return out;
}

async function loadCohort(cohortId, { activeOnly }) {
  const members = await selectAll(() => {
    let q = sb.from('members').select('id,name,phone,team,status')
      .eq('cohort_id', cohortId).order('id');
    if (activeOnly) q = q.eq('status', 'active');
    return q;
  }, `${cohortId} members`);

  const sessions = await selectAll(() => sb
    .from('sessions').select('session_date,label,label_norm,is_class')
    .eq('cohort_id', cohortId).order('session_date'), `${cohortId} sessions`);

  const ids = new Set(members.map(m => m.id));
  const dates = sessions.map(s => s.session_date);
  // 세션 날짜로 걸러야 다른 기수 출결까지 끌어오지 않는다
  const attendance = (await selectAll(() => sb
    .from('attendance').select('member_id,session_date,status')
    .in('session_date', dates)
    .order('member_id').order('session_date'), `${cohortId} attendance`))
    .filter(a => ids.has(a.member_id));

  return { members, sessions, attendance };
}

// 지난 기수에서 과제로 보충 인정받은 주차 (결석했지만 이수로 처리된 것).
// 규칙: 그 기수에서 이미 인정받았으므로 새 기수에서도 이수로 본다.
async function loadMakeupPassed(cohortId) {
  return selectAll(() => sb
    .from('v_makeup_detail').select('member_id,session_label')
    .eq('cohort_id', cohortId).eq('counted', true)
    .order('member_id').order('session_label'), `${cohortId} makeup`);
}

const prev = await loadCohort(FROM, { activeOnly: false });   // 지난 기수는 하차자도 본다
const next = await loadCohort(TO,   { activeOnly: true });
const prevMakeup = await loadMakeupPassed(FROM);

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
// 지난 기수에서 "이수한" 주차 = 출석(O) 또는 지난 기수 이수 이월(◎)
//
// '과제'(과제·소감문으로 메운 결석)는 여기 넣지 않는다. 그건 결석이고,
// 이수 인정은 v_makeup_detail 을 거쳐야 3회 한도(makeup_limit)가 적용된다.
// 여기 넣으면 한도를 우회해 4회, 5회를 낸 사람까지 통째로 이수로 친다.
const PASSED = new Set(['O', '◎']);

const prevDateToLabel = new Map(
  prev.sessions.filter(s => s.is_class && s.label_norm).map(s => [s.session_date, s.label_norm]));

const prevAttByMember = new Map();
const addPassed = (memberId, label) => {
  if (!prevAttByMember.has(memberId)) prevAttByMember.set(memberId, new Set());
  prevAttByMember.get(memberId).add(label);
};

for (const a of prev.attendance) {
  const label = prevDateToLabel.get(a.session_date);
  if (!label) continue;                                   // 교제·나눔·미매핑은 제외
  if (!PASSED.has(String(a.status ?? '').trim().toUpperCase())) continue;
  addPassed(a.member_id, label);
}

// 결석했지만 과제로 인정받은 주차도 이수로 친다.
// 그 기수에서 이미 인정된 것을 새 기수에서 다시 들으라고 할 수는 없다.
const makeupLabels = new Set();
for (const d of prevMakeup) {
  if (!d.session_label) continue;
  addPassed(d.member_id, d.session_label);
  makeupLabels.add(`${d.member_id}|${d.session_label}`);
}
console.log(`   ${FROM} 과제 보충 인정: ${prevMakeup.length}건 (출석과 같이 이수로 친다)\n`);

// v_makeup_detail 이 옛 정의('X' 만)인지 여기서 잡는다.
//
// 지난 기수에 '과제' 로 적힌 칸이 있는데 보충 인정이 0건이면,
// supabase/views.sql 의 is_absent() 반영이 안 된 것이다.
// 그대로 진행하면 그 사람들의 이수분이 통째로 누락되는데 오류는 나지 않는다 —
// 로그에는 '이미 기록 있음'(alreadyFilled)만 늘어난다.
// 이월은 dry-run 이 기본이라 사람이 결과를 보는 자리다. 여기서 멈추면 놓칠 수 없다.
{
  const marked = prev.attendance
    .filter(a => prevDateToLabel.has(a.session_date))
    .filter(a => String(a.status ?? '').trim().toUpperCase() === '과제').length;
  if (marked > 0 && prevMakeup.length === 0) {
    console.error(`❌ ${FROM} 에 '과제' 로 적힌 칸이 ${marked}개인데 보충 인정이 0건입니다.`);
    console.error('');
    console.error("   supabase/views.sql 의 v_makeup_detail 이 아직 결석을 'X' 로만 봅니다.");
    console.error('   is_absent() 를 쓰도록 고친 views.sql 을 Supabase 에서 재실행한 뒤 다시 돌리세요.');
    console.error('   그대로 진행하면 그 주차들이 새 기수로 이월되지 않습니다 (오류 없이).');
    process.exit(1);
  }
}

// 같은 사람이 지난 기수에 두 번 등장할 수 있다(재등록). 이수 주차를 합친다.
const prevPassedByKey = new Map();
const prevMakeupByKey = new Map();   // 그중 과제로 인정받은 주차 (보고용)
for (const m of prev.members) {
  const passed = prevAttByMember.get(m.id);
  if (!passed?.size) continue;
  const k = key(m);
  if (!prevPassedByKey.has(k)) prevPassedByKey.set(k, new Set());
  for (const label of passed) {
    prevPassedByKey.get(k).add(label);
    if (makeupLabels.has(`${m.id}|${label}`)) {
      if (!prevMakeupByKey.has(k)) prevMakeupByKey.set(k, new Set());
      prevMakeupByKey.get(k).add(label);
    }
  }
}

// 새 기수에 이미 적혀 있는 값. 무엇이 적혀 있는지까지 알아야
// 'X 인 보충 주차만 덮는다' 를 판단할 수 있다.
const nextValue = new Map();
for (const a of next.attendance) {
  const v = String(a.status ?? '').trim();
  if (v !== '') nextValue.set(`${a.member_id}|${a.session_date}`, v);
}

const nextClassSessions = next.sessions.filter(s => s.is_class && s.label_norm);

// ---------------------------------------------------------------- plan
const rows = [];
const report = [];
let matched = 0;
const alreadyFilled = [];   // 이수 이력은 있는데 그 주차에 이미 기록이 있는 사람

for (const m of next.members) {
  const passed = prevPassedByKey.get(key(m));
  if (!passed?.size) continue;
  matched++;

  const fromMakeup = prevMakeupByKey.get(key(m)) || new Set();
  const marks = [];
  let makeupMarks = 0;
  let overwrites = 0;
  let collided = 0;
  for (const s of nextClassSessions) {
    if (!passed.has(s.label_norm)) continue;

    const cur = nextValue.get(`${m.id}|${s.session_date}`) ?? '';
    const isMakeup = fromMakeup.has(s.label_norm);

    if (cur !== '') {
      // 이미 값이 있으면 원칙은 그대로 둔다.
      //
      // 예외 하나: 지난 기수에 과제로 인정받은 주차가 새 기수에서 X 로 잡혀 있는 경우.
      // 그 X 는 "새 기수에서 아직 안 들었다"는 뜻으로 찍힌 것인데,
      // 이미 인정받은 주차를 다시 들으라는 얘기가 되어 규칙과 어긋난다.
      // 그 좁은 경우에만 ◎ 로 바꾼다. O·◎·- 는 어떤 경우에도 건드리지 않는다.
      if (!(isMakeup && cur.toUpperCase() === 'X')) { collided++; continue; }
      overwrites++;
    }

    rows.push({ member_id: m.id, session_date: s.session_date, status: '◎' });
    // 과제로 인정받은 주차는 눈에 띄게 표시한다 (출석해서 이수한 것과 구분)
    marks.push(isMakeup ? `${s.label_norm}*${cur ? '(X→◎)' : ''}` : s.label_norm);
    if (isMakeup) makeupMarks++;
  }
  if (marks.length) report.push({ name: m.name, phone: m.phone, team: m.team, marks, makeupMarks, overwrites });
  else alreadyFilled.push({ name: m.name, phone: m.phone, team: m.team, collided });
}

console.log(`👥 ${TO} 인원 중 ${FROM} 이수 이력이 있는 사람: ${matched}명`);
console.log(`◎  새로 찍을 칸: ${rows.length}개 · 대상 ${report.length}명\n`);

// matched 와 report.length 가 다르면 왜 다른지 밝힌다.
// 조용히 넘어가면 '왜 23명 중 10명만 찍히지?' 하고 헤매게 된다.
if (alreadyFilled.length) {
  console.log(`ℹ️  나머지 ${alreadyFilled.length}명은 찍을 칸이 없습니다:`);
  for (const r of alreadyFilled.slice(0, 30)) {
    console.log(r.collided > 0
      ? `   ${r.team || '-'} ${r.name}${r.phone || ''}  이미 그 ${r.collided}개 주차에 기록이 있음`
      : `   ${r.team || '-'} ${r.name}${r.phone || ''}  ${TO} 커리큘럼과 겹치는 주차 없음`);
  }
  if (alreadyFilled.length > 30) console.log(`   … 외 ${alreadyFilled.length - 30}명`);
  console.log('');
}

if (report.length) {
  const totalMakeup = report.reduce((n, r) => n + (r.makeupMarks || 0), 0);
  const totalOver = report.reduce((n, r) => n + (r.overwrites || 0), 0);
  console.log(`상세:  (* 는 ${FROM} 에서 과제로 인정받은 주차 — ${totalMakeup}개` +
              (totalOver ? `, 그중 X→◎ 로 바꾼 것 ${totalOver}개` : '') + ')');
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
