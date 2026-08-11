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
    getKimbapDetail,
    getHomeworkList,
    getSessions,
    getSessionKey,
    getCurrentSessionDate,
    getProgress,
    getRequiredHomework,
    MAKEUP_LIMIT,
    updateAttendanceBatch,
    getCacheInfo,
    getCohortId,
    subscribe,
    MODULE_VERSION,
} from './scripts/members-data.js?v=42';

const SCRIPT_VERSION = 'script.js v42';
// 어느 버전이 돌고 있는지 한눈에. 캐시가 옛 파일을 내주면 여기서 바로 드러난다.
console.log('%c🔖 ' + SCRIPT_VERSION + ' / ' + MODULE_VERSION,
            'background:#1B3B6F;color:#fff;padding:2px 8px;border-radius:4px');

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
// 폰트 크기 (UX #3 접근성) — default ↔ large 토글
// ============================================================================
const FONT_SCALE_KEY = 'plc_font_scale_v1';
const FONT_SCALES = ['default', 'large'];
const FONT_SCALE_CLASS = { large: 'font-scale-large' };

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

        // 캐시 있으면 즉시 활성화 (백그라운드 refresh 자동 시작)
        const { cacheHit } = await ensureLoaded();

        if (elements.searchBtn) elements.searchBtn.disabled = false;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";

        console.log(cacheHit ? "⚡ 캐시 즉시 활성화 (백그라운드 갱신 중)" : "✅ 서버 첫 로드 완료");
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        if (getMembers().length === 0) {
            alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
            if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
        }
    }
}

