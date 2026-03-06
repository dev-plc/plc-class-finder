// [설정] 구글 시트 CSV 주소
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';

// [설정] 장소별 지도 이미지 매핑 (구글 드라이브 직링크)
const locationMapImages = {
    "웨슬리홀": "https://drive.google.com/uc?export=view&id=1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    "칼빈": "https://drive.google.com/uc?export=view&id=19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "자모영아실": "https://drive.google.com/uc?export=view&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
    // 구글 시트의 'location' 열에 적힌 명칭과 정확히 일치해야 합니다.
};

// 데이터 저장 변수
let memberData = [];

// DOM 요소
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const searchBtn = document.getElementById('searchBtn');
const resultContainer = document.getElementById('resultContainer');
const errorMessage = document.getElementById('errorMessage');
const closeBtn = document.getElementById('closeBtn');

// 결과 표시 요소
const resultName = document.getElementById('resultName');
const resultTeam = document.getElementById('resultTeam');
const resultLocation = document.getElementById('resultLocation');
const mapContainer = document.getElementById('mapContainer');
