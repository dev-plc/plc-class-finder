// Supabase 접속 설정.
//
// anon 키는 공개돼도 안전하다 — RLS 정책이 실제 접근을 제어한다.
// 이 파일은 읽기 전용 창구다. 쓰기는 sbPostGas(GAS) 로만 나간다.

export const SUPABASE_URL = 'https://wvpqdicsqjozhxtxsnin.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHFkaWNzcWpvemh4dHhzbmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTA3OTMsImV4cCI6MjEwMDI2Njc5M30.-_vV9lQYoWMZMqEahveSz4fT5psTbF3feKfBZ28qG0w';

// 출결 쓰기 창구.
//
// 읽기는 Supabase 에서 바로 하지만(빠르다), 쓰기는 이 URL 로만 간다.
// 출결의 원본이 시트이기 때문이다 — GAS 가 시트에 먼저 쓰고 DB 에 밀어넣는다.
// 앱이 DB 를 직접 쓰면 시트와 두 곳에서 쓰는 꼴이 되어 반드시 어긋난다.
//
// ⚠️ GAS 웹앱은 application/json 을 받으면 preflight 때문에 CORS 로 막힌다.
//    반드시 text/plain 으로 보낼 것 (아래 sbPostGas 가 그렇게 한다).
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec';

/**
 * GAS 웹앱에 POST. 응답은 { success, message, ... } 형태.
 */
export async function sbPostGas(body) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GAS 응답 실패 (${res.status})`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'GAS 저장 실패');
  return json;
}

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
 * 나눠서 전부 가져온다.
 *
 * PostgREST 는 한 번에 돌려주는 행 수에 상한이 있다 (Supabase 기본 1000).
 * 출석은 인원 × 주차라 금방 넘어간다 — 83명 × 19주차면 벌써 1577행이다.
 * 상한에 걸리면 조용히 잘려서, 화면에는 "출석 0" 인데 DB 뷰는 10 이라고 하는
 * 앞뒤가 안 맞는 상태가 된다.
 *
 * path 에 order 를 반드시 넣되, **고유한 키로** 넣을 것. 정렬이 없거나
 * 같은 값이 여러 행에 걸리면 페이지마다 순서가 흔들려 빠지거나 겹친다.
 * 있으나 마나 한 order 가 규칙을 지킨 것처럼 보이는 게 더 위험하다 —
 * homework_submissions 를 order=session_label,type 로 읽던 때가 그랬다.
 * 한 페이지(1000)에 다 들어오는 동안은 멀쩡해 보인다.
 */
export async function sbSelectAll(path, pageSize = 1000) {
  const out = [];
  for (let offset = 0; offset < 500000; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await sbSelect(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}


// 참고: DB 에 직접 쓰는 RPC 헬퍼(sbRpc)는 일부러 두지 않는다.
// 출결의 원본은 시트이고, 앱의 쓰기는 sbPostGas 로만 나가야 한다.
// 직접 쓰는 길을 열어 두면 언젠가 누군가 그 길로 가고,
// 그 순간 시트와 DB 두 곳에서 쓰는 상태로 돌아간다.

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
