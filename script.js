// 1. 설정 데이터
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyTTxRbd9dqwxQvSplUwwrheWoQGt3CbYm7JYHNFsqT45B7JjBjaE-563IOqqkOcgVT/exec";

// 💡 로컬 스토리지 캐시 키 정의
const CACHE_KEY_DATA = "plc_member_data_v17";
const CACHE_KEY_MAP = "plc_location_map_v17";
const CACHE_KEY_TEAM_LINKS = "plc_team_links_v17"; // ✨ 추가

let locationMapImages = {}; 
let memberData = [];
let teamLinksMap = {}; // ✨ 추가

// 2. DOM 요소 선택
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
    searchBtnText: document.querySelector('#searchBtn .btn-text'),
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

// 3. 데이터 로드 (✨ 캐싱 및 UI 차단 기능 포함)
async function loadData() {
    try {
        // [1] 초기 버튼 상태: 서버 통신 대기
        if (elements.searchBtn) elements.searchBtn.disabled = true;
        if (elements.searchBtnText) {
            elements.searchBtnText.textContent = "로딩중...";
        }

        // [2] 로컬 캐시에서 데이터 먼저 꺼내오기
        const cachedDataStr = localStorage.getItem(CACHE_KEY_DATA);
        const cachedMapStr = localStorage.getItem(CACHE_KEY_MAP);
        const cachedTeamLinksStr = localStorage.getItem(CACHE_KEY_TEAM_LINKS);

        if (cachedDataStr) {
            memberData = JSON.parse(cachedDataStr);
            if (cachedMapStr) locationMapImages = JSON.parse(cachedMapStr);
            if (cachedTeamLinksStr) teamLinksMap = JSON.parse(cachedTeamLinksStr);
            
            console.log("⚡ Cached Data Loaded: 즉시 활성화 됨");
            console.log("⚡ 캐시된 memberData 길이:", memberData.length);
            console.log("⚡ 캐시된 teamLinksMap 키:", Object.keys(teamLinksMap));
            
            // 캐시 데이터가 있으면 사용자 대기 없이 버튼 즉시 활성화
            if (elements.searchBtn) elements.searchBtn.disabled = false;
            if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";
        } else {
            if (elements.searchBtnText) elements.searchBtnText.textContent = "데이터 로딩중... (최초 1회)";
        }

        // [3] 백그라운드에서 최신 데이터 가져와서 동기화
        const noCacheUrl = GAS_API_URL + "?t=" + new Date().getTime();
        
        const fetchPromise = fetch(noCacheUrl)
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    memberData = result.data;
                    if (result.locationMap) locationMapImages = result.locationMap;
                    if (result.teamLinks) teamLinksMap = result.teamLinks;
                    
                    localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
                    localStorage.setItem(CACHE_KEY_MAP, JSON.stringify(locationMapImages));
                    localStorage.setItem(CACHE_KEY_TEAM_LINKS, JSON.stringify(teamLinksMap));
                    
                    console.log("✅ Live Data Synced (백그라운드 최신화 완료)");
                    console.log("✅ Live memberData 길이:", memberData.length);
                    console.log("✅ Live teamLinksMap 키:", Object.keys(teamLinksMap));
                    
                    if (elements.searchBtn) elements.searchBtn.disabled = false;
                    if (elements.searchBtnText) elements.searchBtnText.textContent = "조회하기";
                }
            });

        if (!cachedDataStr) {
            await fetchPromise;
        }

    } catch (error) {
        console.error("❌ Fetch Error:", error);
        if (memberData.length === 0) {
            alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
            if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
        }
    }
}

