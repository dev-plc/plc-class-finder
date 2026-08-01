#!/usr/bin/env node
// DB 조회 — GitHub Actions에서 실행되어 결과를 로그·아티팩트로 남긴다.
// 로컬에서도 실행 가능: PRESET=completion_risk node scripts/query-db.mjs

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const PRESET = process.env.PRESET || process.argv[2] || 'completion_status';
const TEAM   = (process.env.TEAM || process.argv[3] || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PRESETS = {
  completion_status: {
    title: '수료 판정 현황',
    view: 'v_completion_status',
    columns: ['team', 'name', 'phone', 'credited', 'required', 'remaining_needed',
              'absent_count', 'na_count', 'makeup_used', 'verdict'],
    order: { column: 'team' },
  },
  makeup_detail: {
    title: '과제로 출석 인정받은 내역',
    view: 'v_makeup_detail',
    columns: ['team', 'name', 'phone', 'session_label', 'session_date',
              'homework_type', 'seq', 'counted'],
    order: { column: 'team' },
  },
  in_progress: {
    title: '진행중 (중도 합류 — 다음 기수 이어듣기 대상)',
    view: 'v_completion_status',
    columns: ['team', 'name', 'phone', 'credited', 'na_count',
              'absent_count', 'makeup_used', 'verdict'],
    filter: (q) => q.eq('verdict', '진행중'),
    order: { column: 'team' },
  },
  completion_risk: {
    title: '수료 위험자 (남은 강의 다 나와도 미달)',
    view: 'v_completion_risk',
    columns: ['team', 'name', 'phone', 'credited', 'sessions_left',
              'max_possible', 'required', 'absent_count'],
    order: { column: 'team' },
  },
  homework_required: {
    title: '과제 제출 필요 (결석 주차만)',
    view: 'v_homework_required',
    columns: ['team', 'name', 'phone', 'session_label', 'session_date'],
    order: { column: 'team' },
  },
  team_report: {
    title: '조별 요약',
    view: 'v_team_report',
    columns: ['team', 'member_count', 'completed', 'in_progress', 'needs_review',
              'incomplete', 'makeup_total', 'avg_credited', 'avg_pct'],
    order: { column: 'team' },
  },
  needs_admin_review: {
    title: '관리자 확인 필요 (보충 한도 초과 등)',
    view: 'v_completion_status',
    columns: ['team', 'name', 'phone', 'credited', 'makeup_available',
              'makeup_used', 'makeup_overflow', 'admin_note'],
    filter: (q) => q.eq('needs_admin_review', true),
    order: { column: 'team' },
  },
};

const preset = PRESETS[PRESET];
if (!preset) {
  console.error(`❌ 알 수 없는 preset: ${PRESET}`);
  console.error('   사용 가능:', Object.keys(PRESETS).join(', '));
  process.exit(1);
}

let q = sb.from(preset.view).select('*');
if (preset.filter) q = preset.filter(q);
if (TEAM) q = q.eq('team', TEAM);
if (preset.order) q = q.order(preset.order.column, { ascending: true });

const { data, error } = await q;
if (error) {
  console.error('❌ 조회 실패:', error.message);
  process.exit(1);
}

// ---------------------------------------------------------------- 출력
const header = `${preset.title}${TEAM ? ` — ${TEAM}조` : ''}`;
console.log(`\n📋 ${header}`);
console.log(`   ${data.length}건\n`);

if (data.length === 0) {
  console.log('   (해당 없음)');
} else {
  // 콘솔 표
  const cols = preset.columns.filter(c => c in data[0]);
  const widths = cols.map(c =>
    Math.max(c.length, ...data.map(r => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  console.log('   ' + line(cols));
  console.log('   ' + widths.map(w => '─'.repeat(w)).join('  '));
  for (const r of data) console.log('   ' + line(cols.map(c => r[c])));
}

// 아티팩트
writeFileSync('query-result.json', JSON.stringify({ preset: PRESET, team: TEAM || null, count: data.length, rows: data }, null, 2));

const csvCols = data.length ? preset.columns.filter(c => c in data[0]) : preset.columns;
const csv = [csvCols.join(',')]
  .concat(data.map(r => csvCols.map(c => {
    const v = String(r[c] ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')))
  .join('\n');
writeFileSync('query-result.csv', '﻿' + csv);   // BOM: 엑셀 한글 깨짐 방지

console.log('\n💾 query-result.json / query-result.csv 저장됨');
