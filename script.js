// 데이터 계층 (Phase A: GAS, Phase C: Supabase 예정)
import {
    ensureLoaded,
    refresh,
    getMembers,
    findMember,
    getTeamMembers,
    getLocationImage,
    getTeamLink,
    getGeneralAnnouncementLink,
    updateAttendance,
    getCacheInfo,
} from './scripts/members-data.js';

// ============================================================================
// 1. 내 정보 기억 (localStorage) — UX #2
// ============================================================================
const LAST_SEARCH_KEY = 'plc_last_search_v1';
const LAST_SEARCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90일

function saveLastSearch(name, phone) {
    try {
        localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({
            name, phone, ts: Date.now(),
        }));
    } catch (e) { /* 무시 */ }
}

function loadLastSearch() {
    try {
        const raw = localStorage.getItem(LAST_SEARCH_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj?.name || !obj?.phone) return null;
        if (obj.ts && Date.now() - obj.ts > LAST_SEARCH_MAX_AGE_MS) {
            localStorage.removeItem(LAST_SEARCH_KEY);
            return null;
        }
        return obj;
    } catch (e) { return null; }
}

function clearLastSearch() {
    try { localStorage.removeItem(LAST_SEARCH_KEY); } catch (e) {}
}

// ============================================================================
// 2. DOM 요소 선택
// ============================================================================
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
    searchBtnText: document.querySelector('#searchBtn .btn-text'),
    resultContainer: document.getElementById('resultContainer'),
    errorMessage: document.getElementById('errorMessage'),
    errorText: document.getElementById('errorText'),
    closeBtn: document.getElementById('closeBtn'),
    resultName: document.getElementById('resultName'),
    resultTeam: document.getElementById('resultTeam'),
    resultLocation: document.getElementById('resultLocation'),
    resultLunch: document.getElementById('resultLunch'),
    mapContainer: document.getElementById('mapContainer'),
    mapImage: document.getElementById('mapImage'),
    themeToggle: document.getElementById('themeToggle'),
    adminBtn: document.getElementById('adminBtn'),
    adminModal: document.getElementById('adminLoginModal'),
    adminClose: document.getElementById('adminLoginClose'),
    adminForm: document.getElementById('adminLoginForm'),
    clearRememberedBtn: document.getElementById('clearRememberedBtn'),
    fontScaleToggle: document.getElementById('fontScaleToggle'),
};

// ============================================================================
// 폰트 크기 (UX #3 접근성) — default → large → xlarge → default 순환
// ============================================================================
const FONT_SCALE_KEY = 'plc_font_scale_v1';
const FONT_SCALES = ['default', 'large', 'xlarge'];
const FONT_SCALE_CLASS = { large: 'font-scale-large', xlarge: 'font-scale-xlarge' };

function applyFontScale(scale) {
    document.body.classList.remove('font-scale-large', 'font-scale-xlarge');
    if (FONT_SCALE_CLASS[scale]) document.body.classList.add(FONT_SCALE_CLASS[scale]);
}

function loadFontScale() {
    try {
        const saved = localStorage.getItem(FONT_SCALE_KEY);
        if (FONT_SCALES.includes(saved)) return saved;
    } catch (e) {}
    return 'default';
}

function cycleFontScale() {
    const current = loadFontScale();
    const next = FONT_SCALES[(FONT_SCALES.indexOf(current) + 1) % FONT_SCALES.length];
    try { localStorage.setItem(FONT_SCALE_KEY, next); } catch (e) {}
    applyFontScale(next);
}

// 초기 적용 (렌더 전, 페이지 깜빡임 방지)
applyFontScale(loadFontScale());

// ============================================================================
// 3. 초기 데이터 로드
// ============================================================================
async function loadData() {
    try {
        if (elements.searchBtn) elements.searchBtn.disabled = true;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "로딩중...";

        const { cacheHit, refreshed } = await ensureLoaded();

        if (cacheHit) {
            console.log("⚡ Cached Data Loaded: 즉시 활성화");
            if (elements.searchBtn) elements.searchBtn.disabled = false;
            if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";
        }
        if (refreshed) {
            console.log("✅ Live Data Synced");
            if (elements.searchBtn) elements.searchBtn.disabled = false;
            if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";
        }
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        if (getMembers().length === 0) {
            alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
            if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
        }
    }
}

