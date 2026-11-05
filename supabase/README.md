# 밥맞J 데이터베이스

Supabase PostgreSQL용 DB 구현이다. Android/Pleos 소스는 변경하지 않는다.

## 현재 상태
- migrations의 SQL을 로컬 PGlite PostgreSQL 엔진에 순서대로 적용해 검증한다.
- 클라우드 Supabase 연결 정보가 없어 원격 DB에는 아직 적용하지 않았다.
- 테스트의 auth.users와 DB 역할은 Supabase 플랫폼을 재현하기 위한 최소 테스트 전용 bootstrap이다. 실제 Supabase Auth 로그인·PostgREST·다중 연결 동시성 테스트와 동일하지 않다.
- 이 폴더는 NestJS 서버 코드가 아니다. 서버 구현 시 토큰 검증·식당 소속/역할 검사를 반드시 추가해야 한다.

## 테이블
`users`, `user_vehicles`, `restaurants`, `restaurant_members`, `restaurant_pickup_locations`, `orders`, `order_items`, `cooking_reservations`, `menus`.

`users.id`는 Supabase `auth.users.id`를 참조한다. Supabase Auth 계정 생성 이후 NestJS가 프로필을 생성해야 한다. 자동 프로필 트리거는 설치하지 않는다. 전화번호는 +국가번호 형식이며 인증 여부를 뜻하지 않는다.

매장당 복수 픽업 위치, 기본 차량/픽업 위치의 중복 방지, 주문 당시 차량·전화번호·픽업 위치·메뉴/가격 보존, 세 종류 상태 enum과 FK/CHECK/인덱스를 포함한다. 물리 삭제는 참조가 있으면 제한한다. 개인정보 보관/익명화 작업은 후속 구현 대상이다.

## 테스트
Node.js 22 이상을 권장한다. 패키지 버전은 package-lock.json에 고정한다.

```sh
npm ci --prefix supabase/tests --ignore-scripts
npm test --prefix supabase/tests
```
매 테스트마다 메모리 DB를 새로 만들기 때문에 클라우드·로컬 기존 DB 데이터를 건드리지 않는다. 계정/차량/메뉴 값은 테스트 fixture이고 운영 seed가 아니다.

## Supabase에 적용
Supabase CLI와 Docker가 설치된 경우, **새 로컬 개발 DB**는 루트에서 다음 명령으로 시작하고 미적용 마이그레이션을 적용한다.

```sh
supabase start
supabase migration up --local
```
현재 작업 환경에는 Supabase CLI/Docker가 없어 이 CLI 경로 자체는 실행 검증하지 않았다. schema `public`에 같은 이름의 테이블·enum이 이미 있는 프로젝트에는 먼저 충돌 여부를 조사해야 한다.

호스팅 프로젝트가 준비되면 대상 프로젝트를 확인한 뒤 아래 명령으로 연결·사전 확인·적용한다.

```sh
supabase login
supabase link --project-ref <실제-project-ref>
supabase db push --dry-run
supabase db push
```
또는 새 프로젝트의 SQL Editor에서 migrations를 파일명 순서대로 실행할 수 있다. SQL Editor 수동 적용 시 CLI migration history와 자동 동기화되지 않으므로 이후 CLI 배포를 시작하기 전 적용 이력을 정리해야 한다. CLI 방식 사용을 권한다. 원격 reset 명령은 필요 없다. 실제 키는 `.env.example`의 빈 항목을 로컬 보안 설정에 채우고 커밋하지 않는다.

## 서버 전용 RPC
아래 함수는 service_role에만 허용된다. 각 호출은 하나의 DB 트랜잭션이다. 일반 사용자 입력을 검증 없이 전달하지 않는다.

| 함수 | 역할 |
|---|---|
| `create_pickup_order(p_user uuid, p_restaurant uuid, p_pickup uuid, p_plate text, p_phone text, p_request_key uuid, p_items jsonb)` | 주문·항목·픽업 스냅샷 동시 생성, 요청 키로 재시도 중복 방지 |
| `reserve_cooking(p_order uuid, p_duration integer, p_eta timestamptz, p_buffer integer=0)` | 수락·조리 예약 동시 저장. 시작 전 재호출하면 예약 변경 |
| `start_cooking(p_order uuid)` | 실제 동시 조리 수 검사 후 COOKING/LOCK |
| `mark_order_ready(p_order uuid)` | READY로 전환하고 자리 반환 |
| `close_pickup_order(p_order uuid, p_status order_status)` | CANCELLED/REJECTED/COMPLETED 검증·반영 |