// 기수 전환 감지
//
// 새 기수가 시작되면 캐시에 남은 이전 기수 결과가 화면에 떠 있을 수 있다.
// 조용히 바꾸면 본인 것인 줄 알고 오해하므로, 걷어내고 알린다.
subscribe((event) => {
    if (event.type !== 'cohort-changed') return;
    if (elements.resultContainer) elements.resultContainer.style.display = 'none';
    if (elements.mapContainer) elements.mapContainer.style.display = 'none';
    showError(`${event.to} 명단으로 갱신되었습니다. 다시 조회해 주세요.`);
});

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

        // 캐시에서 즉시 검색 (백그라운드로 데이터 갱신은 loadData가 담당)
        const member = findMember(name, phone);

        if (member) {
            saveLastSearch(name, phone);
            if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
            displayResult(member);

            // 대상 인원의 최신 정보 확보를 위해 백그라운드로 refresh
            // 완료 후 결과가 바뀌었다면 재렌더
            refresh().then(() => {
                const updated = findMember(name, phone);
                if (updated && JSON.stringify(updated) !== JSON.stringify(member)) {
                    displayResult(updated);
                }
            }).catch(err => console.warn('백그라운드 refresh 실패:', err));
        } else {
            // 캐시에 없으면 서버 재조회 후 재검색
            try {
                await refresh();
            } catch (fetchErr) {
                console.warn("⚠️ refresh 실패:", fetchErr);
            }
            const retried = findMember(name, phone);
            if (retried) {
                saveLastSearch(name, phone);
                if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
                displayResult(retried);
            } else {
                showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
            }
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

        // 본인 안내 (수료 진행률·제출 필요 과제)
        renderMyStatus(member);

        // 상세 현황 (출석·김밥·과제·수료)
        renderStatusDetail(member);

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
// 본인 안내 — 수료까지 얼마나 남았는지, 제출할 과제가 있는지
//
// 판정은 DB 뷰(v_completion_status)가 하고 여기서는 표시만 한다.
// 당사자가 스스로 알면 관리자가 찾아 알릴 일이 줄어든다.
// ============================================================================
const HOMEWORK_FORM_URL =
    'https://docs.google.com/forms/d/e/1FAIpQLSex87UOQx7C9-9H1MJtrY-rLfNh_wfQWVVQ66-1XnY6YJ2M9A/viewform';

function renderMyStatus(member) {
    const el = document.getElementById('myStatusCard');
    if (!el) return;

    const p = getProgress(member);
    if (!p) { el.style.display = 'none'; return; }

    const pending = getRequiredHomework(member);
    const pct = p.required > 0 ? Math.round((p.credited / p.required) * 100) : 0;
    const done = p.verdict === '수료';

    // 진행률 막대
    const bar = `
        <div class="ms-bar" role="img" aria-label="수료 진행률 ${pct}%">
            <div class="ms-bar-fill" style="width:${Math.min(pct, 100)}%"></div>
        </div>`;

    // 헤드라인: 수료했으면 축하, 아니면 남은 횟수
    const headline = done
        ? `<div class="ms-headline done">🎓 수료 요건을 채웠어요</div>`
        : `<div class="ms-headline">
             <strong>${p.credited}</strong> / ${p.required}강 이수
             <span class="ms-remain">· 수료까지 ${p.remainingNeeded}회</span>
           </div>`;

    // 보충 안내 (결석을 과제로 메울 수 있는 기회가 얼마나 남았는지)
    let makeupNote = '';
    if (p.makeupOverflow > 0) {
        makeupNote = `<div class="ms-note warn">
            과제로 인정받을 수 있는 횟수(${MAKEUP_LIMIT}회)를 넘었어요. 담당자 확인이 필요합니다.
        </div>`;
    } else if (p.makeupUsed > 0) {
        makeupNote = `<div class="ms-note">
            과제로 ${p.makeupUsed}회 인정받았어요 (남은 기회 ${p.makeupLeft}회)
        </div>`;
    }

    // 제출이 필요한 과제 — 결석한 주차 중 아직 안 낸 것만
    let homeworkBlock = '';
    if (pending.length > 0) {
        const shown = pending.slice(0, 4).map(h => h.sessionLabel).join(' · ');
        const more = pending.length > 4 ? ` 외 ${pending.length - 4}건` : '';
        const canStillCount = p.makeupLeft > 0 && !done;
        homeworkBlock = `
            <div class="ms-homework">
                <div class="ms-hw-head">
                    <span class="ms-hw-title">📝 제출하지 않은 과제 ${pending.length}건</span>
                    <a class="ms-hw-btn" href="${HOMEWORK_FORM_URL}" target="_blank" rel="noopener">제출하기 →</a>
                </div>
                <div class="ms-hw-list">${shown}${more}</div>
                ${canStillCount
                    ? `<div class="ms-hw-hint">지금 제출하면 최대 ${p.makeupLeft}회까지 출석으로 인정돼요</div>`
                    : ''}
            </div>`;
    }

    el.className = 'my-status' + (done ? ' done' : '');
    el.innerHTML = `
        ${headline}
        ${bar}
        <div class="ms-stats">
            <span>출석 ${p.presentCount}</span>
            <span>결석 ${p.absentCount}</span>
            ${p.makeupUsed ? `<span>과제 인정 ${p.makeupUsed}</span>` : ''}
        </div>
        ${makeupNote}
        ${homeworkBlock}
    `;
    el.style.display = 'block';
}

// ============================================================================
// 상세 현황 렌더링 (출석 · 김밥 · 과제 통합 그리드)
// ============================================================================
const SESSION_KEY_RE = /^\d{2}\/\d{2}$/;

function extractSessions(member) {
    return Object.keys(member)
        .filter(k => SESSION_KEY_RE.test(k))
        .sort((a, b) => {
            const [am, ad] = a.split('/').map(Number);
            const [bm, bd] = b.split('/').map(Number);
            return am === bm ? ad - bd : am - bm;
        });
}

function classifyStatus(raw) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (s === 'O') return { cls: 'present', label: 'O', title: '출석' };
    if (s === '◎') return { cls: 'online',  label: '◎', title: '온라인/대체' };
    if (s === 'X') return { cls: 'absent',  label: 'X', title: '결석' };
    if (s === '-') return { cls: 'none',    label: '−', title: '수업 없음' };
    return { cls: 'empty', label: '·', title: '미기록' };
}

