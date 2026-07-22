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
    updateAttendance,
    getCacheInfo,
    MODULE_VERSION,
} from './scripts/members-data.js';

const SCRIPT_VERSION = 'script.js v24 (통합 그리드: 출석+김밥+과제)';
console.log('🔖 로드됨:', SCRIPT_VERSION, '/', MODULE_VERSION);

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

// 김밥 detail 배열에서 attendanceDate에 가장 가까운 세션 (±5일 이내)
function matchKimbapForDate(kimbapDetail, attendanceMMDD) {
    const target = mmddToDate(attendanceMMDD);
    if (!target || !kimbapDetail) return null;
    let best = null, minDiff = Infinity;
    for (const [name, info] of Object.entries(kimbapDetail)) {
        const kd = mmddToDate(info.date);
        if (!kd) continue;
        const diff = Math.abs(kd.getTime() - target.getTime());
        if (diff <= 5 * 86400000 && diff < minDiff) {
            minDiff = diff;
            best = { name, applied: info.applied, date: info.date };
        }
    }
    return best;
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

    const memberId = member.id || (String(member.name || '') + String(member.phone || ''));
    const kimbapDetail = getKimbapDetail(memberId);
    const homeworkList = getHomeworkList(memberId);

    const sessions = extractSessions(member);
    const grid = document.getElementById('attendanceGrid');
    const summary = document.getElementById('attendanceSummary');
    const counts = { present: 0, online: 0, absent: 0, none: 0, empty: 0 };
    let kimbapAppliedCount = 0;
    let homeworkSubmittedCount = 0;

    // 통합 그리드 렌더
    if (grid) {
        grid.innerHTML = sessions.map(mmdd => {
            const s = classifyStatus(member[mmdd]);
            counts[s.cls] = (counts[s.cls] || 0) + 1;

            const kb = matchKimbapForDate(kimbapDetail, mmdd);
            const sessionName = kb?.name || '';
            const hw = sessionName ? homeworkForSession(homeworkList, sessionName) : [];
            if (kb?.applied === 1) kimbapAppliedCount++;
            if (hw.length) homeworkSubmittedCount++;

            const badges = [];
            if (kb?.applied === 1) badges.push('<span class="badge-kimbap" title="김밥 신청">🍙</span>');
            if (hw.length) {
                const links = hw.filter(h => h.url).map(h => h.url);
                const linkAttr = links.length ? `data-hw-url="${links[0]}"` : '';
                badges.push(`<span class="badge-homework" title="과제 제출: ${hw.map(h => h.type).join(', ')}" ${linkAttr}>📝</span>`);
            }

            const isTeacher = sessionName === '교제';
            const teacherMark = isTeacher ? '<span class="cell-tag">교제</span>' : '';

            return `
                <div class="attendance-cell ${s.cls} ${isTeacher ? 'kyoje' : ''}" title="${mmdd}${sessionName ? ' · ' + sessionName : ''} · ${s.title}">
                    <span class="cell-date">${mmdd}</span>
                    ${sessionName ? `<span class="cell-session">${sessionName}</span>` : ''}
                    <span class="cell-status">${s.label}</span>
                    ${badges.length ? `<span class="cell-badges">${badges.join('')}</span>` : ''}
                    ${teacherMark}
                </div>
            `;
        }).join('');

        // 과제 뱃지 클릭 시 링크 열기
        grid.querySelectorAll('[data-hw-url]').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = el.getAttribute('data-hw-url');
                if (url) window.open(url, '_blank', 'noopener');
            });
        });
    }

    // 요약
    if (summary) {
        const total = sessions.length;
        const attended = counts.present + counts.online;
        const absenceFromData = member['결석횟수'] != null && String(member['결석횟수']).trim() !== ''
            ? Number(member['결석횟수'])
            : (counts.absent + counts.empty);
        summary.innerHTML = `
            총 <strong>${total}</strong>강 ·
            <strong style="color:#059669">출석 ${attended}</strong> ·
            <strong style="color:#dc2626">결석 ${absenceFromData}</strong>
            ${counts.online ? ` · <strong style="color:#6d28d9">대체 ${counts.online}</strong>` : ''}
            ${kimbapAppliedCount ? ` · <strong style="color:#d97706">🍙 ${kimbapAppliedCount}회 신청</strong>` : ''}
            ${homeworkSubmittedCount ? ` · <strong style="color:#2563eb">📝 ${homeworkSubmittedCount}건 제출</strong>` : ''}
        `;
    }

    // ────── 김밥 요약 (매칭 안 된 세션이 있을 경우 대비) ──────
    const lunchEl = document.getElementById('lunchStatus');
    if (lunchEl) {
        const detailKeys = Object.keys(kimbapDetail);
        if (detailKeys.length > 0) {
            const applied = detailKeys.filter(k => kimbapDetail[k].applied === 1);
            if (applied.length === 0) {
                lunchEl.innerHTML = '<span class="lunch-badge no">신청 내역 없음</span>';
            } else {
                lunchEl.innerHTML = `
                    <span class="lunch-badge yes">🍙 총 ${applied.length}회 신청</span>
                    <div style="font-size:calc(13px * var(--font-scale)); color:var(--text-light,#6B7280); margin-top:6px;">
                        ${applied.map(k => `${k}${kimbapDetail[k].date ? ` (${kimbapDetail[k].date})` : ''}`).join(', ')}
                    </div>
                `;
            }
        } else {
            // Fallback: 메인 시트의 요약 필드
            const upper = (v) => String(v ?? '').trim().toUpperCase();
            const l1 = upper(member['김밥1차']);
            const l2 = upper(member['김밥2차']);
            const badge = (label, val) =>
                val === 'O' ? `<span class="lunch-badge yes">${label} 🍙 신청</span>`
                            : `<span class="lunch-badge no">${label} —</span>`;
            lunchEl.innerHTML = badge('1차', l1) + badge('2차', l2);
        }
    }

    // ────── 과제 제출 목록 ──────
    const noteEl = document.getElementById('noteStatus');
    if (noteEl) {
        if (homeworkList.length > 0) {
            // 세션별 그룹핑
            const bySession = {};
            for (const hw of homeworkList) {
                const key = hw.session || '(미기재)';
                if (!bySession[key]) bySession[key] = [];
                bySession[key].push(hw);
            }
            const rows = Object.entries(bySession).map(([sess, subs]) => {
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
            });
            noteEl.className = 'note-status homework-list';
            noteEl.innerHTML = `
                <div style="font-weight:700; margin-bottom:8px;">총 ${homeworkList.length}건 제출</div>
                ${rows.join('')}
            `;

            // .note 필드도 있으면 부속 메모로 표시
            const note = String(member['.note'] ?? '').trim();
            if (note) {
                noteEl.innerHTML += `
                    <div class="hw-extra-note">📌 특이사항: ${note}</div>
                `;
            }
        } else {
            // 과제 데이터 없으면 .note 만
            const note = String(member['.note'] ?? '').trim();
            if (!note) {
                noteEl.className = 'note-status empty';
                noteEl.textContent = '(제출 내역 없음)';
            } else {
                const warn = /제출필요|과제|소감문/.test(note);
                noteEl.className = warn ? 'note-status warn' : 'note-status';
                noteEl.textContent = note;
            }
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
    // 출석(O·◎) 이외는 모두 결석 취급 (빈 값 포함)
    const presentCount = members.filter(m => ['O','◎'].includes(upper(m.attendance))).length;
    const absentCount  = members.length - presentCount;
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
    const sd = document.getElementById('statusDetailContainer');
    if (sd) sd.style.display = 'none';
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
