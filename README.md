# PL교회 교리교육 조 배치 검색기

## 📋 프로젝트 소개
교회 교리교육 성도들이 자신의 조 배치 정보를 쉽게 찾을 수 있도록 만든 웹 검색 시스템입니다.

## ✨ 주요 기능
- 이름 + 전화번호 뒷 4자리로 조 검색
- 조, 위치 정보 표시
- 조별 배치도 이미지 표시 (선택사항)
- 모바일 최적화된 반응형 디자인

## 🚀 사용 방법

### 1. 로컬에서 테스트
파일 탐색기에서 `index.html` 파일을 더블클릭하여 브라우저로 엽니다.

### 2. 웹 서버로 실행 (추천)
CORS 문제를 피하기 위해 간단한 웹 서버를 실행합니다:

**Python 사용:**
```bash
python -m http.server 8000
```

그 후 브라우저에서 `http://localhost:8000` 접속

## 📝 데이터 업데이트 방법

### 1. Google Sheets에서 CSV 다운로드
- 파일 → 다운로드 → 쉼표로 구분된 값(.csv)

### 2. CSV 구조
```
Location,Team,name,number
웨슬리홀,남 1,[이름],
웨슬리홀,남 1,[이름],
```

**중요:** `name` 열은 "이름+전화번호뒷4자리" 형식

### 3. JSON 변환
수동으로 `data.json` 파일을 업데이트하거나, 스크립트를 사용하여 변환합니다.

## 🖼️ 배치도 이미지 추가 방법

### 1. 이미지 파일 준비
- `images` 폴더에 조별 배치도 이미지 저장
- 파일명 예시: `남1.jpg`, `여5.png` 등

### 2. data.json에 이미지 경로 추가
```json
{
  "location": "웨슬리홀",
  "team": "남 1",
  "name": "김현",
  "phone": "6903",
  "mapImage": "images/남1.jpg"
}
```

## 📱 QR 코드 생성

웹사이트 배포 후 다음 사이트에서 QR 코드 생성:
- https://www.qr-code-generator.com/
- https://www.the-qrcode-generator.com/

## 🌐 배포 방법 (GitHub Pages)

### 1. GitHub 저장소 생성
1. GitHub에 새 repository 생성
2. 파일 업로드 (index.html, style.css, script.js, data.json)

### 2. GitHub Pages 활성화
1. Settings → Pages
2. Source: Deploy from a branch
3. Branch: main → /(root) → Save

### 3. 접속 URL
`https://<사용자명>.github.io/<저장소명>/`

## 📁 파일 구조
```
교리교육 조배치 검색기/
├── index.html          # 메인 HTML
├── style.css           # 스타일시트
├── script.js           # JavaScript 로직
├── data.json           # 성도 데이터
├── images/             # 배치도 이미지 (선택사항)
│   ├── 남1.jpg
│   ├── 여5.png
│   └── ...
└── README.md           # 이 파일
```

## 🎨 디자인 컬러
- 배경: 밀크베이지 (#F5F1E8)
- 메인: 미드나이트 블루 (#1B3B6F)
- 로고: PLC

## 📊 현재 데이터
- 총 성도 수: 309명
- 남성: 남 1 ~ 남 9 (9개 조)
- 여성: 여 1 ~ 여 20 (20개 조)

## ⚠️ 주의사항
- 전화번호는 뒷 4자리만 사용 (개인정보 보호)
- 데이터 업데이트 시 `data.json` 파일만 교체하면 됩니다
- 브라우저에서 직접 파일을 열 때 CORS 에러가 발생할 수 있습니다 (로컬 서버 사용 권장)

## 📞 문의
문제가 발생하면 교회 담당자에게 연락주세요.

---
**PL교회 12주 교리교육**

