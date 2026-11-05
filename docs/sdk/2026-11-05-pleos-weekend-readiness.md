# Pleos SDK 검증표와 주말 최소 시연 계획

조사일: 2026-11-05. 시연 대상 주말: 11월 7~8일.
소스/Gradle/Manifest/DB는 수정하지 않았다. 공식 문서 열람, 로컬 AAR 공개 시그니처 확인, 에뮬레이터 부팅과 기존 APK 설치만 수행했다.

## 1. 확인 범위와 중요한 정정
README.md, restaurant-web/AGENTS.md, settings.gradle.kts, 세 Android 모듈 Gradle/Manifest/Kotlin 소스, 로컬 Android SDK/AVD 및 Gradle 캐시를 조사했다.
현재 저장소에는 Pleos Maven 저장소·NaviHelper 의존성·초기화/호출·NAVI 권한이 없다. shared 화면은 고정 MessageTemplate이며 서버 통신도 없다.

그러나 **로컬 Gradle 공용 캐시에는 SDK AAR이 존재**한다. 이전의 ‘현재 프로젝트에서 SDK 미발견’을 컴퓨터 전체에 SDK가 없다는 뜻으로 해석하면 안 된다. 캐시 소유 프로젝트/과거 사용 이력은 확인하지 못했으며 이 앱의 연동 성공 근거는 아니다.

- 캐시 루트: /Users/yunseunghyeon/.gradle/caches/modules-2/files-2.1/ai.pleos.playground
- NaviHelper 3.0.5, navi-data 3.0.4, navi-aidl 3.0.1 AAR/POM 존재.
- 공식 가이드의 NaviHelper 버전도 3.0.5다. 전이 의존성 버전이 모두 3.0.5여야 한다고 추측하지 않는다.
- [로컬 AAR 경로·SHA-256](2026-11-05-local-inventory.log), [공개 API 시그니처](2026-11-05-navi-public-api.log).

## 2. SDK 검증표
‘문서/바이너리 지원’과 ‘현재 앱 실호출 성공’을 구분한다.

| 기능 | 지원 근거 | 로컬/실행 검증 | 주말 분류 |
|---|---|---|---|
| 픽업 좌표 목적지·경로 설정 | 공식 [목적지 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/destinations)의 requestRoute(RouteInfo), getDestinationInfo, onRoutingCompleted/onDestinationInfo. 캐시 메서드/위경도 필드 일치 | SDK 연결·권한·경로 요청은 아직 앱에서 실행 안 함 | **실연동 후보, 런타임 미검증** |
| 경로 재탐색 | 공개 requestReRoute, changeRouteOption 및 문서의 이벤트 목록 | 메서드 존재 확인만, 실제 재탐색 미검증 | 필수 시연에서 제외 |
| 경로 상태 조회 | getRouteStateInfo → onRouteStateInfo. 공개 RouteStateInfo에는 isRouting 등의 필드 | RouteStateInfo 자체에는 ETA 필드 없음 | ETA 조회와 혼동 금지 |
| 주행 중 ETA/남은 시간 갱신 | 공식 [이벤트 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/event-listeners)의 onDrivingInfo. 바이너리 DrivingInfo.destination → DrivingState.getDuration/getDistance | duration 단위·의미·갱신 간격·실제 발생 조건 미확인. 공개 NaviHelper에 getDrivingInfo라는 호출은 없음 | **모의 ETA를 기본으로 준비**, 실콜백 확인 후 교체 |
| 별도 경로/여정 예측 ETA | 공개 requestTrip(TripRequest) → onTripInfo(TripInfo), TripInfo.getEta 존재. 공식 [requestTrip 참조](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/navi-helper/ai.pleos.playground.navi.helper/navi-helper/request-trip) | 열람된 상세 참조는 제목/탐색 위주로 파라미터·단위 설명을 확인 못 함. getEta 정수의 단위를 추측하지 않음 | **미검증**, 새 호출 시그니처/단위 가정 금지 |
| 목적지 도착 이벤트 | 공식 onDestinationArrived(DestinationArrivedInfo), 캐시 공개 메서드 일치 | 실제 서비스의 콜백 발생 미검증 | 수신 검증 전 수동 도착으로 시연 |
| 도착 3분 전/픽업존 접근 이벤트 | 열람한 공식 이벤트 목록과 캐시 listener에 전용 임계값 콜백은 확인 못 함 | ‘도착’ 콜백은 ‘접근’ 콜백과 다름 | **ETA 기반 파생 알림**으로 분리; 모의 ETA이면 모의 접근 알림으로 표시 |
| 에뮬레이터 부팅·디버깅 기반 | 공식 [설치 가이드](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator) | API34/arm64 AVD 부팅, sys.boot_completed=1, ADB 연결, 기존 automotive APK install Success | **검증됨: 부팅·설치 범위**. 화면 렌더링·SDK 호출은 별도 |
| Virtual Console | 공식 [설정 가이드](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/use-vehicle-emulator)의 8088 포워딩 | connectwebconsole 패키지 존재, 브라우저 콘솔 접속/조작은 미실행 | 미검증. 차량 상태 시뮬레이션을 경로 ETA 제공 기능으로 단정하지 않음 |

