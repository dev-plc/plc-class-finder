// Supabase 접속 설정.
//
// anon 키는 공개돼도 안전하다 — RLS 정책과 RPC 권한이 실제 접근을 제어한다.
// 쓰기는 set_attendance / set_attendance_batch 함수로만 가능하고,
// 테이블 직접 쓰기는 막혀 있다.

export const SUPABASE_URL = 'https://wvpqdicsqjozhxtxsnin.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w';

// 첫 조회 전(네트워크 실패 포함) 폴백. 평소에는 쓰이지 않는다.
export const DEFAULT_COHORT_ID = '2기';
const ACTIVE_COHORT_KEY = 'plc_active_cohort';

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

// ============================================================================
// 활성 기수
//
// 기수를 코드에 박아두면 3기·4기로 넘어갈 때마다 배포를 해야 한다.
// cohorts.is_active 를 진실로 삼아, DB에서 한 줄 바꾸면 앱이 따라오게 한다.
// ============================================================================

/**
 * 직전에 확인된 기수. 네트워크를 타지 않으므로 캐시를 즉시 읽을 때 쓴다.
 * 한 번도 조회한 적 없으면 null.
 */
export function getCachedCohortId() {
  try { return localStorage.getItem(ACTIVE_COHORT_KEY); } catch { return null; }
}

/**
 * 지금 활성화된 기수 ID. 조회 실패 시 마지막으로 알던 값 → 기본값 순으로 물러선다.
 */
export async function getActiveCohortId() {
  try {
    const rows = await sbSelect(
      'cohorts?select=id&is_active=is.true&order=started_at.desc.nullslast&limit=1');
    const id = rows?.[0]?.id;
    if (id) {
      try { localStorage.setItem(ACTIVE_COHORT_KEY, id); } catch { /* 무시 */ }
      return id;
    }
    console.warn('활성 기수가 지정돼 있지 않습니다 (cohorts.is_active).');
  } catch (e) {
    console.warn('활성 기수 조회 실패, 마지막 값 사용:', e);
  }
  return getCachedCohortId() || DEFAULT_COHORT_ID;
}
