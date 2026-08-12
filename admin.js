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
    subscribe,
} from './scripts/members-data.js?v=44';
import { matches as hangulMatches } from './scripts/hangul.js?v=44';

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
        const badge = document.querySelector('.admin-badge');
        if (badge && getCohortId()) badge.textContent = `${getCohortId()} · 관리자`;
        renderTeamsView();
        renderMembersView();
        initAttendanceTab();
    } catch (error) {
        console.error('❌ 데이터 로드 실패:', error);
        alert('데이터를 불러오는데 실패했습니다.');
    }
}

// 기수 전환 감지 — 배경 갱신 중에 새 기수가 들어오면 화면 전체를 다시 그린다
subscribe((event) => {
    if (event.type === 'cohort-changed') {
        console.log(`기수 전환: ${event.from} → ${event.to}`);
        renderTeamsView();
        renderMembersView();
        initAttendanceTab();
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

// 화면에 노출하는 4단 상태. DB가 허용하는 값과 같아야 한다.
const ATT_STATES = [
    { value: 'O', label: 'O', title: '출석' },
    { value: '◎', label: '◎', title: '지난 기수에 이수 (출석 인정)' },
    { value: 'X', label: 'X', title: '결석' },
    { value: '-', label: '−', title: '집계 제외' },
];
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
        : getCurrentSessionDate();
    if (attSessionDate) attSessionSelect.value = attSessionDate;

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
    const session = getSessions().find(s => s.session_date === attSessionDate);

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

        const buttons = ATT_STATES.map(st => `
            <button type="button"
                    class="att-state${cur === st.value ? ' on s-' + stateClass(st.value) : ''}"
                    data-uuid="${m._uuid}" data-status="${st.value}"
                    title="${st.title}" aria-pressed="${cur === st.value}">${st.label}</button>`).join('');

        html += `
            <div class="att-row${changed ? ' changed' : ''}${cur === '' ? ' blank' : ''}" data-uuid="${m._uuid}">
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
    const next = attDraft.get(uuid) === btn.dataset.status ? '' : btn.dataset.status;
    attDraft.set(uuid, next);
    renderAttList();
});

// 이름을 몇 개만 뽑아 보여준다 (확인 창이 길어지지 않게)
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
        if (mode === 'reset') {
            for (const [uuid, v] of attBaseline) attDraft.set(uuid, v);
        } else if (mode === 'clear') {
            const marked = [...attDraft].filter(([, v]) => v !== '').map(([u]) => u);
            if (marked.length && !confirm(
                `${marked.length}명의 기록을 지웁니다.\n\n` +
                `${attNamesOf(marked)}\n\n` +
                `지난 기수 이수(◎)까지 함께 지워집니다. 진행할까요?`)) return;
            for (const uuid of attDraft.keys()) attDraft.set(uuid, '');
        } else if (mode === 'fillX') {
            const blanks = [...attDraft].filter(([, v]) => v === '').map(([u]) => u);
            if (!blanks.length) return;
            if (!confirm(
                `미기록 ${blanks.length}명을 결석으로 처리합니다.\n\n` +
                `${attNamesOf(blanks)}\n\n` +
                `지난 기수에 이수해 안 나와도 되는 분이 섞여 있으면\n` +
                `취소하고 그분들을 ◎ 로 먼저 표시하세요.`)) return;
            for (const uuid of blanks) attDraft.set(uuid, 'X');
        } else {
            const others = [...attDraft].filter(([, v]) => v !== '' && v !== mode).map(([u]) => u);
            if (others.length && !confirm(
                `전원을 '${mode}' 로 바꿉니다.\n\n` +
                `이미 다른 값이 있는 ${others.length}명도 덮어씁니다:\n${attNamesOf(others)}\n\n진행할까요?`)) return;
            for (const uuid of attDraft.keys()) attDraft.set(uuid, mode);
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
window.addEventListener('load', () => {
    loadData();
    searchNameInput?.focus();
});
