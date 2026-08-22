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
    splitLinks,
    getProgress,
    subscribe,
} from './scripts/members-data.js?v=94';
import { matches as hangulMatches } from './scripts/hangul.js?v=94';
import { registerServiceWorker } from './scripts/sw-update.js?v=94';
import { sbPostGas } from './scripts/supabase-config.js?v=94';

// 로그인 확인
if (!sessionStorage.getItem('adminLoggedIn')) {
    window.location.href = 'index.html';
}

// 지금 돌고 있는 버전.
//
// import.meta.url 은 '실제로 불러온' 주소다. HTML 에 적힌 값이 아니라
// 브라우저가 정말 받아온 파일의 주소라, 캐시에 걸려 옛 파일이 돌고 있으면
// 옛 번호가 그대로 나온다. 그래서 이 값은 거짓말을 하지 않는다.
//
// 화면에 띄우는 이유: 고친 게 안 보인다고 할 때 원인이 코드인지 캐시인지
// 구분할 방법이 없어 같은 자리를 몇 번씩 판 적이 있다. 번호 하나면 끝난다.
const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || '?';

// ============================================================================
// DOM 요소
// ============================================================================
const themeToggle = document.getElementById('themeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 검색 모드

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
        // 버전은 데이터를 못 받아왔을 때도 보여야 한다 — 그때가 제일 알고 싶은 순간이다
        const badge = document.querySelector('.admin-badge');
        if (badge) {
            badge.textContent =
                `${getCohortId() ? getCohortId() + ' · ' : ''}관리자 · v${APP_VERSION}`;
        }
        try { renderTeamsView(); } catch (e) { console.error(e); }
        try { renderMembersView(); } catch (e) { console.error(e); }
        try { initAttendanceTab(); } catch (e) { console.error(e); }
        try { initPrintTab(); } catch (e) { console.error(e); }
        try { initAbsenceTab(); } catch (e) { console.error(e); }
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
        initAbsenceTab();
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
    try { initAbsenceTab(); } catch (e) { console.error(e); }

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

[teamFilter, memberFilter].forEach(attachClearButton);

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
        card.addEventListener('click', () => openMemberDetail(member));
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
// ◎(출석 인정)는 이월 스크립트가 지난 기수 기록에서 뽑거나,
// 결석했지만 과제·소감문을 내서 대체 인정된 경우다.
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
    '◎': { label: '◎', title: '출석 인정 — 지난 기수 이수 또는 과제·소감문 대체. 시트에서만 고칩니다' },
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
        `출석 인정(◎) ${demoted.length}명을 결석으로 바꿉니다.\n\n` +
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
// 개인 상세 (개인별 보기에서 카드를 누르면)
//
// 출석·김밥·과제를 한 화면에서 본다. 셋 다 최근 것부터 보여 주고,
// 처음에는 앞의 몇 개만 편다 — 20주차·24건씩 늘어놓으면 훑을 수가 없다.
//
// 여기서는 아무것도 고치지 않는다. 고치는 곳은 출석 관리 탭이다.
// ============================================================================
const MD_KEEP = 4;           // 출석 그리드에서 먼저 보여 줄 칸 수
const MD_HW_KEEP = 5;        // 과제 목록에서 먼저 보여 줄 줄 수

const memberModal = document.getElementById('memberModal');
const mdTitle     = document.getElementById('mdTitle');
const mdBody      = document.getElementById('mdBody');

const MD_MARK = {
    'O': { cls: 'o', txt: 'O' },
    '◎': { cls: 'd', txt: '◎' },
    'X': { cls: 'x', txt: 'X' },
    '-': { cls: 'n', txt: '−' },
    '':  { cls: 'b', txt: '·' },
};

// 접었다 폈다 하는 묶음. 처음 keep 개만 보이고 나머지는 버튼을 눌러야 나온다.
function mdFoldable(items, keep, renderFn, unit) {
    if (items.length <= keep) return items.map(renderFn).join('');
    const rest = items.length - keep;
    return items.slice(0, keep).map(renderFn).join('')
        + `<div class="md-rest" hidden>${items.slice(keep).map(renderFn).join('')}</div>`
        + `<button type="button" class="md-more" data-rest="${rest}" data-unit="${unit}">더보기 (${rest}${unit})</button>`;
}

// 제출 URL 칸에 링크가 둘 들어오면(파일 2개 제출) 버튼도 둘로 나눈다.
// 한 칸에 이어 붙은 채로 href 에 넣으면 주소가 깨져 하나도 못 연다.
function mdLinks(url) {
    const urls = splitLinks(url);
    return urls.map((u, i) =>
        `<a class="md-row-link" href="${encodeURI(u)}" target="_blank" rel="noopener"
            title="제출 파일 ${i + 1}">🔗${urls.length > 1 ? i + 1 : ''}</a>`).join('');
}

function mdSection(icon, title, right, inner, extraClass = '') {
    return `
        <section class="md-sec ${extraClass}">
            <div class="md-sec-head"><span class="md-ico">${icon}</span>
                <span class="md-sec-title">${title}</span>
                <span class="md-sec-right">${right}</span></div>
            ${inner}
        </section>`;
}

function openMemberDetail(member) {
    if (!memberModal || !mdBody) return;

    // ── 출석
    //
    // 지난 주차를 최근 것부터, 그 다음에 앞으로의 주차를 가까운 것부터 놓는다.
    // 예전에는 그냥 뒤집어서 12월 강의가 맨 앞에 왔다 — 아직 하지도 않은 주차라
    // 정작 봐야 할 '방금 끝난 수업' 이 한참 아래에 있었다.
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
                   + `-${String(today.getDate()).padStart(2, '0')}`;
    const all = getSessions();
    const done   = all.filter(s => s.session_date <= todayIso).reverse();   // 최근부터
    const coming = all.filter(s => s.session_date >  todayIso);             // 가까운 것부터

    // 그 주차에 과제를 냈나 · 김밥을 신청했나
    const kbMap = getKimbapDetail(member.id) || {};
    const hwSet = new Set((getHomeworkList(member.id) || [])
        .map(h => prNormalizeSession(h.session)).filter(Boolean));
    const marksOf = (sx) => {
        const norm = prNormalizeSession(sx.label_norm || '');
        return {
            hw: hwSet.has(norm),
            kb: kbMap[sx.label_norm]?.applied === 1,
        };
    };

    const statusOf = (sx) => {
        const key = getSessionKey(sx.session_date);
        return normStatus(key ? member[key] : '');
    };

    // ◎ 는 앞으로의 주차에도 붙는다.
    //
    // 지난 기수 이수자는 시트에 남은 주차까지 미리 ◎ 가 찍혀 있다.
    // '아직 안 한 수업' 이라고 예정으로 묶어 버리면 신규 등록자와 구분이 안 된다.
    // ◎ 는 예측이 아니라 이미 지난 기수에서 들었다는 사실이므로 그대로 센다.
    // O·X·미기록은 지난 주차에서만 센다 — 그건 아직 일어나지 않은 일이다.
    const counts = { O: 0, '◎': 0, X: 0, '-': 0, '': 0 };
    let soon = 0;

    const cells = done.map(sx => {
        const v = statusOf(sx);
        counts[v in counts ? v : ''] += 1;
        return { sx, v, ...marksOf(sx) };
    }).concat(coming.map(sx => {
        const v = statusOf(sx);
        if (v === '◎') { counts['◎'] += 1; return { sx, v, ...marksOf(sx) }; }
        soon += 1;
        return { sx, v: null, ...marksOf(sx) };        // v=null → 예정
    }));

    const attGrid = mdFoldable(cells, MD_KEEP, ({ sx, v, hw, kb }) => {
        const m = v === null ? null : (MD_MARK[v] || MD_MARK['']);
        const marks = (hw ? '<span title="과제 제출">📝</span>' : '')
                    + (kb ? '<span title="김밥 신청">🍙</span>' : '');
        return `<div class="md-cell ${m ? 's-' + m.cls : 'is-soon'}">
            <span class="md-cell-date">${escapeHtml(sx.label)}</span>
            <span class="md-cell-name">${escapeHtml(sx.label_norm || '')}</span>
            <span class="md-cell-mark">${m ? m.txt : '예정'}</span>
            ${marks ? `<span class="md-cell-marks">${marks}</span>` : ''}
        </div>`;
    }, '개');

    // 요약. 0 인 항목은 빼서 눈에 걸리는 것만 남긴다 —
    // '그 외 17' 처럼 뭉뚱그리면 그게 미기록인지 이수인지 알 수가 없다.
    const bits = [`진행 ${done.length}회차`];
    if (counts.O)     bits.push(`출석 ${counts.O}`);
    if (counts.X)     bits.push(`결석 ${counts.X}`);
    if (counts['◎'])  bits.push(`인정 ${counts['◎']}`);
    if (counts[''])   bits.push(`미기록 ${counts['']}`);
    if (counts['-'])  bits.push(`수업없음 ${counts['-']}`);
    if (soon)         bits.push(`예정 ${soon}`);
    const attSummary = bits.join(' · ');

    // ◎ 가 많은 사람은 그리드만 봐서는 티가 안 난다. 제목 옆에 한 번 짚어 준다.
    //
    // ◎ 는 두 가지다 — 지난 기수에 이수했거나, 결석했지만 과제·소감문을 내서
    // 대체 인정받았거나. 시트에는 둘 다 같은 ◎ 로 들어와 여기서는 구분할 수 없다.
    // 그래서 '지난 기수 이수' 라고 단정하지 않고 '인정 출석' 이라고만 적는다.
    const credited = counts['◎'];

    // ── 김밥 : 신청한 주차만, 최근부터
    const kb = getKimbapDetail(member.id) || {};
    const kbRows = Object.entries(kb)
        .filter(([, info]) => info?.applied === 1)
        .map(([name, info]) => ({ name, date: info.date || '' }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // ── 과제 : 최근 낸 것부터. 날짜는 강의 일정에서 읽는다
    const hw = getHomeworkList(member.id) || [];
    const dateOf = (sess) => {
        const target = prNormalizeSession(sess);
        const hit = getSessions().find(x => prNormalizeSession(x.label_norm || '') === target);
        return hit ? hit.session_date : '';
    };
    const hwRows = hw.map(h => ({ ...h, when: h.submittedAt || dateOf(h.session) }))
        .sort((a, b) => String(b.when).localeCompare(String(a.when)));

    mdTitle.textContent =
        `${member.name} (${member.phone}) · ${member.team || '미편성'} · ${member.location || ''}`;

    mdBody.innerHTML =
        mdSection('📋', credited
                    ? `<span class="md-carry" title="지난 기수 이수 또는 과제·소감문 대체">◎ 인정 출석 ${credited}</span>`
                    : '',
                  attSummary, `<div class="md-grid">${attGrid}</div>`)
      + mdSection('🍙', '', kbRows.length ? `총 ${kbRows.length}회 신청` : '신청 내역 없음',
                  kbRows.length
                    ? `<div class="md-rows">${mdFoldable(kbRows, MD_HW_KEEP, r =>
                        `<div class="md-row"><span class="md-row-key">${escapeHtml(r.name)}</span>
                         <span class="md-row-when">${escapeHtml(r.date)}</span></div>`, '개')}</div>`
                    : '')
      + mdSection('📝', '', hwRows.length ? `총 ${hwRows.length}건 제출` : '제출 내역 없음',
                  hwRows.length
                    ? `<div class="md-rows">${mdFoldable(hwRows, MD_HW_KEEP, r =>
                        `<div class="md-row"><span class="md-row-key">${escapeHtml(r.session || '(미기재)')}</span>
                         <span class="md-row-type">${escapeHtml(r.type || '')}</span>
                         <span class="md-row-when">${escapeHtml(String(r.when).slice(0, 10))}</span>
                         ${mdLinks(r.url)}
                         </div>`, '개')}</div>`
                    : '');

    memberModal.classList.add('active');
    memberModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeMemberDetail() {
    if (!memberModal) return;
    memberModal.classList.remove('active');
    memberModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

document.getElementById('mdClose')?.addEventListener('click', closeMemberDetail);
memberModal?.addEventListener('click', (e) => { if (e.target === memberModal) closeMemberDetail(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && memberModal?.classList.contains('active')) closeMemberDetail();
});

// 더보기 — 눌린 묶음만 편다
mdBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('.md-more');
    if (!btn) return;
    const rest = btn.previousElementSibling;
    if (!rest?.classList.contains('md-rest')) return;
    const open = rest.hasAttribute('hidden');
    rest.toggleAttribute('hidden', !open);
    btn.textContent = open ? '접기' : `더보기 (${btn.dataset.rest}${btn.dataset.unit})`;
});

// ============================================================================
// 페이지 로드
// ============================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
} else {
    loadData();
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
const prPagePicks     = document.getElementById('prPagePicks');
// updatePrintInfo 가 이 값을 읽는다. 선언이 뒤에 있으면 첫 렌더에서 TDZ 로 터진다.
const prPickToggle    = document.getElementById('prPickToggle');
const prPickSomeBtn   = document.getElementById('prPickSomeBtn');
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

// ---------------------------------------------------------------------------
// 표시할 칸을 기억한다
//
// 과제 칸을 쓰는 사람은 매번 쓴다. 들어올 때마다 다시 체크하게 두면 안 된다.
//
// 다만 김밥신청은 성격이 다르다. 그건 취향이 아니라 '월 마지막 수업이냐' 로
// 정해지는 값이다. 다른 칸처럼 그냥 저장해 버리면, 한 번 끈 순간 자동 판단이
// 영영 죽는다 — 다음 달 마지막 주에도 칸이 안 나온다.
//
// 그래서 김밥신청만 주차별로 기억한다.
//   · 사람이 말한 적 없는 주차  → 자동 판단 (월 마지막 수업이면 켬)
//   · 사람이 정한 적 있는 주차  → 그 뜻대로
// 이러면 둘이 안 부딪힌다. 자동은 빈자리에서만 말하고, 사람 말은 안 덮인다.
// ---------------------------------------------------------------------------
const PR_PREF_KEY = 'plc_admin_print_prefs';
const PR_SAVED_COLS = ['status', 'homework', 'memo', 'summary'];
const PR_KIMBAP_KEEP = 40;      // 주차별 기록은 이만큼만 남긴다

let prKimbapBy = {};            // { '2026-08-16': true|false }

function loadPrintPrefs() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(PR_PREF_KEY) || '{}'); }
    catch { /* 깨진 값은 버린다 */ }

    prKimbapBy = (saved.kimbapBy && typeof saved.kimbapBy === 'object') ? saved.kimbapBy : {};

    const cols = saved.cols || {};
    for (const key of PR_SAVED_COLS) {
        if (typeof cols[key] === 'boolean' && prOpt[key]) prOpt[key].checked = cols[key];
    }
}

