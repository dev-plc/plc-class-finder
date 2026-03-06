const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';

const locationMapImages = {
    "웨슬리홀": "https://drive.google.com/uc?export=view&id=1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    "칼빈": "https://drive.google.com/uc?export=view&id=19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "자모영아실": "https://drive.google.com/uc?export=view&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};

let memberData = [];

// 로드 함수 (데이터 확인용 로그 포함)
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        console.log('✅ 로드된 데이터:', memberData); // 브라우저 콘솔에서 확인 가능
    } catch (error) {
        console.error('❌ 로드 에러:', error);
    }
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').map(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase()); // 헤더 소문자 통일
    return lines.slice(1).filter(line => line).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ? values[i].trim().replace(/"/g, '') : "";
        });
        return obj;
    });
}

function searchMember() {
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();

    if (!name || !phone) {
        alert("이름과 전화번호 4자리를 모두 입력해주세요.");
        return;
    }

    // 이름과 번호 검색 (공백 제거 후 비교)
    const member = memberData.find(m => 
        String(m.name) === name && String(m.phone) === phone
    );

    if (member) {
        showResult(member);
    } else {
        document.getElementById('errorText').innerHTML = "정보를 찾을 수 없습니다.<br>시트의 이름/번호와 일치하는지 확인하세요.";
        document.getElementById('errorMessage').style.display = 'flex';
        document.getElementById('resultContainer').style.display = 'none';
    }
}

function showResult(member) {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('resultName').textContent = member.name;
    document.getElementById('resultTeam').textContent = member.team;
    document.getElementById('resultLocation').textContent = member.location;

    const mapUrl = locationMapImages[member.location];
    const mapContainer = document.getElementById('mapContainer');
    if (mapUrl) {
        document.getElementById('mapImage').src = mapUrl;
        mapContainer.style.display = 'block';
    } else {
        mapContainer.style.display = 'none';
    }

    document.getElementById('resultContainer').style.display = 'block';
}

// 초기화
window.addEventListener('load', loadData);
document.getElementById('searchBtn').addEventListener('click', searchMember);const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';

const locationMapImages = {
    "웨슬리홀": "https://drive.google.com/uc?export=view&id=1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    "칼빈": "https://drive.google.com/uc?export=view&id=19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "자모영아실": "https://drive.google.com/uc?export=view&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};

let memberData = [];

// 로드 함수 (데이터 확인용 로그 포함)
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        console.log('✅ 로드된 데이터:', memberData); // 브라우저 콘솔에서 확인 가능
    } catch (error) {
        console.error('❌ 로드 에러:', error);
    }
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').map(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase()); // 헤더 소문자 통일
    return lines.slice(1).filter(line => line).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ? values[i].trim().replace(/"/g, '') : "";
        });
        return obj;
    });
}

function searchMember() {
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();

    if (!name || !phone) {
        alert("이름과 전화번호 4자리를 모두 입력해주세요.");
        return;
    }

    // 이름과 번호 검색 (공백 제거 후 비교)
    const member = memberData.find(m => 
        String(m.name) === name && String(m.phone) === phone
    );

    if (member) {
        showResult(member);
    } else {
        document.getElementById('errorText').innerHTML = "정보를 찾을 수 없습니다.<br>시트의 이름/번호와 일치하는지 확인하세요.";
        document.getElementById('errorMessage').style.display = 'flex';
        document.getElementById('resultContainer').style.display = 'none';
    }
}

function showResult(member) {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('resultName').textContent = member.name;
    document.getElementById('resultTeam').textContent = member.team;
    document.getElementById('resultLocation').textContent = member.location;

    const mapUrl = locationMapImages[member.location];
    const mapContainer = document.getElementById('mapContainer');
    if (mapUrl) {
        document.getElementById('mapImage').src = mapUrl;
        mapContainer.style.display = 'block';
    } else {
        mapContainer.style.display = 'none';
    }

    document.getElementById('resultContainer').style.display = 'block';
}

// 초기화
window.addEventListener('load', loadData);
document.getElementById('searchBtn').addEventListener('click', searchMember);
