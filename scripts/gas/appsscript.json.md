# GAS 매니페스트 (appsscript.json)

`scripts/gas/appsscript.json` 은 **참고용**이다. Apps Script 프로젝트 안의
`appsscript.json` 을 직접 고쳐야 하고, 이 파일을 복사해 붙여넣으면 된다.

## 왜 필요한가

GAS 는 보통 코드를 훑어 필요한 권한을 스스로 잡는다. 그런데 매니페스트에
`oauthScopes` 가 적혀 있으면 **그 목록 밖의 권한은 요청조차 하지 않는다.**

실제로 겪은 일: 시트 접근은 되는데 `UrlFetchApp.fetch` 만
"권한이 없습니다" 로 막혔다. 승인 창을 아무리 다시 띄워도 소용없었다 —
요청 목록에 그 권한이 없으니 승인할 것도 없었던 것이다.

## 보이게 하는 법

Apps Script 편집기 → `프로젝트 설정`(왼쪽 톱니) →
`"appsscript.json" 매니페스트 파일을 편집기에 표시` 체크.
편집기 파일 목록에 `appsscript.json` 이 나타난다.

## 권한별 쓰임

| 권한 | 무엇에 쓰나 |
|---|---|
| `spreadsheets` | 출석부·김밥·과제 탭 읽기·쓰기 |
| `script.external_request` | Supabase 호출, GitHub 워크플로 실행 |
| `script.scriptapp` | 시간 트리거 설치 (`plcInstallPushTrigger`) |

`script.scriptapp` 은 시트에 붙인 프로젝트에만 필요하다. 웹 앱 프로젝트에
넣어 두어도 해가 없으니 둘 다 같은 목록을 써도 된다.

## 고친 뒤

1. 매니페스트 저장
2. 편집기에서 `plcAuthorize` ▶ 실행 → **승인 창이 새로 뜬다** → 허용
3. 웹 앱 재배포 (`배포 관리 → 연필 → 버전: 새 버전`)

2번에서 승인 창이 안 뜨면 이미 승인된 것이거나 목록이 아직 안 바뀐 것이다.
후자라면 [Google 계정 → 보안 → 타사 앱](https://myaccount.google.com/permissions)
에서 이 스크립트의 액세스를 지우고 다시 실행하면 처음부터 묻는다.
