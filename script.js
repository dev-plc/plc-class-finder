// 1. 설정 데이터
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';
//이미지 https://postimages.org/ 업로드해서 링크받기
/*
const locationMapImages = {
    "웨슬리": "https://lh3.googleusercontent.com/u/0/d/1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    //"칼빈": "https://lh3.googleusercontent.com/u/0/d/19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "칼빈": "https://i.postimg.cc/hjTSJ8jD/1221-kalbin.jpg",
    "자모영아실": "https://lh3.googleusercontent.com/u/0/d/13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};
*/
const locationMapImages = {
    "웨슬리": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    "칼빈": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "자모영아실": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};
let memberData = [];

// 2. DOM 요소 선택
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
    resultContainer: document.getElementById('resultContainer'),
    errorMessage: document.getElementById('errorMessage'),
    errorText: document.getElementById('errorText'),
    closeBtn: document.getElementById('closeBtn'),
    resultName: document.getElementById('resultName'),
    resultTeam: document.getElementById('resultTeam'),
    resultLocation: document.getElementById('resultLocation'),
    mapContainer: document.getElementById('mapContainer'),
    mapImage: document.getElementById('mapImage'),
    themeToggle: document.getElementById('themeToggle'),
    adminBtn: document.getElementById('adminBtn'),
    adminModal: document.getElementById('adminLoginModal'),
    adminClose: document.getElementById('adminLoginClose'),
    adminForm: document.getElementById('adminLoginForm')
};

// 3. 데이터 로드 및 파싱
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        console.log("✅ Data Loaded:", memberData.length, "members");
    } catch (error) {
        console.error("❌ Fetch Error:", error);
    }
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== "");
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    return lines.slice(1).map(line => {
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ? values[i].trim().replace(/"/g, '') : "";
        });
        return obj;
    });
}

// 4. 검색 및 결과 표시
function searchMember() {
    const name = elements.nameInput.value.trim();
    const phone = elements.phoneInput.value.trim();

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    const member = memberData.find(m => 
        String(m.name) === name && String(m.phone) === phone
    );

    if (member) {
        displayResult(member);
    } else {
        showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
    }
}

function displayResult(member) {
    elements.errorMessage.style.display = 'none';
    elements.resultName.textContent = member.name;
    elements.resultTeam.textContent = member.team;
    elements.resultLocation.textContent = member.location;

    // 1. 지도 이미지 표시 로직
    const pureLocation = member.location.trim();
    const mapUrl = locationMapImages[pureLocation];

    if (mapUrl) {
        elements.mapImage.src = mapUrl;
        elements.mapContainer.style.display = 'block';
    } else {
        elements.mapContainer.style.display = 'none';
    }

    // 2. 튜터/서브튜터/관리자 권한 확인 및 조원 목록 표시
    const isTutor = member.role && (
        member.role.includes('튜터') || 
        member.role.includes('서브튜터') || 
        member.role.includes('관리자')
    );
    
    const memberListContainer = document.getElementById('teamMemberListContainer');
    
    if (isTutor && memberListContainer) {
        const teamMembers = memberData.filter(m => m.team === member.team);
        renderTeamMembers(teamMembers, member.team);
        memberListContainer.style.display = 'block';
    } else if (memberListContainer) {
        memberListContainer.style.display = 'none';
    }

    elements.resultContainer.style.display = 'block';
    elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
}

// 5. 조원 목록을 화면에 그리는 함수
function renderTeamMembers(members, teamName) {
    const listElement = document.getElementById('teamMemberList');
    const titleElement = document.getElementById('teamListTitle');
    
    if (!listElement || !titleElement) return;

    titleElement.textContent = `👥 ${teamName} 조원 명단 (${members.length}명)`;
    
    const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    listElement.innerHTML = sortedMembers.map(m => `
        <div class="team-member-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 8px; border-bottom: 1px solid #eee;">
            <div style="display: flex; align-items: center;">
                <span style="font-weight: bold; font-size: 15px; color: var(--text-color);">
                    ${m.name}${m.phone}
                </span>
            </div>
            <span style="font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">
                ${m.role || '조원'}
            </span>
        </div>
    `).join('');
}

function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 6. 이벤트 리스너 통합
function initEventListeners() {
    elements.searchBtn.addEventListener('click', searchMember);
    
    elements.closeBtn.addEventListener('click', () => {
        elements.resultContainer.style.display = 'none';
    });

    elements.themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });

    elements.adminBtn.addEventListener('click', () => {
        elements.adminModal.classList.add('active');
    });

    elements.adminClose.addEventListener('click', () => {
        elements.adminModal.classList.remove('active');
    });

    elements.adminForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const id = document.getElementById('adminId').value;
        const pw = document.getElementById('adminPassword').value;
        
        if (id === 'plc' && pw === 'plc1234') {
            alert("로그인 성공!");
            sessionStorage.setItem('adminLoggedIn', 'true'); 
            window.location.href = 'admin.html'; 
        } else {
            const errorElement = document.getElementById('adminLoginError');
            errorElement.style.display = 'block';
            errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
        }
    });

    elements.phoneInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchMember();
    });
}

// 7. 이미지 모달 제어 함수
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

    if (imageModal) {
        imageModal.addEventListener('click', () => {
            closeModal();
        });
    }

    if (modalClose) {
        modalClose.addEventListener('click', (e) => {
            e.stopPropagation();
            closeModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imageModal && imageModal.classList.contains('active')) {
            closeModal();
        }
    });

    function closeModal() {
        imageModal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
}

// 8. 실행
window.addEventListener('load', () => {
    loadData();
    initEventListeners();
    initModal();
});
