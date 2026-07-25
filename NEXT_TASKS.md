# 다음 작업 목록

## 우선순위

1. 튜터 조 전체 출석표 뷰 (핵심 신기능)
2. 김밥·과제 리스트 "더보기" 패턴
3. SW 업데이트 배너 (편의)

---

## 튜터용 조 전체 출석표 뷰

**요약**: 튜터 뷰에서 버튼 → 자기 조 전체 출석표를 출석부(DB)와 유사한 가로 형태로 조회.

### 요구사항
- 튜터·서브튜터·바나바 조회 결과에 **"전체 출석표"** 버튼 추가
- 클릭 시 모달 또는 별도 섹션으로 표 오픈
- 출석부(DB) 같은 레이아웃 (가로로 김)
- 각 셀에 **출석 · 김밥 · 과제** 통합 표시

### 레이아웃 (안)
```
┌──────────┬──────┬──────┬──────┬─────┬─────┬─────┬──────┐
│          │교리1 │교리2 │교리3 │ ... │교리12│나눔 │대화1 │...
│          │3/15  │3/22  │3/29  │     │6/07  │6/14 │6/21  │
├──────────┼──────┼──────┼──────┼─────┼─────┼─────┼──────┤
│[이름]│O 🍙  │O     │O 📝  │ ... │ X   │  −  │ O 🍙 │
├──────────┼──────┼──────┼──────┼─────┼─────┼─────┼──────┤
│[이름]│O     │O 📝  │O     │ ... │ O   │  O  │ X    │
├──────────┼──────┼──────┼──────┼─────┼─────┼─────┼──────┤
│...       │      │      │      │     │     │     │      │
└──────────┴──────┴──────┴──────┴─────┴─────┴─────┴──────┘
```

### 구현 포인트
- **가로 스크롤**: 셀 폭 고정, container `overflow-x: auto`
- **첫 열 sticky**: `position: sticky; left: 0` 로 이름 열 고정 (좌우 스크롤 시)
- **헤더 행 sticky**: `position: sticky; top: 0` 로 상단 세션명 고정 (세로 스크롤 시)
- 데이터는 이미 있음:
  - 출석: `member[MM/DD]` (출석부 컬럼)
  - 김밥: `getKimbapDetail(member.id)`
  - 과제: `getHomeworkList(member.id)` — 세션별 매칭 필요
- 셀 표시:
  - O/X/◎/− 텍스트 + 색상 (기존 attendance-cell 스타일 재사용)
  - 김밥 신청이면 🍙 뱃지
  - 과제 제출이면 📝 뱃지 (클릭 → 링크)
- 세션 목록: 김밥 탭의 세션명 순서 사용 (교리1 → 교리12 → 교재 → 교제 → 나눔 → 성경적대화1~4)
- 강의 외(교제/나눔)는 배경 다르게 표시

### UI 위치 후보
- **A**: 조원 명단 위 · 요약 카드 옆에 버튼
- **B**: 조원 명단 하단에 접기·펼치기
- **C**: 별도 모달 (풀스크린)

가장 실용적: **C 모달** (가로로 넓게 쓸 수 있고, 기존 조원 명단은 그대로 유지)

### 파일 변경 예정
- `index.html`: 버튼 + 모달 컨테이너 추가
- `script.js`: `renderTeamAttendanceTable()` 함수 신설, 버튼 이벤트
- `style.css`: 가로 표 스타일, sticky 헤더/열

---

## 김밥·과제 "더보기" 패턴

### 정렬 규칙 (핵심)
- **오늘 기준으로 가까운 항목부터** 표시 (=날짜 내림차순, 최근이 위)
- 기본: 위에서 **5개**만 노출
- 하단 "**+N건 더 보기 ▼**" 버튼 → 클릭 시 과거 항목까지 전부 펼침
- "**접기 ▲**"로 다시 축소

### A. 김밥 신청 요약 (칩)
- 대상: `getKimbapDetail(id)`의 applied=1 세션들
- 정렬: 세션 date 내림차순 (예: 성경적대화3 7/5 → 성경적대화2 6/28 → ...)
- 기본 표시: 상위 5개 칩
- 예시:
  ```
  🍙 총 13회 신청
  [성경적대화3 7/5] [성경적대화1 6/21] [교리10 5/17]
  [교리9 5/10] [교리7 4/26]
  + 8건 더 보기 ▼
  ```

### B. 과제 제출 목록
- 대상: `getHomeworkList(id)` 세션별 그룹
- 정렬: 세션 date 내림차순 (김밥과 매칭된 session date 사용, 또는 sessionOrdinal 역순 fallback)
- 기본 표시: 상위 5행
- 예시:
  ```
  📝 총 12건 제출
  ─────────────────────
  성경적대화3   과제, 소감문   🔗
  성경적대화1   과제           🔗
  교리10        과제           🔗
  교리8         소감문         🔗
  교리6         과제, 소감문   🔗

  + 7건 더 보기 ▼
  ```

### 정렬용 날짜 얻기
- 김밥: `kimbapDetail[key].date` → MM/DD 파싱
- 과제: session 이름을 김밥 세션명과 매칭해 그 세션의 date 사용
  - 매칭 실패 시 fallback: sessionOrdinal 역순
- 날짜 없으면 맨 아래로

### 구현 스켈레톤
```js
function makeExpandable(container, items, renderItemFn, keepN = 5) {
    if (items.length <= keepN) {
        container.innerHTML = items.map(renderItemFn).join('');
        return;
    }
    const shown = items.slice(0, keepN).map(renderItemFn).join('');
    const hidden = items.slice(keepN).map(renderItemFn).join('');
    container.innerHTML = `
        ${shown}
        <div class="hidden-items" hidden>${hidden}</div>
        <button class="expand-toggle" type="button">+ ${items.length - keepN}건 더 보기 ▼</button>
    `;
    const btn = container.querySelector('.expand-toggle');
    const hiddenEl = container.querySelector('.hidden-items');
    btn.addEventListener('click', () => {
        const expanded = hiddenEl.hasAttribute('hidden');
        if (expanded) {
            hiddenEl.removeAttribute('hidden');
            btn.textContent = '접기 ▲';
        } else {
            hiddenEl.setAttribute('hidden', '');
            btn.textContent = `+ ${items.length - keepN}건 더 보기 ▼`;
        }
    });
}
```

### 적용 대상 (미적용)
- 출석 그리드: 접지 않음 (한눈에 봐야 함)
- 통합 그리드의 강의 셀: 접지 않음 (전체 흐름 봐야 함)

---

## SW 업데이트 배너

- 새 SW 감지 시 하단 배너 표시: "🎉 새 버전이 준비됐어요. [지금 업데이트]"
- 탭 → skipWaiting → controllerchange → 자동 리로드
- 30분 주기 update() + visibilitychange update() 이미 개념 정리됨
- 자세한 코드는 세션 대화 참조 (script.js registerServiceWorker 확장, sw.js message 핸들러, style.css .update-banner)