// MM/DD → Date (연도는 대략 판단, 매치용)
function mmddToDate(mmdd, refYear = new Date().getFullYear()) {
    const m = String(mmdd || '').match(/(\d{1,2})[\/\.\-](\d{1,2})/);
    if (!m) return null;
    return new Date(refYear, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

// Date-string (예: "Sun Mar 15 2026...") → M/d 축약. 정상 세션명이면 그대로 반환.
function prettySessionName(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // 이미 정상 세션명이면 그대로
    if (/^(교리|대화|성경적대화|나눔|교제|교재)/.test(s)) return s;
    // 긴 Date 문자열 → M/d
    if (s.length > 15) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return s;
}

// 김밥 detail 배열에서 attendanceDate에 가장 가까운 세션 (±5일 이내)
function matchKimbapForDate(kimbapDetail, attendanceMMDD) {
    const target = mmddToDate(attendanceMMDD);
    if (!target || !kimbapDetail) return null;
    let best = null, minDiff = Infinity;
    for (const [rawName, info] of Object.entries(kimbapDetail)) {
        // info.date에서 파싱 우선, 없으면 name 자체를 Date로 파싱 (fallback)
        let kd = mmddToDate(info.date);
        if (!kd) {
            const asDate = new Date(rawName);
            if (!isNaN(asDate.getTime()) && rawName.length > 15) kd = asDate;
        }
        if (!kd) continue;
        const diff = Math.abs(kd.getTime() - target.getTime());
        if (diff <= 5 * 86400000 && diff < minDiff) {
            minDiff = diff;
            best = {
                name: prettySessionName(rawName),
                applied: info.applied,
                date: info.date || `${kd.getMonth() + 1}/${kd.getDate()}`,
            };
        }
    }
    return best;
}

// "N강 ...", "교리N", "대화N", "성경적대화N" → 세션 순번 (정렬용)
function sessionOrdinal(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/^(성경적대화|대화)\s*(\d+)/);
    if (m) return 100 + parseInt(m[2], 10);
    m = s.match(/^교리\s*(\d+)/) || s.match(/^(\d+)\s*강/);
    if (m) return parseInt(m[1] || m[2], 10);
    if (/^교재/.test(s) || /^교제/.test(s)) return 90;
    if (/^나눔/.test(s)) return 95;
    return 999;
}

// 세션명이 정규 강의(교리·성경적대화)인지 판별
// 교제, 나눔은 표시하되 총 강수·수료 카운트에서 제외
function isClassSession(sessionName) {
    if (!sessionName) return false;
    return /^교리\s*\d+/.test(sessionName) || /^성경적대화\s*\d+/.test(sessionName);
}

// ============================================================================
// "더보기" 리스트 헬퍼 — 최근 항목 우선, 나머지는 접어둠
// ============================================================================
const EXPAND_KEEP_N = 5;

function makeExpandable(container, items, renderItemFn, keepN = EXPAND_KEEP_N, unit = '건') {
    if (!container) return;
    if (items.length <= keepN) {
        container.innerHTML = items.map(renderItemFn).join('');
        return;
    }
    const shown = items.slice(0, keepN).map(renderItemFn).join('');
    const rest = items.slice(keepN).map(renderItemFn).join('');
    const restCount = items.length - keepN;

    container.innerHTML = `
        ${shown}
        <div class="expandable-rest" hidden>${rest}</div>
        <button class="expand-toggle" type="button">+ 이전 ${restCount}${unit} 더 보기 ▼</button>
    `;

    const btn = container.querySelector('.expand-toggle');
    const restEl = container.querySelector('.expandable-rest');
    btn.addEventListener('click', () => {
        const willExpand = restEl.hasAttribute('hidden');
        if (willExpand) {
            restEl.removeAttribute('hidden');
            btn.textContent = '접기 ▲';
        } else {
            restEl.setAttribute('hidden', '');
            btn.textContent = `+ 이전 ${restCount}${unit} 더 보기 ▼`;
        }
    });
}

// MM/DD 문자열 → 정렬용 숫자 (월*100+일). 없으면 -1.
function mmddSortValue(dateStr) {
    const m = String(dateStr || '').match(/(\d{1,2})[\/\.\-](\d{1,2})/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

// 과제 session 필드에서 정규화 키 추출.
// "1강 XXX" → "교리1", "교리1" → "교리1"
// "대화1 XXX", "성경적대화1" → "대화1"
// "교제" → "교제", "나눔" → "나눔"
function normalizeSessionKey(s) {
    const raw = String(s || '').trim();
    let m = raw.match(/^성경적대화\s*(\d+)/) || raw.match(/^대화\s*(\d+)/);
    if (m) return '대화' + m[1];
    m = raw.match(/^교리\s*(\d+)/) || raw.match(/^(\d+)\s*강/);
    if (m) return '교리' + m[1];
    if (/^교제/.test(raw) || /^교재/.test(raw)) return '교제';
    if (/^나눔/.test(raw)) return '나눔';
    return raw;
}

// 특정 세션명에 매칭되는 과제 제출 목록
function homeworkForSession(homeworkList, sessionName) {
    if (!homeworkList?.length || !sessionName) return [];
    const target = normalizeSessionKey(sessionName);
    return homeworkList.filter(hw => normalizeSessionKey(hw.session) === target);
}

function renderStatusDetail(member) {
    const container = document.getElementById('statusDetailContainer');
    if (!container) return;
    container.style.display = 'block';

    // 기수 이름은 DB가 정한다. 화면에 박아 두면 기수가 바뀌어도 옛 이름이 남는다.
    const cohortTab = document.getElementById('cohortTabCurrent');
    if (cohortTab) cohortTab.textContent = getCohortId() || '현재 기수';

    const memberId = member.id || (String(member.name || '') + String(member.phone || ''));
    const kimbapDetail = getKimbapDetail(memberId);
    const homeworkList = getHomeworkList(memberId);

    // 세션 목록은 DB(sessions 테이블)에서 온다.
    // label_norm·is_class 가 이미 정해져 있어 추론이 필요 없다.
    const dbSessions = getSessions();
    const enriched = dbSessions.map(s => {
        const mmdd = String(s.label || '').trim();
        const name = s.label_norm || '';
        const kb = name ? kimbapDetail[name] : null;
        return {
            mmdd,
            sessionName: name,
            kimbapApplied: kb?.applied === 1,
            isClass: s.is_class === true,
        };
    }).filter(e => e.mmdd);

    const grid = document.getElementById('attendanceGrid');
    const summary = document.getElementById('attendanceSummary');
    let classAttended = 0, classAbsent = 0, classOnline = 0;
    let kimbapAppliedCount = 0, homeworkSubmittedCount = 0;

    // 통합 그리드 렌더
    if (grid) {
        grid.innerHTML = enriched.map(({ mmdd, sessionName, kimbapApplied, isClass }) => {
            const s = classifyStatus(member[mmdd]);

            // 교리/성경적대화만 카운트
            if (isClass) {
                if (s.cls === 'present') classAttended++;
                else if (s.cls === 'online') { classAttended++; classOnline++; }
                else if (s.cls === 'absent' || s.cls === 'empty') classAbsent++;
            }

            const hw = sessionName ? homeworkForSession(homeworkList, sessionName) : [];
            if (kimbapApplied) kimbapAppliedCount++;
            if (hw.length) homeworkSubmittedCount++;

            const badges = [];
            if (kimbapApplied) badges.push('<span class="badge-kimbap" title="김밥 신청">🍙</span>');
            if (hw.length) {
                const links = hw.filter(h => h.url).map(h => h.url);
                const linkAttr = links.length ? `data-hw-url="${links[0]}"` : '';
                badges.push(`<span class="badge-homework" title="과제 제출: ${hw.map(h => h.type).join(', ')}" ${linkAttr}>📝</span>`);
            }

            const isTeacher = sessionName === '교제' || sessionName === '나눔';

            return `
                <div class="attendance-cell ${s.cls} ${isTeacher ? 'kyoje' : ''}" title="${mmdd}${sessionName ? ' · ' + sessionName : ''} · ${s.title}${!isClass ? ' (강의 외)' : ''}">
                    <span class="cell-date">${mmdd}</span>
                    ${sessionName ? `<span class="cell-session">${sessionName}</span>` : ''}
                    <span class="cell-status">${s.label}</span>
                    ${badges.length ? `<span class="cell-badges">${badges.join('')}</span>` : ''}
                </div>
            `;
        }).join('');

        grid.querySelectorAll('[data-hw-url]').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = el.getAttribute('data-hw-url');
                if (url) window.open(url, '_blank', 'noopener');
            });
        });
    }

    // 요약 - 교리/성경적대화만 카운트
    if (summary) {
        const classTotal = enriched.filter(e => e.isClass).length;
        const absenceFromData = member['결석횟수'] != null && String(member['결석횟수']).trim() !== ''
            ? Number(member['결석횟수'])
            : classAbsent;
        summary.innerHTML = `
            총 <strong>${classTotal}</strong>강 ·
            <strong style="color:#059669">출석 ${classAttended}</strong> ·
            <strong style="color:#dc2626">결석 ${absenceFromData}</strong>
            ${classOnline ? ` · <strong style="color:#6d28d9">대체 ${classOnline}</strong>` : ''}
            ${kimbapAppliedCount ? ` · <strong style="color:#d97706">🍙 ${kimbapAppliedCount}회 신청</strong>` : ''}
            ${homeworkSubmittedCount ? ` · <strong style="color:#2563eb">📝 ${homeworkSubmittedCount}건 제출</strong>` : ''}
        `;
    }

    // ────── 김밥 요약 (칩 형태, 최근순 + 더보기) ──────
    const lunchEl = document.getElementById('lunchStatus');
    if (lunchEl) {
        const detailKeys = Object.keys(kimbapDetail);
        if (detailKeys.length > 0) {
            // 최근(오늘에 가까운) 순으로 내림차순
            const applied = detailKeys
                .filter(k => kimbapDetail[k].applied === 1)
                .sort((a, b) => {
                    const da = mmddSortValue(kimbapDetail[a].date);
                    const db = mmddSortValue(kimbapDetail[b].date);
                    if (da !== db) return db - da;
                    return sessionOrdinal(prettySessionName(b)) - sessionOrdinal(prettySessionName(a));
                });

            if (applied.length === 0) {
                lunchEl.innerHTML = '<span class="lunch-badge no">신청 내역 없음</span>';
            } else {
                lunchEl.innerHTML = `
                    <div class="lunch-summary-header">
                        <span class="lunch-badge yes">🍙 총 ${applied.length}회 신청</span>
                    </div>
                    <div class="kimbap-chip-list" id="kimbapChipList"></div>
                `;
                makeExpandable(
                    document.getElementById('kimbapChipList'),
                    applied,
                    (k) => {
                        const name = prettySessionName(k);
                        const date = kimbapDetail[k].date;
                        const showDate = date && date !== name;
                        return `<span class="kimbap-chip">${name}${showDate ? `<em>${date}</em>` : ''}</span>`;
                    },
                    EXPAND_KEEP_N,
                    '회'
                );
            }
        } else {
            const upper = (v) => String(v ?? '').trim().toUpperCase();
            const l1 = upper(member['김밥1차']);
            const l2 = upper(member['김밥2차']);
            const badge = (label, val) =>
                val === 'O' ? `<span class="lunch-badge yes">${label} 🍙 신청</span>`
                            : `<span class="lunch-badge no">${label} —</span>`;
            lunchEl.innerHTML = badge('1차', l1) + badge('2차', l2);
        }
    }

    // ────── 과제 제출 목록 (최근순 + 더보기, 특이사항 노출 X) ──────
    const noteEl = document.getElementById('noteStatus');
    if (noteEl) {
        if (homeworkList.length > 0) {
            const bySession = {};
            for (const hw of homeworkList) {
                const key = hw.session || '(미기재)';
                if (!bySession[key]) bySession[key] = [];
                bySession[key].push(hw);
            }

            // 세션명 → 김밥 세션 날짜 매핑 (정렬용)
            const sessionDateOf = (sessName) => {
                const target = normalizeSessionKey(sessName);
                for (const [rawName, info] of Object.entries(kimbapDetail)) {
                    if (normalizeSessionKey(prettySessionName(rawName)) === target) {
                        return mmddSortValue(info.date);
                    }
                }
                return -1;
            };

            // 최근(오늘에 가까운) 순으로 내림차순
            const sortedEntries = Object.entries(bySession).sort(([a], [b]) => {
                const da = sessionDateOf(a);
                const db = sessionDateOf(b);
                if (da !== db) return db - da;
                return sessionOrdinal(b) - sessionOrdinal(a);
            });

            noteEl.className = 'note-status homework-list';
            noteEl.innerHTML = `
                <div style="font-weight:700; margin-bottom:6px;">총 ${homeworkList.length}건 제출</div>
                <div id="homeworkRows"></div>
            `;
            makeExpandable(
                document.getElementById('homeworkRows'),
                sortedEntries,
                ([sess, subs]) => {
                    const types = [...new Set(subs.map(s => s.type).filter(Boolean))];
                    const links = subs.filter(s => s.url).map(s =>
                        `<a href="${s.url}" target="_blank" rel="noopener" class="hw-link">🔗</a>`).join(' ');
                    return `
                        <div class="hw-row">
                            <span class="hw-session">${sess}</span>
                            <span class="hw-types">${types.join(', ') || '(유형 미기재)'}</span>
                            <span class="hw-links">${links}</span>
                        </div>
                    `;
                },
                EXPAND_KEEP_N,
                '개 강'
            );
            // 특이사항(.note)은 관리자용이므로 일반 뷰에서 노출하지 않음
        } else {
            noteEl.className = 'note-status empty';
            noteEl.textContent = '(제출 내역 없음)';
        }
    }

    // ────── 수료 상태 ──────
    const compEl = document.getElementById('completionStatus');
    if (compEl) {
        const raw = String(member['수료'] ?? '').trim();
        if (raw === 'O') {
            compEl.className = 'completion-status done';
            compEl.textContent = '🎓 수료 완료';
        } else if (raw === '△') {
            compEl.className = 'completion-status partial';
            compEl.textContent = '△ 부분 수료';
        } else {
            compEl.className = 'completion-status none';
            compEl.textContent = '미수료';
        }
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

// 조원 명단이 보고 있는 주차 (YYYY-MM-DD). 튜터가 드롭다운으로 고른다.
// null 이면 '가장 최근 지난 강의' 로 떨어진다.
let teamSessionDate = null;

// 지난(오늘 포함) 주차만. 아직 하지 않은 강의는 찍을 것이 없고,
// 미리 찍히면 결석 수가 부풀려져 수료 판정과 과제 안내가 틀어진다.
function pastSessions() {
    const t = new Date();
    const todayIso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    return getSessions().filter(s => s.session_date <= todayIso);
}

// 조원 명단·요약 카드가 보는 주차의 출결 키 (MM/DD).
//
// buildMemberRow 는 주차별 값을 MM/DD 키로 펼쳐 둔다. 예전 GAS 응답에는
// m.attendance 라는 단일 필드가 있었는데 Supabase 로 옮기며 사라졌고,
// 그걸 모르고 계속 읽는 바람에 조원 전원이 미체크·결석으로 보였다.
function currentSessionKey() {
    const d = teamSessionDate || getCurrentSessionDate();
    return d ? (getSessionKey(d) || '') : '';
}

// 주차 드롭다운. 열 때마다 다시 만든다 (배경 갱신으로 세션이 늘 수 있다).
function renderTeamSessionBar() {
    const sel = document.getElementById('teamSessionSelect');
    const note = document.getElementById('teamSessionNote');
    if (!sel) return;

    const sessions = pastSessions();
    if (sessions.length === 0) {
        sel.innerHTML = '<option>아직 진행된 강의가 없습니다</option>';
        sel.disabled = true;
        if (note) note.textContent = '';
        return;
    }
    sel.disabled = false;

    const known = new Set(sessions.map(s => s.session_date));
    if (!teamSessionDate || !known.has(teamSessionDate)) {
        const current = getCurrentSessionDate();
        teamSessionDate = known.has(current) ? current : sessions[sessions.length - 1].session_date;
    }

    // 최근이 위로 (방금 끝난 수업을 바로 찾도록)
    sel.innerHTML = [...sessions].reverse().map(s => {
        const name = s.label_norm || '';
        const label = `${s.label}${name ? ' · ' + name : ''}${s.is_class ? '' : ' (수료 미반영)'}`;
        return `<option value="${s.session_date}"${s.session_date === teamSessionDate ? ' selected' : ''}>${label}</option>`;
    }).join('');

    if (note) {
        const latest = sessions[sessions.length - 1].session_date;
        note.textContent = teamSessionDate === latest ? '' : '지난 주차를 보고 있습니다';
    }
}

document.getElementById('teamSessionSelect')?.addEventListener('change', (e) => {
    if (countAttendanceChanges() > 0 &&
        !confirm('저장하지 않은 변경이 있습니다. 버리고 다른 주차로 이동할까요?')) {
        e.target.value = teamSessionDate;
        return;
    }
    teamSessionDate = e.target.value;
    if (currentRenderedTeam) {
        renderTeamMembers(getTeamMembers(currentRenderedTeam.name),
                          currentRenderedTeam.name, currentRenderedTeam.role);
    }
});

function attendanceOf(m, key) {
    return key ? String(m[key] || '').trim().toUpperCase() : '';
}

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

    currentRenderedTeam = { name: teamName, role };
    titleElement.textContent = `👥 ${teamName} 조원 명단`;
    renderTeamSessionBar();
    if (summaryEl) renderTeamSummary(summaryEl, members);

    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.name.localeCompare(b.name, 'ko');
    });

    const sessionKey = currentSessionKey();
    listElement.innerHTML = sortedMembers.map((m, index) => {
        const borderStyle = index === 0
            ? "border-top: 1px dashed #ddd;"
            : "border-top: 1px solid #eee;";
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        const attendanceRaw = attendanceOf(m, sessionKey);
        const isChecked = (attendanceRaw === 'O' || attendanceRaw === '◎') ? 'checked' : '';
        // ◎(지난 기수 이수)·−(집계 제외)는 체크만으로 표현이 안 된다.
        // 원래 값을 실어 두고, 튜터가 손대지 않으면 저장에서 제외한다.
        const mark = attendanceRaw === '◎' ? ' <span title="지난 기수 이수" style="color:#7c3aed;">◎</span>'
                   : attendanceRaw === '-' ? ' <span title="집계 제외" style="color:#888;">−</span>' : '';

        return `
            <label class="team-member-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 8px; ${borderStyle} cursor: pointer;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" ${isChecked} class="attendance-check"
                        data-name="${m.name}" data-phone="${m.phone}" data-initial="${isChecked ? '1' : '0'}"
                        data-initial-status="${attendanceRaw}"
                        style="width: 18px; height: 18px; cursor: pointer;">
                    <span style="font-weight: bold; font-size: 15px; color: var(--text-color);">
                        ${m.name}(${m.phone}) ${lunchIcon}${mark}
                    </span>
                </div>
                <span style="font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">
                    ${m.role || '조원'}
                </span>
            </label>
        `;
    }).join('');

    setupAttendanceSaveBar();
}

