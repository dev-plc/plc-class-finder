// scripts/members-data.js
//
// 데이터 접근 계층. UI는 이 파일의 함수만 쓰고 백엔드를 알지 못한다.
// Phase C: 백엔드를 GAS → Supabase 로 교체했다. 외부 인터페이스는 그대로.
//
// 원본 분담 — 전부 시트가 원본이다. DB 는 조회를 빠르게 하려고 두는 사본이다.
//   출석    앱에서 찍으면 GAS 가 시트에 쓰고 DB 에 밀어넣는다.
//           시트에 직접 쳐도 되고, 10분마다 트리거가 DB 를 맞춘다.
//   그 외   일 1회 동기화로 DB 에 들어온다.
//
// 읽기만 Supabase 에서 바로 한다 (빠르다). 쓰기는 반드시 GAS 를 거친다 —
// 앱이 DB 를 직접 쓰면 시트와 두 곳에서 쓰는 꼴이 되어 반드시 어긋난다.

import { matches as hangulMatches } from './hangul.js?v=113';
import { sbSelect, sbSelectAll, sbPostGas, getActiveCohortId, getCachedCohortId } from './supabase-config.js?v=113';

export const MODULE_VERSION = 'members-data v62';

// 보충 인정 한도. supabase/views.sql 의 makeup_limit() 과 같은 값이어야 한다.
export const MAKEUP_LIMIT = 3;

// 조를 이끄는 사람인가 — 수강생이 아니라 섬기는 쪽.
//
// 역할 어휘가 여기 한 곳에만 있어야 한다. 한때 script.js 는 네 갈래를 보고
// admin.js 는 '조장' 을 찾았는데, 시트에는 '조장' 이라고 적히는 일이 없어서
// 관리자 화면의 대표 교역자 칸이 늘 비어 있었다. 증상은 '아무것도 안 뜸'
// 하나뿐이라 어디가 틀렸는지 화면만 봐서는 알 수 없었다.
export function isTutorRole(role) {
  const s = String(role || '');
  return s.includes('튜터')       // 서브튜터도 여기 걸린다
      || s.includes('바나바')
      || s.includes('조장')       // 시트에 이렇게 적히면 그것도 받는다
      || s.includes('관리자');
}

// ============================================================================
// 캐시 설정
// ============================================================================
// localStorage 키 버전. 저장하는 데이터의 모양이 바뀌면 올린다.
// (올리지 않으면 옛 모양이 캐시에서 그대로 나와 화면이 안 바뀐다)
const CACHE_VERSION = 37;
const CK = {
  members:     `plc_members_v${CACHE_VERSION}`,
  locationMap: `plc_location_map_v${CACHE_VERSION}`,
  teamLinks:   `plc_team_links_v${CACHE_VERSION}`,
  homework:    `plc_homework_v${CACHE_VERSION}`,
  kimbap:      `plc_kimbap_v${CACHE_VERSION}`,
  sessions:    `plc_sessions_v${CACHE_VERSION}`,
  progress:    `plc_progress_v${CACHE_VERSION}`,
  needHomework:`plc_need_hw_v${CACHE_VERSION}`,
  cohort:      `plc_cohort_v${CACHE_VERSION}`,
};

