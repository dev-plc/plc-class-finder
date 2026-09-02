// 조별 전체 출석표 — 튜터 화면과 관리자 화면이 함께 쓴다.
//
// 왜 모듈로 뺐나
//   한동안 이 표는 script.js 에만 있었고, admin.js 는 같은 규칙을 자기 이름으로
//   한 벌 더 갖고 있었다 (prNormalizeSession = normalizeSessionKey). 두 벌이 살아
//   있으면 한쪽만 고쳐지고, 그게 어느 쪽인지는 한참 뒤에야 드러난다.
//   실제로 '담당교역자' 를 admin.js 가 m.pastor 로 읽어 화면에 빈 칸만 그리던
//   버그도 같은 종류였다 — 값의 이름이 두 파일에 따로 적혀 있었다.
//
// 화면은 여기서 그리고, 판정(수료·결석)은 members-data 를 통해 DB 뷰에서 온다.

import {
    getSessions,
    getKimbapDetail,
    getHomeworkList,
    getCompletionOutlook,
} from './members-data.js?v=108';

// ============================================================================
// 세션명 정규화
// ============================================================================
// 과제 session 필드에서 정규화 키 추출.
// "1강 XXX" → "교리1", "교리1" → "교리1"
// "대화1 XXX", "성경적대화1" → "대화1"
// "교제" → "교제", "나눔" → "나눔"
//
// 폼 응답과 시트 강의명이 다르게 적히므로 양쪽을 이걸로 통과시킨 뒤 비교한다.
export function normalizeSessionKey(s) {
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
export function homeworkForSession(homeworkList, sessionName) {
    if (!homeworkList?.length || !sessionName) return [];
    const target = normalizeSessionKey(sessionName);
    return homeworkList.filter(hw => normalizeSessionKey(hw.session) === target);
}

// ============================================================================
// 출결 값 → 화면
// ============================================================================
// isFuture: 아직 하지 않은 수업인가.
//
// 빈칸을 '미기록' 하나로만 부르면 안 된다. 아직 하지 않은 수업의 빈칸과
// 이미 지났는데 안 찍은 빈칸은 뜻이 전혀 다르다 — 앞은 정상이고 뒤는 할 일이다.
// 둘 다 흐린 점으로 나오니 읽는 사람은 '수업없음' 으로 짐작하게 된다.
export function classifyStatus(raw, isFuture = false) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (s === 'O') return { cls: 'present', label: 'O', title: '출석' };
    if (s === '◎') return { cls: 'online',  label: '◎', title: '지난 기수 이수 이월' };
    if (s === '과제') return { cls: 'makeup', label: '과제', title: '결석 — 과제·소감문으로 메움' };
    if (s === 'X') return { cls: 'absent',  label: 'X', title: '결석' };
    if (s === '-') return { cls: 'none',    label: '−', title: '수업 없음 (집계 제외)' };
    if (isFuture)  return { cls: 'future',  label: '',  title: '아직 하지 않은 수업' };
    return { cls: 'empty', label: '·', title: '미기록 — 아직 출석을 찍지 않았습니다' };
}

// ============================================================================
// 열
// ============================================================================
export function buildSessionColumns() {
    // 오늘 것은 아직 안 찍었을 수 있으므로 '지난 수업' 으로 본다 —
    // 수업이 끝나고 찍는 자리라 오늘 빈칸은 '미기록' 이 맞다.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return getSessions()
        .map(s => ({
            mmdd: String(s.label || '').trim(),
            name: s.label_norm || '',
            isClass: s.is_class === true,
            isFuture: String(s.session_date || '') > today,
        }))
        .filter(c => c.mmdd);
}

// 평소에 보여 줄 범위 — 지난 주차 전부 + 다가오는 한 주까지 자른 뒤, 뒤에서 10개.
//
// 16주가 되면 표가 가로로 계속 늘어나 오른쪽 끝(=지금 주차)을 보려면 매번
// 스크롤해야 한다. 정작 튜터가 볼 곳은 최근 몇 주와 이번 주다.
// 다가오는 한 주를 포함하는 이유: 3강까지 했고 다음 주가 21강이면 21강 칸이
// 보여야 '다음에 무엇을 하는지' 를 같은 표에서 읽는다.
export const MATRIX_KEEP_N = 10;