// ============================================================================
// 출석 일괄 저장 (체크 후 버튼으로 반영)
// ============================================================================
function getAttendanceChecks() {
    return Array.from(document.querySelectorAll('#teamMemberList .attendance-check'));
}

function countAttendanceChanges() {
    return getAttendanceChecks().filter(cb => (cb.checked ? '1' : '0') !== cb.dataset.initial).length;
}

function refreshSaveBar() {
    const bar = document.getElementById('attendanceSaveBar');
    const btn = document.getElementById('saveAttendanceBtn');
    const info = document.getElementById('attendanceSaveInfo');
    if (!bar || !btn || !info) return;

    const checks = getAttendanceChecks();
    const checkedCount = checks.filter(cb => cb.checked).length;
    const changes = countAttendanceChanges();

    info.textContent = `출석 ${checkedCount} · 결석 ${checks.length - checkedCount}`
        + (changes ? ` · 변경 ${changes}건` : '');
    btn.disabled = changes === 0;
    btn.textContent = changes === 0 ? '변경 사항 없음' : `출석 반영 (${changes}건)`;
    bar.classList.toggle('has-changes', changes > 0);
}

function setupAttendanceSaveBar() {
    const bar = document.getElementById('attendanceSaveBar');
    if (!bar) return;
    bar.style.display = 'flex';

    getAttendanceChecks().forEach(cb => {
        cb.addEventListener('change', refreshSaveBar);
    });
    refreshSaveBar();
}