function savePrintPrefs() {
    // 주차 기록은 기수가 바뀌어도 쌓이기만 한다. 최근 것만 남긴다.
    const dates = Object.keys(prKimbapBy).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - PR_KIMBAP_KEEP))) {
        delete prKimbapBy[d];
    }

    const cols = {};
    for (const key of PR_SAVED_COLS) if (prOpt[key]) cols[key] = prOpt[key].checked;

    try { localStorage.setItem(PR_PREF_KEY, JSON.stringify({ cols, kimbapBy: prKimbapBy })); }
    catch { /* 저장 실패는 무시 */ }
}

loadPrintPrefs();

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
// 조·장소 고르기는 '거르기' 가 아니라 '찾아가기' 다.
//
// 예전에는 고른 조만 남기고 나머지를 지웠다. 그러면 집계표가 그 조 하나짜리가
// 되어 아무 뜻이 없고, 다른 조를 보려면 다시 전체로 돌아와야 했다.
// 무엇을 인쇄할지는 '출력할 장 → 부분 선택' 이 정한다. 여기서는 자리만 옮긴다.
function prScrollToTeam(value) {
    let key = value;
    if (value === TEAM_ALL) {
        key = PR_SUMMARY_KEY;                       // 전체는 맨 위 집계표로
    } else if (String(value).startsWith(PR_LOC_PREFIX)) {
        const loc = value.slice(PR_LOC_PREFIX.length);
        key = getTeams().find(t => prTeamLocation(t) === loc);   // 그 장소의 첫 조
    }
    // 조가 하나뿐이면 집계표가 없다. 그때는 첫 장으로 간다.
    const el = (key && prPreview?.querySelector(`.pr-sheet[data-page="${CSS.escape(key)}"]`))
             || (value === TEAM_ALL ? prPreview?.querySelector('.pr-sheet') : null);
    if (!el) return;

    // 조작부가 화면에 붙어 있어(sticky) 그 높이만큼 위를 가린다. 그만큼 덜 내린다.
    const panel = document.querySelector('.pr-panel');
    const gap = (panel?.getBoundingClientRect().height || 0) + 12;
    const y = window.scrollY + el.getBoundingClientRect().top - gap;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// 오늘에서 날짜상 가장 가까운 주차.
//
// 출석부는 수업 '전에' 뽑는다. 그래서 기본값이 지난 주차면 안 된다 —
// 수업 전날 인쇄하러 들어오면 지난주 것이 떠서 매번 주차를 바꿔야 했다.
//
// 출석 관리 화면은 반대다. 거기는 이미 끝난 수업에 체크하므로 지난 주차가 맞고,
// 그래서 getCurrentSessionDate(가장 최근 지난 주차)를 그대로 쓴다.
// 그걸 고치면 출석이 아직 하지도 않은 수업에 찍힌다.
function prNearestSessionDate() {
    const sessions = getSessions();
    if (!sessions.length) return null;

    const t = new Date();
    const todayIso =
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const gap = (iso) => Math.abs(Date.parse(iso) - Date.parse(todayIso));

    let best = sessions[0];
    for (const s of sessions) {
        // 거리가 같으면 다가오는 쪽 — 인쇄는 앞으로 있을 수업을 위해 한다
        if (gap(s.session_date) < gap(best.session_date)
            || (gap(s.session_date) === gap(best.session_date) && s.session_date > best.session_date)) {
            best = s;
        }
    }
    return best.session_date;
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
//   맨 아래 특이사항 칸                      =  30mm
//   여유 4mm
//
// 특이사항 칸을 여기서 미리 빼 두지 않으면 표가 밀려 두 장이 된다.
const PR_NOTE_BOX_MM = 30;
const PR_PAGE_AVAIL_MM = 273 - 26 - PR_NOTE_BOX_MM - 4;

// 집계표는 특이사항 칸이 없으니 그만큼 더 쓴다.
// 줄이 열댓 개뿐이라 상한을 좀 더 열어 둔다 — 안 그러면 한 장이 휑하다.
function prSummaryRowMm(count) {
    if (!count) return 10;
    const fit = (273 - 26 - 4) / count;
    return Math.round(Math.min(24, Math.max(10, fit)) * 10) / 10;
}

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

    // 고른 적이 없거나 고른 주차가 사라졌을 때만 기본값을 잡는다.
    // 매번 다시 잡으면 배경 갱신이 올 때마다 보던 주차가 튕긴다.
    const known = new Set(sessions.map(x => x.session_date));
    if (!prSessionDate || !known.has(prSessionDate)) {
        prSessionDate = prNearestSessionDate() || sessions[0]?.session_date || null;
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

// 주차를 바꾸면 김밥 칸을 다시 잡는다.
// 그 주차에 대해 사람이 정한 적이 있으면 그 값, 없으면 자동 판단.
function syncKimbapDefault() {
    if (!prOpt.kimbap) return;
    const chosen = prKimbapBy[prSessionDate];
    prOpt.kimbap.checked = typeof chosen === 'boolean'
        ? chosen
        : isLastClassOfMonth(prSessionDate);
    updateKimbapHint();
}

// 지금 칸이 켜지고 꺼진 이유를 한 줄로 알려준다.
// 자동으로 켰는지, 내가 정해둔 값인지 구분이 안 되면 사람이 앱을 못 믿는다.
function updateKimbapHint() {
    if (!prHint) return;
    const last = isLastClassOfMonth(prSessionDate);
    const chosen = prKimbapBy[prSessionDate];

    if (typeof chosen !== 'boolean') {
        prHint.textContent = last
            ? '이 주차는 해당 월의 마지막 수업입니다 — 김밥신청 칸을 자동으로 켰습니다.'
            : '';
        return;
    }
    if (chosen === last) {   // 정해둔 값이 자동 판단과 같으면 굳이 설명할 게 없다
        prHint.textContent = last
            ? '이 주차는 해당 월의 마지막 수업입니다 — 김밥신청 칸을 켰습니다.'
            : '';
        return;
    }
    prHint.textContent = last
        ? '이 주차는 월 마지막 수업이지만, 김밥신청 칸을 끈 것으로 기억하고 있습니다.'
        : '이 주차의 김밥신청 칸을 켠 것으로 기억하고 있습니다.';
}

// ---------------------------------------------------------------------------
// 출력할 장 고르기
//
// 체크가 두 군데 있다 — 장마다 붙은 것과 위 조작부의 목록.
// 어느 쪽을 눌러도 같은 곳(prSkip)을 고치고 나머지 한쪽을 따라오게 한다.
// 한쪽만 고치면 위에서 끈 장이 아래에서는 켜진 채로 보인다.
//
// 다시 그리지 않는 것이 중요하다. renderPrintPreview 를 부르면
// 미리보기가 통째로 새로 그려져 보고 있던 자리를 잃는다.
// ---------------------------------------------------------------------------
let prPageKeys = [];            // 지금 미리보기에 있는 장들 (그린 순서대로)

const PR_SUMMARY_KEY = '__summary__';
const prPageLabel = (key) => (key === PR_SUMMARY_KEY ? '집계표' : key);

function prSetPageOn(key, on) {
    if (on) prSkip.delete(key); else prSkip.add(key);

    const sel = `[data-page="${CSS.escape(key)}"]`;
    const sheet = prPreview?.querySelector(`.pr-sheet${sel}`);
    sheet?.classList.toggle('pr-skip', !on);

    for (const box of [sheet?.querySelector('.pr-pick-input'),
                       prPagePicks?.querySelector(`.pr-pagepick-input${sel}`)]) {
        if (box && box.checked !== on) box.checked = on;
    }
}

function prRenderPagePicks() {
    if (!prPagePicks) return;
    prPagePicks.innerHTML = prPageKeys.map(k => `
        <label class="pr-chip pr-page-chip">
            <input type="checkbox" class="pr-pagepick-input" data-page="${escapeHtml(k)}"${prSkip.has(k) ? '' : ' checked'}>
            <span>${escapeHtml(prPageLabel(k))}</span>
        </label>`).join('');
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

    const teams = getTeams();   // 항상 전부 그린다 (고르기는 찾아가기다)
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
                <section class="pr-page" style="--pr-row: ${prSummaryRowMm(stats.length + 1)}mm">
                <div class="pr-head">
                    <h2>${escapeHtml(getCohortId() || '')} 조별 집계</h2>
                    <div class="pr-session">${escapeHtml(sessionLabel)}</div>
                </div>
                <table class="pr-table pr-summary">
                    <thead><tr><th class="pr-c-idx">No.</th>
                               <th class="pr-c-team">조</th><th class="pr-c-loc">장소</th>
                               <th class="pr-c-num">인원</th><th class="pr-c-num">김밥</th></tr></thead>
                    <tbody>
                        ${stats.map((x, i) => `<tr><td class="pr-c-idx">${i + 1}</td>
                            <td>${escapeHtml(x.team)}</td>
                            <td>${escapeHtml(x.location)}</td>
                            <td>${x.count}</td><td>${x.applied || ''}</td></tr>`).join('')}
                        <tr class="pr-total"><td class="pr-c-idx"></td><td>합계</td><td></td><td>${totalN}</td><td>${totalK}</td></tr>
                    </tbody>
                </table>
                </section>
            </div>`;
    }

    for (const st of stats) {
        // 시트에 적힌 순서 그대로 둔다.
        //
        // 역할순·이름순으로 다시 세우면 종이와 시트를 나란히 놓고 짚어 갈 때
        // 줄이 어긋난다. 종이에 손으로 적은 걸 시트에 옮기는 일이라
        // 순서가 다르면 옮겨 적다가 사람을 잘못 찾는다.
        // (데이터 계층이 team, team_no 로 정렬해 둔다 — 그게 시트 순서다.
        //  역할은 이름 아래 줄에 나오므로 튜터가 누구인지는 여전히 보인다.)
        const members = getTeamMembers(st.team);

        // 번호도 시트를 따른다. 전원에게 시트 번호가 있을 때만 그걸 쓰고,
        // 하나라도 비면 통째로 순번(1,2,3…)으로 간다 —
        // 섞이면 어느 쪽이 시트 번호인지 알 수 없어 더 헷갈린다.
        const sheetNos = members.map(m => String(m['no.'] ?? '').trim());
        const useSheetNo = sheetNos.length > 0 && sheetNos.every(n => n !== '');

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
                    <td class="pr-c-no">${useSheetNo ? escapeHtml(sheetNos[i]) : i + 1}</td>
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
                <div class="pr-note">
                    <span class="pr-note-label">특이사항</span>
                </div>
                </section>
            </div>`;
    }

    prPreview.innerHTML = html;

    // 조작부 목록은 미리보기와 같은 순서·같은 내용이어야 한다
    prPageKeys = [...prPreview.querySelectorAll('.pr-sheet')].map(s => s.dataset.page);
    prRenderPagePicks();

    updatePrintInfo();
}

function updatePrintInfo() {
    updatePrPickToggle();          // 켜고 끌 때마다 버튼이 지금 상태의 반대를 보여야 한다
    if (!prInfo || !prPreview) return;
    const pages = prPreview.querySelectorAll('.pr-sheet');
    const on = prPreview.querySelectorAll('.pr-sheet:not(.pr-skip)').length;
    prInfo.textContent = pages.length === 0 ? ''
        : (on === pages.length ? `${pages.length}장 출력`
                               : `${pages.length}장 중 ${on}장 출력 (${pages.length - on}장 제외)`);
}

// 장 위의 체크, 조작부의 체크 — 어느 쪽을 눌러도 같은 곳으로 간다
prPreview?.addEventListener('change', (e) => {
    const box = e.target.closest('.pr-pick-input');
    if (!box) return;
    prSetPageOn(box.dataset.page, box.checked);
    updatePrintInfo();
});
prPagePicks?.addEventListener('change', (e) => {
    const box = e.target.closest('.pr-pagepick-input');
    if (!box) return;
    prSetPageOn(box.dataset.page, box.checked);
    updatePrintInfo();
    // 여러 장을 연달아 끄는 일이 많다. 하나 고를 때마다 닫으면 다시 열어야 한다.
});

// '부분 선택' — 목록은 눌렀을 때만 뜬다
function prSetPickMenu(open) {
    if (!prPagePicks || !prPickSomeBtn) return;
    prPagePicks.hidden = !open;
    prPickSomeBtn.setAttribute('aria-expanded', String(open));
    prPickSomeBtn.textContent = open ? '부분 선택 ▴' : '부분 선택 ▾';
}
prPickSomeBtn?.addEventListener('click', () => prSetPickMenu(prPagePicks?.hidden));

// 바깥을 누르거나 ESC 면 닫는다. 안쪽(체크)을 눌렀을 때는 열어 둔다.
document.addEventListener('click', (e) => {
    if (prPagePicks?.hidden) return;
    if (e.target.closest('.pr-pick-menu')) return;
    prSetPickMenu(false);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !prPagePicks?.hidden) {
        prSetPickMenu(false);
        prPickSomeBtn?.focus();
    }
});

// 전체 선택·해제는 버튼 하나로.
//
// 두 버튼을 나란히 두면 늘 하나는 눌러도 아무 일이 없다.
// 지금 상태의 반대만 보여 준다 — 다 켜져 있으면 '전체 해제', 하나라도 꺼져
// 있으면 '전체 선택'. 다시 그리지 않으므로 보고 있던 자리를 잃지 않는다.
function updatePrPickToggle() {
    if (!prPickToggle) return;
    const allOn = prPageKeys.length > 0 && prPageKeys.every(k => !prSkip.has(k));
    prPickToggle.textContent = allOn ? '전체 해제' : '전체 선택';
    prPickToggle.disabled = prPageKeys.length === 0;
}

prPickToggle?.addEventListener('click', () => {
    const allOn = prPageKeys.every(k => !prSkip.has(k));
    prPageKeys.forEach(k => prSetPageOn(k, !allOn));
    updatePrintInfo();
});

// 범위가 바뀌면 뺐던 것도 뜻을 잃는다
prSessionSelect?.addEventListener('change', (e) => {
    prSessionDate = e.target.value;
    prSkip.clear();
    syncKimbapDefault();
    renderPrintPreview();
});
// 다시 그리지 않는다 — 그리는 내용이 같고, 다시 그리면 빼 둔 장 선택이 날아간다
prTeamSelect?.addEventListener('change', (e) => {
    prTeamName = e.target.value;
    prScrollToTeam(prTeamName);
});
// 김밥신청은 '이 주차에 대해' 정한 것으로 남긴다 (자동 판단을 죽이지 않는다)
prOpt.kimbap?.addEventListener('change', () => {
    if (prSessionDate) prKimbapBy[prSessionDate] = prOpt.kimbap.checked;
    savePrintPrefs();
    updateKimbapHint();
    renderPrintPreview();
});
[prOpt.status, prOpt.homework, prOpt.memo, prOpt.summary].forEach(el =>
    el?.addEventListener('change', () => { savePrintPrefs(); renderPrintPreview(); }));

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
// 결석 현황
//
// 규칙 (새가족교육 안내문 4항):
//   3회 결석까지 — 과제 및 소감문 제출로 대체 가능
//   4회 결석    — 다음 기수에 재수강
//
// ⚠️ 기준 주차까지만 센다.
//
// 지난 기수 참석자는 시트에 앞으로의 주차까지 X 가 미리 들어 있는 경우가 있다.
// 기수 전체를 세면 아직 하지도 않은 수업이 결석으로 잡혀, 실제로는 한 번도
// 안 빠진 사람이 '4회 이상' 으로 떴다 (이현주 사례).
// 아직 하지 않은 수업은 결석이 아니다.
//
// 이 화면은 아무것도 고치지 않는다. 볼 사람을 추려 줄 뿐이다 —
// 사정을 미리 알린 사람, 담당 교역자와 의논 중인 사람이 섞여 있다.
// ============================================================================
const AB_RETAKE_AT = 4;                  // 이 횟수부터 재수강 (안내문 4항)
const AB_THRESHOLDS = [2, 3, 4];
const AB_STREAK_MIN = 2;                 // 이 횟수부터 '연속' 이라고 표시한다

const abSessionSelect = document.getElementById('abSession');
const abTeamSelect    = document.getElementById('abTeam');
const abPastorSelect  = document.getElementById('abPastor');
const abWeekBadge     = document.getElementById('abWeekBadge');
const abWeekNote      = document.getElementById('abWeekNote');
const abWeekList      = document.getElementById('abWeekList');
const abTotalBadge    = document.getElementById('abTotalBadge');
const abTotalNote     = document.getElementById('abTotalNote');
const abTotalList     = document.getElementById('abTotalList');
const abThresholds    = document.getElementById('abThresholds');
const abSortSelect    = document.getElementById('abSort');
const abDirBtn        = document.getElementById('abDir');

const AB_PASTOR_ALL = '__all__';

// 정렬. '결석' 은 누적 명단에서는 누적 횟수, 이 주차 명단에서는 연속 주차를 뜻한다 —
// 두 장이 보는 숫자가 다르므로 각자 자기 숫자로 세운다.
const AB_SORTS = [
    { key: 'absent', label: '결석 순' },
    { key: 'team',   label: '조' },
    { key: 'pastor', label: '담당교역자' },
];

let abSessionDate = null;
let abTeamName = TEAM_ALL;
let abPastor = AB_PASTOR_ALL;
let abSort = 'absent';
let abDesc = true;              // 결석은 많은 쪽이 먼저 보여야 한다
let abMin = 2;
let abLastRows = { week: [], total: [] };   // 명단 복사가 쓴다

// 기준 주차까지의 강의 주차. 여기가 이 화면의 핵심이다.
// is_class 가 아닌 주차(교제·나눔)는 수료 집계에서 빠지므로 여기서도 뺀다.
function abSessionsUpTo(dateIso) {
    return getSessions().filter(s => s.is_class !== false && s.session_date <= dateIso);
}

const abPastorOf = (m) => String(m['담당교역자'] || '').trim();

function abRows() {
    if (!abSessionDate) return [];
    const sessions = abSessionsUpTo(abSessionDate);
    const thisKey = getSessionKey(abSessionDate);

    let people = (abTeamName === TEAM_ALL ? getMembers() : getTeamMembers(abTeamName));
    if (abPastor !== AB_PASTOR_ALL) people = people.filter(m => abPastorOf(m) === abPastor);

    return people.map(m => {
        const absentWeeks = [];
        let blank = 0;
        for (const s of sessions) {
            const key = getSessionKey(s.session_date);
            const v = normStatus(key ? m[key] : '');
            if (v === 'X') absentWeeks.push(s);
            else if (v === '') blank++;
        }

        // 연속 결석 — 기준 주차부터 거꾸로 이어지는 X 의 개수.
        // 빈칸에서 멈춘다. 아직 안 찍은 주차를 결석으로 이어 붙이면 안 된다.
        let streak = 0;
        for (let i = sessions.length - 1; i >= 0; i--) {
            const key = getSessionKey(sessions[i].session_date);
            if (normStatus(key ? m[key] : '') !== 'X') break;
            streak++;
        }

        return {
            m, blank, streak,
            weeks: absentWeeks,
            absent: absentWeeks.length,
            thisWeek: normStatus(thisKey ? m[thisKey] : '') === 'X',
        };
    });
}

function abPersonHtml(r, extra) {
    return `
        <div class="ab-item${r.absent >= AB_RETAKE_AT ? ' risk' : ''}">
            <span class="ab-team">${escapeHtml(r.m.team || '미편성')}</span>
            <span class="ab-name">${escapeHtml(r.m.name)}<span class="ab-phone">${escapeHtml(r.m.phone)}</span></span>
            ${abPastorOf(r.m) ? `<span class="ab-pastor">${escapeHtml(abPastorOf(r.m))}</span>` : ''}
            <span class="ab-extra">${extra}</span>
        </div>`;
}

const abText = (x, y) => String(x || '').localeCompare(String(y || ''), 'ko');

// useStreak: 이 주차 명단은 '연속 주차' 가 그 사람의 숫자다.
function abSorter(useStreak) {
    return (a, b) => {
        let d;
        if (abSort === 'team')        d = abText(a.m.team, b.m.team);
        else if (abSort === 'pastor') d = abText(abPastorOf(a.m), abPastorOf(b.m));
        else d = (useStreak ? a.streak - b.streak : a.absent - b.absent);
        if (abDesc) d = -d;
        // 같은 값이면 조 → 이름 순으로 굳힌다. 안 그러면 다시 그릴 때마다 순서가 흔들린다.
        return d || abText(a.m.team, b.m.team) || abText(a.m.name, b.m.name);
    };
}

function initAbsenceTab() {
    if (!abSessionSelect || !abTeamSelect) return;

    const sessions = getSessions();
    abSessionSelect.innerHTML = sessions.map(s =>
        `<option value="${s.session_date}">${s.label}${s.label_norm ? ' · ' + s.label_norm : ''}</option>`).join('');

    const known = new Set(sessions.map(s => s.session_date));
    if (!abSessionDate || !known.has(abSessionDate)) {
        // 이미 끝난 수업이 기본값 — 아직 안 한 주차를 기준으로 삼으면 안 된다
        abSessionDate = getCurrentSessionDate() || sessions[sessions.length - 1]?.session_date || null;
    }
    if (abSessionDate) abSessionSelect.value = abSessionDate;

    const teams = getTeams();
    abTeamSelect.innerHTML = `<option value="${TEAM_ALL}">전체 (${teams.length}개 조)</option>`
        + teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (abTeamName !== TEAM_ALL && !teams.includes(abTeamName)) abTeamName = TEAM_ALL;
    abTeamSelect.value = abTeamName;

    if (abPastorSelect) {
        const pastors = [...new Set(getMembers().map(abPastorOf).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'ko'));
        abPastorSelect.innerHTML = `<option value="${AB_PASTOR_ALL}">전체</option>`
            + pastors.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
        if (abPastor !== AB_PASTOR_ALL && !pastors.includes(abPastor)) abPastor = AB_PASTOR_ALL;
        abPastorSelect.value = abPastor;
        abPastorSelect.disabled = pastors.length === 0;
    }

    if (abSortSelect && !abSortSelect.options.length) {
        abSortSelect.innerHTML = AB_SORTS.map(o =>
            `<option value="${o.key}">${o.label}</option>`).join('');
    }
    if (abSortSelect) abSortSelect.value = abSort;
    updateAbDirBtn();

    renderAbsence();
}

function renderAbsence() {
    if (!abWeekList || !abTotalList) return;

    const sessions = abSessionsUpTo(abSessionDate || '');
    const session = getSessions().find(s => s.session_date === abSessionDate);
    const rows = abRows();

    // ── 이 주차 결석자
    const week = rows.filter(r => r.thisWeek).sort(abSorter(true));
    abLastRows.week = week;

    if (abWeekBadge) {
        abWeekBadge.textContent = session ? `${session.label} · ${week.length}명` : '';
    }
    if (abWeekNote) {
        // 이 주차에 아직 아무 표시도 없는 사람 (결석이 아니라 미기록이다)
        const thisKey = abSessionDate ? getSessionKey(abSessionDate) : '';
        const unset = rows.filter(r => normStatus(thisKey ? r.m[thisKey] : '') === '').length;
        abWeekNote.textContent = unset
            ? `※ ${unset}명은 아직 기록이 없습니다 — 결석으로 세지 않았습니다.`
            : '';
        abWeekNote.style.display = unset ? '' : 'none';
    }
    abWeekList.innerHTML = week.length
        ? week.map(r => abPersonHtml(r,
            r.streak >= AB_STREAK_MIN ? `<span class="ab-streak">${r.streak}주 연속</span>` : '')).join('')
        : '<div class="ab-empty">이 주차 결석자가 없습니다.</div>';

    // ── 누적 결석자
    const total = rows.filter(r => r.absent >= abMin).sort(abSorter(false));
    abLastRows.total = total;

    if (abThresholds) {
        abThresholds.innerHTML = AB_THRESHOLDS.map(n => `
            <button type="button" class="ab-th${abMin === n ? ' on' : ''}" data-min="${n}">
                ${n}회 이상${n === AB_RETAKE_AT ? ' <span class="ab-th-tag">재수강</span>' : ''}
            </button>`).join('');
    }
    if (abTotalBadge) abTotalBadge.textContent = `${total.length}명`;
    if (abTotalNote) {
        abTotalNote.textContent =
            `강의 ${sessions.length}회차 기준 · 결석(X)만 셉니다 (빈칸 · ◎ · − 은 제외)`;
    }
    abTotalList.innerHTML = total.length
        ? total.map(r => abPersonHtml(r,
            `<span class="ab-count">${r.absent}회</span>`
            + `<span class="ab-weeks">${r.weeks.map(s => `<span class="ab-week">${s.label}</span>`).join('')}</span>`)).join('')
        : `<div class="ab-empty">${abMin}회 이상 결석한 사람이 없습니다.</div>`;
}

abSessionSelect?.addEventListener('change', (e) => { abSessionDate = e.target.value; renderAbsence(); });
abTeamSelect?.addEventListener('change', (e) => { abTeamName = e.target.value; renderAbsence(); });
abPastorSelect?.addEventListener('change', (e) => { abPastor = e.target.value; renderAbsence(); });
abSortSelect?.addEventListener('change', (e) => {
    abSort = e.target.value;
    // 기준을 바꾸면 그 기준에 맞는 방향으로 시작한다 —
    // 결석은 많은 쪽부터, 조·이름은 가나다순이 자연스럽다.
    abDesc = (abSort === 'absent');
    updateAbDirBtn();
    renderAbsence();
});
abDirBtn?.addEventListener('click', () => { abDesc = !abDesc; updateAbDirBtn(); renderAbsence(); });

function updateAbDirBtn() {
    if (!abDirBtn) return;
    abDirBtn.textContent = abDesc ? '↓ 내림차순' : '↑ 오름차순';
    abDirBtn.title = abDesc ? '큰 값·나중 글자부터' : '작은 값·앞 글자부터';
}
abThresholds?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ab-th');
    if (!btn) return;
    abMin = Number(btn.dataset.min);
    renderAbsence();
});

// 명단 복사 — 조별방에 그대로 붙여 넣을 수 있게 한 줄에 한 사람씩.
document.getElementById('absenceTab')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ab-copy');
    if (!btn) return;
    const which = btn.dataset.copy;
    const rows = abLastRows[which] || [];
    if (!rows.length) { btn.textContent = '복사할 명단 없음'; }
    else {
        const text = rows.map(r => [
            r.m.team || '',
            `${r.m.name}(${r.m.phone})`,
            abPastorOf(r.m),
            which === 'total' ? `결석 ${r.absent}회`
                              : (r.streak >= AB_STREAK_MIN ? `${r.streak}주 연속` : ''),
        ].filter(Boolean).join(' ')).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = `✅ ${rows.length}명 복사됨`;
        } catch {
            // 클립보드를 막아 둔 환경(비 HTTPS 등)에서도 손으로 긁어갈 수 있게
            window.prompt('복사할 명단입니다 (Ctrl+C)', text);
            btn.textContent = '📋 명단 복사';
            return;
        }
    }
    setTimeout(() => { btn.textContent = '📋 명단 복사'; }, 2000);
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
