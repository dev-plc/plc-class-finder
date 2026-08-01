#!/usr/bin/env node
// 임의 SELECT 실행 — 진단·확인용.
// GitHub Actions에서 실행되므로 컨테이너 프록시 allowlist 불필요.
//
// 사용법:
//   SQL="select ..." node scripts/run-sql.mjs
//   node scripts/run-sql.mjs --file=supabase/adhoc.sql
//
// 안전장치: SELECT / WITH 로 시작하는 조회만 허용.

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='))?.split('=')[1];

let sql = process.env.SQL || '';
if (!sql && fileArg && existsSync(fileArg)) sql = readFileSync(fileArg, 'utf8');
if (!sql && existsSync('supabase/adhoc.sql')) sql = readFileSync('supabase/adhoc.sql', 'utf8');

// 선행 주석·빈 줄을 걷어낸 뒤 검사한다 (파일은 대개 설명 주석으로 시작)
function stripLeadingComments(text) {
  let s = text;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    s = s.replace(/^--[^\n]*\n?/, '');   // 줄 주석
    s = s.replace(/^\/\*[\s\S]*?\*\/\s*/, ''); // 블록 주석
    if (s === before) return s;
  }
}

sql = sql.replace(/;+\s*$/, '');
const body = stripLeadingComments(sql).trim();

if (!body) {
  console.error('❌ 실행할 SQL이 없습니다. SQL 환경변수나 supabase/adhoc.sql 을 지정하세요.');
  process.exit(1);
}

// 조회만 허용 (실수로 데이터를 바꾸지 않도록)
if (!/^(select|with)\b/i.test(body)) {
  console.error('❌ SELECT 또는 WITH 로 시작하는 조회만 실행할 수 있습니다.');
  console.error('   데이터 변경은 Supabase SQL Editor 에서 직접 하세요.');
  console.error(`   받은 첫 구문: ${body.slice(0, 60)}…`);
  process.exit(1);
}
if (/;/.test(body)) {
  console.error('❌ 세미콜론이 포함되어 있습니다. 한 번에 하나의 조회만 실행하세요.');
  process.exit(1);
}

// 주석을 제거한 본문만 전달 (DB 함수도 같은 검사를 하므로)
sql = body;

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}

console.log('▶ 실행할 SQL:\n');
console.log(sql.split('\n').map(l => '   ' + l).join('\n'));
console.log('');

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// PostgREST 는 임의 SQL을 받지 않으므로 exec_sql RPC 를 통해 실행한다.
// (supabase/exec_sql.sql 로 미리 만들어 둔 함수)
const { data, error } = await sb.rpc('exec_sql', { query: sql });

if (error) {
  console.error('❌ 실행 실패:', error.message);
  if (error.message.includes('exec_sql')) {
    console.error('\n   exec_sql 함수가 없습니다.');
    console.error('   supabase/exec_sql.sql 을 Supabase SQL Editor 에서 먼저 실행하세요.');
  }
  process.exit(1);
}

const rows = Array.isArray(data) ? data : (data ? [data] : []);
console.log(`📋 ${rows.length}건\n`);

if (rows.length === 0) {
  console.log('   (결과 없음)');
} else {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const width = cols.map(c =>
    Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const line = cells => cells.map((v, i) => String(v ?? '').padEnd(width[i])).join('  ');
  console.log('   ' + line(cols));
  console.log('   ' + width.map(w => '─'.repeat(w)).join('  '));
  for (const r of rows.slice(0, 500)) console.log('   ' + line(cols.map(c => r[c])));
  if (rows.length > 500) console.log(`   … 외 ${rows.length - 500}건 (전체는 아티팩트 참조)`);
}

writeFileSync('sql-result.json', JSON.stringify(rows, null, 2));
console.log('\n💾 sql-result.json 저장됨');
