# DGfinder 인계 — 관리자 페이지의 '시트에서 지금 가져오기' 버튼

DGfinder Code 대화에 **아래 `---` 사이를 통째로** 붙여넣으세요.
실제 구현은 `plc-class-finder` 의 `scripts/gas/doGet.js` (v29) · `admin.js` · `admin.html` 입니다.

---

# 작업: 관리자 페이지에서 시트 → DB 동기화를 즉시 실행

## 왜 필요한가

명단·편성·위치·과제 같은 것은 **하루 한 번(정오) 도는 GitHub Actions** 로만 DB 에 들어옵니다.
수업 직전에 장소를 옮기거나 인원을 추가하면 **그때까지 앱에 안 나옵니다.**
관리자가 GitHub 에 들어가 워크플로를 손으로 돌리는 것 말고 방법이 없었습니다.

## 만들 것

관리자 페이지에 버튼 두 개.

```
[⟳ 시트에서 지금 가져오기]  [화면 새로 고침]   요청했습니다. 보통 1~2분 걸립니다.
```

- **가져오기** — 동기화 워크플로를 실행한다 (1~2분)
- **새로 고침** — 끝난 뒤 앱이 새 데이터를 다시 읽는다

**두 단계인 이유**: 동기화가 끝나도 앱은 캐시를 들고 있습니다. 누군가는 다시 불러와야 합니다.

## 구조 — 왜 GAS 를 거치나

워크플로 실행에는 GitHub 토큰이 필요한데, **그 토큰을 앱에 넣을 수 없습니다.**
저장소가 공개면 JS 를 누구나 읽습니다. 비공개여도 브라우저에 내려간 코드는 열어볼 수 있습니다.

```
앱 [버튼]
  │  POST { action: "sync" }        ← 토큰 없음
  ↓
GAS doPost                          ← 토큰은 여기 스크립트 속성에
  │  POST /actions/workflows/{wf}/dispatches
  ↓
GitHub Actions → 시트를 읽어 DB 에 넣는다
```

## GAS 쪽

```js
var GH_REPO_DEFAULT = "owner/repo";       // DGfinder 저장소
var GH_WORKFLOW_DEFAULT = "sync-db.yml";  // 워크플로 파일명
var SYNC_MIN_INTERVAL_MS = 60 * 1000;

function requestSync_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GH_TOKEN");
  if (!token) return { success: false, message: "GH_TOKEN 이 없습니다 (스크립트 속성)." };

  // 연타 방지. 스크립트 속성은 쓰기가 느리니 캐시를 쓴다.
  var cache = CacheService.getScriptCache();
  if (cache.get("sync_recent")) {
    return { success: false, message: "방금 요청했습니다. 1분 뒤에 다시 눌러 주세요." };
  }

  var repo = props.getProperty("GH_REPO") || GH_REPO_DEFAULT;
  var wf = props.getProperty("GH_WORKFLOW") || GH_WORKFLOW_DEFAULT;

  var res = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + repo + "/actions/workflows/" + wf + "/dispatches", {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      payload: JSON.stringify({ ref: "main", inputs: {} }),
      muteHttpExceptions: true
    });

  var code = res.getResponseCode();
  if (code === 204) {
    cache.put("sync_recent", "1", Math.ceil(SYNC_MIN_INTERVAL_MS / 1000));
    return { success: true, message: "동기화를 요청했습니다. 보통 1~2분 걸립니다." };
  }
  if (code === 401 || code === 403) return { success: false, message: "토큰이 거부됐습니다 (" + code + ")." };
  if (code === 404) return { success: false, message: "워크플로를 찾지 못했습니다 (" + repo + " · " + wf + ")." };
  return { success: false, message: "GitHub " + code + ": " + res.getContentText().slice(0, 200) };
}
```

`doPost` 맨 앞에서 분기합니다. **시트 잠금(LockService)을 잡기 전에** 처리하세요 —
동기화는 시트를 건드리지 않으므로 출석 저장이 진행 중이어도 막힐 이유가 없습니다.