async function saveAttendanceBatch() {
    const btn = document.getElementById('saveAttendanceBtn');
    const info = document.getElementById('attendanceSaveInfo');
    if (!btn) return;

    // 바뀐 사람만 보낸다.
    //
    // 전원을 보내면 present ? 'O' : 'X' 로 바뀌면서 ◎(지난 기수 이수)와
    // −(집계 제외)가 통째로 사라진다. 손대지 않은 사람은 건드리지 않는다.
    const changed = getAttendanceChecks()
        .filter(cb => (cb.checked ? '1' : '0') !== cb.dataset.initial);
    if (changed.length === 0) return;

    // ◎ 를 결석으로 바꾸는 것은 언제나 의심스럽다. 안 나와도 되는 사람이기 때문이다.
    const demoted = changed.filter(cb => !cb.checked && cb.dataset.initialStatus === '◎');
    if (demoted.length && !confirm(
        `지난 기수 이수(◎) ${demoted.length}명을 결석으로 바꿉니다.\n\n` +
        demoted.map(cb => `${cb.dataset.name}(${cb.dataset.phone})`).join(', ') +
        `\n\n이분들은 안 나와도 되는 분입니다. 정말 결석으로 기록할까요?`)) return;

    const entries = changed.map(cb => ({
        name: cb.dataset.name,
        phone: cb.dataset.phone,
        present: cb.checked,
    }));

    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '저장 중…';

    const { success, updated, session, error } =
        await updateAttendanceBatch(entries, teamSessionDate || undefined);

    if (success) {
        // 저장 성공 → 현재 체크 상태를 새 기준선으로
        getAttendanceChecks().forEach(cb => {
            if ((cb.checked ? '1' : '0') !== cb.dataset.initial) {
                cb.dataset.initialStatus = cb.checked ? 'O' : 'X';
            }
            cb.dataset.initial = cb.checked ? '1' : '0';
        });
        if (info) {
            info.textContent = `✅ ${session ? session + ' ' : ''}${updated ?? entries.length}건 저장 완료`;
        }
        // 요약 카드 갱신
        if (currentRenderedTeam) {
            const summaryEl = document.getElementById('teamSummaryCard');
            if (summaryEl) renderTeamSummary(summaryEl, getTeamMembers(currentRenderedTeam.name));
        }
        setTimeout(refreshSaveBar, 2500);
    } else {
        alert('출석 저장 실패: ' + (error?.message || '알 수 없는 오류'));
        btn.textContent = prevText;
        btn.disabled = false;
    }
}