공식 가이드는 콜백 전달이 Navigation 앱 구현/현재 상태에 따라 달라질 수 있다고 설명한다. 메서드 존재나 호출 반환만으로 경로/ETA 성공으로 판정하지 않는다.

## 3. 설치/실행 근거
AVD: /Users/yunseunghyeon/.android/avd/Pleos_Connect_v2.1.0.avd/config.ini
- target android-34, arm64-v8a, RAM 4096MB.
- image.sysdir.1=system-images/android-34/pleos_car_emulator/arm64-v8a/
- 실제 이미지 경로: /Users/yunseunghyeon/Library/Android/sdk/system-images/android-34/pleos_car_emulator/arm64-v8a/
- source.properties: Android API34, vendor 42dot. SDK emulator 실행 파일 존재.
- emulator -accel-check 결과: Hypervisor.Framework 사용 가능, exit 0.
- 읽기 전용/스냅샷 미사용/창 없는 모드로 기동. 관찰한 기기 emulator-5554, 부팅 완료 1, Android SDK 34.
- 설치 패키지: ai.pleos.playground.service.navi, ai.umos.maps.android.navigation.app, ai.pleos.connectwebconsole 등.
- 기존 automotive/build/outputs/apk/debug/automotive-debug.apk 설치 Success(exit0).
- SDK 초기화/경로 요청/화면 표시/주행 시뮬레이션은 수행하지 않았다. 앱 설치를 앱 정상 동작으로 과장하지 않는다.

전체 확인 결과: [에뮬레이터 probe 로그](2026-11-05-emulator-probe.log).

## 4. 실연동 검증 절차 — 아직 수행하지 않은 단계 명시
### A. SDK 연결 준비
공식 [SDK 가져오기](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/importing-sdk)에 따라, 후속 구현에서 Maven 저장소와 ai.pleos.playground:NaviHelper:3.0.5 의존성을 추가한다. 이번 조사에서는 변경하지 않았다.
저장소 주소: https://nexus-playground.pleos.ai/repository/maven-releases/

공식 [권한 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/declaring-permissions): 정보 조회 NAVI_ROUTE, 경로 요청 NAVI_ROUTE_SEARCH. 전체 이름은 pleos.car.permission.NAVI_ROUTE / pleos.car.permission.NAVI_ROUTE_SEARCH. 실제 부여 여부/접근 신청 조건도 확인해야 한다. 이번 기존 Manifest에는 없다.

공식 [초기화](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/NaviHelper/initialization-and-release) 순서: NaviHelper(context) → initialize(onConnected,onFailed) → 연결 후 addListener → 요청 → removeListener/release. 오류 콜백 기록 및 리소스 해제가 필요하다.

### B. 좌표 경로 검증
1. 주문 스냅샷의 pickup latitude/longitude를 사용하고 다른 주문의 경로가 아닌지 매핑한다.
2. 공식 RouteInfo 입력 정의를 설치된 SDK와 대조한다. POI 식별자가 임의 좌표에 꼭 필요한지 확인되지 않았으므로 가짜 poiId를 만들어 넣지 않는다.
3. requestRoute 요청 시각·목적지 좌표·orderId/routeId를 자체 로그로 남긴다.
4. onError 또는 onRoutingCompleted를 확인한다. getDestinationInfo 결과와 주문 좌표를 비교한다.
5. 통과 기준은 서비스 연결, 최종 탐색 완료, 목적지 일치이며 ‘메서드 호출 시 예외 없음’만으로 통과시키지 않는다.

### C. ETA/접근 검증
1. onDrivingInfo의 실제 수신 여부와 원시 duration/distance 값을 기록한다. 단위와 누락/센티널 값은 공식 상세 문서나 SDK 샘플로 확인 전까지 변환하지 않는다.
2. 경로 취소·재탐색·목적지 변경 시 이전 주문의 ETA를 폐기한다.
3. ETA 단위 확인 후에만 서비스 계약의 arrivalAt으로 변환한다. 로컬 수신 시각을 SDK 측정 시각으로 속이지 말고 관측 근거를 기록한다.
4. 정지/주행/경로 변경에 따른 갱신을 확인한 후 VEHICLE source를 사용한다. 확인 전에는 UNKNOWN 또는 MOCK이다.
5. onDestinationArrived는 현재 주문의 목적지 이벤트인지 확인 후 도착 표시 후보로만 사용한다. 공간 실제 점유나 음식 인도를 자동 확정하지 않는다.
6. 3분 전 알림은 별도 서버 임계값 정책으로 계산한다. SDK가 직접 ‘픽업 접근’을 알려줬다고 표시하지 않는다.