// ============================================================================
// 4. 검색 로직
// ============================================================================
async function searchMember() {
    try {
        const name = elements.nameInput.value.trim().replace(/\s/g, '');
        const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');

        if (!name || !phone) {
            showError("이름과 번호 4자리를 입력해주세요.");
            return;
        }

        // 조회할 때마다 최신 데이터 강제 로드 (지난주 캐시 방지)
        if (elements.searchBtn) elements.searchBtn.disabled = true;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "조회중...";
        try {
            await refresh();
        } catch (fetchErr) {
            console.warn("⚠️ 최신 데이터 불러오기 실패, 캐시로 검색:", fetchErr);
        } finally {
            if (elements.searchBtn) elements.searchBtn.disabled = false;
            if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";
        }

        const member = findMember(name, phone);

        if (member) {
            saveLastSearch(name, phone);
            if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
            displayResult(member);
        } else {
            showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
        }
    } catch (err) {
        console.error("❌ [searchMember] 에러:", err);
        alert("검색 중 에러 발생: " + err.message);
    }
}

// ============================================================================
// 5. 검색 결과 표시
// ============================================================================
function toggleRow(row, value, target) {
    const safeValue = (value === null || value === undefined) ? "" : String(value);
    if (safeValue.trim() !== "") {
        if (target) target.textContent = safeValue;
        if (row) row.style.display = 'flex';
    } else {
        if (row) row.style.display = 'none';
    }
}

function displayResult(member) {
    try {
        elements.errorMessage.style.display = 'none';

        const memberListContainer = document.getElementById('teamMemberListContainer');
        if (memberListContainer) memberListContainer.style.display = 'none';

        const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
        const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
        const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
        const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null;

        toggleRow(nameRow, member.name, elements.resultName);
        toggleRow(teamRow, member.team, elements.resultTeam);
        toggleRow(locationRow, member.location, elements.resultLocation);

        const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
        toggleRow(lunchRow, lunchStatus, elements.resultLunch);

        // 텔레그램 안내방 행 helper
        function ensureTelegramRow(rowId, labelText, link, btnText) {
            let row = document.getElementById(rowId);

            if (!row && teamRow) {
                row = document.createElement('div');
                row.id = rowId;
                row.className = teamRow.className;
                row.style.display = 'flex';

                const labelTag = teamRow.children[0] ? teamRow.children[0].tagName.toLowerCase() : 'span';
                const valueTag = teamRow.children[1] ? teamRow.children[1].tagName.toLowerCase() : 'span';
                const labelClass = teamRow.children[0] ? teamRow.children[0].className : '';
                const valueClass = teamRow.children[1] ? teamRow.children[1].className : '';

                row.innerHTML = `
                    <${labelTag} class="${labelClass}">${labelText}</${labelTag}>
                    <${valueTag} class="${valueClass}">
                        <a href="" target="_blank" class="telegram-btn"
                           style="display: inline-flex; align-items: center; gap: 6px;
                                  padding: 8px 14px; background: #0088cc; color: white;
                                  border-radius: 6px; text-decoration: none; font-weight: bold;">
                            <span>✈️</span>
                            <span class="tg-text"></span>
                        </a>
                    </${valueTag}>
                `;

                const insertAfter = (rowId === 'telegramRow')
                    ? (document.getElementById('newFamilyRow') || teamRow)
                    : teamRow;
                insertAfter.parentNode.insertBefore(row, insertAfter.nextSibling);
            }

            if (!row) return;

            const linkEl = row.querySelector('a.telegram-btn');
            const textEl = row.querySelector('.tg-text');

            if (link && linkEl && textEl) {
                linkEl.href = link;
                textEl.textContent = btnText;
                row.style.display = 'flex';
            } else {
                row.style.display = 'none';
            }
        }

        // 새가족교육안내방 (모든 사용자에게 노출)
        ensureTelegramRow(
            'newFamilyRow',
            '새가족교육안내방',
            getGeneralAnnouncementLink(),
            '새가족교육안내방 입장하기'
        );

        // 본인 소속 조 안내방
        const myTeamLink = (member.team && member.team !== '새가족교육안내방')
            ? getTeamLink(member.team)
            : null;
        ensureTelegramRow(
            'telegramRow',
            '조별 안내방',
            myTeamLink,
            member.team ? `${member.team} 안내방 입장하기` : ''
        );

        const pureLocation = member.location ? String(member.location).trim() : "";
        const mapUrl = getLocationImage(pureLocation);
        if (mapUrl) {
            elements.mapImage.src = mapUrl;
            elements.mapContainer.style.display = 'block';
        } else {
            elements.mapContainer.style.display = 'none';
        }

        const isTutor = member.role && (
            member.role.includes('튜터') ||
            member.role.includes('서브튜터') ||
            member.role.includes('바나바') ||
            member.role.includes('관리자')
        );

        if (isTutor && member.team && memberListContainer) {
            const teamMembers = getTeamMembers(member.team);
            renderTeamMembers(teamMembers, member.team, member.role);
        }

        elements.resultContainer.style.display = 'block';
        elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        console.error("❌ [displayResult] 에러:", err);
        alert("결과 표시 중 에러 발생: " + err.message);
    }
}

