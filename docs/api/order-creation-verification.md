# 주문 생성 API 최소 범위 검증 보고

검증일: 2026-11-04 (한국시간)

## 먼저 확인한 지침·구조
- 현재 발견된 AGENTS.md는 restaurant-web/AGENTS.md뿐이다. Next.js 영역 지침이며 이번에 웹 소스를 수정하지 않았다.
- server/package.json과 server/src/app.ts, app.module.ts에서 NestJS/TypeScript 서버와 API prefix /api를 확인했다.
- server/src/database/local-database.ts에서 로컬 PGlite 연결, 기존 SQL 마이그레이션 적용, 트랜잭션과 서비스 역할 재사용을 확인했다.
- supabase/migrations/20261104000100_core.sql의 orders/order_items/식당/픽업 위치 FK와 상태 기본값, 20261104000200_reservations.sql의 기존 주문 생성 함수, 20261104000300_menu_order_api.sql의 메뉴 조회·가격 스냅샷·멱등성 함수를 확인했다.

## 구현 판단
기존 POST /api/orders가 요구사항을 이미 충족하므로 중복 API를 추가하거나 서버/DB 스키마를 변경하지 않았다. 기존 컨트롤러 → Zod 검증 → PickupService → create_menu_pickup_order → create_pickup_order 경로를 실행 검증했다.

사용자 ID는 개발용 bearer 토큰에서 결정한다. 요청에는 restaurantId, pickupLocationId, vehiclePlate, contactPhone, requestKey, items[{menuId,quantity}]가 필요하다. 메뉴명과 단가는 DB에서 읽으며 임의 가격/사용자 ID/상태 입력은 허용하지 않는다.

응답에 id, orderStatus=PENDING, cookingStatus=UNSCHEDULED, vehicleStatus=UNKNOWN과 저장된 메뉴·픽업 위치 정보가 포함된다. 이번 최소 범위는 수락·ETA 계산·조리 예약·결제·배달 기능을 추가하지 않는다. 정상 주문 생성 후 cooking_reservations가 0건임을 검사했다.

## 실행 및 검증 결과
루트에서 npm test 실행, 종료 코드 0. 서버/공통 계약 TypeScript 빌드 성공. HTTP/API 테스트 13개(하위 테스트/그룹 포함), 기존 DB 테스트 8개 통과, 실패 0개.
루트 npm run typecheck 실행, 종료 코드 0.

| 요청한 검증 | HTTP 결과 | DB 확인 |
|---|---|---|
| 정상 주문 | 201, UUID id와 PENDING 응답 | 2개 메뉴의 수량·식당·선택 위치·세 초기 상태 저장, 조리 예약 없음 |
| 존재하지 않는 메뉴 ID | 400 | 주문·항목·예약 수 변화 없음 |
| 수량 0 이하 | 0과 -1 각각 400 | 동일 |
| 주문 항목 빈 배열 | 400 | 동일 |
| 다른 식당의 픽업 위치 | 400 | 동일 |
| 중복 요청 | 동일 사용자/requestKey/정규화 본문이면 201과 기존 주문 ID; 같은 키로 수량 변경 시 409 | 새 주문·항목·예약 생성 없음 |

HTTP 테스트는 NestJS를 임시 포트로 실제 실행하고 임시 PostgreSQL 엔진에 SQL을 적용한다. 기존 .local/database 데이터와 실행 중 서버는 변경하지 않는다. 요청·응답뿐 아니라 DB 상태를 직접 검사한다.

## 이번 변경 파일
- server/test/pickup-api.test.mjs: 최소 주문 요구사항을 개별 하위 테스트 6개로 추가.
- docs/api/order-creation-verification.md: 이 보고서.

서버 운영 소스, 전체 DB 마이그레이션, package.json들과 루트 lockfile은 작업 시작 시의 SHA-256 해시와 동일함을 확인했다. 라이브러리 추가·스키마 변경 없음.

## 남은 문제와 검증 한계
- 현재 실행 저장소와 인증은 로컬 개발용 PGlite 및 bearer 계정이다. Supabase 호스팅/Auth와 운영 배포는 미연결.
- 중복 재시도 정책은 기존대로 201을 유지하며 같은 주문을 반환한다. 항목 순서 등 정규화 본문이 달라지면 다른 요청으로 취급한다.
- 독립 PostgreSQL 세션의 동시 요청 경쟁은 이번 로컬 엔진 테스트에 포함하지 않았다. 동일 요청 재전송과 충돌은 순차 HTTP 호출로 검증했다.
- ETA와 식당 수락/조리 시작 예약 API는 다음 작업이다. 기존 DB 예약 함수가 있다는 사실을 이번 API 구현 완료로 세지 않았다.

요청/응답 예시와 로컬 실행: [pickup.md](pickup.md).
