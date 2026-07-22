#!/usr/bin/env node
// Supabase 연결 확인 스크립트.
// anon 키로 SELECT 시도 후 결과/에러 보고.

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ .env.local에 SUPABASE_URL 또는 SUPABASE_ANON_KEY 없음.');
  process.exit(1);
}

console.log(`🌐 URL: ${SUPABASE_URL}`);
console.log(`🔑 anon key: ${SUPABASE_ANON_KEY.slice(0, 20)}...`);
console.log(`🔒 service_role: ${SUPABASE_SERVICE_ROLE_KEY ? '있음' : '없음 (이관 시 필요)'}`);
console.log('');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log('▶ cohorts 테이블 SELECT 시도...');
  const { data, error } = await supabase.from('cohorts').select('*').limit(5);

  if (error) {
    if (error.code === '42P01') {
      console.error('❌ cohorts 테이블이 존재하지 않음.');
      console.error('   → Supabase Dashboard → SQL Editor에서 supabase/schema.sql을 먼저 실행하세요.');
    } else if (error.message?.includes('permission denied')) {
      console.error('❌ 권한 거부 (GRANT 또는 RLS 문제).');
      console.error('   → supabase/schema.sql 전체를 실행했는지 확인하세요.');
    } else {
      console.error('❌ 에러:', error);
    }
    process.exit(1);
  }

  console.log(`✅ 연결 성공. cohorts 레코드 수: ${data.length}`);
  if (data.length > 0) console.log('   데이터:', data);
  else console.log('   (아직 데이터 없음 — 이관 스크립트 실행 필요)');

  console.log('\n▶ members 테이블 SELECT 시도...');
  const { data: m, error: mErr } = await supabase.from('members').select('id', { count: 'exact' }).limit(1);
  if (mErr) {
    console.error('❌ members:', mErr.message);
    process.exit(1);
  }
  console.log(`✅ members 테이블 접근 가능.`);
}

main();
