// [설정] 구글 시트 CSV 주소
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';

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
const mapImage = document.getElementById('mapImage');
const errorText = document.getElementById('errorText');

// [기능 추가] CSV 파싱 함수: 구글 시트 데이터를 객체 배열로 변환
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    if (lines.length === 0) return [];
    
    // 첫 줄(헤더) 추출 및 정리
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const obj = {};
        // 쉼표로 구분하되 따옴표 내부의 쉼표는 무시하는 정규식
        const currentline = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

        headers.forEach((header, index) => {
            let value = currentline[index] ? currentline[index].trim() : "";
            obj[header] = value.replace(/"/g, ''); // 따옴표 제거
        });
        result.push(obj);
    }
    return result;
}

// 데이터 로드 함수 (구글 시트 연동형)
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        if (!response.ok) throw new Error('네트워크 응답이 올바르지 않습니다.');
        
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        
        console.log('✅ 구글 시트 실시간 데이터 로드 완료:', memberData.length, '명');
    } catch (error) {
        console.error('❌ 데이터 로드 실패:', error);
        showError('데이터를 불러오는데 실패했습니다. 시트 설정을 확인해주세요.');
    }
}

// 검색 함수
function searchMember() {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    
    if (!name) { showError('이름을 입력해주세요.'); nameInput.focus(); return; }
    if (!phone) { showError('전화번호 뒷 4자리를 입력해주세요.'); phoneInput.focus(); return; }
    if (phone.length !== 4 || !/^\d{4}$/.test(phone)) {
        showError('전화번호 뒷 4자리를 정확히 입력해주세요.');
        phoneInput.focus();
        return;
    }
    
    // 데이터 검색 (구글 시트의 열 이름 name, phone과 일치해야 함)
    const member = memberData.find(m => 
        String(m.name).trim() === name && String(m.phone).trim() === phone
    );
    
    if (member) {
        showResult(member);
    } else {
        showError('일치하는 정보를 찾을 수 없습니다.<br>이름과 전화번호를 다시 확인해주세요.<br><br>주변 교역자에게 문의하시거나<br>하단의 <strong>문의</strong> 또는 <strong>오류 신고</strong>를 이용해주세요.');
    }
}

// 결과 표시 함수
function showResult(member) {
    hideError();
    
    resultName.textContent = member.name;
    resultTeam.textContent = member.team;
    resultLocation.textContent = member.location;
    
    // 60세 이상 대형 글자 모드 (시트에 age 열이 있는 경우)
    if (member.age && parseInt(member.age) >= 60) {
        document.body.classList.add('large-text');
    } else {
        document.body.classList.remove('large-text');
    }
    
    // 배치도 이미지 처리
    if (member.mapImage && member.mapImage.startsWith('http')) {
        mapImage.src = member.mapImage;
        mapContainer.style.display = 'block';
    } else {
        mapContainer.style.display = 'none';
    }
    
    resultContainer.style.display = 'block';
    setTimeout(() => {
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 에러 메시지 제어
function showError(message) {
    errorText.innerHTML = message;
    errorMessage.style.display = 'flex';
    resultContainer.style.display = 'none';
    setTimeout(() => {
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

function hideError() { errorMessage.style.display = 'none'; }

function closeResult() {
    resultContainer.style.display = 'none';
    nameInput.value = '';
    phoneInput.value = '';
    nameInput.focus();
}

// 이벤트 리스너 설정
searchBtn.addEventListener('click', searchMember);
closeBtn.addEventListener('click', closeResult);

nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') phoneInput.focus(); });
phoneInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchMember(); });
phoneInput.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
nameInput.addEventListener('input', hideError);
phoneInput.addEventListener('input', hideError);

// 테마 설정 (초기값 라이트)
const themeToggle = document.getElementById('themeToggle');
document.body.classList.remove('dark-mode');
themeToggle.addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });

// 이미지 모달 기능
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalClose = document.getElementById('modalClose');

mapImage.addEventListener('click', () => {
    modalImage.src = mapImage.src;
    imageModal.classList.add('active');
    document.body.style.overflow = 'hidden';
});

function closeModal() {
    imageModal.classList