export function foldColumns(cols, keepN = MATRIX_KEEP_N) {
    const firstFuture = cols.findIndex(c => c.isFuture);
    // 미래 열이 없으면(기수 마지막 주) 전부가 '지난 주차' 다
    const upto = firstFuture === -1 ? cols.length : firstFuture + 1;
    return cols.slice(0, upto).slice(-keepN);
}

// ============================================================================
// 진행률 — 이름 바로 옆
// ============================================================================
// 따로 열을 만들면 두 번째 고정(sticky) 열이 되어 첫 열의 실제 너비만큼 left 를
// 줘야 하는데, 그 너비는 이름 길이에 따라 변한다. 그래서 이름 칸 안에 넣는다.
const MX_PROG_TITLE = {
    done:    '수료 요건 충족',
    ontrack: '남은 강의를 나오면 수료',
    atrisk:  '남은 강의 전부 + 과제·소감문 필요',
    gone:    '담당 교역자와 의논 필요',
};

function mxProgressHtml(m) {
    const o = getCompletionOutlook(m);
    if (!o) return '';
    return `<span class="mx-prog mx-prog-${o.bucket}"
                  title="${o.p.credited}/${o.p.required} 인정 · ${MX_PROG_TITLE[o.bucket]}">
                ${o.p.credited}<span class="mx-prog-of">/${o.p.required}</span>
            </span>`;
}

// ============================================================================
// 표
// ============================================================================
// scrollEl 을 받는다 — 튜터 화면과 관리자 화면의 칸이 서로 다르다.
// expanded: true 면 모든 주차, false 면 foldColumns() 가 고른 범위만.
//
// 접을 때 열을 display:none 으로 감추지 않는다. .mx-name-cell 의 sticky 가
// 깨져서 이름 칸이 같이 흘러간다 — 통째로 다시 그린다.
export function renderTeamMatrix(scrollEl, teamName, members, { expanded = false } = {}) {
    if (!scrollEl) return { total: 0, shown: 0 };

    const all = buildSessionColumns();
    const cols = expanded ? all : foldColumns(all);
    const sorted = members;   // 시트 순서 그대로 — 명단·종이와 줄이 맞아야 한다

    const headRow = cols.map(c => `
        <th class="${c.isClass ? '' : 'non-class'}${c.isFuture ? ' mx-future' : ''}"
            ${c.isFuture ? 'title="아직 하지 않은 수업"' : ''}>
            <span class="mx-session">${c.name || '-'}</span>
            <span class="mx-date">${c.mmdd}</span>
        </th>
    `).join('');

    const bodyRows = sorted.map(m => {
        const id = m.id || (String(m.name || '') + String(m.phone || ''));
        const kimbapDetail = getKimbapDetail(id);
        const homeworkList = getHomeworkList(id);

        const cells = cols.map(c => {
            const s = classifyStatus(m[c.mmdd], c.isFuture);
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
                    <div class="mx-name-in">
                        <span class="mx-who">
                            <span class="mx-name">${m.name}<span class="mx-phone">${m.phone || ''}</span></span>
                            <span class="mx-role">${m.role || '조원'}</span>
                        </span>
                        ${mxProgressHtml(m)}
                    </div>
                </th>
                ${cells}
            </tr>
        `;
    }).join('');

    scrollEl.innerHTML = `
        <table class="matrix-table">
            <thead>
                <tr>
                    <th class="mx-name-cell mx-corner">
                        <div class="mx-name-in"><span class="mx-who">조원</span>
                        <span class="mx-prog-head">진행</span></div>
                    </th>
                    ${headRow}
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;

    // 호출한 쪽이 '모두 보기 (N)' 버튼을 그릴지 정할 수 있게 돌려준다
    return { total: all.length, shown: cols.length, teamName };
}

// 접기/펼치기 버튼을 매트릭스 위에 그린다. 접힌 열이 없으면 아무것도 안 그린다.
// 튜터 화면과 관리자 화면이 같은 모양이어야 해서 여기 둔다.
export function renderMatrixFold(btnEl, { total, shown }, expanded, onToggle) {
    if (!btnEl) return;
    if (total <= shown && !expanded) { btnEl.style.display = 'none'; return; }
    btnEl.style.display = '';
    btnEl.textContent = expanded ? `최근 ${MATRIX_KEEP_N}주만 보기` : `모두 보기 (${total}주)`;
    btnEl.setAttribute('aria-expanded', String(expanded));
    btnEl.onclick = onToggle;   // 다시 그릴 때마다 갈아끼운다 (핸들러가 쌓이지 않게)
}
