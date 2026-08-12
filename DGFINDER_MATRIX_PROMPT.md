# DGfinder 인계 — 조 전체 출석표 (출결 + 김밥 + 과제 한 화면)

DGfinder Code 대화에 **아래 `---` 사이를 통째로** 붙여넣으세요.
실제 구현은 `plc-class-finder` 의 `script.js:1037~1135` · `style.css:1241~1400` 입니다.

---

# 작업: 조 전체 출석표 매트릭스

## 무엇을 만드나

튜터·조장이 조회 화면에서 `📊 전체 출석표` 를 누르면, **조원 전체 × 전 주차**가
한 표로 뜹니다. 칸 하나에 세 가지가 겹쳐 보입니다 — 출결, 김밥 신청, 과제 제출.

```
          교리1    교리2    교리3    교제     교리4
          08/09    08/16    08/23    08/30    09/06
─────────────────────────────────────────────────────
국승숙     O       ◎       ◎        −        O
 튜터      🍙                                  🍙
─────────────────────────────────────────────────────
김경은     O       O📝     ◎        −        X
          🍙
─────────────────────────────────────────────────────
서미화     X📝     O       O        −        O
```

한 사람씩 열어보지 않고 **조 전체를 한눈에** 보는 게 목적입니다.
"이번 주 누가 빠졌지", "과제 안 낸 사람이 누구지" 를 스크롤 한 번으로 답합니다.

## 필요한 데이터 세 가지

```js
// 1) 세션 목록 — 컬럼이 된다
getSessions() // [{ label: '08/09', label_norm: '교리1', is_class: true }, ...]

// 2) 인원 행 — 출결이 MM/DD 키로 펼쳐져 있어야 한다
member['08/09'] // 'O' | '◎' | 'X' | '-' | ''

// 3) 김밥·과제 — 사람별로 따로 받는다
getKimbapDetail(id)  // { '교리1': { applied: 1, date: '08/09' }, ... }
getHomeworkList(id)  // [{ session: '교리1', type: '소감문', url: '...' }, ...]
```

## ⚠️ 가장 큰 함정 — 키가 두 종류다

**출결은 날짜(MM/DD)로, 김밥·과제는 세션명(교리1)으로 저장돼 있습니다.**

한 칸을 그리려면 둘 다 필요하므로, 컬럼이 **두 키를 같이 들고 있어야** 합니다.

```js
function buildSessionColumns() {
    return getSessions()
        .map(s => ({
            mmdd:    String(s.label || '').trim(),   // ← 출결을 찾을 키
            name:    s.label_norm || '',             // ← 김밥·과제를 찾을 키
            isClass: s.is_class === true,            // ← 수료 카운트 포함 여부
        }))
        .filter(c => c.mmdd);
}
```

이걸 하나로 합치려 들지 마세요. 날짜는 시트 헤더에서, 세션명은 강의명 행에서 오고,
둘의 대응은 DB 의 `sessions` 테이블이 유일한 기준입니다.

## ⚠️ 두 번째 함정 — 세션명이 곳곳에서 다르게 적힌다

과제는 구글 폼으로 받는데, 폼 응답의 세션명이 시트의 강의명과 **글자가 다릅니다.**
그대로 비교하면 `📝` 가 **한 번도 안 뜹니다.** 오류도 안 나서 알아채기 어렵습니다.

실제로 겪은 것들:
- 폼은 `13강` 인데 시트는 `성경적대화1` (폼이 1~16 통합 번호를 쓴다)
- `교제` 와 `교재` 가 섞여 있다
- `대화1` · `성경적대화1` 이 섞여 있다

**양쪽을 같은 규칙으로 정규화한 뒤에 비교하세요.**

```js
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

function homeworkForSession(homeworkList, sessionName) {
    if (!homeworkList?.length || !sessionName) return [];
    const target = normalizeSessionKey(sessionName);
    return homeworkList.filter(hw => normalizeSessionKey(hw.session) === target);
}
```

DGfinder 의 강의명 체계에 맞게 규칙을 바꾸되, **정규화 자체를 빼지는 마세요.**

## 그리기