// 4. 검색 로직 (✨ try-catch 디버깅 추가)
function searchMember() {
    try {
        console.log("🔍 [searchMember] 시작");
        
        const name = elements.nameInput.value.trim().replace(/\s/g, '');
        const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');
        const searchTarget = name + phone;
        
        console.log("🔍 검색 대상:", searchTarget);
        console.log("🔍 memberData 길이:", memberData.length);

        if (!name || !phone) {
            showError("이름과 번호 4자리를 입력해주세요.");
            return;
        }

        const member = memberData.find(m => 
            String(m.id).replace(/\s/g, '') === searchTarget
        );
        
        console.log("🔍 찾은 멤버:", member);

        if (member) {
            displayResult(member);
        } else {
            showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
        }
    } catch (err) {
        console.error("❌ [searchMember] 에러:", err);
        console.error("❌ 스택:", err.stack);
        alert("검색 중 에러 발생: " + err.message);
    }
}

// 5. 검색 결과 표시
function toggleRow(row, value, target) {
    // ✨ 안전한 값 처리
    const safeValue = (value === null || value === undefined) ? "" : String(value);
    if (safeValue.trim() !== "") {
        if (target) target.textContent = safeValue;
        if (row) row.style.display = 'flex';
    } else {
        if (row) row.style.display = 'none';
    }
}

function displayResult(member) {
    try {
        console.log("=== 🎨 [displayResult] 시작 ===");
        console.log("member 전체:", member);
        console.log("member.team:", member.team);
        console.log("member.location:", member.location);
        console.log("teamLinksMap keys:", Object.keys(teamLinksMap));
        console.log("새가족 링크:", teamLinksMap['새가족교육안내방']);
        console.log("내 조 링크:", teamLinksMap[member.team]);
        console.log("teamRow exists?:", !!elements.resultTeam?.closest('.info-row'));
        
        elements.errorMessage.style.display = 'none';
        
        const memberListContainer = document.getElementById('teamMemberListContainer');
        if (memberListContainer) memberListContainer.style.display = 'none';

        const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
        const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
        const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
        const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null; 

        console.log("📐 teamRow:", teamRow);

        toggleRow(nameRow, member.name, elements.resultName);
        toggleRow(teamRow, member.team, elements.resultTeam);
        toggleRow(locationRow, member.location, elements.resultLocation);
        
        const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
        toggleRow(lunchRow, lunchStatus, elements.resultLunch);

        // ✨ 1 & 2. 새가족교육안내방 + 조별 안내방 (DOM 직접 생성 방식)
        
        // 헬퍼 함수: 텔레그램 행 만들기/업데이트
        function ensureTelegramRow(rowId, labelText, link, btnText) {
            console.log(`🔧 [ensureTelegramRow] ${rowId} 시작 / link=${link}`);
            
            let row = document.getElementById(rowId);
            
            if (!row && teamRow) {
                console.log(`🔧 ${rowId} 행 새로 생성 중...`);
                
                row = document.createElement('div');
                row.id = rowId;
                row.className = teamRow.className;
                row.style.display = 'flex';
                
                // ✨ tagName을 소문자로 변환 (안전성)
                const labelTag = teamRow.children[0] ? teamRow.children[0].tagName.toLowerCase() : 'span';
                const valueTag = teamRow.children[1] ? teamRow.children[1].tagName.toLowerCase() : 'span';
                const labelClass = teamRow.children[0] ? teamRow.children[0].className : '';
                const valueClass = teamRow.children[1] ? teamRow.children[1].className : '';
                
                row.innerHTML = `
                    <${labelTag} class="${labelClass}">${labelText}</${labelTag}>
                    <${valueTag} class="${valueClass}">
                        <a href="" target="_blank" class="telegram-btn"
                           style="display: inline-flex; align-items: center; gap: 6px; 
                                  padding: 8px 14px; background: #0088cc; color: white; 
                                  border-radius: 6px; text-decoration: none; font-weight: bold;">
                            <span>✈️</span>
                            <span class="tg-text"></span>
                        </a>
                    </${valueTag}>
                `;
                
                const insertAfter = (rowId === 'telegramRow') 
                    ? (document.getElementById('newFamilyRow') || teamRow)
                    : teamRow;
                insertAfter.parentNode.insertBefore(row, insertAfter.nextSibling);
                
                console.log(`✅ ${rowId} 삽입 완료`);
            } else if (!teamRow) {
                console.warn(`⚠️ teamRow가 없어서 ${rowId} 만들 수 없음`);
            }
            
            if (!row) return;
            
            const linkEl = row.querySelector('a.telegram-btn');
            const textEl = row.querySelector('.tg-text');
            
            if (link && linkEl && textEl) {
                linkEl.href = link;
                textEl.textContent = btnText;
                row.style.display = 'flex';
                console.log(`✅ ${rowId} 표시됨: ${btnText}`);
            } else {
                row.style.display = 'none';
                console.log(`🚫 ${rowId} 숨김 (link=${link}, linkEl=${!!linkEl}, textEl=${!!textEl})`);
            }
        }
        
        // 새가족교육안내방 (모든 사용자에게 노출)
        ensureTelegramRow(
            'newFamilyRow',
            '새가족교육안내방',
            teamLinksMap['새가족교육안내방'],
            '새가족교육안내방 입장하기'
        );
        
        // 본인 소속 조 안내방
        const myTeamLink = (member.team && member.team !== '새가족교육안내방') 
            ? teamLinksMap[member.team] 
            : null;
        ensureTelegramRow(
            'telegramRow',
            '조별 안내방',
            myTeamLink,
            member.team ? `${member.team} 안내방 입장하기` : ''
        );

        const pureLocation = member.location ? String(member.location).trim() : "";
        const mapUrl = locationMapImages[pureLocation];
        if (mapUrl) {
            elements.mapImage.src = mapUrl;
            elements.mapContainer.style.display = 'block';
        } else {
            elements.mapContainer.style.display = 'none';
        }

        const isTutor = member.role && (
            member.role.includes('튜터') || 
            member.role.includes('서브튜터') || 
            member.role.includes('바나바') || 
            member.role.includes('관리자')
        );
        
        if (isTutor && member.team && memberListContainer) {
            const teamMembers = memberData.filter(m => m.team === member.team);
            renderTeamMembers(teamMembers, member.team, member.role);
        }

        elements.resultContainer.style.display = 'block';
        elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
        
        console.log("=== ✅ [displayResult] 완료 ===");
    } catch (err) {
        console.error("❌ [displayResult] 에러:", err);
        console.error("❌ 스택:", err.stack);
        alert("결과 표시 중 에러 발생: " + err.message);
    }
}

