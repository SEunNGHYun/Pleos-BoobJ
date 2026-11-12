# 11월 7일 밥맞J 통합 점검

기준은 11월 7일 작업 시작 시점의 main이다. 루트 README, 식당 웹 AGENTS.md, Supabase README, API 계약, SDK 점검 기록과 소스·테스트를 대조했다. 이번 작업은 검증과 문서 기록으로 범위를 잡았다.

| 영역 | 판정 | 근거 |
|---|---|---|
| DB 기본 스키마 | 구현 | `supabase/migrations/`의 식당·사용자·차량·메뉴·복수 픽업 위치·주문·조리 예약·접수 이력. PGlite에서 제약, 스냅샷, RLS 검증 |
| 호스팅 Supabase/Auth 및 독립 DB 세션 경쟁 | 미검증 | 로컬 테스트는 PGlite와 개발 인증을 사용. 운영 DB 적용 및 동시 세션 충돌 검증 필요 |
| 주문 생성·조회·식당 접수 | 구현 | `server/src/pickup/pickup.controller.ts`, `pickup.service.ts`. 등록·메뉴/위치 조회·주문 생성/조회·식당 목록·수락/거절. 요청 키 재시도와 식당 권한 검증 |
| 메뉴별 안내 조리시간 | 미구현 | 메뉴 스키마·공통 계약에 기본 조리시간 없음. 식당이 수락 시 입력하는 실제 예상 조리시간은 구현 |
| 식당 웹 | 부분 구현 | `restaurant-web/src/app/page.tsx`와 health 연결. 주문 목록/접수/입장/인도 UI 미구현 |
| Kotlin 차량 앱 | 부분 구현 | `shared/src/main/java/com/example/delivery/shared/MyCarAppScreen.kt`는 기본 화면. 메뉴·주문·ETA·픽업 상태 연결 미구현 |
| ETA 기반 조리 일정·LOCK | 부분 구현 | `20261104000200_reservations.sql`의 예약·시작·준비 완료·종료 함수. 수락 API는 MOCK ETA로 예약. 변경 ETA 수신·자동 재계산·실제 시작/완료 HTTP 경로 없음 |
| 픽업 공간 예약·다중 차량 충돌 방지 | 미구현 | 픽업 위치와 주문 스냅샷은 저장. 공간 재고, 시간 구간, 실제 점유, 예약 경쟁 제어 없음. 수락 응답은 NOT_IMPLEMENTED |
| SDK 코드 연동 | 미구현 | 로컬 캐시에서 NaviHelper/navi-data/navi-aidl 확인. 프로젝트 의존성·호출부 없음 |
| SDK 실차/에뮬레이터 호출 | 미검증 | [기존 SDK 근거](../../sdk/2026-11-05-pleos-weekend-readiness.md). 좌표 경로 requestRoute, ETA 후보 requestTrip/DrivingState, 도착 onDestinationArrived의 공개 표면과 런타임 결과를 구분. 접근 임계값 알림은 MOCK 정책 후보 |

## 최소 통합 흐름

| 단계 | 현재 동작 | 통합 계약 |
|---|---|---|
| 생성 | 사용자 POST /api/orders. 식당·메뉴·수량·픽업 위치·차량번호·연락처·요청 키. PENDING / UNSCHEDULED / UNKNOWN 반환. ETA 입력은 확장안 | ETA가 없어도 접수 대기 가능 |
| 접수 및 공간 확정 | 소속 식당 POST /api/orders/:id/accept. 버전·요청 키·조리시간·MOCK ETA. ACCEPTED / SCHEDULED와 조리 예약만 저장 | 수락·픽업 공간 RESERVED·조리 일정 원자적 확정. 공간 충돌 시 409, 기존 주문 보존, 대안은 제안으로 표시 |
| 조리 시작 및 준비 | DB 함수로 COOKING → READY. HTTP 미연결 | 시작에서 LOCK, 이후 ETA 변경에도 시작 시각 보존. READY에서 조리 자리 반환 |
| 차량 도착·입장 | 상태 enum만 존재 | 차량 ARRIVED와 식당의 입장 확인을 분리. 실제 공간 점유 확인 후 RESERVED → IN_USE |
| 인도 완료 | DB 함수는 READY 이후 COMPLETED를 허용. 공간/HTTP 미연결 | 식당이 READY 및 IN_USE를 확인해 COMPLETED + RELEASED를 한 트랜잭션에 반영 |

