// 데이터 계층 (Phase A: GAS, Phase C: Supabase 예정)
import {
    ensureLoaded,
    getMembers,
} from './scripts/members-data.js';
import { matches as hangulMatches } from './scripts/hangul.js';

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
        await ensureLoaded();
        console.log('✅ 데이터 로드 완료:', getMembers().length, '명');
        renderTeamsView();
        renderMembersView();
    } catch (error) {
        console.error('❌ 데이터 로드 실패:', error);
        alert('데이터를 불러오는데 실패했습니다.');
    }
}

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
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `
            <div class="team-card-header">
                <div class="team-card-name">${team.name}</div>
                <div class="team-card-count">${team.members.length}명</div>
            </div>
            <div class="team-card-location">${team.location}</div>
        `;
        card.addEventListener('click', () => showTeamMembers(team));
        teamsGrid.appendChild(card);
    });
}

teamFilter?.addEventListener('input', (e) => {
    renderTeamsView(e.target.value.trim());
});

function showTeamMembers(team) {
    teamModalTitle.textContent = `${team.name} (${team.members.length}명) · ${team.location}`;

    teamMembersList.innerHTML = '';
    team.members.forEach(member => {
        const card = document.createElement('div');
        card.className = 'team-member-card';
        card.innerHTML = `
            <div class="team-member-id">${member.name}${member.phone}</div>
            <div class="team-member-age">${member.age}세</div>
        `;
        teamMembersList.appendChild(card);
    });

    teamModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeTeamModal() {
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
