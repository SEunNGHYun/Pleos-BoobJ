# 식당 접수 API

범위: 기존 로컬 NestJS API와 DB 조리 예약 함수를 연결한다. ETA는 MOCK 입력이며 픽업 공간 예약은 식당이 관리한다고 가정한 위치의 소프트웨어 배정이다. [식당 웹과 차량 앱 시연](two-screen-demo.md)에서 기존 API를 사용한다.

## 실행·인증
루트 `npm run local:setup` 후 `npm run dev:server`. 이미 서버가 DB를 사용하는 중이면 setup 전에 서버를 종료한다. 기존 DB 데이터/이력은 유지하고 새 마이그레이션은 서버 시작 시 적용한다.
점주·직원 토큰을 Authorization: Bearer 헤더로 보낸다. 자신의 식당 소속이 아닌 주문은 404, 인증 실패는 401, DB 미설정은 503이다. 현재 개발 토큰은 production용 인증이 아니다.

## 1. 접수 대기 목록
`GET /api/restaurants/{restaurantId}/orders?status=PENDING&limit=20&offset=0`

상태 생략 시 전체 상태. limit=1~100(기본20), offset=0~100000(기본0). 응답은 `{items,total,limit,offset}`이다. 각 항목에 기존 주문 상세와 version, 확정 조리시간, 조리 예약, ETA 출처를 포함한다. 최신 생성 시각 및 ID 내림차순으로 정렬한다.

## 2. 주문 수락
`POST /api/orders/{orderId}/accept`

```json
{
  "acceptedCookDurationMinutes": 20,
  "preparationBufferMinutes": 0,
  "expectedVersion": 0,
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "eta": {
    "source": "MOCK",
    "arrivalAt": "2026-11-05T11:00:00Z",
    "observedAt": "2026-11-05T10:00:00Z"
  }
}
```

시각과 UUID는 실제 요청에 맞게 바꾼다. observedAt은 요청 시점 5분 이내여야 하며 미래 허용 오차는 30초다. arrivalAt은 observedAt보다 빠르면 안 된다. **이 값은 실차 ETA가 아니라 명시적인 모의 입력**이다. VEHICLE 등 미검증 source는 400으로 거절한다. 추후 차량 ETA 수신 API가 생기면 주문 저장 ETA를 사용하도록 별도 확장한다.

- PENDING만 수락 가능. 양수 조리시간(1~240분) 필수. 메뉴 안내 추정값 대신 식당 입력을 사용한다.
- 준비 여유시간은 0~120분, 기본0. 안내용 ‘최장 메뉴+10분’과 별개다.
- eta 필드 누락은 422 ETA_REQUIRED, 오래되거나 잘못된 관측 시각은 422 INVALID_ETA. 시간 형식·범위·미정의 필드 오류는 400이다.
- 식당 단위 DB 잠금 후 권한·요청 재송신·현재 버전·상태를 확인하고 기존 reserve_cooking을 호출한다.
- 수락과 조리 예약, 처리 이력은 한 트랜잭션이다. 예약 실패면 모두 롤백한다.
- 식당의 max_concurrent_orders에 따라 가능한 시간대에 배정한다. 기존 함수의 7일 범위에서 배정 불가하면 409. 이 경우 주문은 PENDING 유지다.
- 수락은 ACCEPTED/SCHEDULED로 바뀌며 version이 증가한다. 새 요청 키로 재수락은 409다. 조리 예약 수정 API로 사용하지 않는다.

200 응답은 기존 주문 상세에 다음을 포함한다.

```json
{
  "id":"<주문 UUID>",
  "orderStatus":"ACCEPTED",
  "cookingStatus":"SCHEDULED",
  "version":1,
  "acceptedCookDurationMinutes":20,
  "eta":{"source":"MOCK","arrivalAt":"<요청 시각>","observedAt":"<관측 시각>"},
  "cookingReservation":{"id":"<예약 UUID>","plannedStartAt":"<배정 시각>","plannedEndAt":"<배정 완료 시각>"},
  "pickupSpaceReservationStatus":"RESERVED",
  "pickupSpaceReservation":{"spaceNumber":1,"startAt":"<확정 시작>","endAt":"<확정 종료>"}
}
```

픽업 위치별 `spaceCapacity`와 `handoffMinutes` 기본값은 1과 3이다. 수락은 주방 일정, 공간 구간, 접수 이력을 같은 트랜잭션에 저장한다. 구간은 시작 포함·종료 제외다.

요청 시각을 사용할 수 없으면 409와 `code`, `availableAtEta: false`, `alternativePickupAt`을 반환한다. `PICKUP_CONFLICT`는 공간 충돌, `SPACE_OCCUPIED`는 실제 점유가 이어져 대안을 정할 수 없는 경우, `COOKING_CAPACITY`는 해당 시각까지 조리 일정이 맞지 않는 경우다. 대안은 다시 확인할 후보이며 주문은 PENDING 상태로 유지된다.

입장은 내부 DB 함수로 예약 시간 안에만 허용한다. OCCUPIED는 시간이 지나도 인도 완료 전까지 차단하며, 예약 취소나 인도 완료 시 RELEASED를 저장한다. 기존 예약 없는 접수 건은 UNRESERVED로 조회되고 과거 요청 키의 재전송은 당시 응답을 반환한다.

## 3. 주문 거절
`POST /api/orders/{orderId}/reject`

```json
{"expectedVersion":0,"requestKey":"22222222-2222-4222-8222-222222222222","reason":"재료 소진"}
```

PENDING만 허용한다. reason은 공백 제외 1~500자. 200 REJECTED 및 증가한 version, rejectionReason을 반환한다. 고객 주문 상세와 식당 목록에서도 거절 사유를 조회할 수 있다. 이미 수락/종료한 주문에 새 거절 요청은 409다.

## 재시도·권한·저장 규칙
- actor/order/action/requestKey 범위로 영속 처리 이력을 기록한다. action은 ACCEPT/REJECT다.
- 같은 키·정규화 본문 재송신은 최초 저장한 200 응답을 반환한다. 이후 상태가 달라졌더라도 응답은 최초 스냅샷이므로 최신 상태는 GET으로 조회한다.
- 같은 키의 다른 본문은 409. 재송신은 버전 검사보다 먼저 판단하지만 현재 식당 소속 검사는 항상 먼저 수행한다.
- 새로운 요청은 expectedVersion이 다르면 409. 같은 주문의 동시 수락은 한 요청만 성공하고 다른 새 키 요청은 충돌한다.
- DB 이력에는 정규화 요청(거절 사유/모의 ETA)과 최초 응답을 저장한다. 공개 클라이언트에는 직접 테이블 접근을 허용하지 않는다.
- 새 테이블 restaurant_order_actions는 접수 작업 중복 방지/사유 보존용이다. 기존 마이그레이션과 주문 상태 enum은 변경하지 않았다.

## 남은 범위
실제 Supabase/Auth, 차량 ETA 수신·갱신, ETA 변경에 따른 재계획은 별도 작업이다. [수동 조리·입장·인도 흐름](two-screen-demo.md#수동-인도-시연)은 기존 DB 함수를 호출하는 식당 전용 HTTP 작업으로 제공한다. 독립 PostgreSQL 세션 경쟁 검증도 로컬 단일 엔진 테스트와 별도로 필요하다.
