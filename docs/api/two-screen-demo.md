# 차량 주문과 식당 접수 시연

두 화면은 같은 로컬 NestJS API와 PGlite DB를 사용한다. 메뉴·장소·주문 상태는 저장된 API 데이터다. 차량 ETA는 식당 화면에서 입력한 MOCK이며 예상 픽업은 ETA와 조리 예약 종료 중 늦은 시각이다. 식당 수락 시 배정한 공간과 시간 구간은 식당 목록에서 확인할 수 있다. 차량 예상 픽업 표시는 MOCK이며 공간의 실제 점유를 뜻하지 않는다.

## 준비

1. 루트에서 `npm run local:setup` 후 `npm run dev`를 실행한다. [식당 등록 예시](pickup.md#1-식당-등록)를 사용해 owner 토큰으로 메뉴와 픽업 장소가 있는 식당을 등록하고 식당 ID를 기록한다.
2. `./gradlew :automotive:assembleDebug`로 APK를 빌드하고 Pleos Connect 에뮬레이터를 시작한다. `adb devices -l`에서 serial, `adb -s <serial> shell am get-current-user`에서 차량 사용자 번호를 확인한다.
3. 파일 권한을 제한한 로컬 JSON에 customer 토큰, 등록 응답의 식당 ID, 시연용 차량번호 및 연락처를 넣는다. 파일을 저장소에 추가하지 않는다.

```json
{"token":"<customer token>","restaurantId":"<restaurant id>","vehiclePlate":"12가3456","contactPhone":"+821000001234"}
```

```sh
adb -s <serial> install -r automotive/build/outputs/apk/debug/automotive-debug.apk
adb -s <serial> reverse tcp:3001 tcp:3001
adb -s <serial> shell 'run-as com.example.delivery --user <user> mkdir -p files'
adb -s <serial> shell -T 'run-as com.example.delivery --user <user> sh -c "cat > files/pickup-demo.json"' < /private/path/pickup-demo.json
adb -s <serial> shell am start --user <user> -n com.example.delivery/androidx.car.app.activity.CarAppActivity
```

차량 프로필에서 패키지가 보이지 않으면 `adb -s <serial> shell cmd package install-existing --user <user> com.example.delivery`로 설치 상태를 확인한다. 설정 변경 후에는 앱을 종료하고 다시 연다.

## 시연

1. 차량에서 **주문 실행**을 눌러 카탈로그를 불러온다. 메뉴, 수량(1~5), 픽업 장소 행을 눌러 값을 선택하고 다시 주문 실행을 누른다. 주문 ID와 PENDING을 확인한다.
2. [식당 웹](http://127.0.0.1:3000)의 **차량 주문**에서 식당 ID와 owner 개발 토큰을 입력해 목록을 조회한다. 동일 주문 ID를 확인한다.
3. 조리시간과 MOCK 도착까지 남은 분을 입력해 수락하거나, 사유를 입력해 거절한다. 수락 후 ACCEPTED와 조리 시작 예정시각을 확인한다.
4. 차량에서 **상태 새로고침**을 누른다. 같은 주문 ID에 ACCEPTED와 MOCK 예상 픽업, 또는 REJECTED와 거절 사유가 표시된다.
5. 같은 주문을 두 식당 탭에서 먼저 조회한 뒤 한 탭에서 수락한다. 나머지 탭의 수락은 409 상태 변경 안내와 목록 갱신으로 이어진다. 연결 오류가 난 경우에는 같은 요청 키로 재시도한다.

이 데모는 한 차량 주문을 추적한다. CANCELLED가 조회되면 양쪽에서 취소 상태를 표시한다. 취소는 식당에서 조리 시작·입장 전에 처리한다. Pleos 내비게이션 SDK 호출은 없으며, 차량 앱 화면은 기존 AndroidX Car App 호스트로 실행한다.

## 검증 기록

Pleos Connect v2.1.0에서 비빔밥 2개와 지정 픽업 구역 A를 선택해 주문 `17168a36-ce59-459f-83eb-f11ed42b1521`을 생성했다. 차량과 식당 웹에 동일 ID와 PENDING이 표시됐다. 식당 웹의 수락 버튼으로 ACCEPTED를 저장하고 차량에서 새로고침해 동일 상태를 확인했다. 조리 시작 예정은 22:31:07 KST, MOCK 예상 픽업은 22:51:07 KST였다.

첫 실행에서는 상태 갱신에 ListTemplate을 반복 사용해 차량 호스트의 화면 전환 제한에 걸렸다. 목록 행 제목을 유지하고 결과 화면을 PaneTemplate으로 분리한 후 새 주문으로 재검증했다. 웹·서버 빌드, 타입 검사, API 25건·DB 8건, 웹 연결·장애 스모크 테스트, 차량·모바일 디버그 빌드가 통과했다.

## 수동 인도 시연

픽업 공간 배정이 적용된 새 주문으로 진행한다. 식당 수락 시 조리 1분, MOCK 도착까지 2분을 입력하면 준비와 입장 버튼을 누를 시간을 확보할 수 있다. 식당 목록에 RESERVED 및 구간, 조리 시작 예정이 표시된다. 수동 조리 시작 → 수동 준비 완료 → 예약 구간 안에서 수동 입장 확인 → 수동 인도 완료를 누른다. 식당 목록의 COMPLETED / RELEASED와 차량 앱 새로고침 후 인도 완료를 확인한다. 조리 전 취소는 식당 목록의 주문 취소로 처리한다.

식당 전용 POST /api/orders/:id/{start,ready,arrive,complete,cancel}에 `expectedVersion`과 `requestKey`를 전송한다. 네트워크 실패 시 원래 요청 키와 본문으로 재시도한다. 동일 요청은 저장한 응답을 반환하며, 동일 완료 상태에서 최신 버전으로 다시 완료해도 상태나 버전을 갱신하지 않는다. ETA는 MOCK이고 입장·인도는 식당 수동 확인이다.

시간 경계를 포함한 자동 시나리오에는 약 1분이 필요하다. 저장소 루트에서 아래 명령을 실행한다.

```sh
npm run build
RUN_PICKUP_DEMO=1 node --test --test-name-pattern='manual pickup lifecycle' server/test/pickup-api.test.mjs
npm run test:smoke
```

## MOCK ETA 변경 시연

1. 식당 웹에서 주문을 수락한 뒤, 조리 시작 전에 **새 MOCK 도착까지 (분)**을 입력하고 **ETA 갱신**을 누른다. 기존 예약 구간을 벗어난 ETA를 입력한다.
2. 두 화면에서 확정된 기존 구간과 새 픽업·조리 제안을 확인한다. 열려 있는 주문 화면은 약 5초마다 조회하며 차량에서 수동 새로고침도 가능하다.
3. 차량의 **변경 시간 확정**을 누른다. 식당 화면에서 갱신된 예약 구간과 조리 시작 예정 시각을 확인한다.
4. 변경을 확정하지 않으면 기존 구간을 유지한다. 기존 구간이 지나면 입장할 수 없고 주문은 유지된다. 새 제안의 조리 시작 시각이 지났거나 조리를 이미 시작한 경우 제안 확정이 차단된다. 확정 전에 다른 주문이 공간을 확보하면 기존 일정이 유지되며 직원이 새 ETA를 입력해 다시 제안할 수 있다.

식당의 `POST /api/orders/:id/eta`에는 `eta`, `expectedVersion`, `requestKey`가 필요하다. 주문 고객의 `POST /api/orders/:id/eta/confirm`에는 제안을 받은 버전의 `expectedVersion`과 `requestKey`가 필요하다. 두 화면은 최신 ETA와 확정 예약, `etaProposal`을 각각 표시한다.

## 목적지 기준 식당 선택

Pleos 내비에서 최종 목적지를 지정한 뒤 밥맞J의 **내비 위치·목적지 불러오기**를 누른다. **음식 카테고리 선택 → 식당 선택 → 메뉴 선택 → 주문 실행** 순서로 진행한다. 식당 등록 요청에 `foodCategory`를 지정할 수 있으며 기존 식당은 **기타**에 표시된다.

카카오 키가 설정되어 있고 Pleos가 출발지·목적지 좌표를 반환하면 경유 총거리를 짧은 순으로 표시한다. 경로 정보를 확인할 수 없어도 식당과 메뉴를 선택할 수 있다. 주문에는 검색 결과에 사용한 픽업 장소를 그대로 보낸다.

### 시연 식당 한 번에 등록

루트에서 처음 한 번 `npm run local:setup`을 실행한다. API 서버를 종료한 상태에서 `npm run local:seed`를 실행하면 로컬 개발 DB에 가상 식당 3곳이 등록된다. 세 식당 모두 한식 카테고리의 비빔밥을 판매하며 각각 다른 픽업 좌표와 기본 조리시간을 사용한다. 같은 운영자에게 같은 이름으로 등록된 시연 식당은 재실행 시 건너뛴다. 스크립트가 출력한 식당 ID는 식당 웹의 주문 조회에 사용할 수 있다.

등록 후 API 서버를 시작한다. 테스트 좌표는 식당 후보를 비교하기 위한 데이터이며, 실제 경유 거리를 얻으려면 카카오 경로 키와 출발지·목적지 좌표를 별도로 설정한다.