`p_items` 예: `[{"menu_name":"제육","quantity":1,"unit_price_krw":10000}]`.
menus 테이블과 `create_menu_pickup_order` 함수를 추가했다. 사용자 주문 API는 메뉴 ID로 DB에서 이름·가격을 읽는 새 함수만 사용한다. 기존 `create_pickup_order`는 레거시/내부 DB 호출용이므로 외부 요청에 직접 연결하지 않는다. 외부 클라이언트가 가격·사용자 ID·식당 권한을 임의 지정하도록 허용하면 안 된다. 동일 user/request_key 재시도는 기존 주문을 반환하므로 변경 주문은 새 request_key를 사용한다.

## 수용량 규칙
- `restaurants.max_concurrent_orders`는 매장 전체에서 동시에 조리할 주문 수, 주문 1건은 자리 1개다.
- PENDING은 자리를 차지하지 않는다. 수락하려면 양수 조리시간과 유효한 ETA가 필요하다.
- 목표 시작은 max(현재 시각, ETA - 조리시간 - 여유시간). 빈 구간이 없으면 구간 종료 후보를 순서대로 검사해 가장 이른 가능한 예약을 저장한다.
- [시작, 종료) 구간의 **최대 동시 점유**를 검사한다. 서로 겹치지 않는 주문들의 단순 합계를 수용량으로 세지 않는다.
- 예약 탐색은 현재부터 7일 안에 끝나는 구간으로 제한한다. 영업시간은 아직 반영하지 않으므로 운영 전 추가해야 한다.
- 모든 예약/상태 RPC는 식당 행 → 주문 행 순서로 잠근다. 기본 READ COMMITTED 격리 수준을 사용한다. 높은 격리 수준에서 발생하는 직렬화 오류 등은 서버에서 트랜잭션 전체 재시도해야 한다.
- service_role도 주문·항목·예약 직접 DML은 금지하고 함수만 사용한다. 식당 수용량 감소는 기존 실제/예약 점유가 초과되면 거절한다.
- COOKING/READY에서는 ETA에 의한 예약 이동 금지. 실제 조리 시작은 미래 예약보다 현재 조리 건수를 기준으로 허용/차단한다. 준비 완료 전까지 실제 자리는 유지된다.
- 예상 완료를 넘긴 COOKING은 예약 계산에서 무기한 점유로 간주한다. READY 처리 후 다시 예약 가능하다. 준비 중 CANCELLED는 금지하고, COMPLETED는 READY 이후만 허용한다.

## 보안과 남은 구현
- 모든 테이블 RLS 활성화, anon/authenticated에 업무 데이터 권한·RPC 실행 권한 없음. 클라이언트는 NestJS를 경유한다.
- SECURITY DEFINER RPC는 빈 search_path와 명시적 스키마를 사용한다. 서버 전용 키는 RLS를 우회하므로 NestJS의 인증/인가가 필수다.
- service_role은 계정·식당·직원·위치 설정을 관리할 수 있다. OWNER 최소 1명 유지 및 권한 위임 절차는 NestJS 구현 범위이며 DB는 OWNER 최대 1명만 보장한다.
- 예약 자동 재조정 작업자, ETA 수신/차량 상태 갱신 RPC, 조리 완료 예상 시각 수정 RPC, 알림·영업시간·메뉴 수정 API·상태 이력은 아직 없다. 스키마에 차량 상태 저장 컬럼은 있지만 차량 실시간 연동을 구현한 것은 아니다.
- 조리 시작 시 예상 완료에 영향을 받는 미래 예약은 같은 트랜잭션에서 재배정한다. 전체를 7일 안에 재배정할 수 없으면 조리 시작도 롤백하고 충돌을 반환한다. 시작 후 실제 조리가 예상보다 길어지는 경우를 감지할 NestJS 작업자는 별도 구현해야 하며 지연 알림이 자동 발송되지는 않는다.
- 클라우드 Supabase 적용, 실제 JWT/REST 경유 호출, 독립 DB 세션의 경쟁 요청 검증은 연결 환경 마련 후 별도 수행해야 한다.

공식 참고: [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html).

## 로컬 API 연결 추가
서버의 실제 로컬 저장·개발 계정·신규 메뉴 기반 주문 함수 사용법은 [API 안내](../docs/api/pickup.md)를 따른다. 이 로컬 연결은 실제 Supabase Auth/REST 연동과 구분한다.