```js
function classifyStatus(raw) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (s === 'O') return { cls: 'present', label: 'O', title: '출석' };
    if (s === '◎') return { cls: 'online',  label: '◎', title: '온라인/대체' };
    if (s === 'X') return { cls: 'absent',  label: 'X', title: '결석' };
    if (s === '-') return { cls: 'none',    label: '−', title: '수업 없음' };
    return { cls: 'empty', label: '·', title: '미기록' };
}

function renderTeamMatrix(teamName, members) {
    const cols = buildSessionColumns();

    const headRow = cols.map(c => `
        <th class="${c.isClass ? '' : 'non-class'}">
            <span class="mx-session">${c.name || '-'}</span>
            <span class="mx-date">${c.mmdd}</span>
        </th>`).join('');

    const bodyRows = members.map(m => {
        const id = m.id || (String(m.name || '') + String(m.phone || ''));
        const kimbapDetail = getKimbapDetail(id);
        const homeworkList = getHomeworkList(id);

        const cells = cols.map(c => {
            const s  = classifyStatus(m[c.mmdd]);                    // ← 날짜 키
            const kb = c.name ? kimbapDetail[c.name] : null;          // ← 세션명 키
            const hw = c.name ? homeworkForSession(homeworkList, c.name) : [];

            const badges = [];
            if (kb?.applied === 1) badges.push('🍙');
            if (hw.length) badges.push('📝');

            return `
                <td class="mx-cell ${s.cls} ${c.isClass ? '' : 'non-class'}"
                    title="${m.name} · ${c.mmdd}${c.name ? ' ' + c.name : ''} · ${s.title}">
                    <span class="mx-status">${s.label}</span>
                    ${badges.length ? `<span class="mx-badges">${badges.join('')}</span>` : ''}
                </td>`;
        }).join('');

        return `
            <tr>
                <th class="mx-name-cell" scope="row">
                    <span class="mx-name">${m.name}</span>
                    <span class="mx-role">${m.role || '조원'}</span>
                </th>
                ${cells}
            </tr>`;
    }).join('');

    document.getElementById('matrixScroll').innerHTML = `
        <table class="matrix-table">
            <thead><tr><th class="mx-name-cell mx-corner">조원</th>${headRow}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}
```

**튜터를 위로 정렬하세요.** 조장·튜터가 먼저 나와야 자기 조를 확인하기 쉽습니다.

```js
const rolePriority = { '튜터': 1, '서브튜터': 2, '조장': 3, '조원': 5, '': 6 };
const sorted = [...members].sort((a, b) => {
    const pa = rolePriority[a.role] || 4, pb = rolePriority[b.role] || 4;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name, 'ko');
});
```

## 모바일에서 읽히게 — 여기가 실제로 어렵습니다

주차가 16개면 표가 화면을 훌쩍 넘습니다. **가로 스크롤 + 양방향 고정**이 필수입니다.
이름 열이 안 따라오면 오른쪽으로 스크롤한 순간 누구 줄인지 알 수 없습니다.

```css
.matrix-scroll { overflow: auto; -webkit-overflow-scrolling: touch; }
.matrix-table  { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; }

/* 상단 헤더 고정 */
.matrix-table thead th { position: sticky; top: 0; z-index: 2; background: #f9fafb; min-width: 46px; }

/* 좌측 이름 열 고정 */
.mx-name-cell { position: sticky; left: 0; z-index: 3; background: #fff; text-align: left; }
/* 좌상단 모서리는 둘 다 걸리므로 제일 위로 */
.mx-corner    { z-index: 4; }
```

`border-collapse: separate` 가 필요합니다 — `collapse` 면 sticky 셀의 테두리가 사라집니다.

수료에 안 들어가는 주차(교제·나눔)는 흐리게 해서 구분하세요. 그걸 빼먹으면
"16강인데 왜 18칸이냐" 는 질문이 반복됩니다.

## 범례를 반드시 넣으세요

`O ◎ X − 🍙 📝` 는 처음 보면 아무도 모릅니다. 표 바로 위에 한 줄로 두세요.

```html
<div class="matrix-legend">
  <span><b>O</b> 출석</span><span><b>◎</b> 대체</span><span><b>X</b> 결석</span>
  <span><b>−</b> 수업없음</span><span>🍙 김밥</span><span>📝 과제</span>
</div>
```

## 검증

1. 김밥을 신청한 주차에 `🍙` 가 뜨는가 — **안 뜨면 김밥 데이터의 키가 세션명이 아닐 것**
2. 과제를 낸 주차에 `📝` 가 뜨는가 — **안 뜨면 세션명 정규화 문제**. 폼 응답의
   세션명 원문과 시트의 강의명을 나란히 찍어 비교하세요
3. 오른쪽 끝까지 스크롤했을 때 이름 열이 붙어 있는가
4. 아래로 스크롤했을 때 주차 헤더가 붙어 있는가
5. 수료 미반영 주차가 눈에 띄게 구분되는가
6. 조원이 30명일 때도 열리는가 (렌더가 한 번에 끝나야 한다)

---