```js
function doPost(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  try {
    var probe = JSON.parse(e.postData.contents);
    if (probe && probe.action === "sync") {
      var r = requestSync_();
      return output.setContent(JSON.stringify({ success: r.success, message: r.message }));
    }
  } catch (err) {
    return output.setContent(JSON.stringify({ success: false, message: "요청을 읽지 못했습니다: " + err.message }));
  }
  // …이하 기존 출석 저장 (여기서 잠금을 잡는다)
}
```

## 앱 쪽

```js
syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
        const res = await postToGas({ action: 'sync' });   // text/plain 으로 보낼 것
        setInfo(res.message + ' 끝나면 [화면 새로 고침] 을 눌러 주세요.', 'ok');
    } catch (err) {
        setInfo('요청 실패: ' + err.message, 'fail');
    } finally {
        setTimeout(() => { syncBtn.disabled = false; }, 60000);   // 연타 방지
    }
});

reloadBtn.addEventListener('click', async () => {
    await refresh();          // 데이터 계층의 전량 재조회
});
```

---

# ⚠️ 설정 — 여기서 대부분 막힙니다

## 1. 토큰

GitHub → `Settings → Developer settings → Personal access tokens → Fine-grained tokens`

- Repository access: **해당 저장소만** (여러 개를 함께 고를 수 있습니다)
- Permissions: **`Actions: Read and write`** 하나면 됩니다
- 만료일을 넉넉히. 만료되면 버튼이 401 로 죽습니다

## 2. 스크립트 속성

Apps Script 편집기 → `프로젝트 설정` → `스크립트 속성`

```
GH_TOKEN    = (발급받은 토큰)
GH_REPO     = owner/repo        ← 주소창의 github.com/ 뒤 두 토막 그대로
GH_WORKFLOW = sync-db.yml       ← .github/workflows/ 안의 파일명 (화면 제목 아님)
```

## 3. 매니페스트 — ⚠️ 여기서 제일 오래 막혔습니다

`UrlFetchApp.fetch 을 호출할 수 있는 권한이 없습니다` 가 뜨고,
**승인 창을 아무리 다시 띄워도 안 풀립니다.**

원인: GAS 는 보통 코드를 훑어 필요한 권한을 스스로 잡는데,
**`appsscript.json` 에 `oauthScopes` 가 적혀 있으면 그 목록 밖의 권한은 요청조차 하지 않습니다.**
승인할 것이 없으니 버튼을 눌러도 그대로입니다.