// ============================================================================
// 메모리 상태
// ============================================================================
const state = {
  cohortId: null,    // 이 데이터가 어느 기수 것인지 (기수 전환 감지에 쓴다)
  members: [],       // UI 호환 형태 (MM/DD 키 포함)
  sessions: [],      // [{session_date, label, label_norm, is_class, session_no}]
  locationMap: {},
  teamLinks: {},
  homework: {},      // { id: [{session, type, url, submittedAt}, ...] }
  kimbap: {},        // { id: { '교리1': {applied, date}, ... } }
  progress: {},      // { uuid: {credited, required, remaining_needed, ...} }
  needHomework: {},  // { uuid: [{session_label, session_date}, ...] }
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
    const m = localStorage.getItem(CK.members);
    if (!m) return false;
    const get = (k, fallback) => {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    };
    state.members     = JSON.parse(m);
    state.sessions    = get(CK.sessions, []);
    state.locationMap = get(CK.locationMap, {});
    state.teamLinks   = get(CK.teamLinks, {});
    state.homework    = get(CK.homework, {});
    state.kimbap      = get(CK.kimbap, {});
    state.progress     = get(CK.progress, {});
    state.needHomework = get(CK.needHomework, {});
    state.cohortId     = localStorage.getItem(CK.cohort) || getCachedCohortId();
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
    localStorage.setItem(CK.sessions,    JSON.stringify(state.sessions));
    localStorage.setItem(CK.locationMap, JSON.stringify(state.locationMap));
    localStorage.setItem(CK.teamLinks,   JSON.stringify(state.teamLinks));
    localStorage.setItem(CK.homework,    JSON.stringify(state.homework));
    localStorage.setItem(CK.kimbap,      JSON.stringify(state.kimbap));
    localStorage.setItem(CK.progress,     JSON.stringify(state.progress));
    localStorage.setItem(CK.needHomework, JSON.stringify(state.needHomework));
    if (state.cohortId) localStorage.setItem(CK.cohort, state.cohortId);
  } catch (e) {
    console.warn('캐시 쓰기 실패, 무시:', e);
  }
}

// ============================================================================
// DB → UI 형태 변환
// ============================================================================