// ============================================================================
// 6. 조원 목록 (튜터/관리자 뷰)
// ============================================================================
const rolePriority = {
    "관리자": 1,
    "튜터": 2,
    "서브튜터": 3,
    "바나바": 4,
    "조원": 5,
    "": 6
};

function renderTeamMembers(members, teamName, role) {
    const listElement = document.getElementById('teamMemberList');
    const titleElement = document.getElementById('teamListTitle');
    const container = document.getElementById('teamMemberListContainer');
    const summaryEl = document.getElementById('teamSummaryCard');

    if (!listElement || !titleElement || !container) return;

    if (!role || role.trim() === '') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    currentRenderedTeam = { name: teamName };
    titleElement.textContent = `👥 ${teamName} 조원 명단`;
    if (summaryEl) renderTeamSummary(summaryEl, members);

    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.name.localeCompare(b.name, 'ko');
    });

    listElement.innerHTML = sortedMembers.map((m, index) => {
        const borderStyle = index === 0
            ? "border-top: 1px dashed #ddd;"
            : "border-top: 1px solid #eee;";
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        const isChecked = (m.attendance && m.attendance.toUpperCase() === 'O') ? 'checked' : '';

        return `
            <div class="team-member-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 8px; ${borderStyle}">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" ${isChecked}
                        style="width: 18px; height: 18px; cursor: pointer;"
                        onclick="toggleAttendanceUI('${m.name}', '${m.phone}', this.checked, this)">
                    <span style="font-weight: bold; font-size: 15px; color: var(--text-color);">
                        ${m.name}(${m.phone}) ${lunchIcon}
                    </span>
                </div>
                <span style="font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">
                    ${m.role || '조원'}
                </span>
            </div>
        `;
    }).join('');
}

// ============================================================================
// 7. 출석 토글 (Optimistic update는 데이터 계층이 담당)
// ============================================================================
let currentRenderedTeam = null; // 현재 표시 중인 조 (요약 카드 갱신용)

async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const { success, error } = await updateAttendance(name, phone, checked);
    if (!success) {
        alert('출석 처리 실패: ' + (error?.message || '알 수 없는 오류'));
        if (checkboxElement) checkboxElement.checked = !checked;
        return;
    }
    // 요약 카드 즉시 갱신
    if (currentRenderedTeam) {
        const summaryEl = document.getElementById('teamSummaryCard');
        if (summaryEl) {
            const members = getTeamMembers(currentRenderedTeam.name);
            renderTeamSummary(summaryEl, members);
        }
    }
}

// 요약 카드만 재렌더 (체크박스 리스트는 그대로 유지)
function renderTeamSummary(summaryEl, members) {
    const upper = (v) => String(v || '').trim().toUpperCase();
    const presentCount = members.filter(m => ['O','◎'].includes(upper(m.attendance))).length;
    const absentCount  = members.filter(m => upper(m.attendance) === 'X').length;
    const kimbapCount  = members.filter(m => upper(m.lunch) === 'O').length;
    summaryEl.innerHTML = `
        <div class="stat">
            <div class="stat-value">${members.length}</div>
            <div class="stat-label">총원</div>
        </div>
        <div class="stat present">
            <div class="stat-value">${presentCount}</div>
            <div class="stat-label">✅ 출석</div>
        </div>
        <div class="stat absent">
            <div class="stat-value">${absentCount}</div>
            <div class="stat-label">❌ 결석</div>
        </div>
        <div class="stat lunch">
            <div class="stat-value">${kimbapCount}</div>
            <div class="stat-label">🍙 김밥</div>
        </div>
    `;
}
// 인라인 onclick에서 접근 가능하도록 window에 노출
window.toggleAttendanceUI = toggleAttendanceUI;

