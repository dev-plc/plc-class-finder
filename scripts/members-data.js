// scripts/members-data.js
//
// 데이터 접근 추상화 계층.
// 목적: script.js·admin.js가 GAS/CSV/DB 등 백엔드 세부사항을 알지 않도록 격리.
//
// Phase A (현재): 내부에서 GAS 호출. localStorage 캐시.
// Phase C (이후): 내부만 Supabase 호출로 교체. 외부 인터페이스 불변.
//
// 사용: <script type="module" src="script.js?v=20"></script>

// ============================================================================
// 백엔드 엔드포인트
// ============================================================================
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec";

// ============================================================================
// 캐시 설정
// ============================================================================
const CACHE_VERSION = 17;
const CK = {
  members:     `plc_members_v${CACHE_VERSION}`,
  locationMap: `plc_location_map_v${CACHE_VERSION}`,
  teamLinks:   `plc_team_links_v${CACHE_VERSION}`,
};

// ============================================================================
// 메모리 상태
// ============================================================================
const state = {
  members: [],
  locationMap: {},
  teamLinks: {},
  loaded: false,
};
const subscribers = new Set();

function notify(event) {
  for (const cb of subscribers) {
    try { cb(event); } catch (e) { console.error('subscriber error', e); }
  }
}

// ============================================================================
// 캐시 I/O
// ============================================================================
function readCacheSync() {
  try {
    const m  = localStorage.getItem(CK.members);
    const lm = localStorage.getItem(CK.locationMap);
    const tl = localStorage.getItem(CK.teamLinks);
    if (!m) return false;
    state.members     = JSON.parse(m);
    state.locationMap = lm ? JSON.parse(lm) : {};
    state.teamLinks   = tl ? JSON.parse(tl) : {};
    state.loaded = true;
    return true;
  } catch (e) {
    console.warn('캐시 읽기 실패, 무시:', e);
    return false;
  }
}

function writeCacheSync() {
  try {
    localStorage.setItem(CK.members,     JSON.stringify(state.members));
    localStorage.setItem(CK.locationMap, JSON.stringify(state.locationMap));
    localStorage.setItem(CK.teamLinks,   JSON.stringify(state.teamLinks));
  } catch (e) {
    console.warn('캐시 쓰기 실패, 무시:', e);
  }
}

// ============================================================================
// 서버 통신 (Phase A: GAS)
// ============================================================================
async function fetchFromServer() {
  const url = GAS_API_URL + "?t=" + Date.now();
  const res = await fetch(url);
  const result = await res.json();
  if (!result.success) throw new Error('서버 응답 실패');
  return {
    members:     Array.isArray(result.data) ? result.data : [],
    locationMap: result.locationMap || {},
    teamLinks:   result.teamLinks || {},
  };
}

async function postAttendance(name, phone, status) {
  // GAS Apps Script는 { name, phone, status } 형식만 인식
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ name, phone, status }),
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.message || '출석 업데이트 실패');
  return result;
}

// ============================================================================
// 공개 API
// ============================================================================

/**
 * 캐시를 메모리로 로드. 없으면 false 반환.
 */
export function loadCache() {
  return readCacheSync();
}

/**
 * 서버에서 최신 데이터를 강제로 받아와 메모리·캐시 갱신.
 * @returns {Promise<boolean>} 성공 여부
 */
export async function refresh() {
  const fresh = await fetchFromServer();
  state.members     = fresh.members;
  state.locationMap = fresh.locationMap;
  state.teamLinks   = fresh.teamLinks;
  state.loaded = true;
  writeCacheSync();
  notify({ type: 'refresh' });
  return true;
}

/**
 * 캐시 우선 로드. 캐시 히트면 즉시 반환하고 백그라운드로 refresh.
 * 캐시 미스면 서버 응답을 기다림.
 *
 * @param {object} opts
 * @param {boolean} opts.forceRefresh — 캐시 무시하고 서버 우선
 * @param {(err: Error) => void} opts.onBackgroundRefreshError — 백그라운드 갱신 실패 콜백
 * @returns {Promise<{cacheHit: boolean, backgroundRefreshing: boolean}>}
 */
