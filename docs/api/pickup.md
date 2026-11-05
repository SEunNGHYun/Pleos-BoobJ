# 식당 등록·주문·픽업 장소 API

## 범위와 실행

현재는 **로컬 개발 DB를 실제로 사용하는 API**다. Supabase 호스팅/Auth에 연결한 운영 API는 아니다. 파일 기반 PGlite PostgreSQL에 기존 Supabase 마이그레이션을 적용해 재시작 후에도 데이터를 보존한다. 로컬 모드는 NODE_ENV=production에서 사용 불가하고 서버 주소도 loopback으로 제한한다.

루트에서:

```sh
npm ci
npm run local:setup
npm run dev:server
```

`local:setup`은 `.local/database/`에 DB를 만들고 `server/.env`에 LOCAL_DB_PATH를 설정한다. `.local/credentials.json`에 개발용 owner/customer 계정 ID와 서로 다른 bearer 토큰을 저장한다. 파일과 토큰은 Git 제외 대상이며 토큰 원문은 DB에 저장하지 않는다. 재실행은 기존 계정을 재사용한다. 서버가 같은 DB를 사용 중이면 종료한 뒤 setup을 실행한다.

식당·메뉴·주문 샘플은 자동 생성하지 않는다. 직접 API로 등록한다. 이 계정은 Supabase 가입 계정이나 실제 연락처 인증을 대체하지 않는다. 추후 운영 연결 시 Supabase Auth 검증 어댑터로 교체해야 한다.

기본 주소: `http://127.0.0.1:3001/api`.
모든 업무 요청은 `Authorization: Bearer <해당 사용자 토큰>` 필요. 사용자 ID는 서버가 토큰으로 결정한다. DB 미설정 시 503, 인증 실패 시 401. health는 인증 없이 사용한다.

## API 목록

| 메서드 | 경로 | 동작 |
|---|---|---|
| POST | /restaurants | 식당·점주 소속·복수 픽업 위치·초기 메뉴를 한 번에 등록 |
| GET | /restaurants/:id/pickup-locations | 해당 식당의 활성 픽업 위치 목록 |
| GET | /restaurants/:id/menus | 해당 식당의 주문 가능한 메뉴 목록 |
| POST | /orders | 메뉴·수량과 선택한 픽업 위치로 주문 생성 |
| GET | /orders/:id | 주문 상세, 메뉴/가격/위치 스냅샷 |
| GET | /orders/:id/pickup-location | 주문에 저장한 픽업 장소만 조회 |

주문 상세와 픽업 장소 조회는 본인 주문 또는 자신이 소속된 식당의 주문만 허용한다. 다른 사용자의 주문과 존재하지 않는 주문은 모두 404로 응답한다. 식당 등록은 인증된 사용자가 신규 식당의 OWNER가 되는 온보딩 동작이다.

## 1. 식당 등록

owner 토큰으로 `POST /api/restaurants`, Content-Type: application/json.

```json
{
  "name": "밥맞식당",
  "contactPhone": "+82212345678",
  "address": "서울시 예시 주소",
  "maxConcurrentOrders": 2,
  "isAcceptingOrders": true,
  "pickupLocations": [
    {"name":"정문 주차장","address":"정문 지정 픽업존","latitude":37.5,"longitude":127.0,"isDefault":true},
    {"name":"후문 픽업존","address":"후문 지정 픽업존","latitude":37.51,"longitude":127.01,"instructions":"지정 주차구역에서 수령"}
  ],
  "menus": [
    {"name":"제육덮밥","priceKrw":10000},
    {"name":"비빔밥","priceKrw":9000}
  ]
}
```

201 응답은 식당 id와 등록된 pickupLocations/menus의 id를 포함한다. 이후 주문에는 이 응답의 실제 UUID를 사용한다. 픽업 위치 최소 1개·최대 30개, 기본 위치 최대 1개, 메뉴 최대 100개. menus 생략 시 빈 목록이고 메뉴 추가/수정 API는 아직 없다. isAcceptingOrders 기본값은 false다.

