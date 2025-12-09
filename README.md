# ☕ PL Cafe 메뉴판

교회 카페를 위한 귀여운 주문 시스템 POC

## 🎨 기능

### 고객 화면 (index.html)
- 귀여운 메뉴판 디자인
- 메뉴 선택 및 장바구니
- 주문자 정보 입력 (이름, 구분)
- 주문하기 기능

### 직원 화면 (staff.html)
- 실시간 주문 현황
- 주문 상태 관리 (대기중/준비중/완료)
- 필터링 기능
- 통계 표시

## 🚀 실행 방법

### 로컬에서 테스트
1. 프로젝트 폴더를 엽니다
2. `index.html`을 더블클릭하거나 Live Server로 실행
3. 고객 화면에서 주문 테스트
4. 직원 화면(`staff.html`)에서 주문 확인

### GitHub Pages로 배포
1. GitHub 저장소 생성
2. 파일들을 업로드
3. Settings → Pages에서 배포 설정
4. `main` 브랜치 선택
5. 배포 완료!

## 📱 사용 방법

### 고객용
1. 메뉴판 접속 (`index.html`)
2. 이름과 구분 입력
3. 원하는 메뉴 선택 (클릭)
4. "주문하기" 버튼 클릭
5. 완료!

### 직원용
1. 직원 화면 접속 (`staff.html`)
2. 실시간으로 주문 확인
3. "준비 시작" → "완료" 버튼으로 상태 관리
4. 필터로 주문 상태별 조회

## 💾 현재 저장 방식

**LocalStorage 사용 중**
- 브라우저에 데이터 저장
- 같은 PC/브라우저에서만 작동
- POC 용도로 충분

## 🔥 Firebase 업그레이드 (선택사항)

실제 운영을 위해 Firebase로 업그레이드하면:
- ✅ 핸드폰으로 주문 가능
- ✅ 여러 기기에서 실시간 동기화
- ✅ 주문 내역 영구 저장

### Firebase 설정 방법

1. **Firebase 프로젝트 생성**
   - https://console.firebase.google.com/ 접속
   - "프로젝트 추가" 클릭
   - 프로젝트 이름: "plcafe" 입력

2. **Realtime Database 활성화**
   - 좌측 메뉴 → Realtime Database
   - "데이터베이스 만들기" 클릭
   - 테스트 모드로 시작

3. **Firebase 설정 코드 받기**
   - 프로젝트 설정 → 웹 앱 추가
   - Firebase 설정 객체 복사

4. **코드에 적용**
   - `scripts/firebase-config.js` 파일 생성
   - 아래 코드 붙여넣기:

```javascript
// Firebase SDK 로드
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Firebase 설정 (여기에 본인의 설정 입력)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database, ref, push, onValue, update };
```

5. **HTML 파일 수정**
   - customer.js, staff.js를 Firebase 버전으로 교체
   - 자세한 코드는 필요시 제공

## 📝 메뉴 수정 방법

`index.html`의 메뉴 섹션에서:

```html
<div class="menu-card" data-menu="메뉴이름" data-price="가격">
    <div class="menu-icon">🎯</div>
    <h3 class="menu-name">메뉴이름</h3>
    <p class="menu-price">가격원</p>
    <button class="btn-select">선택하기</button>
</div>
```

## 🎨 디자인 수정

### 색상 변경
`styles/customer.css`:
- 메인 컬러: `#ff6b9d` (핑크)
- 그라데이션: `#ffecd2` → `#fcb69f`

`styles/staff.css`:
- 메인 컬러: `#667eea` (보라)
- 그라데이션: `#667eea` → `#764ba2`

### 아이콘 변경
이모지를 원하는 것으로 교체하세요!

## 💡 향후 개선 아이디어

- [ ] Firebase 연동으로 실시간 동기화
- [ ] 메뉴 이미지 추가
- [ ] 옵션 선택 기능 (HOT/ICE, 샷 추가 등)
- [ ] 주문 알림 사운드
- [ ] 다크 모드
- [ ] 주문 통계 대시보드

## 📧 문의

문제가 있거나 개선 아이디어가 있으면 알려주세요!

