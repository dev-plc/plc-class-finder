// 데이터 계층. 백엔드(Supabase)는 이 모듈 안에만 있다.
import {
    ensureLoaded,
    getMembers,
    getSessions,
    getTeams,
    getSessionKey,
    getCurrentSessionDate,
    getTeamMembers,
    updateAttendanceBatch,
    getCohortId,
    refresh,
    getKimbapDetail,
    getHomeworkList,
    subscribe,
} from './scripts/members-data.js?v=60';
import { matches as hangulMatches } from './scripts/hangul.js?v=60';
import { registerServiceWorker } from './scripts/sw-update.js?v=60';
import { sbPostGas } from './scripts/supabase-config.js?v=60';

// 로그인 확인
if (!sessionStorage.getItem('adminLoggedIn')) {
    window.location.href = 'index.html';
}

// ============================================================================
// DOM 요소
// ============================================================================
const themeToggle = document.getElementById('themeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 검색 모드
const searchNameInput = document.getElementById('searchName');
const adminSearchBtn = document.getElementById('adminSearchBtn');
const duplicateContainer = document.getElementById('duplicateContainer');
const duplicateList = document.getElementById('duplicateList');
const searchResultContainer = document.getElementById('searchResultContainer');
const searchCloseBtn = document.getElementById('searchCloseBtn');
const searchErrorMessage = document.getElementById('searchErrorMessage');
const searchErrorText = document.getElementById('searchErrorText');

// 조별/개인별 보기
const teamsGrid = document.getElementById('teamsGrid');
const membersGrid = document.getElementById('membersGrid');
const teamModal = document.getElementById('teamModal');
const teamModalClose = document.getElementById('teamModalClose');
const teamModalTitle = document.getElementById('teamModalTitle');
const teamMembersList = document.getElementById('teamMembersList');
const teamFilter = document.getElementById('teamFilter');
const memberFilter = document.getElementById('memberFilter');

// ============================================================================
// 데이터 로드
// ============================================================================
async function loadData() {
    try {
        // 캐시 있으면 즉시 렌더 (백그라운드 갱신은 자동)
        await ensureLoaded({
            onBackgroundRefreshError: (err) => console.warn('배경 갱신 실패:', err),
        });
        console.log('✅ 데이터 로드:', getCohortId(), getMembers().length, '명');
    } catch (error) {
        console.error('❌ 데이터 로드 예외 (네트워크/캐시):', error);
    } finally {
        const badge = document.querySelector('.admin-badge');
        if (badge && getCohortId()) badge.textContent = `${getCohortId()} · 관리자`;
        try { renderTeamsView(); } catch (e) { console.error(e); }
        try { renderMembersView(); } catch (e) { console.error(e); }
        try { initAttendanceTab(); } catch (e) { console.error(e); }
        try { initPrintTab(); } catch (e) { console.error(e); }
    }
}

// 기수 전환 감지 — 배경 갱신 중에 새 기수가 들어오면 화면 전체를 다시 그린다
subscribe((event) => {
    if (event.type === 'cohort-changed') {
        console.log(`기수 전환: ${event.from} → ${event.to}`);
        renderTeamsView();
        renderMembersView();
        initAttendanceTab();
        initPrintTab();
        alert(`${event.to} 명단으로 갱신되었습니다.`);
        return;
    }
    if (event.type !== 'refresh') return;

    // 배경 갱신이 끝났다. 화면은 캐시로 먼저 그려졌으니 여기서 새 값으로 바꾼다.

    // 검색어를 넣어 둔 채로 갱신이 오면 필터를 그대로 유지한다.
    // 인자 없이 부르면 목록이 전체로 돌아가 엉뚱한 화면으로 보인다.
    renderTeamsView(teamFilter?.value.trim() || '');
    renderMembersView(memberFilter?.value.trim() || '');

    // 조 모달이 열려 있으면 그 안도 새 값으로 바꾼다 (열 때 뜬 스냅숏이라 안 따라온다)
    if (teamModal?.classList.contains('active') && openTeamName) {
        showTeamMembers({ name: openTeamName, members: getTeamMembers(openTeamName),
                          location: getTeamMembers(openTeamName)[0]?.location || '' });
    }

    // 출석 화면은 반드시 같이 갱신해야 한다. 이 화면만 값을 attBaseline/attDraft 에
    // 스냅숏으로 떠 놓기 때문에, 갱신하지 않으면 옛 값이 화면에 남는다.
    // 실제로 ◎ 인 사람이 빈칸으로 보였고, 그 상태에서 '빈칸 → 결석' 을 누르는 바람에
    // 지난 기수 이수자가 결석으로 저장된 일이 있었다.
    try { initPrintTab(); } catch (e) { console.error(e); }

    if (attChanges().length === 0) {
        initAttendanceTab();
    } else {
        // 편집 중이면 덮지 않는다 (입력하던 것이 날아간다). 대신 옛 값임을 알린다.
        attStale = true;
        updateAttSummary();
    }
});

// ============================================================================
// 검색칸 지우기 (✕)
//
// 필터는 자주 지우고 다시 친다. 한 글자씩 지우게 두면 성가시고,
// 화면이 큰 기기에서는 백스페이스를 오래 눌러야 한다.
// 입력칸을 감싸고 오른쪽에 ✕ 를 얹는다 — 값이 있을 때만 보인다.
//
// 지운 뒤 input 이벤트를 직접 쏜다. 그래야 이미 붙어 있는 필터·오류 숨김
// 리스너가 그대로 돈다. 여기서 화면을 다시 그리지 않는 이유다.
// ============================================================================
function attachClearButton(input) {
    if (!input || input.dataset.clearable) return;
    input.dataset.clearable = '1';

    const wrap = document.createElement('div');
    wrap.className = 'input-clearable';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'input-clear';
    btn.setAttribute('aria-label', '입력 지우기');
    btn.textContent = '✕';
    wrap.appendChild(btn);

    const sync = () => { btn.style.display = input.value ? 'flex' : 'none'; };
    sync();
    input.addEventListener('input', sync);

    btn.addEventListener('click', () => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sync();
        input.focus();
    });
}

[searchNameInput, teamFilter, memberFilter].forEach(attachClearButton);

