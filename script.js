// 1. 설정 데이터
//const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';
//이미지 https://postimages.org/ 업로드해서 링크받기
/*
const locationMapImages = {
    "웨슬리": "https://lh3.googleusercontent.com/u/0/d/1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    //"칼빈": "https://lh3.googleusercontent.com/u/0/d/19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "칼빈": "https://i.postimg.cc/hjTSJ8jD/1221-kalbin.jpg",
    "자모영아실": "https://lh3.googleusercontent.com/u/0/d/13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};
*/

// 발급받은 구글 스크립트 웹앱 URL을 아래에 붙여넣으세요.
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec";

const locationMapImages = {
    "웨슬리": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=1arEQNNRYyHbXtNWsU1HtsdRCER86s7GI",
    "칼빈": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=1uEdPmapbCINzD36wrRbgZefdHM4KuSnu",
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
    resultLunch: document.getElementById('resultLunch'),
    mapContainer: document.getElementById('mapContainer'),
    mapImage: document.getElementById('mapImage'),
    themeToggle: document.getElementById('themeToggle'),
    adminBtn: document.getElementById('adminBtn'),
    adminModal: document.getElementById('adminLoginModal'),
    adminClose: document.getElementById('adminLoginClose'),
    adminForm: document.getElementById('adminLoginForm')
};