// 'YYYY-MM-DD' → 'MM/DD' (UI가 이 키로 출결을 읽는다)
function toMMDD(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}` : null;
}

// DB 레코드를 기존 GAS 응답과 같은 모양으로 조립한다.
// UI가 member['03/15'] · member['수료'] 같은 키를 직접 쓰고 있어
// 그 형태를 유지해 UI 변경을 피한다.
function buildMemberRow(m, sessions, attByMember) {
  const row = {
    id: `${m.name}${m.phone || ''}`,
    _uuid: m.id,                       // DB 조회·대조에 쓴다
    name: m.name,
    phone: m.phone || '',
    team: m.team || '',
    location: m.location || '',
    role: m.role || '',
    gen: m.gender || '',
    age: m.age ?? '',
    status: m.status || 'active',
    '연락처': m.full_phone || '',
    '결혼': m.marital || '',
    '담당교역자': m.pastor || '',
    'no.': m.team_no ?? '',
    '.note': m.note || '',
    '수료': m.completion || '',
    '김밥1차': m.lunch1 || '',
    '김밥2차': m.lunch2 || '',
    telegram: m.telegram_ok === true ? 'true' : m.telegram_ok === false ? 'false' : '',
    '안내문자': m.sms_ok === true ? 'true' : m.sms_ok === false ? 'false' : '',
  };

  // 세션별 출결을 MM/DD 키로 펼친다
  const att = attByMember.get(m.id) || new Map();
  let absentCount = 0;
  for (const s of sessions) {
    const key = toMMDD(s.session_date);
    if (!key) continue;
    const v = att.get(s.session_date) ?? '';
    row[key] = v;
    // 결석은 X 와 과제 둘 다다 (supabase/views.sql 의 is_absent 와 같은 규칙).
    // '과제' 는 결석했지만 과제·소감문으로 메운 주차 — 안 나온 것은 같다.
    if (s.is_class && ['X', '과제'].includes(String(v).trim().toUpperCase())) absentCount++;
  }
  row['결석횟수'] = String(absentCount);

  return row;
}

// ============================================================================
// 서버 통신
// ============================================================================

// 판정 결과 두 뷰. 출석이 바뀌면 값이 달라지므로 저장 직후에도 다시 읽는다.
const PROGRESS_QUERY =
  `v_completion_status?select=member_id,credited,required,remaining_needed,` +
  `present_count,absent_count,makeup_used,makeup_available,makeup_overflow,` +
  `unrecorded_count,verdict&cohort_id=eq.`;
const NEED_HW_QUERY =
  `v_homework_required?select=member_id,session_label,session_date&cohort_id=eq.`;

function indexProgress(progress, needHomework) {
  const progressMap = {};
  for (const p of progress) progressMap[p.member_id] = p;

  const needHomeworkMap = {};
  for (const h of needHomework) {
    (needHomeworkMap[h.member_id] ||= []).push({
      sessionLabel: h.session_label,
      sessionDate: h.session_date,
    });
  }
  // 최근 강의부터 (과제 안내는 최근 것이 먼저 눈에 들어와야 한다)
  for (const list of Object.values(needHomeworkMap)) {
    list.sort((a, b) => String(b.sessionDate).localeCompare(String(a.sessionDate)));
  }
  return { progress: progressMap, needHomework: needHomeworkMap };
}

async function fetchFromServer(cohortId) {
  const enc = encodeURIComponent(cohortId);

  const [members, sessions, attendance, kimbap, homework, teamLinks, locationMaps,
         progress, needHomework] =
    await Promise.all([
      // 행 수가 늘어나는 것은 전부 나눠 받는다 (아래 order 는 페이징에 필수)
      //
      // sheet_row 가 앞에 오는 것이 조 순서를 정한다. 시트에 적힌 그대로 따라간다 —
      // 이름으로 짐작하면 새 조가 생길 때마다 어긋난다 ('V3' 가 한글보다 앞서 맨 앞에 왔다).
      // nullslast: 동기화가 아직 안 돌아 sheet_row 가 비어 있으면 뒤의 team,team_no 로
      // 떨어져 예전과 똑같이 동작한다. 배포와 데이터 갱신 사이에 깨지는 구간이 없다.
      sbSelectAll(`members?select=*&cohort_id=eq.${enc}&status=eq.active` +
                  `&order=sheet_row.asc.nullslast,team.asc,team_no.asc,id.asc`),
      sbSelectAll(`sessions?select=*&cohort_id=eq.${enc}&order=session_date`),
      sbSelectAll(`attendance?select=member_id,session_date,status,members!inner(cohort_id)` +
                  `&members.cohort_id=eq.${enc}&order=member_id,session_date`),
      sbSelectAll(`kimbap_signups?select=member_id,session_label,session_date,applied` +
                  `&cohort_id=eq.${enc}&order=member_id,session_label`),
      sbSelectAll(`homework_submissions?select=session_label,session_raw,type,url,submitted_at,members!inner(name,phone)` +
                  `&order=session_label,type`),
      sbSelect(`team_links?select=team,chat_url&cohort_id=eq.${enc}`),
      sbSelect(`location_maps?select=location,image_url,detail_url`),
      // 판정 결과는 DB 뷰에서 그대로 읽는다 (규칙이 views.sql 한 곳에만 있도록)
      sbSelectAll(PROGRESS_QUERY + enc + '&order=member_id'),
      sbSelectAll(NEED_HW_QUERY + enc + '&order=member_id,session_date'),
    ]);

  // 출결을 member_id → (session_date → status) 로 정리
  const attByMember = new Map();
  for (const a of attendance) {
    if (!attByMember.has(a.member_id)) attByMember.set(a.member_id, new Map());
    attByMember.get(a.member_id).set(a.session_date, a.status ?? '');
  }

  const rows = members.map(m => buildMemberRow(m, sessions, attByMember));

  // uuid → 표시용 id 매핑 (김밥·과제를 붙일 때 사용)
  const uuidToId = new Map(members.map(m => [m.id, `${m.name}${m.phone || ''}`]));

  const kimbapMap = {};
  for (const k of kimbap) {
    const id = uuidToId.get(k.member_id);
    if (!id) continue;
    (kimbapMap[id] ||= {})[k.session_label] = {
      applied: k.applied ? 1 : 0,
      date: toMMDD(k.session_date) || '',
    };
  }

  // 김밥 대상자 여부.
  //
  // 신청 내역(kimbap_signups)이 원본이다. 아직 내역이 없는 기수라면
  // 시트 명단의 1·2차 칸으로 대신한다 — 상세 요약(script.js)이 쓰는
  // 순서와 같아야 위아래가 어긋나지 않는다.
  //
  // GAS → Supabase 로 옮길 때 이 필드가 통째로 빠져서,
  // 모달 상단 김밥 칸·조원 목록 🍙·통계 인원이 모두 조용히 죽어 있었다.
  for (const row of rows) {
    const detail = kimbapMap[row.id];
    const applied = detail
      ? Object.values(detail).some(v => v.applied === 1)
      : ['김밥1차', '김밥2차'].some(k => String(row[k]).trim().toUpperCase() === 'O');
    row.lunch = applied ? 'O' : 'X';
  }

  const homeworkMap = {};
  for (const h of homework) {
    if (!h.members) continue;
    const key = `${h.members.name}${h.members.phone || ''}`;
    (homeworkMap[key] ||= []).push({
      session: h.session_raw || h.session_label,
      type: h.type || '',
      url: h.url || '',
      submittedAt: h.submitted_at || '',
    });
  }

  const { progress: progressMap, needHomework: needHomeworkMap } =
    indexProgress(progress, needHomework);

  const teamLinkMap = {};
  for (const t of teamLinks) if (t.team) teamLinkMap[t.team] = t.chat_url || '';

  const locationMap = {};
  for (const l of locationMaps) {
    if (!l.location) continue;
    locationMap[l.location] = l.image_url || '';
    if (l.detail_url) locationMap[`${l.location}링크`] = l.detail_url;
  }

  return {
    members: rows,
    sessions,
    locationMap,
    teamLinks: teamLinkMap,
    homework: homeworkMap,
    kimbap: kimbapMap,
    progress: progressMap,
    needHomework: needHomeworkMap,
  };
}

// ============================================================================
// 공개 API
// ============================================================================

export function loadCache() {
  return readCacheSync();
}

export async function refresh() {
  const cohortId = await getActiveCohortId();
  const previous = state.cohortId;
  const fresh = await fetchFromServer(cohortId);
  // fresh 가 모든 데이터 키를 덮으므로 이전 기수 값은 남지 않는다
  Object.assign(state, fresh, { cohortId, loaded: true });
  writeCacheSync();

  if (previous && previous !== cohortId) {
    console.log(`기수 전환 감지: ${previous} → ${cohortId}`);
    notify({ type: 'cohort-changed', from: previous, to: cohortId });
  }
  notify({ type: 'refresh' });
  return true;
}

export async function ensureLoaded({ forceRefresh = false, onBackgroundRefreshError } = {}) {
  const cacheHit = !forceRefresh && loadCache();
  if (cacheHit) {
    notify({ type: 'cache-hit' });
    refresh().catch(err => {
      console.warn('백그라운드 refresh 실패:', err);
      onBackgroundRefreshError?.(err);
    });
    return { cacheHit: true, backgroundRefreshing: true };
  }
  await refresh();
  return { cacheHit: false, backgroundRefreshing: false };
}

/**
 * 판정 뷰만 다시 읽는다. 출석을 저장하면 수료 진행률·과제 대상이 바뀌므로
 * 전량 refresh 없이 이 두 가지만 갱신한다.
 */
export async function refreshProgress() {
  const enc = encodeURIComponent(state.cohortId || await getActiveCohortId());
  const [progress, needHomework] = await Promise.all([
    sbSelectAll(PROGRESS_QUERY + enc + '&order=member_id'),
    sbSelectAll(NEED_HW_QUERY + enc + '&order=member_id,session_date'),
  ]);
  Object.assign(state, indexProgress(progress, needHomework));
  writeCacheSync();
  notify({ type: 'progress-refresh' });
}

export function getMembers() {
  return state.members;
}

/**
 * 지금 화면에 올라와 있는 데이터의 기수 ID.
 */
export function getCohortId() {
  return state.cohortId;
}

/**
 * 세션 목록. 관리자 출석 화면에서 주차를 고를 때 쓴다.
 */
export function getSessions() {
  return state.sessions;
}

/**
 * (name, phone) 로 단일 인원 조회.
 * 정확 매칭 우선, 실패하면 초성·부분 매칭 (전화번호는 정확 일치 필수).
 */
export function findMember(name, phone) {
  const cleanName = (name || '').trim().replace(/\s/g, '');
  const cleanPhone = (phone || '').trim().replace(/[^0-9]/g, '');
  if (!cleanName || !cleanPhone) return null;

  const target = cleanName + cleanPhone;
  const exact = state.members.find(m => m.id === target || (m.name + m.phone) === target);
  if (exact) return exact;

  return state.members.find(m => m.phone === cleanPhone && hangulMatches(m.name, cleanName)) || null;
}

export function getTeamMembers(teamName) {
  if (!teamName) return [];
  return state.members.filter(m => m.team === teamName);
}

/**
 * 조 이름 목록. 시트 편성 순서(team, team_no)를 그대로 따른다.
 */
export function getTeams() {
  const seen = new Set();
  const out = [];
  for (const m of state.members) {
    if (m.team && !seen.has(m.team)) { seen.add(m.team); out.push(m.team); }
  }
  return out;
}

/**
 * 'YYYY-MM-DD' → 'MM/DD'. 인원 행에서 출결을 읽을 때 쓰는 키.
 */
export function getSessionKey(sessionDate) {
  return toMMDD(sessionDate);
}

export function getLocationImage(location) {
  if (!location) return null;
  return state.locationMap[String(location).trim()] || null;
}

export function getTeamLink(teamName) {
  if (!teamName) return null;
  return state.teamLinks[teamName] || null;
}

// 전체 안내방 (조별방과는 별개다).
//
// 현장은 '새가족교육안내방', 온라인은 '온라인 새가족교육' 이 전체방이다.
// 온라인 조에게 현장 방을 알려 주면 엉뚱한 방으로 들어가고 자기 안내는 못 받는다.
//
// 이름은 띄어쓰기를 지우고 맞춘다. 시트에는 '온라인 새가족교육' 처럼
// 공백이 들어가 있는데, 사람이 적는 칸이라 언제든 '온라인새가족교육' 이
// 되거나 '안내방' 이 붙을 수 있다. 정확히 한 글자만 인정하면 그때 조용히 끊긴다.
//
// 전체방과 조별방은 서로를 막지 않는다 — 조별방이 아직 없는 조(새O1~O4)라도
// 전체방은 떠야 한다. 그래서 두 줄을 따로 그린다.
const ROOM_GENERAL_KEYS = ['새가족교육안내방'];
const ROOM_ONLINE_KEYS  = ['온라인새가족교육', '온라인새가족교육안내방'];

const squashName = (s) => String(s ?? '').replace(/\s+/g, '');

// 링크가 비어 있는 줄은 없는 것으로 본다.
// 새O1~O4 처럼 방이 아직 없는 조는 시트에 줄만 있고 링크 칸이 비어 있다.
function findRoomUrl(keys) {
  const want = new Set(keys);
  for (const [team, url] of Object.entries(state.teamLinks)) {
    if (url && want.has(squashName(team))) return url;
  }
  return null;
}

/** 위치 문자열이 온라인인가. '온라인', '온라인2' 등 모두 걸린다. */
export function isOnlineLocation(location) {
  return /온라인/.test(String(location ?? ''));
}

/**
 * 안내할 전체 안내방.
 *
 * 온라인 전체방이 아직 없으면 현장 방으로 물러서되, name 도 같이 되돌린다 —
 * '온라인' 이라고 적어 놓고 현장 방을 열어 주면 안 뜨는 것보다 나쁘다.
 *
 * @returns {{url: string|null, name: string, online: boolean}}
 */
export function getAnnouncementRoom(location) {
  if (isOnlineLocation(location)) {
    const url = findRoomUrl(ROOM_ONLINE_KEYS);
    if (url) return { url, name: '온라인새가족교육안내방', online: true };
  }
  return { url: findRoomUrl(ROOM_GENERAL_KEYS), name: '새가족교육안내방', online: false };
}

/** 전체 안내방으로 쓰이는 줄인가 (조별방 목록에서 걸러낼 때 쓴다) */
export function isAnnouncementRoomName(name) {
  const k = squashName(name);
  return ROOM_GENERAL_KEYS.includes(k) || ROOM_ONLINE_KEYS.includes(k);
}

/**
 * 본인의 수료 진행 상황.
 * 판정 규칙은 DB 뷰(v_completion_status)에 있고 여기서는 읽기만 한다.
 *
 * @param {object} member  findMember 등이 돌려준 인원 객체
 * @returns {{credited, required, remainingNeeded, presentCount, absentCount,
 *            makeupUsed, makeupAvailable, makeupOverflow, unrecordedCount,
 *            verdict, makeupLeft}|null}
 */
export function getProgress(member) {
  const uuid = member?._uuid;
  if (!uuid) return null;
  const p = state.progress[uuid];
  if (!p) return null;
  return {
    credited:        p.credited ?? 0,
    required:        p.required ?? 16,
    remainingNeeded: p.remaining_needed ?? 0,
    presentCount:    p.present_count ?? 0,
    absentCount:     p.absent_count ?? 0,
    makeupUsed:      p.makeup_used ?? 0,
    makeupAvailable: p.makeup_available ?? 0,
    makeupOverflow:  p.makeup_overflow ?? 0,
    unrecordedCount: p.unrecorded_count ?? 0,
    verdict:         p.verdict ?? '',
    // 남은 보충 기회 (한도 3회 기준)
    makeupLeft: Math.max(0, MAKEUP_LIMIT - (p.makeup_used ?? 0)),
  };
}

/**
 * 제출이 필요한 과제 목록 (결석한 주차 중 미제출).
 * @returns {Array<{sessionLabel: string, sessionDate: string}>} 최근 강의부터
 */
export function getRequiredHomework(member) {
  const uuid = member?._uuid;
  if (!uuid) return [];
  return state.needHomework[uuid] || [];
}

// ============================================================================
// 수료 전망 — 이대로 가면 채울 사람인가
//
// 판정 숫자(credited·absent·makeup)는 v_completion_status 가 준다. 여기서
// 다시 세지 않는다. 이 함수가 더하는 것은 '앞으로 남은 강의가 몇 회인가'
// 하나뿐이고, 그건 판정이 아니라 달력이다.
//
// 관리자 화면(수료 현황 탭)과 튜터 화면(조 요약)이 같은 답을 내야 하므로
// 계산은 여기 한 곳에만 둔다. 문구는 보는 사람이 달라 각 화면이 정한다.
// ============================================================================

// 아직 하지 않은 강의. 오늘 것은 수업이 끝나고 찍으므로 남은 쪽에 넣는다.
export function getRemainingClassSessions() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return state.sessions.filter(s => s.is_class !== false && s.session_date >= today).length;
}

// '수료 예정' 이라고 부를 수 있는 거리. 이 횟수 안에 채울 수 있어야 예정이다.
//
// 기수 초반에는 결석만 없으면 누구나 '남은 걸 다 나오면 채워진다'. 틀린 말은
// 아니지만 그때 예정이라고 부르면 변별력이 없다 — 2주차에 조원 전원이 예정으로
// 뜬다. 곧 끝나는 사람만 예정이라고 부르고, 나머지는 '진행 중' 으로 둔다.
export const ONTRACK_WITHIN = 3;

/**
 * @returns {null | {
 *   p, remain, open, pastUnmarked, gap, maxReach, makeupRoom,
 *   needHomework, needsReview, unmarked,
 *   bucket: 'done'|'ontrack'|'going'|'atrisk'|'gone'
 * }}
 *   done    다 채웠다
 *   ontrack 앞으로 ONTRACK_WITHIN 회 안에 채워진다 (보충 없이)
 *   going   보충 없이 채울 수 있지만 아직 더 남았다
 *   atrisk  그것만으로 모자라 과제·소감문까지 내야 한다
 *   gone    다 채워도 못 미친다
 */
export function getCompletionOutlook(member) {
  const p = getProgress(member);
  if (!p) return null;

  const remain = getRemainingClassSessions();

  // 아직 결과가 안 정해진 주차 = 빈칸 전부.
  //
  // 앞으로 남은 강의만 세면 안 된다. 지난 주차인데 아직 안 찍은 칸도
  // 여전히 O 가 될 수 있다 — 튜터가 나중에 찍으면 된다.
  // 남은 강의만 세던 때는 1·2주차를 안 찍어 둔 조에서 조원이 0/16 으로
  // 잡히고 '다 나와도 못 미친다' 로 떴다. 결석한 적이 없는데도 그랬다.
  //
  // unrecordedCount 는 16개 강의 중 빈칸 전부다 (지난 것 + 앞으로 것).
  const open = p.unrecordedCount;

  // 그중 이미 지나간 것. 이건 전망이 아니라 '찍어야 할 출석' 이다.
  // 앞 주차에 미리 찍힌 값이 있으면 remain 보다 작아질 수 있어 0 으로 막는다.
  const pastUnmarked = Math.max(0, open - remain);

  // 이미 과제를 낸 결석분은 credited 에 들어가 있으므로
  // '결석했지만 아직 안 낸' 주차만 앞으로 더 받을 몫이다.
  const notYet     = Math.max(0, p.absentCount - p.makeupAvailable);
  const makeupRoom = Math.min(p.makeupLeft, notYet);
  const maxReach   = p.credited + open + makeupRoom;
  const gap        = Math.max(0, p.required - p.credited);

  let bucket;
  if (p.credited >= p.required)             bucket = 'done';
  else if (maxReach < p.required)           bucket = 'gone';
  else if (p.credited + open < p.required)  bucket = 'atrisk';
  else if (gap <= ONTRACK_WITHIN)           bucket = 'ontrack';
  else                                      bucket = 'going';

  return { p, remain, open, pastUnmarked, gap, maxReach, makeupRoom, bucket,
           unmarked: pastUnmarked > 0,
           needsReview: p.makeupOverflow > 0,
           needHomework: Math.max(0, gap - open) };
}

export function getKimbapDetail(memberId) {
  return state.kimbap[memberId] || {};
}

export function getHomeworkList(memberId) {
  return state.homework[memberId] || [];
}

/**
 * 과제 제출 URL 칸을 링크 여러 개로 쪼갠다.
 *
 * 한 과제에 파일을 두 개 올리면 폼이 한 칸에 이어 붙여 넣는다.
 *   "https://drive.google.com/open?id=A, https://drive.google.com/open?id=B"
 * 이걸 그대로 href 에 넣으면 주소가 깨져서 둘 다 열리지 않는다.
 * 쉼표·공백·줄바꿈 어느 것으로 이어져 있든 끊는다.
 *
 * 드라이브 링크는 알파벳·숫자·`-`·`_` 뿐이라 쉼표가 주소 안에 들어갈 일은 없다.
 * http 로 시작하는 조각이 하나도 없으면 (주소가 아닌 다른 값이 들어온 경우)
 * 원문을 그대로 한 개로 돌려준다 — 값을 잃지 않는다.
 *
 * @param {string} url 시트의 '제출 URL' 칸 원문
 * @returns {string[]} 링크 배열 (빈 칸이면 빈 배열)
 */
export function splitLinks(url) {
  const raw = String(url || '').trim();
  if (!raw) return [];
  const links = raw.split(/[\s,]+/).filter(s => /^https?:\/\//i.test(s));
  return links.length ? links : [raw];
}

// ============================================================================
// 출석 기록 (DB 가 원본)
// ============================================================================

// 오늘 기준 가장 최근 지난 세션. 출석 체크의 기본 대상.
function currentSessionDate() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const past = state.sessions.filter(s => s.session_date <= todayIso);
  if (past.length) return past[past.length - 1].session_date;
  return state.sessions[0]?.session_date ?? null;
}

export function getCurrentSessionDate() {
  return currentSessionDate();
}

/**
 * 조 단위 출석 일괄 저장.
 * 실패 시 메모리·캐시를 이전 값으로 되돌린다.
 *
 * @param {Array<{name, phone, present}|{memberUuid, status}>} entries
 * @param {string} [sessionDate] 생략하면 가장 최근 지난 세션
 */
export async function updateAttendanceBatch(entries, sessionDate) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { success: false, error: new Error('저장할 항목이 없습니다.') };
  }
  const target = sessionDate || currentSessionDate();
  if (!target) {
    return { success: false, error: new Error('출석 대상 세션을 찾지 못했습니다.') };
  }
  const mmdd = toMMDD(target);

  // 입력을 { uuid, status } 로 정규화
  const payload = [];
  const previous = [];
  for (const e of entries) {
    let row, status;
    if (e.memberUuid) {
      row = state.members.find(m => m._uuid === e.memberUuid);
      status = e.status;
    } else {
      row = state.members.find(m => m.name === e.name && m.phone === e.phone);
      status = e.status ?? (e.present ? 'O' : 'X');
    }
    if (!row?._uuid) continue;
    // GAS 는 시트의 ID(이름+전화 뒷자리)로 행을 찾는다. uuid 는 DB 쪽에서만 쓴다.
    payload.push({ member_id: row._uuid, name: row.name, phone: row.phone, status });
    previous.push({ row, mmdd, value: row[mmdd] ?? '' });
    row[mmdd] = status;                       // optimistic
  }

  if (payload.length === 0) {
    return { success: false, error: new Error('대상 인원을 찾지 못했습니다.') };
  }

  writeCacheSync();
  notify({ type: 'attendance-batch-optimistic', count: payload.length });

  try {
    // 출결의 원본은 시트다. DB 를 직접 쓰지 않고 GAS 를 거친다 —
    // GAS 가 시트에 먼저 쓰고, 같은 값을 DB 에 밀어넣는다.
    // 앱이 DB 를 직접 쓰면 시트와 두 곳에서 쓰는 꼴이 되어 반드시 어긋난다.
    const result = await sbPostGas({
      session: target,
      batch: payload.map(p => ({ name: p.name, phone: p.phone, status: p.status })),
    });
    // GAS 는 시트에 썼지만 DB 반영에 실패할 수 있다. 그래도 저장은 성공이다 —
    // 원본에 들어갔고, 10분 트리거(pushAttendanceToDb)가 곧 맞춰 준다.
    if (result.dbError) console.warn('DB 반영은 잠시 뒤에 됩니다:', result.dbError);
    notify({ type: 'attendance-batch-confirmed', count: result?.updated ?? payload.length });
    // 수료 진행률·과제 대상은 출석에서 파생된다. 저장을 막지 않도록 배경에서 갱신.
    refreshProgress().catch(err => console.warn('진행상황 갱신 실패:', err));
    return {
      success: true,
      updated: result?.updated ?? payload.length,
      session: mmdd,
      skipped: result?.skipped ?? [],
    };
  } catch (err) {
    for (const p of previous) p.row[p.mmdd] = p.value;
    writeCacheSync();
    notify({ type: 'attendance-batch-rollback' });
    return { success: false, error: err };
  }
}

/**
 * 단건 출석 기록.
 */
export async function updateAttendance(name, phone, presentOrStatus, sessionDate) {
  const status = typeof presentOrStatus === 'boolean'
    ? (presentOrStatus ? 'O' : 'X')
    : presentOrStatus;
  return updateAttendanceBatch([{ name, phone, status }], sessionDate);
}

// ============================================================================
// 기타
// ============================================================================

export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getCacheInfo() {
  return {
    loaded: state.loaded,
    cohortId: state.cohortId,
    memberCount: state.members.length,
    sessionCount: state.sessions.length,
    teamCount: new Set(state.members.map(m => m.team).filter(Boolean)).size,
    locationCount: Object.keys(state.locationMap).length,
    teamLinkCount: Object.keys(state.teamLinks).length,
    cacheKeys: CK,
  };
}

export function clearCache() {
  Object.values(CK).forEach(k => localStorage.removeItem(k));
  state.cohortId = null;
  state.members = [];
  state.sessions = [];
  state.locationMap = {};
  state.teamLinks = {};
  state.homework = {};
  state.kimbap = {};
  state.progress = {};
  state.needHomework = {};
  state.loaded = false;
  notify({ type: 'cache-cleared' });
}