`프로젝트 설정` → `"appsscript.json" 매니페스트 파일을 편집기에 표시` 체크 →
파일이 나타나면 `oauthScopes` 에 추가하세요.

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp"
]
```

## 4. 승인 → 재배포 (순서가 중요)

**`doGet`/`doPost` 는 URL 로 불려서 승인 창을 띄울 자리가 없습니다.**
권한 없이 배포되면 조용히 실패합니다. 사람이 편집기에서 함수를 실행해야 승인이 됩니다.

아래 점검 함수를 넣고 **편집기에서 ▶ 실행** → 승인 → **그다음 재배포**.
순서를 바꾸면 그대로입니다.

```js
function authorizeAndCheck() {
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty("GH_REPO") || GH_REPO_DEFAULT;
  var wf = props.getProperty("GH_WORKFLOW") || GH_WORKFLOW_DEFAULT;
  var token = props.getProperty("GH_TOKEN");
  var lines = [];

  try { lines.push("시트 접근    : ✅ " + SpreadsheetApp.openById(SHEET_ID).getName()); }
  catch (e) { lines.push("시트 접근    : ❌ " + e.message); }

  // ⚠️ 외부 요청 확인을 GitHub 의 미인증 주소로 하면 안 된다.
  //    Google 서버 IP 는 공용이라 미인증 한도에 걸려 403 이 나고,
  //    권한 문제로 오해하게 된다. 인증되는 곳(여기서는 Supabase)으로 확인한다.
  try {
    var sb = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/cohorts?select=id&limit=1", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
      muteHttpExceptions: true });
    lines.push("외부 요청    : " + (sb.getResponseCode() === 200 ? "✅" : "❌ " + sb.getResponseCode()));
  } catch (e) { lines.push("외부 요청    : ❌ " + e.message); }

  if (!token) { lines.push("GitHub       : ❌ GH_TOKEN 없음"); }
  else {
    var gh = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28" };
    var r1 = UrlFetchApp.fetch("https://api.github.com/repos/" + repo, { headers: gh, muteHttpExceptions: true });
    if (r1.getResponseCode() === 200) {
      lines.push("GitHub 저장소: ✅ " + repo);
      var r2 = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/actions/workflows/" + wf,
                                 { headers: gh, muteHttpExceptions: true });
      lines.push("GitHub 워크플로: " + (r2.getResponseCode() === 200 ? "✅ " + wf : "❌ " + wf + " 없음"));
    } else if (r1.getResponseCode() === 401) lines.push("GitHub 저장소: ❌ 401 토큰이 잘못됐거나 만료");
    else if (r1.getResponseCode() === 404) lines.push("GitHub 저장소: ❌ 404 " + repo + " 없음 또는 토큰에 미포함");
    else lines.push("GitHub 저장소: ❌ " + r1.getResponseCode());
  }

  Logger.log(lines.join("\n"));
  return lines.join("\n");
}
```

`401`·`404` 를 나눠 보여주는 게 중요합니다. **토큰이 틀렸는지, 저장소 이름이 틀렸는지,
워크플로 파일명이 틀렸는지가 한 번에 갈립니다.**

---

# ⚠️ 그 밖의 함정

**`doPost` 가 실패를 삼키면 권한 문제가 안 보인다.**
출석 저장에서 DB 반영 실패를 조용히 넘기게 해 두면(시트에는 들어갔으니 맞는 설계다),
**외부 요청 권한이 없다는 사실이 몇 주 동안 드러나지 않습니다.**
실제로 그랬습니다 — 이 동기화 버튼을 만들고서야 알았습니다.
삼키더라도 **응답에 실패 사유를 실어 보내고 콘솔에 경고**하세요.

**브라우저에서 GAS 를 부를 때 `application/json` 은 CORS 로 막힌다.**
preflight 때문입니다. `Content-Type: text/plain;charset=utf-8` 로 보내고
서버에서 `JSON.parse(e.postData.contents)` 하세요.

**이 URL 은 인증이 없다.**
GAS 주소를 아는 사람은 누구나 동기화를 걸 수 있습니다. 다만 이 동작이 하는 일은
시트를 DB 로 옮기는 것뿐이고, 워크플로에 `concurrency` 를 걸어 두면 겹쳐도 안전합니다.
그래도 연타는 막으세요 — 앱과 GAS **양쪽에서** 막아야 합니다.
앱만 막으면 주소를 직접 부르는 경우가 남습니다.

**워크플로 입력은 비워서 보낸다.**
`inputs: {}` 로 두어 워크플로의 기본값이 쓰이게 하세요. 여기에 값을 실으면
'출석 가져오기' 같은 위험한 옵션이 실수로 켜질 수 있습니다.

---

## 검증

1. `authorizeAndCheck` 실행 → **네 줄 전부 ✅** 인가
2. 재배포 후 버튼 → GitHub `Actions` 탭에 실행이 뜨는가
3. 1분 안에 다시 누르면 → **"방금 요청했습니다" 로 막히는가**
4. `GH_WORKFLOW` 를 일부러 틀리게 → **404 와 함께 시도한 값이 보이는가**
5. 워크플로가 끝난 뒤 `화면 새로 고침` → **바뀐 데이터가 화면에 나오는가**
6. 출석 저장이 진행 중일 때 동기화 → **막히지 않는가** (잠금 밖에서 처리했는지)

---