상세 오류·재시도·상태 규칙은 [최소 계약](../../api/order-pickup-contract.md) 및 [현재 접수 API](../../api/restaurant-receipt.md)에 있다. 기존 조리 SQL은 시작 후보를 max(현재, ETA − 식당 입력 시간 − 여유시간)으로 잡고 수용량에 따라 뒤로 이동한다. 계획 종료가 원 ETA보다 늦어질 수 있어 확정 픽업 시간은 별도 조율이 필요하다. `max_concurrent_orders`는 주방 수용량이다.

ETA 변경 계약은 observedAt으로 역순/동일 시각 충돌을 판별한다. LOCK 전에는 공간과 조리 계획을 함께 검증하고 실패하면 기존 예약을 보존한다. LOCK 후에는 조리 계획을 보존하고 실제 점유 상태도 ETA로 바꾸지 않는다. 공간 사용 시간이 지났더라도 실제 점유 중에는 다음 차량 입장을 제한한다. 하차 없는 픽업을 위해 지정 진입/대기 위치 및 직원의 입장·인도·자리 반환 확인이 필요하다.

## 실행 결과와 재현

- `npm test` API 16건, DB 8건 통과. 정상 생성과 저장, 없는 메뉴, 0/음수/빈 수량, 타 식당 위치, 중복 요청 및 본문 충돌, 권한, ETA 누락/오류, 예약 실패 롤백, 인접 구간 경계, LOCK/초과 점유, 시작 지연 시 재배정 확인. [로그](npm-test.log)
- `npm run build`, `npm run typecheck`, `npm run test:smoke` 성공. 웹 페이지와 NestJS health 연결, API 중단 응답 검증. [빌드](npm-build.log) · [타입](npm-typecheck.log) · [스모크](npm-smoke.log)
- Android Studio JBR을 JAVA_HOME으로 지정한 뒤 `./gradlew --offline :mobile:assembleDebug :automotive:assembleDebug :mobile:testDebugUnitTest :automotive:testDebugUnitTest` 성공. 99개 작업이 UP-TO-DATE였고 양쪽 단위 테스트는 샘플이다. [로그](android.log)
- 제한된 실행 환경에서 SDK의 `platform-tools/adb devices` 실행 시 `ADB server didn't ACK`, `could not install *smartsocket* listener: Operation not permitted`. 로컬 기기 통신 권한이 있는 환경에서 다시 실행한다.

## 다음 Codex 구현 순서

1. 공간 모델과 운영 규칙 확정. 지정 공간·입장/대기 조건·점유 구간·초과 체류·수동 해제 정책을 계약으로 고정한다. 기존 수락 트랜잭션과 조리 예약 함수를 재사용하고, 동일 공간에 대한 독립 DB 세션 경쟁·인접 구간·롤백을 검증한다.
2. 조리 시작/준비 완료와 차량 입장/인도 API를 연결한다. 기존 함수와 버전·요청 키 규칙을 활용한다. ETA 갱신에서 역순·재전송·LOCK 후 변경·재예약 실패를 확인한다.
3. 메뉴별 기본 조리시간을 저장·조회하고 주문 전 한 주문 내 최댓값 + 안내 여유(10분안)를 표시한다. 식당 입력 조리시간은 일정 계산에 사용한다.
4. 식당 웹과 차량 앱을 기존 API에 연결하고 MOCK ETA로 생성부터 인도까지 검증한다. SDK 경로/ETA/도착 콜백 검증은 실제 의존성·권한을 공식 지침과 대조해 별도로 실행한다.

## 에뮬레이터 재실행

기기 통신이 허용된 환경에서 Pleos Connect v2.1.0 부팅, 내비 서비스 패키지 확인, 차량 APK 설치에 성공했다. 앱 화면 렌더링과 내비 SDK 호출은 미검증이다. [로그와 재현 명령](emulator.log)