// 6. 직책별 우선순위 설정
const rolePriority = {
    "관리자": 1,
    "튜터": 2,
    "서브튜터": 3,
    "바나바": 4,
    "조원": 5,
    "": 6 
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

// ✨ 낙관적 업데이트 적용
async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const status = checked ? 'O' : 'X';
    console.log(`[출석 변경 요청] ${name}(${phone}) -> ${status}`);

    const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
    let originalStatus = 'X'; 
    
    if (memberIndex !== -1) {
        originalStatus = memberData[memberIndex].attendance || 'X';
        memberData[memberIndex].attendance = status;
        localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
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
            console.log('업데이트 최종 성공:', result.message);
        } else {
            console.error('업데이트 실패:', result.message);
            alert('출석 처리에 실패하여 원래 상태로 되돌립니다: ' + result.message);
            rollbackAttendance(name, phone, originalStatus, checkboxElement);
        }
    } catch (error) {
        console.error('네트워크 오류:', error);
        alert('서버 통신 중 문제가 발생하여 체크가 원래 상태로 되돌아갑니다.');
        rollbackAttendance(name, phone, originalStatus, checkboxElement);
    }
}

// 실패 시 롤백 함수
function rollbackAttendance(name, phone, originalStatus, checkboxElement) {
    const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
    if (memberIndex !== -1) {
        memberData[memberIndex].attendance = originalStatus;
        localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
    }
    if (checkboxElement) {
        checkboxElement.checked = (originalStatus === 'O');
    }
}

