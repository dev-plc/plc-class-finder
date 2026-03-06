// [설정] 구글 시트 CSV 주소 (본인의 주소로 교체 확인)
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';

// [설정] 장소별 지도 이미지 매핑
const locationMapImages = {
    "웨슬리홀": "https://drive.google.com/uc?export=view&id=1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    "칼빈": "https://drive.google.com/uc?export=view&id=19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "자모영아실": "https://drive.google.com/uc?export=view&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};

let memberData = [];

// DOM 요소들
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const searchBtn = document.getElementById('searchBtn');
const resultContainer = document.getElementById('resultContainer');
const errorMessage = document.getElementById('errorMessage');
const closeBtn = document.getElementById('closeBtn');
const resultName = document.getElementById('resultName');
const resultTeam = document.getElementById('resultTeam');
const resultLocation = document.getElementById('resultLocation');
const mapContainer = document.getElementById('mapContainer');
const mapImage = document.getElementById('mapImage');
const errorText = document.getElementById('errorText');

// CSV 파싱 함수
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const obj = {};
        const currentline = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        headers.forEach((header, index) => {
            let value = currentline[index] ? currentline[index].trim() : "";
            obj[header] = value.replace(/"/g, ''); 
        });
        result.push(obj);
    }
    return result;
}

// 데이터 로드
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        if (!response.ok) throw new Error('네트워크 응답 없음');
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        console.log('✅ 데이터 로드 완료:', memberData.length, '명');
    } catch (error) {
        console.error('❌ 로드 실패:', error);
        showError('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
}

// 검색 실행
function searchMember() {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    
    if (!name || !phone) {
        showError('이름과 전화번호 뒷자리를 모두 입력해주세요.');
        return;
    }
    
    const member = memberData.find(m => 
        String(m.name).trim() === name && String(m.phone).trim() === phone
    );
    
    if (member) {
        showResult(member);
    } else {
        showError('일치하는 정보를 찾을 수 없습니다.<br>이름과 번호를 다시 확인해주세요.');
    }
}

// 결과 표시
function showResult(member) {
    hideError();
    const loc = member.location ? member.location.trim() : "";
    resultName.textContent = member.name;
    resultTeam.textContent = member.team;
    resultLocation.textContent = loc;
    
    // 장소 매칭 이미지
    const mapUrl = locationMapImages[loc];
    if (mapUrl) {
        mapImage.src = mapUrl;
        mapContainer.style.display = 'block';
    } else {
        mapContainer.style.display = 'none';
    }
    
    resultContainer.style.display = 'block';
    setTimeout(() => {
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 공통 함수들
function showError(msg) {
    errorText.innerHTML = msg;
    errorMessage.style.display = 'flex';
    resultContainer.style.display = 'none';
}

function hideError() { errorMessage.style.display = 'none'; }

function closeResult() {
    resultContainer.style.display = 'none';
    nameInput.value = ''; phoneInput.value = '';
    nameInput.focus();
}

// 이벤트 등록
searchBtn.addEventListener('click', searchMember);
closeBtn.addEventListener('click', closeResult);
phoneInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchMember(); });
window.addEventListener('load', loadData);

// 테마 및 모달
document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

const imageModal = document.getElementById('imageModal');
mapImage.addEventListener('click', () => {
    document.getElementById('modalImage').src = mapImage.src;
    imageModal.classList.add('active');
});
imageModal.addEventListener('click', () => imageModal.classList.remove('active'));
