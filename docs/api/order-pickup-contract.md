# 밥맞J 최소 주문·픽업 계약 v0.1

작성일: 2026-11-05. 상태: **설계 초안, 구현 완료 명세 아님**.
대상 흐름: 차량 앱 → NestJS 중앙 서버 → Next.js 식당 웹.

## 1. 현재 구현과 계약 확장 구분
기존 주문 API는 restaurantId/items/pickupLocationId/vehiclePlate/contactPhone/requestKey를 받고 주문·항목·위치 스냅샷과 초기 상태를 저장한다. ETA 입력, 물리적 공간 예약 및 아래 accept/eta/공간 전이 API는 아직 없다. 기존 Zod 입력은 strict이므로 지금 서버에 eta를 보내면 400이다.

확인 근거:
- server/src/pickup/input.ts, pickup.controller.ts, pickup.service.ts
- contracts/src/index.ts
- supabase/migrations/20261104000100_core.sql, 20261104000200_reservations.sql, 20261104000300_menu_order_api.sql

이 문서는 향후 구현할 계약이다. 코드·DB 스키마·SDK를 변경하거나 실행 테스트를 추가하지 않았다.

## 2. 공통 원칙
- 서버가 주문·공간·조리의 기준 상태를 보관한다. 앱/웹은 상태를 임의 변경하지 않고 동작 요청을 보낸다.
- 사용자 ID는 인증에서 결정한다. 점주는 식당 소속 권한이 필요하다. 현재 개발 bearer 인증과 향후 Supabase 인증은 구분한다.
- UUID와 ISO 8601 시간대 포함 시각을 사용한다. 저장/전송은 UTC, 화면 표시만 한국시간으로 변환한다.
- 메뉴와 픽업 위치는 같은 식당에 속하고 주문 시 판매/사용 가능해야 한다. 이름·가격·선택 위치 주소/좌표/안내는 주문 당시 값으로 보존한다.
- 공간 예약은 주차/픽업 자리이며 주방의 max_concurrent_orders와 다르다. cooking_reservations를 공간 예약으로 사용하지 않는다.
- 공간 점유는 [startAt, endAt) 구간으로 계산한다. 장소별 실제 capacity와 점유시간 정책이 설정되지 않으면 가용성을 UNKNOWN으로 반환한다.
- 안내용 기본 조리시간과 식당 확정 조리시간을 구분한다. 안내값을 실제 조리 예약에 자동 대입하지 않는다.

## 3. 주문 생성 요청 — POST /api/orders (확장안)
Authorization: Bearer <사용자 토큰>, Content-Type: application/json.

```json
{
  "restaurantId": "11111111-1111-4111-8111-111111111111",
  "items": [{"menuId":"22222222-2222-4222-8222-222222222222","quantity":2}],
  "pickupLocationId": "33333333-3333-4333-8333-333333333333",
  "vehiclePlate": "12가3456",
  "contactPhone": "+821012345678",
  "requestKey": "44444444-4444-4444-8444-444444444444",
  "eta": {
    "source": "MOCK",
    "arrivalAt": "2026-11-05T10:30:00Z",
    "observedAt": "2026-11-05T10:00:00Z"
  }
}
```

- items는 비어 있을 수 없고 각 quantity는 1~100 정수, 항목은 최대 100개다. 같은 메뉴는 항목 중복 대신 수량으로 합친다. 기존 검증 범위를 재사용한다.
- vehiclePlate/contactPhone은 기존 필수 입력을 유지한다. 연락처는 +국가번호 형식이다.
- eta.source는 VEHICLE 또는 MOCK. MOCK은 시연/개발에서 명시적으로 활성화한 경우만 허용하고 실제 SDK ETA로 표시하지 않는다.
- 차량 ETA는 **선택한 픽업 위치**까지의 도착 시각이다. observedAt은 측정 시각으로, 서버가 보낸 시간을 측정 시각으로 위장하지 않는다.
- 정상 흐름에는 ETA가 필요하다. 다만 연결 지연을 고려해 eta:null 또는 생략 시 주문을 PENDING으로 저장하고 ETA_MISSING을 반환한다. 이는 누락을 허용하는 명시적 예외이며 예약/시간 확정은 수행하지 않는다.
- 잘못된 날짜·시간대 없는 시각·미허용 source는 400. 오래된 ETA의 기준은 설정된 maxEtaAgeSeconds로 판단하고 없으면 ETA 검증 정책 미설정으로 시간 확정을 중단한다. 임의 기준 초를 하드코딩하지 않는다.
- 메뉴 기본 조리시간/10분 여유시간은 이번 요청 입력이 아니다. 서버 설정·메뉴 데이터로 조회해야 한다.

