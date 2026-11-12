# 11월 8일 밥맞J 복구 점검

로컬 HEAD는 `d4ea914`다. 11월 7일의 화면, 계산 함수, 테스트 및 증거는 수정·추가된 작업 트리에 있다. 이번 검증은 그 변경을 포함한다. 루트 README, 식당 웹 AGENTS.md, Supabase README, API 계약, SDK 검증 기록을 먼저 대조했다. 이 점검은 보고서와 실행 로그만 추가한다.

| 대상 | 판정 | 실제 동작과 파일 근거 |
|---|---|---|
| 로컬 DB | 구현 | [마이그레이션](../../../supabase/migrations), [로컬 DB](../../../server/src/database/local-database.ts). PGlite에 식당·메뉴·위치·주문·조리 예약·접수 이력을 저장 |
| 호스팅 Supabase·Auth | 미구현 / 검증 불가 | 로컬 개발 인증만 사용. Supabase CLI·Docker·psql이 PATH에 없고 검증용 원격 환경이 제공되지 않음. 독립 PostgreSQL 세션 경쟁 검증 불가 |
| 주문 생성·조회·접수 | 구현 | [컨트롤러](../../../server/src/pickup/pickup.controller.ts), [서비스](../../../server/src/pickup/pickup.service.ts). 생성·상세·식당 목록·수락·거절과 권한, 요청 키 재전송 |
| 차량 앱 | 부분 구현 | [Car App 화면](../../../shared/src/main/java/com/example/delivery/shared/MyCarAppScreen.kt), [로컬 HTTP](../../../shared/src/main/java/com/example/delivery/shared/LocalPickupApi.kt). 디버그 환경에서 메뉴·수량·장소 선택, 주문 ID·상태 새로고침, MOCK 예상 픽업 |
| 식당 웹 | 부분 구현 | [주문 화면](../../../restaurant-web/src/components/restaurant-orders.tsx), [서버 호출](../../../restaurant-web/src/app/order-actions.ts). 목록·수락·거절·조리 시작 예정 표시. 입장·준비·인도 화면 미구현 |
| 조리 예약·LOCK | 부분 구현 | [예약 SQL](../../../supabase/migrations/20261104000200_reservations.sql). 수락과 SCHEDULED를 원자적으로 저장. COOKING/READY에서 재예약 차단. 시작·준비·완료는 DB 함수, HTTP 없음 |
| 픽업 공간 예약 | 미구현 | 위치 저장은 구현. [계산 함수](../../../server/src/pickup/pickup-planning.ts)는 1대·3분 가정에서 충돌·대안을 계산. 수락 응답은 NOT_IMPLEMENTED. 예약 저장·실제 점유·해제 없음 |
| ETA 변경·메뉴별 안내시간 | 미구현 | 모의 ETA는 수락 시 입력. 지연·LOCK 계산 테스트는 존재. ETA 수신/재계획 API와 메뉴별 기본 조리시간 저장 없음 |
| Pleos 내비 SDK | 미구현 / 검증 불가 | [SDK 기록](../../sdk/2026-11-05-pleos-weekend-readiness.md). NaviHelper 3.0.5, navi-data 3.0.4, navi-aidl 3.0.1 캐시와 Pleos Connect v2.1.0 AVD 존재. 프로젝트 SDK 의존성·호출부가 없어 실제 경로·ETA·도착 콜백 실행 불가 |

## 상태 전이

- 주문. 생성 → PENDING → ACCEPTED 또는 REJECTED를 HTTP로 실행 가능. 취소와 READY 이후 COMPLETED는 DB 함수로 처리 가능하며 취소·완료 HTTP 경로는 없다. 같은 완료 호출의 완료 시각·버전·조리 자리 해제 시각 유지가 DB 테스트로 확인된다.
- 조리. UNSCHEDULED → SCHEDULED → COOKING → READY. 현재 SQL의 LOCK은 COOKING/READY에서의 재예약 차단이다. 계산 함수가 받는 LOCKED는 독립 DB 상태가 아니다. ETA를 받는 외부 갱신 경로는 없다.
- 픽업 공간. UNRESERVED → RESERVED → IN_USE → RELEASED는 [계약안](../../api/order-pickup-contract.md)이다. 도착 상태만으로 입장·인도 완료가 자동 확정되지 않는다. 주방 수용량은 차량 공간 수용량과 별개다.
- [11월 7일 화면 증거](../2026-11-07/demo/report.md)는 한 주문의 PENDING → ACCEPTED와 MOCK ETA를 확인했다. 이번 점검의 새 화면 시연으로 집계하지 않는다.