// ============================================================================
// 테마 / 로그아웃 / 탭
// ============================================================================
document.body.classList.remove('dark-mode');
themeToggle?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

logoutBtn?.addEventListener('click', () => {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem('adminLoggedIn');
        window.location.href = 'index.html';
    }
});

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${tabName}Tab`).classList.add('active');
    });
});

// ============================================================================
// 검색 모드
// ============================================================================
function searchMember() {
    const name = searchNameInput.value.trim();

    if (!name) {
        showSearchError('이름을 입력해주세요.');
        searchNameInput.focus();
        return;
    }

    // 1) 완전 일치 우선. 2) 없으면 초성/부분 매칭 (자모 검색 UX #3)
    let results = getMembers().filter(m => m.name === name);
    if (results.length === 0) {
        results = getMembers().filter(m => hangulMatches(m.name, name));
    }

    if (results.length === 0) {
        showSearchError('일치하는 정보를 찾을 수 없습니다.');
    } else if (results.length === 1) {
        showSearchResult(results[0]);
    } else {
        showDuplicateSelection(results);
    }
}

function showDuplicateSelection(members) {
    hideSearchError();
    searchResultContainer.style.display = 'none';

    duplicateList.innerHTML = '';
    members.forEach(member => {
        const item = document.createElement('div');
        item.className = 'duplicate-item';
        item.innerHTML = `
            <div class="duplicate-item-id">${member.name}${member.phone}</div>
            <div class="duplicate-item-info">${member.team} · ${member.location} · ${member.age}세</div>
        `;
        item.addEventListener('click', () => {
            showSearchResult(member);
            duplicateContainer.style.display = 'none';
        });
        duplicateList.appendChild(item);
    });

    duplicateContainer.style.display = 'block';
    setTimeout(() => {
        duplicateContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

function showSearchResult(member) {
    hideSearchError();
    duplicateContainer.style.display = 'none';

    document.getElementById('searchResultName').textContent = `${member.name}${member.phone}`;
    document.getElementById('searchResultTeam').textContent = member.team;
    document.getElementById('searchResultLocation').textContent = member.location;

    searchResultContainer.style.display = 'block';
    setTimeout(() => {
        searchResultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

function showSearchError(message) {
    searchErrorText.textContent = message;
    searchErrorMessage.style.display = 'flex';
    searchResultContainer.style.display = 'none';
    duplicateContainer.style.display = 'none';
    setTimeout(() => {
        searchErrorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

function hideSearchError() {
    searchErrorMessage.style.display = 'none';
}

function closeSearchResult() {
    searchResultContainer.style.display = 'none';
    duplicateContainer.style.display = 'none';
    searchNameInput.value = '';
    searchNameInput.focus();
}

adminSearchBtn?.addEventListener('click', searchMember);
searchCloseBtn?.addEventListener('click', closeSearchResult);
searchNameInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchMember();
});
searchNameInput?.addEventListener('input', hideSearchError);

// ============================================================================
// 조별 보기
// ============================================================================
let allTeams = [];

function renderTeamsView(filterText = '') {
    const teamGroups = {};
    getMembers().forEach(member => {
        if (!teamGroups[member.team]) {
            teamGroups[member.team] = {
                name: member.team,
                location: member.location,
                members: []
            };
        }
        teamGroups[member.team].members.push(member);
    });

    const sortedTeams = Object.values(teamGroups).sort((a, b) => {
        const getPrefix = (name) => name.match(/[가-힣]+/)?.[0] || '';
        const getNumber = (name) => parseInt(name.match(/\d+/)?.[0] || '0');
        const prefixA = getPrefix(a.name);
        const prefixB = getPrefix(b.name);
        const numA = getNumber(a.name);
        const numB = getNumber(b.name);
        if (prefixA !== prefixB) {
            const order = ['새', '남', '여', 'DG', 'M', 'W'];
            return order.indexOf(prefixA) - order.indexOf(prefixB);
        }
        return numA - numB;
    });

    allTeams = sortedTeams;

    const filteredTeams = filterText
        ? sortedTeams.filter(team =>
            hangulMatches(team.name, filterText) ||
            hangulMatches(team.location, filterText)
          )
        : sortedTeams;

    teamsGrid.innerHTML = '';
    if (filteredTeams.length === 0) {
        teamsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-light); font-size: 16px;">검색 결과가 없습니다.</div>';
        return;
    }

    filteredTeams.forEach(team => {
        const kimbapCount = team.members.filter(m => (m.lunch || '').toUpperCase() === 'O').length;
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `
            <div class="team-card-header">
                <div class="team-card-name">${team.name}</div>
                <div class="team-card-count">${team.members.length}명</div>
            </div>
            <div class="team-card-location">${team.location}</div>
            <div class="team-card-kimbap">🍱 김밥 ${kimbapCount}개 (${team.members.length}명 중)</div>
        `;
        card.addEventListener('click', () => showTeamMembers(team));
        teamsGrid.appendChild(card);
    });
}

teamFilter?.addEventListener('input', (e) => {
    renderTeamsView(e.target.value.trim());
});

// 지금 열려 있는 조. 배경 갱신이 오면 이 이름으로 다시 그린다.
let openTeamName = null;

function showTeamMembers(team) {
    openTeamName = team.name;
    const kimbapCount = team.members.filter(m => (m.lunch || '').toUpperCase() === 'O').length;
    teamModalTitle.textContent = `${team.name} (${team.members.length}명 / 🍱 김밥 ${kimbapCount}개) · ${team.location}`;

    teamMembersList.innerHTML = '';
    team.members.forEach(member => {
        const isKimbap = (member.lunch || '').toUpperCase() === 'O';
        const kimbapBadge = isKimbap
            ? `<span class="kimbap-badge kimbap-yes">🍱 김밥 O</span>`
            : `<span class="kimbap-badge kimbap-no">김밥 X</span>`;

        const card = document.createElement('div');
        card.className = 'team-member-card';
        card.innerHTML = `
            <div class="team-member-id">${member.name} (${member.phone})</div>
            <div class="team-member-kimbap">${kimbapBadge}</div>
            <div class="team-member-age">${member.age}세</div>
        `;
        teamMembersList.appendChild(card);
    });

    teamModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeTeamModal() {
    openTeamName = null;
    teamModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

teamModalClose?.addEventListener('click', closeTeamModal);
teamModal?.addEventListener('click', (e) => {
    if (e.target === teamModal) closeTeamModal();
});

// ============================================================================
// 개인별 보기
// ============================================================================
function renderMembersView(filterText = '') {
    const sortedMembers = [...getMembers()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    const filteredMembers = filterText
        ? sortedMembers.filter(member =>
            hangulMatches(member.name, filterText) ||
            hangulMatches(member.name + member.phone, filterText) ||
            hangulMatches(member.team, filterText) ||
            hangulMatches(member.location, filterText)
          )
        : sortedMembers;

    membersGrid.innerHTML = '';
    if (filteredMembers.length === 0) {
        membersGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-light); font-size: 16px;">검색 결과가 없습니다.</div>';
        return;
    }

    filteredMembers.forEach(member => {
        const card = document.createElement('div');
        card.className = 'member-card';
        card.innerHTML = `
            <div class="member-card-id">${member.name}${member.phone}</div>
            <div class="member-card-info">
                <div class="member-card-row">
                    <span class="member-card-label">조</span>
                    <span class="member-card-value team">${member.team}</span>
                </div>
                <div class="member-card-row">
                    <span class="member-card-label">나이</span>
                    <span class="member-card-value">${member.age}세</span>
                </div>
                <div class="member-card-row">
                    <span class="member-card-label">위치</span>
                    <span class="member-card-value">${member.location}</span>
                </div>
            </div>
        `;
        membersGrid.appendChild(card);
    });
}

memberFilter?.addEventListener('input', (e) => {
    renderMembersView(e.target.value.trim());
});

// ============================================================================
// 출석 관리
//
// 출석은 DB가 원본이다. 시트에서 고치지 않고 여기서만 기록한다.
// 저장은 set_attendance_batch RPC 한 번으로 끝나고,
// 바꾼 칸만 보낸다 (건드리지 않은 사람은 기존 값 그대로).
// ============================================================================

// 관리자가 찍는 값은 둘뿐이다.
//
// ◎(지난 기수 이수)는 이월 스크립트가 지난 기수 기록에서 뽑고,
// −(집계 제외)는 커리큘럼상 수업이 없는 주차다. 둘 다 사람이 판단할 값이 아니다.
// 손으로 찍게 두면 근거 없는 이수 인정이 생기고, 반대로 이미 붙은 ◎ 를
// 실수로 지우는 일이 난다 — 실제로 이수자 8명이 결석으로 저장된 적이 있다.
const ATT_STATES = [
    { value: 'O', label: 'O', title: '출석' },
    { value: 'X', label: 'X', title: '결석' },
];

// 보기 전용. 이 값이 들어 있는 줄은 아예 손댈 수 없게 한다.
// 고쳐야 하면 시트에서 고친다 (출결의 원본은 시트다).
const ATT_LOCKED = {
    '◎': { label: '◎', title: '지난 기수에 이수 — 시트에서만 고칩니다' },
    '-': { label: '−', title: '집계 제외 — 시트에서만 고칩니다' },
};

function isLocked(v) {
    return Object.prototype.hasOwnProperty.call(ATT_LOCKED, normStatus(v));
}
const ATT_PREF_KEY = 'plc_admin_att_prefs';
const TEAM_ALL = '__all__';

const attSessionSelect = document.getElementById('attSession');
const attTeamSelect = document.getElementById('attTeam');
const attMeta = document.getElementById('attMeta');
const attCounts = document.getElementById('attCounts');
const attList = document.getElementById('attList');
const attSaveInfo = document.getElementById('attSaveInfo');
const attSaveBtn = document.getElementById('attSaveBtn');

let attSessionDate = null;
let attTeamName = TEAM_ALL;
let attBaseline = new Map();   // uuid → 저장돼 있는 상태
let attDraft = new Map();      // uuid → 화면에서 고른 상태
let attSaving = false;
// 배경 갱신이 왔는데 편집 중이라 반영하지 못한 상태.
// 이때 저장하면 옛 값 기준으로 차이를 계산하므로 사용자에게 알려야 한다.
let attStale = false;

function normStatus(v) {
    const s = String(v ?? '').trim();
    return s === '' ? '' : s.toUpperCase();
}

function attTargets() {
    const rows = attTeamName === TEAM_ALL ? getMembers() : getTeamMembers(attTeamName);
    return rows.filter(m => m._uuid);
}

function loadAttPrefs() {
    try { return JSON.parse(localStorage.getItem(ATT_PREF_KEY) || '{}'); }
    catch { return {}; }
}

function saveAttPrefs() {
    try {
        localStorage.setItem(ATT_PREF_KEY,
            JSON.stringify({ session: attSessionDate, team: attTeamName }));
    } catch { /* 저장 실패는 무시 */ }
}

function initAttendanceTab() {
    if (!attSessionSelect || !attTeamSelect) return;

    const sessions = getSessions();
    const prefs = loadAttPrefs();

    // 주차 — 오름차순 (1강부터 순서대로)
    attSessionSelect.innerHTML = '';
    sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.session_date;
        const name = s.label_norm || '';
        opt.textContent = s.is_class
            ? `${s.label}${name ? ' · ' + name : ''}`
            : `${s.label}${name ? ' · ' + name : ''} (수료 미반영)`;
        attSessionSelect.appendChild(opt);
    });

    const known = new Set(sessions.map(s => s.session_date));
    attSessionDate = (prefs.session && known.has(prefs.session))
        ? prefs.session
        : (getCurrentSessionDate() || sessions[0]?.session_date || null);
    if (attSessionDate && attSessionSelect) attSessionSelect.value = attSessionDate;

    // 조
    const teams = getTeams();
    attTeamSelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = TEAM_ALL;
    allOpt.textContent = `전체 (${getMembers().length}명)`;
    attTeamSelect.appendChild(allOpt);
    teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = `${t} (${getTeamMembers(t).length}명)`;
        attTeamSelect.appendChild(opt);
    });
    attTeamName = (prefs.team && (prefs.team === TEAM_ALL || teams.includes(prefs.team)))
        ? prefs.team
        : TEAM_ALL;
    attTeamSelect.value = attTeamName;

    resetAttDraft();
    renderAttList();
}

// 화면의 선택 상태를 저장돼 있는 값으로 되돌린다.
function resetAttDraft() {
    attStale = false;
    attBaseline = new Map();
    attDraft = new Map();
    if (!attSessionDate) return;
    const key = getSessionKey(attSessionDate);
    for (const m of attTargets()) {
        const cur = normStatus(m[key]);
        attBaseline.set(m._uuid, cur);
        attDraft.set(m._uuid, cur);
    }
}

function attChanges() {
    const out = [];
    for (const [uuid, status] of attDraft) {
        if (attBaseline.get(uuid) !== status) out.push({ memberUuid: uuid, status });
    }
    return out;
}

function renderAttList() {
    if (!attList) return;

    const targets = attTargets();
    const sessions = getSessions();
    let session = sessions.find(s => s.session_date === attSessionDate);
    if (!session && sessions.length > 0) {
        session = sessions[0];
        attSessionDate = session.session_date;
        if (attSessionSelect) attSessionSelect.value = attSessionDate;
        resetAttDraft();
    }

    if (!attSessionDate || !session) {
        attList.innerHTML = '<div class="att-empty">주차 정보를 불러오지 못했습니다.</div>';
        if (attMeta) attMeta.textContent = '';
        updateAttSummary();
        return;
    }
    if (targets.length === 0) {
        attList.innerHTML = '<div class="att-empty">해당 조에 인원이 없습니다.</div>';
        updateAttSummary();
        return;
    }

    if (attMeta) attMeta.innerHTML = session.is_class
        ? `<b>${session.label}</b> ${session.label_norm || ''} · 수료 카운트에 포함`
        : `<b>${session.label}</b> ${session.label_norm || ''} · <span class="att-meta-off">수료 카운트 제외</span>`;

    let html = '';
    let lastTeam = null;

    for (const m of targets) {
        if (m.team !== lastTeam) {
            lastTeam = m.team;
            html += `<div class="att-group">${escapeHtml(m.team || '미편성')}</div>`;
        }
        const cur = attDraft.get(m._uuid) ?? '';
        const changed = attBaseline.get(m._uuid) !== cur;
        const role = m.role ? `<span class="att-role">${escapeHtml(m.role)}</span>` : '';

        const locked = ATT_LOCKED[cur];
        const buttons = locked
            ? `<span class="att-locked s-${stateClass(cur)}" title="${locked.title}">${locked.label}</span>`
            : ATT_STATES.map(st => `
            <button type="button"
                    class="att-state${cur === st.value ? ' on s-' + stateClass(st.value) : ''}"
                    data-uuid="${m._uuid}" data-status="${st.value}"
                    title="${st.title}" aria-pressed="${cur === st.value}">${st.label}</button>`).join('');

        html += `
            <div class="att-row${changed ? ' changed' : ''}${cur === '' && !locked ? ' blank' : ''}${locked ? ' locked' : ''}" data-uuid="${m._uuid}">
                <div class="att-who">
                    <span class="att-name">${escapeHtml(m.name)}<span class="att-phone">${escapeHtml(m.phone)}</span></span>
                    ${role}
                </div>
                <div class="att-states">${buttons}</div>
            </div>`;
    }

    attList.innerHTML = html;
    updateAttSummary();
}

function stateClass(v) {
    return { 'O': 'o', '◎': 'd', 'X': 'x', '-': 'n' }[v] || 'n';
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateAttSummary() {
    const counts = { 'O': 0, '◎': 0, 'X': 0, '-': 0, '': 0 };
    for (const v of attDraft.values()) counts[v] = (counts[v] ?? 0) + 1;

    if (attCounts) {
        attCounts.innerHTML =
            `<span class="c-o">출석 ${counts['O']}</span>` +
            `<span class="c-d">대체 ${counts['◎']}</span>` +
            `<span class="c-x">결석 ${counts['X']}</span>` +
            `<span class="c-n">제외 ${counts['-']}</span>` +
            `<span class="c-b">미기록 ${counts['']}</span>`;
    }

    const changes = attChanges();
    if (!attSaveInfo || !attSaveBtn) return;
    if (attStale) {
        attSaveInfo.textContent = changes.length
            ? `${changes.length}명 변경됨 · ⚠️ 새 데이터가 도착했습니다. 저장 후 새로고침하세요`
            : '⚠️ 새 데이터가 도착했습니다. 새로고침하세요';
        attSaveBtn.disabled = changes.length === 0;
        attSaveBtn.textContent = changes.length ? `${changes.length}명 저장` : '저장';
        return;
    }
    if (attSaving) {
        attSaveInfo.textContent = '저장 중…';
        attSaveBtn.disabled = true;
        attSaveBtn.textContent = '저장 중…';
    } else if (changes.length === 0) {
        attSaveInfo.textContent = '변경 사항 없음';
        attSaveBtn.disabled = true;
        attSaveBtn.textContent = '저장';
    } else {
        attSaveInfo.textContent = `${changes.length}명 변경됨`;
        attSaveBtn.disabled = false;
        attSaveBtn.textContent = `${changes.length}명 저장`;
    }
}

attSessionSelect?.addEventListener('change', () => {
    if (attChanges().length && !confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?')) {
        attSessionSelect.value = attSessionDate;
        return;
    }
    attSessionDate = attSessionSelect.value;
    saveAttPrefs();
    resetAttDraft();
    renderAttList();
});

attTeamSelect?.addEventListener('change', () => {
    if (attChanges().length && !confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?')) {
        attTeamSelect.value = attTeamName;
        return;
    }
    attTeamName = attTeamSelect.value;
    saveAttPrefs();
    resetAttDraft();
    renderAttList();
});

// 상태 버튼 (같은 값을 다시 누르면 미기록으로 되돌아간다)
attList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.att-state');
    if (!btn || attSaving) return;
    const uuid = btn.dataset.uuid;
    if (isLocked(attBaseline.get(uuid))) return;   // ◎·− 은 시트에서만 고친다
    const next = attDraft.get(uuid) === btn.dataset.status ? '' : btn.dataset.status;
    attDraft.set(uuid, next);
    renderAttList();
});

// 이름을 몇 개만 뽑아 보여준다 (확인 창이 길어지지 않게)
// 일괄 처리가 건드릴 수 있는 사람. ◎·− 인 줄은 제외한다.
function editableUuids() {
    return [...attDraft.keys()].filter(u => !isLocked(attBaseline.get(u)));
}

function attNamesOf(uuids, limit = 8) {
    const byUuid = new Map(attTargets().map(m => [m._uuid, m]));
    const names = uuids.map(u => {
        const m = byUuid.get(u);
        return m ? `${m.name}${m.phone}` : '';
    }).filter(Boolean);
    const head = names.slice(0, limit).join(', ');
    return names.length > limit ? `${head} 외 ${names.length - limit}명` : head;
}

// 일괄 처리
//
// '빈칸 → 결석' 은 모르는 것을 결석으로 바꾸는 동작이라 위험하다.
// 지난 기수에 이수해 안 나와도 되는 사람도 화면에는 빈칸으로 보이는데,
// 그 사람까지 결석으로 찍히면 수료 판정이 틀어지고 과제 안내까지 잘못 나간다.
// 실제로 그렇게 ◎ 대상자가 X 로 저장된 일이 있었다. 몇 명인지 보여주고 묻는다.
document.querySelectorAll('.att-bulk-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (attSaving) return;
        const mode = btn.dataset.bulk;
        // ◎·− 인 줄은 어떤 일괄 처리로도 바뀌지 않는다.
        const editable = editableUuids();

        if (mode === 'reset') {
            for (const [uuid, v] of attBaseline) attDraft.set(uuid, v);
        } else if (mode === 'clear') {
            const marked = editable.filter(u => attDraft.get(u) !== '');
            if (!marked.length) return;
            if (!confirm(
                `${marked.length}명의 출결 기록을 지웁니다.\n\n${attNamesOf(marked)}\n\n진행할까요?`)) return;
            for (const uuid of marked) attDraft.set(uuid, '');
        } else if (mode === 'fillX') {
            const blanks = editable.filter(u => attDraft.get(u) === '');
            if (!blanks.length) return;
            if (!confirm(
                `미기록 ${blanks.length}명을 결석으로 처리합니다.\n\n${attNamesOf(blanks)}\n\n` +
                `안 온 것이 확실한 분들이 맞는지 확인하세요.`)) return;
            for (const uuid of blanks) attDraft.set(uuid, 'X');
        } else {
            const others = editable.filter(u => {
                const v = attDraft.get(u);
                return v !== '' && v !== mode;
            });
            if (others.length && !confirm(
                `전원을 '${mode}' 로 바꿉니다.\n\n` +
                `이미 다른 값이 있는 ${others.length}명도 덮어씁니다:\n${attNamesOf(others)}\n\n진행할까요?`)) return;
            for (const uuid of editable) attDraft.set(uuid, mode);
        }
        renderAttList();
    });
});

attSaveBtn?.addEventListener('click', async () => {
    const changes = attChanges();
    if (changes.length === 0 || attSaving) return;

    // ◎ 를 X 로 바꾸는 저장은 한 번 더 묻는다.
    // ◎ 는 지난 기수에 이수해 안 나와도 되는 사람이다. 그 사람이 결석으로 바뀌면
    // 수료 판정이 틀어지고, 그 주차 과제를 내라는 안내까지 잘못 나간다.
    // 되돌리려면 손으로 다시 ◎ 를 눌러야 해서, 쓰기 전에 잡는 편이 싸다.
    const demoted = changes.filter(c =>
        attBaseline.get(c.memberUuid) === '◎' && c.status === 'X');
    if (demoted.length && !confirm(
        `지난 기수 이수(◎) ${demoted.length}명을 결석으로 바꿉니다.\n\n` +
        `${attNamesOf(demoted.map(c => c.memberUuid))}\n\n` +
        `이분들은 안 나와도 되는 분입니다. 정말 결석으로 기록할까요?`)) return;

    attSaving = true;
    updateAttSummary();

    const result = await updateAttendanceBatch(changes, attSessionDate);

    attSaving = false;
    if (result.success) {
        // 데이터 계층이 인원 행을 이미 갱신했다. 그 값을 새 기준으로 삼는다.
        for (const c of changes) attBaseline.set(c.memberUuid, c.status);
        renderAttList();
        const skipped = result.skipped?.length ?? 0;
        attSaveInfo.textContent = skipped
            ? `${result.updated}명 저장 · ${skipped}명 실패`
            : `${result.updated}명 저장했습니다`;
        attSaveInfo.classList.add('ok');
        setTimeout(() => attSaveInfo.classList.remove('ok'), 2500);
    } else {
        renderAttList();
        attSaveInfo.textContent = `저장 실패: ${result.error?.message || '알 수 없는 오류'}`;
        attSaveInfo.classList.add('fail');
        setTimeout(() => attSaveInfo.classList.remove('fail'), 5000);
    }
});

// 저장하지 않고 창을 닫으려 하면 경고
window.addEventListener('beforeunload', (e) => {
    if (attChanges().length > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ESC 키로 모달 닫기
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && teamModal?.classList.contains('active')) {
        closeTeamModal();
    }
});

// ============================================================================
// 페이지 로드
// ============================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadData();
        searchNameInput?.focus();
    });
} else {
    loadData();
    searchNameInput?.focus();
}

// ============================================================================
// 출석부 출력 (인쇄용)
//
// 지금까지 관리자가 스프레드시트로 만들어 인쇄하던 조별 출석부를 앱에서 낸다.
// 종이에 손으로 체크하는 양식이므로, 아는 값은 미리 찍고 받을 값은 비워 둔다.
//
//   이름·김밥·과제  → 데이터에서 채운다 (이미 아는 것)
//   출석·김밥신청·메모 → 빈칸 (현장에서 손으로 쓴다)
// ============================================================================
const prSessionSelect = document.getElementById('prSession');
const prTeamSelect    = document.getElementById('prTeam');
const prPreview       = document.getElementById('prPreview');
const prInfo          = document.getElementById('prInfo');
const prHint          = document.getElementById('prHint');
const prOpt = {
    // 두 칸은 따로 켜고 끈다.
    //   status — 이번 주차에 신청한 사람 (데이터). 평소에도 보고 싶은 값이다.
    //   kimbap — 다음 달 신청을 받는 빈 칸. 월 마지막 수업에만 필요하다.
    // 하나로 묶었더니 신청 칸을 끄면 현황까지 사라졌다.
    status:   document.getElementById('prKimbapStatus'),
    kimbap:   document.getElementById('prKimbap'),
    homework: document.getElementById('prHomework'),
    memo:     document.getElementById('prMemo'),
    summary:  document.getElementById('prSummary'),
};

let prSessionDate = null;
let prTeamName = TEAM_ALL;
let prKimbapTouched = false;   // 사람이 김밥 칸을 직접 건드렸나

// 출력에서 뺀 장(場). 조 이름 또는 '__summary__'.
// 칸 토글로 다시 그릴 때는 유지하고, 주차·조를 바꾸면 비운다 —
// 고른 범위가 달라지면 뺐던 것도 뜻을 잃는다.
const prSkip = new Set();

const PR_LOC_PREFIX = 'loc:';

// 조가 어느 장소에 있나. 조원의 location 을 쓴다 (조원끼리는 같다).
function prTeamLocation(team) {
    return getTeamMembers(team)[0]?.location || '';
}

// 지금 고른 범위에 드는 조 목록
function prSelectedTeams() {
    const teams = getTeams();
    if (prTeamName === TEAM_ALL) return teams;
    if (prTeamName.startsWith(PR_LOC_PREFIX)) {
        const loc = prTeamName.slice(PR_LOC_PREFIX.length);
        return teams.filter(t => prTeamLocation(t) === loc);
    }
    return teams.includes(prTeamName) ? [prTeamName] : [];
}

// 그 주차가 해당 월의 마지막 수업인가.
// 김밥은 다음 달 것을 이때 받으므로 이 주차에만 신청 칸이 필요하다.
function isLastClassOfMonth(sessionDate) {
    if (!sessionDate) return false;
    const ym = String(sessionDate).slice(0, 7);
    const same = getSessions()
        .filter(x => String(x.session_date).slice(0, 7) === ym)
        .map(x => x.session_date)
        .sort();
    return same.length > 0 && same[same.length - 1] === sessionDate;
}

// 과제 세션명 대조. 폼 응답과 시트 강의명이 다르게 적히므로 양쪽을 정규화한다.
// (script.js 의 normalizeSessionKey 와 같은 규칙이어야 한다)
function prNormalizeSession(v) {
    const raw = String(v || '').trim();
    let m = raw.match(/^성경적대화\s*(\d+)/) || raw.match(/^대화\s*(\d+)/);
    if (m) return '대화' + m[1];
    m = raw.match(/^교리\s*(\d+)/) || raw.match(/^(\d+)\s*강/);
    if (m) return '교리' + m[1];
    if (/^교제/.test(raw) || /^교재/.test(raw)) return '교제';
    if (/^나눔/.test(raw)) return '나눔';
    return raw;
}

// A4 한 장을 채우도록 줄 높이를 정한다.
//
// 조마다 인원이 달라서(12명 ~ 1명) 고정 높이로는 아래가 휑하거나 넘친다.
// 남는 높이를 인원수로 나누되, 위아래로 묶어 둔다 —
// 최소 9mm(손글씨가 들어갈 만큼), 최대 22mm(적은 조에서 우스꽝스러워지지 않게).
//
//   A4 세로 297mm - 위아래 여백 24mm        = 273mm
//   제목·주차·인원 줄 18mm + 표 머리글 8mm  =  26mm
//   여유 4mm
const PR_PAGE_AVAIL_MM = 273 - 26 - 4;

function prRowHeightMm(count) {
    if (!count) return 9;
    const fit = PR_PAGE_AVAIL_MM / count;
    return Math.round(Math.min(22, Math.max(9, fit)) * 10) / 10;
}

function initPrintTab() {
    if (!prSessionSelect || !prTeamSelect) return;

    const sessions = getSessions();
    prSessionSelect.innerHTML = sessions.map(x => {
        const name = x.label_norm || '';
        return `<option value="${x.session_date}">${x.label}${name ? ' · ' + name : ''}</option>`;
    }).join('');

    const known = new Set(sessions.map(x => x.session_date));
    if (!prSessionDate || !known.has(prSessionDate)) {
        prSessionDate = getCurrentSessionDate() || sessions[0]?.session_date || null;
    }
    if (prSessionDate) prSessionSelect.value = prSessionDate;

    const teams = getTeams();

    // 장소별 묶음 — 웨슬리홀만, 칼빈채플만 뽑는 일이 잦다
    const byLoc = new Map();
    for (const t of teams) {
        const loc = prTeamLocation(t) || '(장소 미정)';
        if (!byLoc.has(loc)) byLoc.set(loc, []);
        byLoc.get(loc).push(t);
    }

    prTeamSelect.innerHTML =
        `<option value="${TEAM_ALL}">전체 (${teams.length}개 조)</option>` +
        (byLoc.size > 1
            ? '<optgroup label="장소별">' + [...byLoc].map(([loc, ts]) =>
                `<option value="${PR_LOC_PREFIX}${escapeHtml(loc)}">${escapeHtml(loc)} (${ts.length}개 조)</option>`).join('') + '</optgroup>'
            : '') +
        '<optgroup label="조별">' + teams.map(t =>
            `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${getTeamMembers(t).length}명)</option>`).join('') + '</optgroup>';

    const valid = prTeamName === TEAM_ALL
        || teams.includes(prTeamName)
        || (prTeamName.startsWith(PR_LOC_PREFIX) && byLoc.has(prTeamName.slice(PR_LOC_PREFIX.length)));
    if (!valid) prTeamName = TEAM_ALL;
    prTeamSelect.value = prTeamName;

    syncKimbapDefault();
    renderPrintPreview();
}

// 주차를 바꾸면 김밥 칸 기본값을 다시 잡는다.
// 사람이 직접 건드린 뒤에는 그 뜻을 존중해 자동으로 되돌리지 않는다.
function syncKimbapDefault() {
    if (!prOpt.kimbap) return;
    const last = isLastClassOfMonth(prSessionDate);
    if (!prKimbapTouched) prOpt.kimbap.checked = last;
    if (prHint) {
        prHint.textContent = last
            ? '이 주차는 해당 월의 마지막 수업입니다 — 김밥신청 칸을 기본으로 켰습니다.'
            : '';
    }
}

// 장마다 붙는 '출력' 체크. 기본은 켬 — 전체를 뽑되 몇 조만 빼는 쓰임이다.
function prPickBox(key) {
    const on = !prSkip.has(key);
    return `<label class="pr-pick">
        <input type="checkbox" class="pr-pick-input" data-page="${escapeHtml(key)}"${on ? ' checked' : ''}>
        <span>출력</span>
    </label>`;
}

function renderPrintPreview() {
    if (!prPreview) return;

    const session = getSessions().find(x => x.session_date === prSessionDate);
    if (!session) {
        prPreview.innerHTML = '<div class="pr-empty">주차를 고르세요.</div>';
        if (prInfo) prInfo.textContent = '';
        return;
    }

    const teams = prSelectedTeams();
    const cols = {
        status:   !!prOpt.status?.checked,     // 김밥 현황 (데이터)
        kimbap:   !!prOpt.kimbap?.checked,     // 김밥신청 (빈칸)
        homework: !!prOpt.homework?.checked,
        memo:     !!prOpt.memo?.checked,
    };
    const sessionLabel = `${session.label}${session.label_norm ? ' ' + session.label_norm : ''}`;
    const sessionKey = prNormalizeSession(session.label_norm || '');

    // 조별 신청 수 — 집계표와 각 장 머리글에 같이 쓴다
    const stats = teams.map(t => {
        const members = getTeamMembers(t);
        const applied = members.filter(m => {
            const d = getKimbapDetail(m.id || (m.name + m.phone));
            return session.label_norm && d[session.label_norm]?.applied === 1;
        }).length;
        return { team: t, location: prTeamLocation(t), count: members.length, applied };
    });

    let html = '';

    if (teams.length > 1 && prOpt.summary?.checked) {
        const totalN = stats.reduce((n, x) => n + x.count, 0);
        const totalK = stats.reduce((n, x) => n + x.applied, 0);
        html += `
            <div class="pr-sheet${prSkip.has('__summary__') ? ' pr-skip' : ''}" data-page="__summary__">
                ${prPickBox('__summary__')}
                <section class="pr-page">
                <div class="pr-head">
                    <h2>${escapeHtml(getCohortId() || '')} 조별 집계</h2>
                    <div class="pr-session">${escapeHtml(sessionLabel)}</div>
                </div>
                <table class="pr-table pr-summary">
                    <thead><tr><th>조</th><th>장소</th><th>인원</th><th>김밥</th></tr></thead>
                    <tbody>
                        ${stats.map(x => `<tr><td class="pr-left">${escapeHtml(x.team)}</td>
                            <td class="pr-left">${escapeHtml(x.location)}</td>
                            <td>${x.count}</td><td>${x.applied || ''}</td></tr>`).join('')}
                        <tr class="pr-total"><td class="pr-left">합계</td><td></td><td>${totalN}</td><td>${totalK}</td></tr>
                    </tbody>
                </table>
                </section>
            </div>`;
    }

    for (const st of stats) {
        const members = [...getTeamMembers(st.team)].sort((a, b) => {
            const pa = { '튜터': 1, '서브튜터': 2, '조장': 3 }[a.role] || 4;
            const pb = { '튜터': 1, '서브튜터': 2, '조장': 3 }[b.role] || 4;
            return pa !== pb ? pa - pb : a.name.localeCompare(b.name, 'ko');
        });

        // 폭은 CSS 가 칸 종류로 정한다 (table-layout: fixed).
        // 이름 칸만 남는 폭을 먹고, 체크 칸은 항상 좁게 유지된다.
        // 메모 머리글에는 쓰던 시트의 표기를 그대로 옅게 남긴다.
        // 적는 사람이 무슨 기호를 쓰는지 기억하지 않아도 되게.
        const memoHead =
            '<span class="pr-memo-mark">1 □ ◎</span> 메모 <span class="pr-memo-mark">▷ ♡ 5</span>';

        const head =
            '<th class="pr-c-no">No.</th>' +
            '<th class="pr-c-name">이름</th>' +
            (cols.status ? '<th class="pr-c-mark">김밥</th>' : '') +
            (cols.kimbap ? '<th class="pr-c-mark pr-c-wide">김밥신청</th>' : '') +
            '<th class="pr-c-mark">출석</th>' +
            (cols.homework ? '<th class="pr-c-mark">과제</th>' : '') +
            (cols.memo ? `<th class="pr-c-memo">${memoHead}</th>` : '<th class="pr-c-fill"></th>');

        const rows = members.map((m, i) => {
            const id = m.id || (String(m.name || '') + String(m.phone || ''));
            const kb = session.label_norm ? getKimbapDetail(id)[session.label_norm] : null;
            const hw = getHomeworkList(id).some(h => prNormalizeSession(h.session) === sessionKey);
            // 역할은 이름 아래 줄에. 옆에 붙이면 이름 칸이 길어지고,
            // 튜터가 누구인지 세로로 훑을 때 눈에 안 들어온다.
            const role = m.role && m.role !== '조원'
                ? `<span class="pr-role">${escapeHtml(m.role)}</span>` : '';
            return `
                <tr>
                    <td class="pr-c-no">${i + 1}</td>
                    <td class="pr-c-name">
                        <span class="pr-name-line">${escapeHtml(m.name)}<span class="pr-phone">${escapeHtml(m.phone)}</span></span>${role}
                    </td>
                    ${cols.status ? `<td class="pr-c-mark">${kb?.applied === 1 ? 'O' : ''}</td>` : ''}
                    ${cols.kimbap ? '<td class="pr-c-mark pr-c-wide pr-blank"></td>' : ''}
                    <td class="pr-c-mark pr-blank"></td>
                    ${cols.homework ? `<td class="pr-c-mark">${hw ? '✓' : ''}</td>` : ''}
                    ${cols.memo ? '<td class="pr-c-memo pr-blank"></td>' : '<td class="pr-c-fill"></td>'}
                </tr>`;
        }).join('');

        html += `
            <div class="pr-sheet${prSkip.has(st.team) ? ' pr-skip' : ''}" data-page="${escapeHtml(st.team)}">
                ${prPickBox(st.team)}
                <section class="pr-page" style="--pr-row: ${prRowHeightMm(members.length)}mm">
                <div class="pr-head">
                    <h2>${escapeHtml(st.team)}</h2>
                    <div class="pr-session">${escapeHtml(sessionLabel)}</div>
                </div>
                <div class="pr-sub">${st.location ? escapeHtml(st.location) + ' · ' : ''}인원 ${st.count}명${cols.status ? ` · 김밥 ${st.applied}명` : ''}</div>
                <table class="pr-table">
                    <thead><tr>${head}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                </section>
            </div>`;
    }

    prPreview.innerHTML = html;
    updatePrintInfo();
}

function updatePrintInfo() {
    if (!prInfo || !prPreview) return;
    const pages = prPreview.querySelectorAll('.pr-sheet');
    const on = prPreview.querySelectorAll('.pr-sheet:not(.pr-skip)').length;
    prInfo.textContent = pages.length === 0 ? ''
        : (on === pages.length ? `${pages.length}장 출력`
                               : `${pages.length}장 중 ${on}장 출력 (${pages.length - on}장 제외)`);
}

prPreview?.addEventListener('change', (e) => {
    const box = e.target.closest('.pr-pick-input');
    if (!box) return;
    const key = box.dataset.page;
    const page = box.closest('.pr-sheet');
    if (box.checked) { prSkip.delete(key); page?.classList.remove('pr-skip'); }
    else             { prSkip.add(key);    page?.classList.add('pr-skip'); }
    updatePrintInfo();
});

document.getElementById('prPickAll')?.addEventListener('click', () => {
    prSkip.clear();
    renderPrintPreview();
});
document.getElementById('prPickNone')?.addEventListener('click', () => {
    prPreview?.querySelectorAll('.pr-sheet').forEach(p => prSkip.add(p.dataset.page));
    renderPrintPreview();
});

// 범위가 바뀌면 뺐던 것도 뜻을 잃는다
prSessionSelect?.addEventListener('change', (e) => {
    prSessionDate = e.target.value;
    prSkip.clear();
    syncKimbapDefault();
    renderPrintPreview();
});
prTeamSelect?.addEventListener('change', (e) => {
    prTeamName = e.target.value;
    prSkip.clear();
    renderPrintPreview();
});
prOpt.kimbap?.addEventListener('change', () => { prKimbapTouched = true; renderPrintPreview(); });
[prOpt.status, prOpt.homework, prOpt.memo, prOpt.summary].forEach(el =>
    el?.addEventListener('change', renderPrintPreview));

document.getElementById('prPrintBtn')?.addEventListener('click', () => {
    const live = [...(prPreview?.querySelectorAll('.pr-sheet:not(.pr-skip)') || [])];
    if (live.length === 0) { alert('출력할 장이 없습니다. 체크를 하나 이상 켜세요.'); return; }

    // 마지막 장 뒤에는 빈 장이 붙지 않게 표시해 둔다.
    // :last-child 로는 안 된다 — 뺀 장은 숨겨질 뿐 여전히 마지막일 수 있다.
    prPreview?.querySelectorAll('.pr-last').forEach(el => el.classList.remove('pr-last'));
    live[live.length - 1].classList.add('pr-last');

    // 인쇄 대상은 미리보기다. 나머지 화면은 인쇄 CSS 가 숨긴다.
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 0);
});


// ============================================================================
// 시트에서 지금 가져오기
//
// 명단·편성·위치·과제·김밥은 하루 한 번(정오)만 들어온다.
// 수업 직전에 장소를 옮기거나 인원을 넣으면 그때까지 앱에 안 나온다.
//
// 동기화는 GitHub Actions 워크플로라 실행하려면 토큰이 필요한데,
// 그 토큰을 여기 둘 수는 없다 — 이 파일은 공개 저장소에 있다.
// 그래서 GAS 에 부탁한다. 토큰은 GAS 스크립트 속성에 있다.
// ============================================================================
const syncBtn = document.getElementById('syncBtn');
const reloadBtn = document.getElementById('reloadBtn');
const syncInfo = document.getElementById('syncInfo');

function setSyncInfo(text, kind) {
    if (!syncInfo) return;
    syncInfo.textContent = text;
    syncInfo.className = 'sync-info' + (kind ? ' ' + kind : '');
}

syncBtn?.addEventListener('click', async () => {
    if (syncBtn.disabled) return;
    const prev = syncBtn.textContent;
    syncBtn.disabled = true;
    syncBtn.textContent = '요청 중…';
    setSyncInfo('요청하는 중입니다…');

    try {
        const res = await sbPostGas({ action: 'sync' });
        setSyncInfo((res.message || '요청했습니다.') +
            ' 끝나면 아래 [화면 새로 고침] 을 눌러 주세요.', 'ok');
    } catch (err) {
        setSyncInfo('요청 실패: ' + (err?.message || '알 수 없는 오류'), 'fail');
    } finally {
        syncBtn.textContent = prev;
        // 연타 방지 — GAS 쪽에서도 1분에 한 번으로 묶여 있다
        setTimeout(() => { syncBtn.disabled = false; }, 60000);
    }
});

reloadBtn?.addEventListener('click', async () => {
    if (reloadBtn.disabled) return;
    reloadBtn.disabled = true;
    const prev = reloadBtn.textContent;
    reloadBtn.textContent = '불러오는 중…';
    try {
        await refresh();                       // 화면 갱신은 refresh 이벤트가 알아서 한다
        setSyncInfo('최신 데이터로 새로 그렸습니다.', 'ok');
    } catch (err) {
        setSyncInfo('불러오기 실패: ' + (err?.message || '알 수 없는 오류'), 'fail');
    } finally {
        reloadBtn.textContent = prev;
        reloadBtn.disabled = false;
    }
});

// 관리자 페이지도 새 버전을 스스로 받는다.
// 이게 없어서 들어갈 때마다 옛 화면이 떴다 (강력 새로고침만 통했다).
registerServiceWorker();