## 4. 공통 주문 계획 응답
POST 생성(201), GET /api/orders/:id(200), 수락/ETA 갱신 성공(200)은 아래 계획 객체를 포함한다. 기존 응답의 상세 필드는 유지할 수 있다.

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "orderStatus": "PENDING",
  "version": 0,
  "eta": {"source":"MOCK","arrivalAt":"2026-11-05T10:30:00Z","observedAt":"2026-11-05T10:00:00Z"},
  "pickup": {
    "locationId":"33333333-3333-4333-8333-333333333333",
    "availability":"AVAILABLE",
    "reservationStatus":"UNRESERVED",
    "reservationId":null,
    "timeStatus":"PROPOSED",
    "window":{"startAt":"2026-11-05T10:30:00Z","endAt":"2026-11-05T10:35:00Z"},
    "checkedAt":"2026-11-05T10:00:01Z",
    "matchesLatestEta":true
  },
  "cooking": {
    "status":"UNSCHEDULED",
    "acceptedDurationMinutes":null,
    "scheduledStartAt":null,
    "reason":"AWAITING_RESTAURANT_ACCEPTANCE"
  },
  "issues":[]
}
```

위 5분 구간은 해당 장소의 점유시간 정책이 5분으로 설정된 설명용 예시다. 공통 기본값을 확정한 것이 아니다.

- availability: AVAILABLE / UNAVAILABLE / UNKNOWN. 현재 검사한 구간의 가용성이며 공간 확보를 의미하지 않는다.
- reservationStatus: UNRESERVED / RESERVED / IN_USE / RELEASED.
- timeStatus: NONE / PROPOSED / CONFIRMED. NONE이면 window=null. CONFIRMED는 음식 준비 가능성과 공간 확보가 모두 확인된 경우만 사용한다.
- 제안은 공간을 선점하지 않는다. 수락 시 반드시 다시 검사한다. checkedAt은 가용성 검사 시각이다.
- cooking.scheduledStartAt은 식당 확정 조리시간·유효한 ETA/픽업 시각·조리 수용량 검사가 모두 가능할 때만 반환한다. 아니면 null과 reason을 반환한다.
- issues는 {code,message} 배열이다. null을 0분이나 현재 시각으로 대체하지 않는다.

## 5. 최소 흐름과 API 제안
| API | 호출 주체와 입력 | 결과 |
|---|---|---|
| POST /api/orders | 사용자: 메뉴·수량·위치·ETA | PENDING. 공간 시간은 제안만, 조리는 UNSCHEDULED |
| GET /api/restaurants/:id/orders?status=PENDING | 소속 식당 | 자사 주문·차량·연락처·픽업 장소·ETA 조회. 페이지 구분/건수 제한 필요 |
| POST /api/orders/:id/accept | 소속 식당: acceptedCookDurationMinutes, expectedVersion, requestKey | 수락·조리 예약·픽업 공간 예약을 한 트랜잭션으로 확정 |
| POST /api/orders/:id/reject | 소속 식당: expectedVersion, requestKey, reason | PENDING만 REJECTED, 보유 자원 해제 |
| POST /api/orders/:id/eta | 주문 사용자/인증된 차량: eta, expectedVersion, requestKey | 최신 ETA 갱신 및 아래 재계산 규칙 적용 |
| POST /api/orders/:id/cooking/start | 소속 식당: expectedVersion, requestKey | 실제 조리 수 검사 후 COOKING/LOCK |
| POST /api/orders/:id/cooking/ready | 소속 식당: expectedVersion, requestKey | READY, 조리 자리만 반환 |
| POST /api/orders/:id/pickup/start | 소속 식당: expectedVersion, requestKey | 실제 입장·공간 수용량 확인 후 IN_USE |
| POST /api/orders/:id/complete | 소속 식당: expectedVersion, requestKey | READY와 IN_USE 확인 후 COMPLETED + RELEASED |
| GET /api/orders/:id | 주문 사용자 또는 소속 식당 | 최신 상태·계획 조회. 최초 동기화 방식은 주기적 조회 |

ETA·식당 확정 조리시간·공간 정책이 부족하면 수락 확정을 보류한다. 기존 DB 제약과 맞지 않는 ‘수락만 먼저 확정’ 경로는 추가하지 않는다.
공간 확보 실패 시 409와 대체 구간을 제시하며 주문은 PENDING을 유지한다. 사용자 동의 없이 다른 픽업 시각을 확정하지 않는다. 대체 시각에 대한 사용자 확인 방식은 아래 미확정 사항으로 남긴다.

### 수락 성공 응답 예
식당 입력 조리시간 20분, 예약용 준비 여유 0분, 픽업 구간 10:30~10:35Z, 수용량 검사를 모두 통과한 예다. 수락 시각은 10:10Z 이전이라고 가정한다.
```json
{
  "id":"55555555-5555-4555-8555-555555555555",
  "orderStatus":"ACCEPTED",
  "version":1,
  "eta":{"source":"MOCK","arrivalAt":"2026-11-05T10:30:00Z","observedAt":"2026-11-05T10:00:00Z"},
  "pickup":{"locationId":"33333333-3333-4333-8333-333333333333","availability":"AVAILABLE","reservationStatus":"RESERVED","reservationId":"66666666-6666-4666-8666-666666666666","timeStatus":"CONFIRMED","window":{"startAt":"2026-11-05T10:30:00Z","endAt":"2026-11-05T10:35:00Z"},"checkedAt":"2026-11-05T10:01:00Z","matchesLatestEta":true},
  "cooking":{"status":"SCHEDULED","acceptedDurationMinutes":20,"scheduledStartAt":"2026-11-05T10:10:00Z","reason":null},
  "issues":[]
}
```

## 6. 상태 전이
### 주문 — 기존 enum 유지
생성 성공 → PENDING(접수 대기) → ACCEPTED(접수 완료) → COMPLETED.
PENDING → REJECTED, PENDING 또는 조리 시작 전 ACCEPTED → CANCELLED.
‘생성’은 이벤트다. 별도 CREATED 상태를 추가하지 않는다.

### 픽업 공간 — 신규 독립 상태 제안
UNRESERVED → RESERVED(구간·수용량 확보) → IN_USE(실제 입장 확인) → RELEASED(음식 인도·자리 반환 확인).
RESERVED → RELEASED(사용 전 취소 또는 확인된 만료)도 가능하다. 해제된 예약은 이력으로 남기고 재확보 시 새 예약 ID를 발급한다.
시간이 지났다는 이유만으로 IN_USE를 자동 해제하지 않는다. 실제 점유가 이어지면 후속 입장을 제한하고 식당에 대응을 요청한다.

### 조리 — 기존 enum 유지
UNSCHEDULED → SCHEDULED → COOKING → READY.
COOKING/READY는 LOCK 상태이며 ETA 변경으로 SCHEDULED로 되돌리지 않는다.
READY는 조리 자리 반환이지 픽업 공간 반환이 아니다.

### 차량 — 기존 상태 유지
UNKNOWN / EN_ROUTE / NEARBY / ARRIVED. ARRIVED 통지만으로 공간 IN_USE나 주문 COMPLETED를 자동 확정하지 않는다.

종료 주문은 자동 예약 계산과 접근 알림을 중단한다. 취소는 조리 시작 전이며 공간도 IN_USE 이전인 경우로 제한하는 안이다. 공간 사용 중 강제 중단은 식당 확인 절차가 별도로 필요하다.

## 7. 조리시간 정책
- 주문 전 안내: 한 주문 안에서 병렬 조리를 가정해 max(선택 메뉴 기본 시간)+안내 여유시간(10분안). 수량으로 단순 곱하거나 메뉴 시간을 합산하지 않는다. 메뉴 시간 저장/조회는 아직 미구현이다.
- 실제 예약: 식당이 수락 시 입력하는 acceptedCookDurationMinutes를 사용한다. 사용자 안내값을 자동 확정값으로 사용하지 않는다.
- 시작 후보: 확정 픽업 구간 시작 − 식당 입력 조리시간 − 예약용 준비 여유시간.
- 안내용 10분과 예약용 준비 여유시간은 별개다. 묵시적으로 이중 가산하지 않는다.
- 후보가 과거이거나 조리 자리·픽업 공간이 부족하면 가능한 대체 시각을 제안한다. 단순히 시작을 현재로 당긴 뒤 원래 픽업 시각을 보장하지 않는다.
- 정책이 미확정이면 scheduledStartAt=null, reason=COOK_POLICY_UNDEFINED. 임의의 조리시간으로 예약을 확정하지 않는다.

## 8. ETA 누락·변경
- 누락 생성: 201 PENDING, eta=null. pickup은 UNKNOWN/UNRESERVED/NONE, window=null. 조리는 UNSCHEDULED/scheduledStartAt=null. issues에 ETA_MISSING. 이후 ETA 추가 가능.
- 새 샘플은 observedAt으로 순서를 판정한다. 역순은 409 STALE_ETA. 동일 시각·동일 샘플은 재전송, 같은 시각인데 내용이 다르면 409 ETA_SAMPLE_CONFLICT.
- LOCK 전: 새 ETA에 따른 조리·공간 계획을 한 트랜잭션으로 변경할 수 있는지 검사한다.
- 재계획 실패: ETA 관측 자체는 200으로 저장하되 기존 예약을 보존한다. pickup.matchesLatestEta=false와 PICKUP_REPLAN_CONFLICT를 반환한다. pickup은 기존 확보 구간의 정보이며 새 후보 결과는 별도 candidatePickup에 동일 구조로 반환한다. 기존 구간을 새 ETA에 맞는 확정 시간으로 오인하게 표시하지 않는다.
- 기존 예약이 없다면 UNRESERVED/NONE을 유지하고 후보만 제시한다. 사용자 확인이 필요한 변경은 자동 확정하지 않는다.
- LOCK 후: ETA와 접근 표시는 갱신하지만 조리 상태·시작 시각은 유지한다. 공간 변경은 별도 수용량 검사와 확인이 필요하다.
- IN_USE 이후: ETA 변경으로 실제 점유를 옮기거나 해제하지 않는다.

## 9. 오류 응답과 저장 규칙
공통 오류 응답 제안:
```json
{
  "error": {
    "code":"PICKUP_RESERVATION_CONFLICT",
    "message":"선택한 픽업 시간에 공간이 없습니다. 다른 시간을 확인해주세요.",
    "retryable":true,
    "orderId":"55555555-5555-4555-8555-555555555555",
    "currentVersion":0,
    "suggestedPickupWindow":{"startAt":"2026-11-05T10:40:00Z","endAt":"2026-11-05T10:45:00Z"}
  }
}
```
식별자·현재 버전·대체 구간은 상황에 맞게 제공하며 대체 구간이 없으면 null이다. 내부 SQL 오류·인증 정보는 노출하지 않는다.

| 상황 | 응답 | 저장 규칙 |
|---|---|---|
| 잘못된 JSON·UUID·수량·빈 항목 | 400 VALIDATION_ERROR | 주문·항목·예약 생성 없음 |
| 메뉴 없음·다른 식당·판매 중지 | 400 MENU_UNAVAILABLE | 동일, 기존 400 방침 유지 |
| 장소 없음·다른 식당·비활성 | 400 PICKUP_LOCATION_UNAVAILABLE | 동일 |
| 식당 없음 | 404 RESTAURANT_NOT_FOUND | 동일 |
| 공간 확보 충돌(수락 시) | 409 PICKUP_RESERVATION_CONFLICT | 수락·조리 예약·공간 확보 모두 롤백, 후보 제시 |
| 이전 버전으로 변경 | 409 VERSION_CONFLICT | 최신 조회 필요, 상태 변경 없음 |
| ETA 누락(생성) | 201 + issues: ETA_MISSING | 주문만 저장, 시간/공간 미확정 |
| 오래되거나 역순인 ETA | 409 STALE_ETA | 기존 값 유지 |
| ETA·조리·공간 정책 부족(수락 시) | 422 ETA_REQUIRED / COOK_POLICY_UNDEFINED / SPACE_POLICY_UNDEFINED | 수락·예약 보류 |
| 같은 사용자·키·정규화 본문 | 201, 기존 주문 ID | 중복 생성 없음. 기존 응답 정책 유지 |
| 같은 키·다른 본문 | 409 IDEMPOTENCY_CONFLICT | 기존 주문 유지. ETA만 달라도 전용 갱신 경로 사용 |
| 인증 없음·잘못된 인증 | 401 UNAUTHENTICATED | 업무 데이터 반환 없음 |
| 타인 주문·타 식당의 변경 요청 | 404 ORDER_NOT_FOUND | 존재 여부 노출 방지 |
| DB/API 사용 불가 | 503 SERVICE_UNAVAILABLE | 확정된 것처럼 표시하지 않음 |

생성 시 공간 혼잡은 201 PENDING을 허용한다. 희망 ETA에 대한 availability=UNAVAILABLE/timeStatus=NONE/window=null과 이슈를 반환하고, 가능한 대체 구간은 candidatePickup에 PROPOSED로 분리해 제공한다. 생성 단계는 공간 확보가 아니므로 수락 단계의 409와 구분한다. window=null인 UNAVAILABLE은 최신 ETA에서 파생한 희망 구간을 확보할 수 없다는 의미다.

### 미확정 정책 응답 예
```json
{
  "id":"55555555-5555-4555-8555-555555555555",
  "orderStatus":"PENDING",
  "version":0,
  "eta":null,
  "pickup":{"locationId":"33333333-3333-4333-8333-333333333333","availability":"UNKNOWN","reservationStatus":"UNRESERVED","reservationId":null,"timeStatus":"NONE","window":null,"checkedAt":null,"matchesLatestEta":false},
  "cooking":{"status":"UNSCHEDULED","acceptedDurationMinutes":null,"scheduledStartAt":null,"reason":"COOK_POLICY_UNDEFINED"},
  "issues":[{"code":"ETA_MISSING","message":"도착 예정 시각이 필요합니다."},{"code":"SPACE_POLICY_UNDEFINED","message":"픽업 공간 정책을 확인해야 합니다."},{"code":"COOK_POLICY_UNDEFINED","message":"조리시간 정책을 확인해야 합니다."}]
}
```

## 10. 원자성·재전송
- 생성 requestKey는 사용자 단위 UNIQUE. 동일 키 검사와 주문 저장은 DB 안에서 원자 처리한다.
- 변경 API의 requestKey는 (인증 주체, 주문 ID, 동작 종류, 키) 범위로 식별한다. 동일 정규화 본문의 재전송은 기존 결과를 반환하고, 다른 본문은 409. 재전송 확인은 expectedVersion 충돌 검사보다 먼저 한다.
- 새 변경 요청의 expectedVersion 검사와 버전 증가는 DB 안에서 수행한다. 단순 메모리 잠금으로 대체하지 않는다.
- 수락 시 권한→상태/버전→정책→조리/공간 수용량→저장을 같은 트랜잭션에서 처리한다. 부분적인 ACCEPTED/RESERVED를 남기지 않는다.
- 실제 입장 시 현재 점유를 재검사한다. 예정 종료가 지난 IN_USE를 빈자리로 세지 않는다.

## 11. 계약 수용 시나리오 및 미확정 사항
향후 구현 검증 조건: 정상 생성→수락→조리→입장→인도, 메뉴/장소 오류, 공간 충돌·검사 후 동시 경쟁, ETA 누락·역순·LOCK 후 변경, 중복 재전송·변경 본문, 정책 미정, 공간 점유 초과, 버전 충돌·타 식당 접근.
이 목록은 계약의 수용 조건이며 아직 실행한 테스트가 아니다.

구현 전에 확정할 항목:
1. 장소별 공간 수·점유시간·영업시간·미도착 유예시간과 공간 예약 스키마. 현재 DB에는 없다.
2. 대체 픽업 시각에 대한 사용자 확인 API·허용 변경 폭. 결정 전에는 제안만 제공한다.
3. ETA 유효기간·실제 SDK 데이터 공급 방식·모의 ETA 활성화 설정.
4. 안내용 10분의 최종값/식당별 설정, 예약 준비 여유시간과 제안 탐색 범위.
5. 공간 사용 중 강제 종료 및 예외 취소 권한.

정책이 미확정이어도 주문을 PENDING으로 저장할 수 있지만, 예약 가능 여부나 확정 시간을 추측하지 않는다.