// ============================================================================
// 조 전체 출석표 (매트릭스 모달)
// ============================================================================

// 조 전체 출석표의 세션 컬럼. DB의 sessions 테이블을 그대로 쓴다.
function buildSessionColumns() {
    return getSessions()
        .map(s => ({
            mmdd: String(s.label || '').trim(),
            name: s.label_norm || '',
            isClass: s.is_class === true,
        }))
        .filter(c => c.mmdd);
}

function renderTeamMatrix(teamName, members) {
    const scrollEl = document.getElementById('matrixScroll');
    const titleEl = document.getElementById('matrixTitle');
    if (!scrollEl) return;

    if (titleEl) titleEl.textContent = `👥 ${teamName} 전체 현황 (${members.length}명)`;

    const cols = buildSessionColumns();
    const sorted = [...members].sort((a, b) => {
        const pa = rolePriority[a.role] || 4;
        const pb = rolePriority[b.role] || 4;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name, 'ko');
    });

    const headRow = cols.map(c => `
        <th class="${c.isClass ? '' : 'non-class'}">
            <span class="mx-session">${c.name || '-'}</span>
            <span class="mx-date">${c.mmdd}</span>
        </th>
    `).join('');

    const bodyRows = sorted.map(m => {
        const id = m.id || (String(m.name || '') + String(m.phone || ''));
        const kimbapDetail = getKimbapDetail(id);
        const homeworkList = getHomeworkList(id);

        const cells = cols.map(c => {
            const s = classifyStatus(m[c.mmdd]);
            const kb = c.name ? kimbapDetail[c.name] : null;
            const hw = c.name ? homeworkForSession(homeworkList, c.name) : [];
            const badges = [];
            if (kb?.applied === 1) badges.push('🍙');
            if (hw.length) badges.push('📝');
            return `
                <td class="mx-cell ${s.cls} ${c.isClass ? '' : 'non-class'}"
                    title="${m.name} · ${c.mmdd}${c.name ? ' ' + c.name : ''} · ${s.title}">
                    <span class="mx-status">${s.label}</span>
                    ${badges.length ? `<span class="mx-badges">${badges.join('')}</span>` : ''}
                </td>
            `;
        }).join('');

        return `
            <tr>
                <th class="mx-name-cell" scope="row">
                    <span class="mx-name">${m.name}</span>
                    <span class="mx-role">${m.role || '조원'}</span>
                </th>
                ${cells}
            </tr>
        `;
    }).join('');

    scrollEl.innerHTML = `
        <table class="matrix-table">
            <thead>
                <tr>
                    <th class="mx-name-cell mx-corner">조원</th>
                    ${headRow}
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;
}

function openMatrixModal() {
    if (!currentRenderedTeam) return;
    const members = getTeamMembers(currentRenderedTeam.name);
    renderTeamMatrix(currentRenderedTeam.name, members);
    const modal = document.getElementById('matrixModal');
    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
}

function closeMatrixModal() {
    const modal = document.getElementById('matrixModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = 'auto';
    }
}

// ============================================================================
// 7. 조 요약 카드
// ============================================================================
let currentRenderedTeam = null; // 현재 표시 중인 조 (요약 카드 갱신용)

// 요약 카드만 재렌더 (체크박스 리스트는 그대로 유지)
function renderTeamSummary(summaryEl, members) {
    const upper = (v) => String(v || '').trim().toUpperCase();
    const key = currentSessionKey();
    const presentCount = members.filter(m => ['O','◎'].includes(attendanceOf(m, key))).length;
    // 아직 안 찍은 사람을 결석으로 세지 않는다. 결석은 X 로 기록된 것만.
    const absentCount  = members.filter(m => attendanceOf(m, key) === 'X').length;
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

// ============================================================================
// 8. 에러 표시
// ============================================================================
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
    const sd = document.getElementById('statusDetailContainer');
    if (sd) sd.style.display = 'none';
    const ms = document.getElementById('myStatusCard');
    if (ms) ms.style.display = 'none';
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

    // 출석 일괄 저장
    safeAdd(document.getElementById('saveAttendanceBtn'), 'click', saveAttendanceBatch, 'saveAttendanceBtn');

    // 조 전체 출석표 모달
    safeAdd(document.getElementById('openMatrixBtn'), 'click', openMatrixModal, 'openMatrixBtn');
    safeAdd(document.getElementById('matrixCloseBtn'), 'click', closeMatrixModal, 'matrixCloseBtn');
    const matrixModal = document.getElementById('matrixModal');
    safeAdd(matrixModal, 'click', (e) => {
        if (e.target === matrixModal) closeMatrixModal();
    }, 'matrixModal');
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && matrixModal?.classList.contains('active')) closeMatrixModal();
    });
}

// 저장된 마지막 검색이 있으면 자동 채움 + "다른 사람으로 조회" 버튼 노출
function applyLastSearch() {
    const last = loadLastSearch();
    if (!last) return;
    if (elements.nameInput)  elements.nameInput.value  = last.name;
    if (elements.phoneInput) elements.phoneInput.value = last.phone;
    if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
}

// ============================================================================
// Service Worker — 새 버전 자동 적용 (안내 토스트 후 리로드)
// ============================================================================
function showUpdateToast(message) {
    let toast = document.getElementById('swUpdateToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'swUpdateToast';
        toast.className = 'sw-update-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
}

function applyUpdate(worker) {
    showUpdateToast('🎉 새 버전을 적용하는 중이에요…');
    // 잠깐 보여준 뒤 적용 (controllerchange → 자동 리로드)
    setTimeout(() => worker.postMessage({ type: 'SKIP_WAITING' }), 600);
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return;
    }

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');

            // 이미 대기 중인 새 버전이 있으면 바로 적용
            if (registration.waiting && navigator.serviceWorker.controller) {
                applyUpdate(registration.waiting);
            }

            // 새 버전이 설치되는 즉시 적용
            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    // controller가 있어야 '업데이트'(첫 설치가 아님)
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        applyUpdate(newSW);
                    }
                });
            });

            // 주기적·포커스 시 업데이트 확인 (브라우저 HTTP 캐시 우회)
            setInterval(() => registration.update(), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update();
            });

            // 새 SW가 페이지를 넘겨받으면 리로드
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloading) return;
                reloading = true;
                window.location.reload();
            });
        } catch (err) {
            console.warn('SW 등록 실패:', err);
        }
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