export async function ensureLoaded({ forceRefresh = false, onBackgroundRefreshError } = {}) {
  const cacheHit = !forceRefresh && loadCache();
  if (cacheHit) {
    notify({ type: 'cache-hit' });
    // 백그라운드 refresh (await 안 함)
    refresh().catch(err => {
      console.warn('백그라운드 refresh 실패:', err);
      if (onBackgroundRefreshError) onBackgroundRefreshError(err);
    });
    return { cacheHit: true, backgroundRefreshing: true };
  }
  // 캐시 없음 — 서버 응답 대기
  await refresh();
  return { cacheHit: false, backgroundRefreshing: false };
}

/**
 * 현재 로드된 전체 인원 배열 (읽기 전용으로 사용 권장).
 */
export function getMembers() {
  return state.members;
}

/**
 * (name, phone) 조합으로 단일 인원 조회.
 * 기존 script.js와 동일 매칭 로직: (name+phone) 결합 문자열 exact match.
 */
export function findMember(name, phone) {
  const target = (name || '').trim().replace(/\s/g, '') + (phone || '').trim().replace(/[^0-9]/g, '');
  if (!target) return null;
  return state.members.find(m => (m.id === target || (m.name + m.phone) === target)) || null;
}

/**
 * 특정 조 소속 인원 배열.
 */
export function getTeamMembers(teamName) {
  if (!teamName) return [];
  return state.members.filter(m => m.team === teamName);
}

/**
 * 장소 지도 이미지 URL.
 */
export function getLocationImage(location) {
  if (!location) return null;
  return state.locationMap[String(location).trim()] || null;
}

/**
 * 조 채팅방 링크.
 */
export function getTeamLink(teamName) {
  if (!teamName) return null;
  return state.teamLinks[teamName] || null;
}

/**
 * 새가족교육안내방 링크 (특수).
 */
export function getGeneralAnnouncementLink() {
  return state.teamLinks['새가족교육안내방'] || null;
}

/**
 * 출석 토글. Optimistic update: 로컬 먼저 갱신 → 서버 실패 시 롤백.
 * @param {string} name
 * @param {string} phone
 * @param {boolean} present — 체크 상태
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
export async function updateAttendance(name, phone, present) {
  const status = present ? 'O' : 'X';
  const idx = state.members.findIndex(m => m.name === name && m.phone === phone);
  if (idx < 0) return { success: false, error: new Error('인원을 찾을 수 없음') };

  const previous = state.members[idx].attendance ?? '';
  state.members[idx].attendance = status;
  writeCacheSync();
  notify({ type: 'attendance-optimistic', name, phone, status });

  try {
    await postAttendance(name, phone, status);
    notify({ type: 'attendance-confirmed', name, phone, status });
    return { success: true };
  } catch (err) {
    state.members[idx].attendance = previous;
    writeCacheSync();
    notify({ type: 'attendance-rollback', name, phone, status: previous });
    return { success: false, error: err };
  }
}

/**
 * 데이터 변경 이벤트 구독.
 * @param {(event: {type: string, [key:string]: any}) => void} callback
 * @returns {() => void} 해지 함수
 */
export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * 캐시 존재 여부 및 통계.
 */
export function getCacheInfo() {
  return {
    loaded: state.loaded,
    memberCount: state.members.length,
    teamCount: new Set(state.members.map(m => m.team).filter(Boolean)).size,
    locationCount: Object.keys(state.locationMap).length,
    teamLinkCount: Object.keys(state.teamLinks).length,
    cacheKeys: CK,
  };
}

/**
 * 캐시 완전 삭제 (진단·리셋용).
 */
export function clearCache() {
  Object.values(CK).forEach(k => localStorage.removeItem(k));
  state.members = [];
  state.locationMap = {};
  state.teamLinks = {};
  state.loaded = false;
  notify({ type: 'cache-cleared' });
}
