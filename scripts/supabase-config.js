// Supabase 접속 설정.
//
// anon 키는 공개돼도 안전하다 — RLS 정책과 RPC 권한이 실제 접근을 제어한다.
// 쓰기는 set_attendance / set_attendance_batch 함수로만 가능하고,
// 테이블 직접 쓰기는 막혀 있다.

export const SUPABASE_URL = 'https://wvpqdicsqjozhxtxsnin.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w';

// 현재 활성 기수. cohorts.is_active 로도 조회 가능하지만
// 매 요청마다 확인할 필요가 없어 상수로 둔다.
export const COHORT_ID = '2기';

const REST = `${SUPABASE_URL}/rest/v1`;

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

/**
 * PostgREST 조회.
 * @param {string} path  테이블·뷰 이름과 쿼리스트링 (예: 'members?select=*&cohort_id=eq.2기')
 */
export async function sbSelect(path) {
  const res = await fetch(`${REST}/${path}`, { headers: baseHeaders });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase 조회 실패 (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * RPC 호출 (쓰기는 전부 이 경로를 통한다).
 */
export async function sbRpc(fn, args) {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = body;
    try { msg = JSON.parse(body).message || body; } catch {}
    throw new Error(`${fn} 실패 (${res.status}): ${String(msg).slice(0, 200)}`);
  }
  return res.json();
}