// 8. 에러 표시 함수
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 9. 이벤트 리스너 (✨ 안전한 등록 방식)
function initEventListeners() {
    const safeAdd = (el, event, handler, name) => {
        if (el) {
            el.addEventListener(event, handler);
            console.log(`✅ 리스너 등록: ${name}`);
        } else {
            console.warn(`⚠️ ${name} 요소가 없어 리스너 등록 건너뜀`);
        }
    };
    
    safeAdd(elements.searchBtn, 'click', searchMember, 'searchBtn');
    safeAdd(elements.closeBtn, 'click', () => { 
        elements.resultContainer.style.display = 'none'; 
    }, 'closeBtn');
    safeAdd(elements.themeToggle, 'click', () => { 
        document.body.classList.toggle('dark-mode'); 
    }, 'themeToggle');
    safeAdd(elements.adminBtn, 'click', () => { 
        elements.adminModal.classList.add('active'); 
    }, 'adminBtn');
    safeAdd(elements.adminClose, 'click', () => { 
        elements.adminModal.classList.remove('active'); 
    }, 'adminClose');
    
    if (elements.adminForm) {
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
                if (errorElement) {
                    errorElement.style.display = 'block';
                    errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
                }
            }
        });
        console.log("✅ 리스너 등록: adminForm");
    } else {
        console.warn("⚠️ adminForm 요소가 없어 리스너 등록 건너뜀");
    }
    
    safeAdd(elements.phoneInput, 'keypress', (e) => { 
        if (e.key === 'Enter' && !elements.searchBtn.disabled) searchMember(); 
    }, 'phoneInput');
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

// 10. 실행 (✨ 진단 모드)
window.addEventListener('load', () => {
    console.log("════════════════════════════════════");
    console.log("=== 🔍 페이지 로드 진단 시작 ===");
    console.log("════════════════════════════════════");
    
    // [1] DOM 요소 점검
    console.log("📌 [1] DOM 요소 점검:");
    Object.keys(elements).forEach(key => {
        const el = elements[key];
        console.log(`  ${el ? '✅' : '❌'} ${key}: ${el ? '존재' : 'NULL (HTML 확인 필요)'}`);
    });
    
    // [2] 캐시 점검
    console.log("📌 [2] localStorage 캐시 점검:");
    console.log(`  ${localStorage.getItem(CACHE_KEY_DATA) ? '✅' : '❌'} memberData 캐시`);
    console.log(`  ${localStorage.getItem(CACHE_KEY_MAP) ? '✅' : '❌'} locationMap 캐시`);
    console.log(`  ${localStorage.getItem(CACHE_KEY_TEAM_LINKS) ? '✅' : '❌'} teamLinks 캐시`);
    
    // [3] 데이터 로드
    console.log("📌 [3] 데이터 로드 시작...");
    loadData().then(() => {
        console.log("📊 데이터 로드 완료:");
        console.log(`  memberData 길이: ${memberData.length}`);
        console.log(`  teamLinksMap 키: ${Object.keys(teamLinksMap).join(', ')}`);
        console.log(`  locationMapImages 키 개수: ${Object.keys(locationMapImages).length}`);
    }).catch(err => {
        console.error("❌ loadData 실패:", err);
    });
    
    // [4] 이벤트 리스너 등록
    console.log("📌 [4] 이벤트 리스너 등록:");
    try {
        initEventListeners();
    } catch (err) {
        console.error("❌ initEventListeners 에러:", err);
    }
    
    // [5] 모달 초기화
    console.log("📌 [5] 모달 초기화:");
    try {
        initModal();
        console.log("✅ initModal 완료");
    } catch (err) {
        console.error("❌ initModal 에러:", err);
    }
    
    // [6] 안전망: 검색 버튼 클릭 감지
    const sb = document.getElementById('searchBtn');
    if (sb) {
        sb.addEventListener('click', () => {
            console.log("🖱️ === 검색 버튼 클릭 감지 ===");
            console.log("  버튼 disabled?:", sb.disabled);
            console.log("  현재 memberData 길이:", memberData.length);
            console.log("  현재 teamLinksMap:", teamLinksMap);
        });
    }
    
    console.log("════════════════════════════════════");
    console.log("=== 🔍 페이지 로드 진단 끝 ===");
    console.log("════════════════════════════════════");
});