## 실행 결과

| 명령 | 결과 |
|---|---|
| `npm run build` | 통과. [로그](build.log) |
| `npm run typecheck` | 통과. [로그](typecheck.log) |
| `npm test` | API·계산 25건, DB 9건 통과. [로그](test.log) |
| `npm run test:smoke` | Next.js → NestJS health 및 API 중단 응답 확인. [로그](test-smoke.log) |
| `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --offline --rerun-tasks :automotive:assembleDebug :mobile:assembleDebug :automotive:testDebugUnitTest :mobile:testDebugUnitTest` | 통과. 99개 작업 실행. 양쪽 단위 테스트는 샘플이며 주문 UI 자동 테스트는 없음. [로그](android.log) |

Node.js v26.8.1, npm 11.19.0을 사용했다. 로컬 저장소는 읽을 수 있었고 웹·서버·Android 빌드 실패는 없었다. Android Gradle 사용 중 향후 Gradle 10 호환 관련 사용 중단 경고가 발생했다. Android 기기 계측 샘플 테스트는 실행하지 않았다.

## 다음 작업의 장애

1. 물리적 픽업 공간·점유 저장과 수락 트랜잭션 통합이 필요하다. 공간당 예약 및 초과 체류를 모델링하고 실제 PostgreSQL의 독립 세션에서 중복 배정을 검증한다.
2. 조리 시작·준비·차량 입장·인도 완료 API 및 UI가 필요하다. 기존 DB 함수를 재사용하고 요청 키·버전·권한·중복 완료를 전체 흐름에서 확인한다.
3. ETA 갱신 이벤트와 LOCK 전후 재계획 정책을 연결해야 한다. 앱의 네트워크 장애·복구와 거절/취소 상태 표시를 자동화할 테스트가 없다.
4. 실연동 시연에는 설치 버전과 일치하는 SDK 의존성·권한 및 실제 콜백 검증이 필요하다.

## 에뮬레이터 재현

설치된 Android SDK에서 다음 명령을 사용했다. 이번 실행에서 기기 serial은 emulator-5560이었다.

```sh
SDK="$HOME/Library/Android/sdk"
"$SDK/emulator/emulator" -accel-check
"$SDK/emulator/emulator" -avd Pleos_Connect_v2.1.0 -port 5560 -read-only -no-snapshot -no-window -no-audio
# 다른 터미널에서 부팅 완료 후
"$SDK/platform-tools/adb" -s emulator-5560 shell getprop sys.boot_completed
"$SDK/platform-tools/adb" -s emulator-5560 shell pm list packages
"$SDK/platform-tools/adb" -s emulator-5560 install -r automotive/build/outputs/apk/debug/automotive-debug.apk
```

부팅 완료 값 1, 내비 서비스·앱 패키지, APK 설치 Success를 확인했다. 새 화면 시연이나 SDK 콜백은 실행하지 않았다. [로그](emulator.log)

## 동일 작업 트리 재점검

`npm run build`, `npm run typecheck`, `npm test`, `npm run test:smoke`를 다시 실행해 모두 종료 코드 0을 확인했다. API·계산 25건과 DB 9건이 통과했다. Android는 위 Gradle 명령에서 `--rerun-tasks`를 빼고 다시 확인했으며 99개 작업이 최신 상태로 판정됐다. 에뮬레이터 설치는 위 최초 점검 증거를 참조한다. 기능 소스 변경 없이 재점검 로그만 추가했다. [웹 빌드](recheck/build.log) · [타입 검사](recheck/typecheck.log) · [회귀](recheck/test.log) · [스모크](recheck/test-smoke.log) · [Android](recheck/android.log)