### D. 에뮬레이터/디버깅 재현
설치된 실제 SDK 경로를 사용한다. serial은 adb devices와 emu avd name으로 확인한 값으로 치환한다.

```sh
/Users/yunseunghyeon/Library/Android/sdk/emulator/emulator -avd Pleos_Connect_v2.1.0 -read-only -no-snapshot -no-window -no-audio
/Users/yunseunghyeon/Library/Android/sdk/platform-tools/adb devices -l
# 이후 명령의 emulator-5554는 이번 관찰값. 실행마다 다시 확인한다.
/Users/yunseunghyeon/Library/Android/sdk/platform-tools/adb -s emulator-5554 shell getprop sys.boot_completed
/Users/yunseunghyeon/Library/Android/sdk/platform-tools/adb -s emulator-5554 install -r automotive/build/outputs/apk/debug/automotive-debug.apk
```

화면/브레이크포인트 검증은 Android Studio Device Manager에서 AVD를 창 모드로 띄우고 automotive 모듈을 Run/Debug한다. 현재 APK는 AndroidX CarAppActivity 기반이다. 호스트 렌더링·권한 오류를 별도로 확인해야 한다.
로그는 Android Studio Logcat에서 앱/에러 콜백 중심으로 확인한다. 필요 시 `adb -s <serial> logcat`을 사용하되 인증정보·전체 사용자 데이터를 공유 로그에 남기지 않는다. ADB 설치/디버깅은 [Android 공식 ADB 문서](https://developer.android.com/tools/adb)를 따른다.

Virtual Console 후속 검증: `adb -s <serial> forward tcp:8088 tcp:8088` → http://127.0.0.1:8088/ 접속. 이 절차는 아직 미실행이며 조회 후 자신이 추가한 포워딩만 제거한다.

차량 앱→로컬 API 연결은 별도 작업이다. 기존 앱에 INTERNET 선언/HTTP 클라이언트가 없으며 로컬 HTTP 접근의 개발 전용 설정도 확인해야 한다. 기본 서버는 loopback 바인딩이므로 단순 LAN 주소 노출로 해결하지 않는다. 후속 개발에서는 ADB reverse 등 문서화된 전달 방식을 검토하고 장치에서 health 응답을 검증한다.

## 5. 모의 ETA 이벤트 계약 — 자체 서비스 제안, SDK API 아님
SDK 실데이터 여부와 무관하게 같은 내부 이벤트 형태로 정규화하는 안이다. 경로 문자열/콜백 이름을 SDK 기능처럼 만들지 않는다.

```json
{
  "eventId":"11111111-1111-4111-8111-111111111111",
  "type":"ETA_UPDATED",
  "orderId":"22222222-2222-4222-8222-222222222222",
  "pickupLocationId":"33333333-3333-4333-8333-333333333333",
  "routeId":"demo-route-1",
  "runId":"weekend-demo-1",
  "sequence":1,
  "source":"MOCK",
  "observedAt":"2026-11-07T01:00:00Z",
  "arrivalAt":"2026-11-07T01:20:00Z"
}
```

- 앱 내부/테스트 드라이버의 제안 계약이다. 서버의 ETA 수신 API도 아직 없으며, 기존 POST orders는 eta 필드를 거부한다. [최소 주문·픽업 계약](../api/order-pickup-contract.md)의 후속 ETA 입력 경로를 구현해야 한다.
- 같은 eventId 재송신은 중복 적용하지 않는다. orderId/픽업 위치/현재 경로가 안 맞으면 거절한다.
- 오래된 sequence/observedAt은 무시하거나 명시적 stale 응답을 반환한다. 신규 경로/시연 run은 이전 샘플과 섞지 않는다.
- 소스는 MOCK과 VEHICLE을 분리하고 화면·로그·이벤트에 유지한다. 실패 시 VEHICLE 값을 조용히 MOCK으로 바꾸지 않고 사용자에게 모의 전환 상태를 표시한다.
- ETA가 없거나 오래되면 UNKNOWN. 이전 시각을 계속 갱신되는 ETA처럼 보여주지 않는다.
- 시연 시간을 줄이려면 가상 시계를 명시적으로 주입한다. 동일 시각에서 arrivalAt만 줄이는 방식은 ‘경로 예상 변화’이며 실제 경과시간 재현과 다르다.

### ETA 기반 모의 접근 알림
서버 관측 시각 기준 0 < arrivalAt-now <= 180초인 최신 유효 이벤트에서 NEARBY로 판정하는 시연 정책을 제안한다. 이미 임계값 안에서 최초 수신해도 한 번 알린다.
- (orderId, runId, NEARBY)당 1회. ETA가 늘었다 다시 줄어도 같은 run에서 반복 발송하지 않는다.
- 중복/역순/누락 샘플, 종료 주문에는 알림을 만들지 않는다.
- ETA=0만으로 ARRIVED/IN_USE/COMPLETED를 확정하지 않는다. 도착·점유·인도는 수동 확인으로 분리한다.
- source=MOCK이면 식당 표시도 ‘모의 ETA 기반 접근 알림’으로 명시한다.

## 6. 주말 최소 시연 흐름과 작업 경계
현재 가능한 것: 로컬 서버·DB·웹 health, 주문 등록/조회 API, DB 함수 예약 테스트, 에뮬레이터 부팅/APK 설치.
아래 업무 화면/수락·ETA API/SDK 호출은 아직 없으므로 주말 전 구현해야 하며 지금 시연 가능하다고 주장하지 않는다.

### 우선 시연: 실제 주문 데이터 + 명시적 모의 차량 시간
1. 실제 로컬 DB에 식당·메뉴·픽업 위치를 등록한다.
2. 차량 앱에 메뉴/수량/픽업 선택과 주문 전송 화면을 연결한다. 실패 시 API 도구 주문으로 대체하고 ‘차량에서 주문 성공’이라고 표현하지 않는다.
3. 식당 웹에 주문 목록·수락/조리시간 입력을 연결한다. 기존 DB 예약 함수와 서버 API를 연결한다.
4. 모의 ETA 20분 → 25분으로 예약 변경, 식당 조리 시작으로 LOCK, 이후 ETA가 바뀌어도 조리 예약이 되돌아가지 않음을 보여준다.
5. 3분 이내 모의 이벤트로 식당 준비 알림을 1회 표시한다.
6. 수동 도착 → 준비 완료/음식 인도 확인 → 주문 종료를 보여준다.
7. 물리적 공간 예약은 별도 스키마/정책이 없으므로 실제 공간 확보로 표시하지 않는다. 구현하지 못하면 ‘장소 선택만 지원/공간 예약 미구현’으로 명시한다.

### 추가 시연: 실 NaviHelper 목적지 설정
주말 초반 별도 제한 시간 안에 SDK 연결/경로 완료/목적지 일치까지 통과하면 실제 경로 설정을 보여준다. 실패 시 기능을 ‘미검증’으로 남기고 모의 ETA 시나리오는 계속한다. ETA 단위/반복 수신까지 검증하지 못하면 목적지 설정 실연동과 ETA 모의 구현을 혼합하되 각각 출처를 화면에 표시한다.

### 시연 완료 기준
- 주문 ID가 차량(또는 명시한 API 도구)·서버·식당에서 일치한다.
- 저장된 픽업 좌표와 경로 목적지가 일치하거나 경로 연동 미검증이 명시된다.
- 모의 입력의 지연·중복·LOCK 후 변경이 재현 가능하다.
- 3분 알림이 한 번만 발생하고 실차 접근 센서 이벤트로 오인되지 않는다.
- SDK 원시 로그/콜백과 서버 이벤트의 source가 남는다.

## 7. 남은 장애
1. 캐시는 있으나 프로젝트 SDK 의존성/권한/초기화 미연결.
2. 임의 좌표만으로 경로 요청 가능한 필수 필드 조건과 실제 경로 탐색 성공 미검증.
3. duration/eta 단위·자동 갱신 조건 미확정. 확인되지 않은 getETA/getDrivingInfo 류 함수를 추가하면 안 된다.
4. Navigation 앱 서비스의 상태·지도/네트워크·권한에 따라 콜백이 다를 수 있다.
5. 서버의 ETA/수락/LOCK API와 식당 관리 화면, 차량 업무 화면 미구현.
6. 물리적 공간 예약은 주방 수용량과 별개로 미구현.

결론: ‘SDK 미설치’가 아니라 **SDK 캐시·에뮬레이터는 확인됐고 현재 앱 연동은 미구현/미검증**이다. 경로 설정은 실연동 후보, 주말 ETA·접근은 모의 계약을 기준으로 준비한다.