// 3. 데이터 로드 (실시간 구글 API 방식으로 변경)
async function loadData() {
    try {
        // 브라우저 캐싱 방지를 위해 URL 끝에 타임스탬프 추가
        const noCacheUrl = GAS_API_URL + "?t=" + new Date().getTime();
        
        const response = await fetch(noCacheUrl);
        if (!response.ok) throw new Error('네트워크 응답이 정상이 아닙니다.');
        
        const result = await response.json();
        
        if (result.success) {
            memberData = result.data;
            console.log("✅ Live Data Loaded:", memberData.length, "members");
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        alert("데이터를 불러오는 중 오류가 발생했습니다. 페이지를 새로고침 해주세요.");
    }
}

// 4. 검색 로직 수정
function searchMember() {
    const name = elements.nameInput.value.trim().replace(/\s/g, '');
    const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');
    const searchTarget = name + phone; // 예: "임시1234"

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    // 시트에서 가져온 id(전체문자열)와 입력한 searchTarget을 비교
    const member = memberData.find(m => 
        String(m.id).replace(/\s/g, '') === searchTarget
    );

    if (member) {
        displayResult(member);
    } else {
        showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
    }
}

// 5. 검색 결과 표시
function toggleRow(row, value, target) {
    if (value && value.trim() !== "") {
        target.textContent = value;
        if (row) row.style.display = 'flex';
    } else {
        if (row) row.style.display = 'none';
    }
}

function displayResult(member) {
    elements.errorMessage.style.display = 'none';
    
    const memberListContainer = document.getElementById('teamMemberListContainer');
    if (memberListContainer) memberListContainer.style.display = 'none';

    // 각 정보 행(row)을 찾아서 표시하거나 숨김
    const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
    const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
    const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
    const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null; 

    toggleRow(nameRow, member.name, elements.resultName);
    toggleRow(teamRow, member.team, elements.resultTeam);
    toggleRow(locationRow, member.location, elements.resultLocation);
    
    // 🍙 김밥 여부 표시 추가 (O가 아니면 기본적으로 X로 표시)
    const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
    toggleRow(lunchRow, lunchStatus, elements.resultLunch);

    // =========================================================
    // ✨ 텔레그램 링크 동적 렌더링 (새가족링크 기반)
    // =========================================================
    let telegramRow = document.getElementById('telegramRow');
    if (!telegramRow && teamRow) {
        // 기존 팀(조) 행을 복제하여 텔레그램 행 생성
        telegramRow = teamRow.cloneNode(true); 
        telegramRow.id = 'telegramRow';
        
        if (telegramRow.children.length >= 2) {
            // 1. 라벨 변경
            const label = telegramRow.children[0];
            if(label) label.textContent = '안내방';

            // 2. 값(링크) 요소 변경 (✅ 버튼 디자인으로 스타일 전면 수정)
            const valueContainer = telegramRow.children[1];
            if(valueContainer) {
                valueContainer.innerHTML = `
                    <a id="resultTelegramLink" href="" target="_blank" 
                       style="display: inline-flex; align-items: center; gap: 6px; 
                              background-color: #2AABEE; color: white; 
                              padding: 8px 16px; border-radius: 20px; 
                              text-decoration: none; font-weight: bold; font-size: 0.9em; 
                              box-shadow: 0 3px 6px rgba(0,0,0,0.15); 
                              cursor: pointer; word-break: keep-all;">
                        <span style="font-size: 1.1em;">✈️</span> 
                        <span id="telegramLinkText"></span>
                    </a>
                `;
                valueContainer.id = ''; // 복제된 id 제거
            }
        }
        // 팀 행 바로 다음 위치에 삽입
        teamRow.parentNode.insertBefore(telegramRow, teamRow.nextSibling);
    }

    const telegramLinkEl = document.getElementById('resultTelegramLink');
    const telegramTextEl = document.getElementById('telegramLinkText');
    if (telegramRow && telegramLinkEl && telegramTextEl) {
        if (member.telegramLink && member.team) {
            telegramLinkEl.href = member.telegramLink;
            telegramTextEl.textContent = `${member.team}조 방 입장하기`; 
            telegramRow.style.display = 'flex'; // 보이게 처리
        } else {
            telegramRow.style.display = 'none'; // 링크가 없으면 숨김
        }
    }
    // =========================================================

    // 이미지 및 팀원 목록
    const pureLocation = member.location ? member.location.trim() : "";
    const mapUrl = locationMapImages[pureLocation];
    if (mapUrl) {
        elements.mapImage.src = mapUrl;
        elements.mapContainer.style.display = 'block';
    } else {
        elements.mapContainer.style.display = 'none';
    }

    // 튜터 권한 확인
    const isTutor = member.role && (
        member.role.includes('튜터') || 
        member.role.includes('서브튜터') || 
        member.role.includes('관리자')
    );
    
    if (isTutor && member.team && memberListContainer) {
        const teamMembers = memberData.filter(m => m.team === member.team);
        renderTeamMembers(teamMembers, member.team, member.role);
    }

    elements.resultContainer.style.display = 'block';
    elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
}

// 6. 직책별 우선순위 설정 (숫자가 낮을수록 상단 노출)
const rolePriority = {
    "관리자": 1,
    "튜터": 2,
    "서브튜터": 3,
    "조원": 4,
    "": 4 // 직책이 없는 경우
};

// 7. 조원 목록 그리기
function renderTeamMembers(members, teamName, role) {
    const listElement = document.getElementById('teamMemberList');
    const titleElement = document.getElementById('teamListTitle');
    const container = document.getElementById('teamMemberListContainer'); 
    
    if (!listElement || !titleElement || !container) return;

    if (!role || role.trim() === '') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    
    const kimbapCount = members.filter(m => m.lunch && m.lunch.toUpperCase() === 'O').length;
    
    titleElement.textContent = `👥 ${teamName} 조원 명단 (총 ${members.length}명 / 🍙 김밥 ${kimbapCount}개)`;
    
    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
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

async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const status = checked ? 'O' : 'X';
    console.log(`[출석 변경 요청] ${name}(${phone}) -> ${status}`);

    if (checkboxElement) {
        checkboxElement.disabled = true;
    }

    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify({
                name: name,
                phone: phone,
                status: status
            })
        });

        const result = await response.json();

        if (result.success) {
            console.log('업데이트 성공:', result.message);
            if (checkboxElement) checkboxElement.disabled = false; 
            
            const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
            if (memberIndex !== -1) {
                memberData[memberIndex].attendance = status;
            }

        } else {
            console.error('업데이트 실패:', result.message);
            alert('출석 실패: ' + result.message);
            if (checkboxElement) {
                checkboxElement.checked = !checked; 
                checkboxElement.disabled = false;
            }
        }
    } catch (error) {
        console.error('네트워크 오류:', error);
        alert('서버와 통신하는 중 문제가 발생했습니다. (인터넷 연결 등을 확인하세요)');
        if (checkboxElement) {
            checkboxElement.checked = !checked;
            checkboxElement.disabled = false;
        }
    }
}

// 8. 에러 표시 함수
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 9. 이벤트 리스너 및 모달 제어
function initEventListeners() {
    elements.searchBtn.addEventListener('click', searchMember);
    elements.closeBtn.addEventListener('click', () => { elements.resultContainer.style.display = 'none'; });
    elements.themeToggle.addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });
    elements.adminBtn.addEventListener('click', () => { elements.adminModal.classList.add('active'); });
    elements.adminClose.addEventListener('click', () => { elements.adminModal.classList.remove('active'); });
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
            errorElement.style.display = 'block';
            errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
        }
    });
    elements.phoneInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchMember(); });
}

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
        if(imageModal) {
            imageModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }
    if (imageModal) imageModal.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

// 10. 실행
window.addEventListener('load', () => {
    loadData();
    initEventListeners();
    initModal();
});