동시 조리 수는 1~1000의 정수, 가격은 0~100,000,000원 정수다. 현재 메뉴별 조리시간 대신 수락 시 주문 전체 조리시간을 입력하는 기존 설계를 유지한다. 이번 API는 수락 기능을 추가하지 않는다.

## 2. 주문 생성

customer 토큰으로 `POST /api/orders`.

```json
{
  "restaurantId": "<식당 응답의 id>",
  "pickupLocationId": "<선택한 픽업 위치 id>",
  "vehiclePlate": "12가3456",
  "contactPhone": "+821012345678",
  "requestKey": "<주문 시도별 생성한 UUID>",
  "items": [{"menuId":"<선택한 메뉴 id>","quantity":2}]
}
```

위 UUID 자리표시는 실제 값으로 치환한다. requestKey는 클라이언트가 crypto.randomUUID() 등으로 생성한다. 동일 요청의 네트워크 재시도에는 같은 키를 쓰고 새 주문에는 새 키를 쓴다.

- 사용자 ID·메뉴명·단가·주문 상태·임의 픽업 좌표는 받지 않는다. 미정의 필드는 400.
- 메뉴명·가격은 서버가 같은 식당의 판매 가능한 메뉴에서 읽어 저장한다.
- 픽업 위치는 같은 식당의 활성 위치만 선택 가능하다.
- 메뉴 수량은 1~100, 항목 수는 1~100. 같은 메뉴 중복 항목은 수량으로 합쳐 보내야 한다.
- 전화번호는 +국가번호 형식. 번호 인증 및 차량 소유 인증은 이번 범위가 아니다.
- 식당 접수 중지 시 409. 잘못된 메뉴·픽업 위치는 400. 식당 없음은 404.
- 같은 사용자/requestKey의 동일 본문은 기존 주문을 반환한다(현재 201 유지). 정규화된 본문이 달라지면 409. 메뉴나 픽업 위치가 이후 비활성화돼도 동일 요청의 재시도는 기존 주문을 반환한다.

응답 주요 필드:

```json
{
  "id":"<생성된 주문 id>",
  "userId":"<토큰의 사용자 id>",
  "restaurantId":"<식당 id>",
  "orderStatus":"PENDING",
  "cookingStatus":"UNSCHEDULED",
  "vehicleStatus":"UNKNOWN",
  "vehiclePlate":"12가3456",
  "contactPhone":"+821012345678",
  "pickupLocation":{"id":"<위치 id>","name":"후문 픽업존","address":"후문 지정 픽업존","latitude":37.51,"longitude":127.01,"instructions":"지정 주차구역에서 수령"},
  "items":[{"id":"<주문 항목 id>","menuName":"제육덮밥","quantity":2,"unitPriceKrw":10000}],
  "totalPriceKrw":20000,
  "createdAt":"<생성 시각>"
}
```

합계는 금액 기록이며 실제 결제 기능은 없다. 주문 생성만으로 조리 수용량을 차지하지 않는다. 식당 수락과 기존 reserve_cooking 함수의 연결은 [접수 API](restaurant-receipt.md)에서 제공한다.

## 3. 주문별 픽업 장소 조회

`GET /api/orders/<주문 id>/pickup-location`은 위 응답의 pickupLocation 객체만 반환한다. 별도 임의 주소 등록 API를 호출하는 구조가 아니라 **주문 생성 시 위치 선택 → 주문에 스냅샷 저장 → 주문별 조회** 흐름이다. 원본 장소명·주소가 바뀌거나 비활성화되어도 주문 당시 정보가 유지된다.

## 검증

```sh
npm run build
npm run typecheck
npm test
npm run test:smoke
```

HTTP 테스트는 임시 DB에서 식당 등록→주문 생성→조회, 가격/사용자 위조 차단, 식당 간 참조 차단, 비활성 메뉴/접수 중지, 요청 재전송, DB 재시작 후 주문 보존을 검증한다. 실제 Supabase REST/JWT 및 독립 PostgreSQL 연결 경쟁 요청 검증은 포함하지 않는다.