// ============================================================================
// 8. 에러 표시
// ============================================================================
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// ============================================================================
// 9. 이벤트 리스너
// ============================================================================
function initEventListeners() {
    const safeAdd = (el, event, handler, name) => {
        if (el) el.addEventListener(event, handler);
        else console.warn(`⚠️ ${name} 요소 없음, 리스너 스킵`);
    };

    safeAdd(elements.searchBtn, 'click', searchMember, 'searchBtn');
    safeAdd(elements.closeBtn, 'click', () => { elements.resultContainer.style.display = 'none'; }, 'closeBtn');
    safeAdd(elements.themeToggle, 'click', () => { document.body.classList.toggle('dark-mode'); }, 'themeToggle');
    safeAdd(elements.adminBtn, 'click', () => { elements.adminModal.classList.add('active'); }, 'adminBtn');
    safeAdd(elements.adminClose, 'click', () => { elements.adminModal.classList.remove('active'); }, 'adminClose');

    if (elements.adminForm) {
        elements.adminForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('adminId').value;
            const pw = document.getElementById('adminPassword').value;
            if (id === 'plc' && pw === 'plc1234') {
                alert("로그인 성공!");
                sessionStorage.setItem('adminLoggedIn', 'true');
                window.location.href = 'admin.html';
            } else {
                const errorElement = document.getElementById('adminLoginError');
                if (errorElement) {
                    errorElement.style.display = 'block';
                    errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
                }
            }
        });
    }

    safeAdd(elements.phoneInput, 'keypress', (e) => {
        if (e.key === 'Enter' && !elements.searchBtn.disabled) searchMember();
    }, 'phoneInput');

    // "다른 사람으로 조회" — 저장된 검색 지우기
    safeAdd(elements.clearRememberedBtn, 'click', () => {
        clearLastSearch();
        elements.nameInput.value = '';
        elements.phoneInput.value = '';
        elements.clearRememberedBtn.style.display = 'none';
        elements.resultContainer.style.display = 'none';
        elements.nameInput.focus();
    }, 'clearRememberedBtn');

    // 폰트 크기 토글
    safeAdd(elements.fontScaleToggle, 'click', cycleFontScale, 'fontScaleToggle');
}

// 저장된 마지막 검색이 있으면 자동 채움 + "다른 사람으로 조회" 버튼 노출
function applyLastSearch() {
    const last = loadLastSearch();
    if (!last) return;
    if (elements.nameInput)  elements.nameInput.value  = last.name;
    if (elements.phoneInput) elements.phoneInput.value = last.phone;
    if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
}

// Service Worker 등록 (PWA)
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // file:// 프로토콜에서는 SW 등록 불가
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return;
    }
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('SW 등록 실패:', err);
        });
    });
}
registerServiceWorker();

function initModal() {
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const mapImage = document.getElementById('mapImage');
    const modalClose = document.getElementById('modalClose');
    if (!mapImage) return;
    mapImage.addEventListener('click', () => {
        modalImage.src = mapImage.src;
        imageModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
    function closeModal() {
        if (imageModal) {
            imageModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }
    if (imageModal) imageModal.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

// ============================================================================
// 10. 실행
// ============================================================================
window.addEventListener('load', () => {
    console.log("=== 페이지 로드 ===");
    console.log("캐시 상태:", getCacheInfo());

    loadData().then(() => {
        console.log("데이터 로드 완료:", getCacheInfo());
    }).catch(err => {
        console.error("❌ loadData 실패:", err);
    });

    try { initEventListeners(); } catch (err) { console.error("initEventListeners 에러:", err); }
    try { initModal(); } catch (err) { console.error("initModal 에러:", err); }
    try { applyLastSearch(); } catch (err) { console.error("applyLastSearch 에러:", err); }
});
