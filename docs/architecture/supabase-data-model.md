# 밥맞J Supabase 데이터 모델 초안

상태: 설계 기준. 2026-11-04 supabase/migrations에 DB 구현을 추가하고 로컬 PostgreSQL 엔진으로 검증했다. 클라우드 Supabase 적용 및 NestJS 구현은 아직 하지 않았다. 실행 범위와 구현 제약은 ../../supabase/README.md 참조.

## 구성과 선택
Pleos 앱 / Next.js 식당 웹 → NestJS 중앙 서버 → Supabase PostgreSQL.
인증은 Supabase Auth를 사용하는 안을 제안한다. 로그인 수단은 아직 미정이다.

안 A: users에 식당 소유자 역할과 식당 ID를 직접 저장. 초기에는 단순하지만 한 사용자의 고객/점주 겸용과 복수 식당 접근에 제약이 있다.
안 B(권장): 공통 users와 restaurants를 두고 restaurant_members로 연결. 테이블 하나가 추가되지만 계정과 식당 권한을 분리할 수 있다.
아래는 안 B 기준 초안이다. 실제 스키마 적용 전 확정이 필요하다.

## 공통 규칙
- 식별자 uuid, 일시 timestamptz, 전화번호와 차량번호 text.
- created_at / updated_at은 모든 업무 테이블에 포함. updated_at은 DB 트리거 또는 서버에서 갱신해야 한다.
- 연락처는 국가번호 포함 형식으로 정규화. 전화번호·차량번호는 계정 식별자나 전역 UNIQUE 값으로 사용하지 않는다.
- 명시하지 않은 필드는 NOT NULL. 아래 ? 표시는 NULL 허용.

## public.users — 계정 프로필
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK, FK → auth.users.id | 인증 계정과 1:1. 임의 UUID 기본값을 두지 않음 |
| display_name | text ? | 사용자 표시 이름 |
| contact_phone | text ? | 기본 주문 연락처. 주문 시에는 필수 |
| created_at | timestamptz default now() | 생성 시각 |
| updated_at | timestamptz default now() | 변경 시각 |

비밀번호·인증 이메일은 중복 저장하지 않는다. 연락처를 인증된 번호로 간주하지 않는다. 식당 직원도 같은 계정을 사용한다.

## public.user_vehicles — 사용자 차량
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | 차량 ID |
| user_id | uuid FK → users.id | 소유 사용자 |
| plate_number | text, 빈 문자열 금지 | 전체 차량번호 |
| label | text ? | 차량 별칭 |
| is_default | boolean default false | 기본 선택 차량 |
| created_at / updated_at | timestamptz | 기록 시각 |

UNIQUE(user_id, plate_number). 사용자별 is_default=true 행은 부분 UNIQUE 인덱스로 최대 1개. 기본 차량이 없어도 주문 시 선택·입력 가능. 전역 차량번호 UNIQUE는 두지 않는다. 차량번호 변경은 과거 주문에 반영하지 않는다.

## public.restaurants — 식당/매장
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | 매장 ID |
| name | text, 빈 문자열 금지 | 매장명 |
| contact_phone | text | 식당 연락처 |
| address | text | 매장 주소 |
| latitude | double precision ? CHECK -90..90 | 매장 위도 |
| longitude | double precision ? CHECK -180..180 | 매장 경도 |
| is_accepting_orders | boolean default false | 새 주문 접수 여부 |
| max_concurrent_orders | integer CHECK > 0, default 1 | 동시에 조리 가능한 주문 수. 식당 설정값 |
| created_at / updated_at | timestamptz | 기록 시각 |

매장 좌표는 둘 다 NULL이거나 둘 다 입력. 매장 주소와 실제 픽업 위치는 분리한다.

## public.restaurant_pickup_locations — 식당별 픽업 위치
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | 픽업 위치 ID |
| restaurant_id | uuid FK → restaurants.id | 소속 매장 |
| name | text, 빈 문자열 금지 | 예: 정문 주차장, 지하 1층 픽업존 |
| address | text | 픽업 주소 |
| latitude | double precision CHECK -90..90 | 경로·ETA 기준 위도 |
| longitude | double precision CHECK -180..180 | 경로·ETA 기준 경도 |
| instructions | text ? | 진입 방향·주정차 위치·수령 안내 |
| is_active | boolean default true | 신규 주문에서 선택 가능 여부 |
| is_default | boolean default false | 기본 추천 위치 |
| created_at / updated_at | timestamptz | 기록 시각 |

매장당 여러 위치를 등록한다. restaurant_id 인덱스와 UNIQUE(restaurant_id, id)를 둔다. is_active=true AND is_default=true 부분 UNIQUE 인덱스로 매장당 활성 기본 위치를 최대 1개로 제한하고 CHECK(NOT is_default OR is_active)를 적용한다. 기본 위치가 없어도 사용자가 활성 위치를 선택할 수 있다.

신규 주문 시 해당 식당의 활성 위치 한 곳을 선택해야 한다. 활성 위치가 없는 식당은 주문받지 못하도록 서버가 검증한다. 기본값·활성 상태 변경과 주문 생성은 트랜잭션/잠금 등으로 동시 변경을 제어한다. 식당은 위치별로 주문을 구분해 조회할 수 있다.

기존 주문이 참조하는 위치는 물리 삭제 대신 비활성화한다. 비활성화는 신규 선택을 차단하며 기존 주문의 위치를 자동 변경하지 않는다. MVP에서는 주문 후 위치 변경을 제공하지 않는 안을 제안한다. 실제 수령 불가 상황은 식당 연락 등 수동 대응하고, 위치 변경·사용자 확인·ETA 재계산 흐름은 후속 설계한다. 위치 등록만으로 합법적인 정차 장소임을 자동 검증하지 않는다.

## public.restaurant_members — 식당 접근 권한
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| restaurant_id | uuid FK → restaurants.id | 소속 매장 |
| user_id | uuid FK → users.id | 직원 계정 |
| role | text CHECK IN ('OWNER','STAFF') | 매장 내 역할 |
| created_at / updated_at | timestamptz | 기록 시각 |

복합 PK(restaurant_id, user_id), user_id 인덱스. MVP는 매장당 OWNER 1개를 부분 UNIQUE 인덱스로 제한한다. 최소 한 명의 OWNER 유지 및 소유권 이전은 서버 트랜잭션에서 처리해야 한다. 사용자가 스스로 멤버 행이나 역할을 생성·변경하지 못하게 한다.

## 관계
restaurants 1:N restaurant_pickup_locations
users 1:N user_vehicles
users N:M restaurants (restaurant_members를 통해 연결)
auth.users 1:1 public.users

## public.orders — 주문
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK | 주문 ID |
| user_id | uuid FK → users.id | 주문 사용자 |
| restaurant_id | uuid FK → restaurants.id | 주문 식당 |
| request_key | uuid | 재전송 중복 주문 방지, UNIQUE(user_id, request_key) |
| pickup_location_id | uuid | 선택 위치. 아래 복합 FK 적용 |
| pickup_vehicle_plate / pickup_contact_phone | text | 주문 당시 차량번호·전화번호, 필수 |
| pickup_name / pickup_address | text | 주문 당시 픽업 장소명·주소 |
| pickup_latitude / pickup_longitude | double precision | 주문 당시 목적지 좌표, 위경도 범위 CHECK |
| pickup_instructions | text ? | 주문 당시 픽업 안내 |
| order_status | text CHECK | PENDING / ACCEPTED / REJECTED / CANCELLED / COMPLETED |
| cooking_status | text CHECK | UNSCHEDULED / SCHEDULED / COOKING / READY |
| vehicle_status | text CHECK | UNKNOWN / EN_ROUTE / NEARBY / ARRIVED |
| accepted_cook_duration_minutes | integer ? CHECK > 0 | 식당이 수락 시 입력하는 주문 전체 조리시간 |
| preparation_buffer_minutes | integer CHECK >= 0, default 0 | 수락 시 저장하는 완료 목표 여유시간 |
| eta_at / eta_updated_at | timestamptz ? | 선택 픽업 장소까지 도착 예측과 갱신 시각 |
| cooking_started_at / estimated_ready_at / ready_at | timestamptz ? | 실제 시작·예상 완료·실제 완료 |
| accepted_at / completed_at / cancelled_at | timestamptz ? | 업무 이벤트 시각 |
| version | integer CHECK >= 0, default 0 | 변경 충돌 감지 |
| created_at / updated_at | timestamptz | 기록 시각 |

기본값 PENDING + UNSCHEDULED + UNKNOWN. 수락 전 조리시간은 NULL이며 수락 후 필수. (restaurant_id, pickup_location_id) 복합 FK → restaurant_pickup_locations(restaurant_id, id), 삭제 RESTRICT. UNIQUE(restaurant_id, id)는 예약의 식당 일치 검증용이다. 상태 전이와 필드 필수 조건은 서버 검증과 DB 제약으로 보장한다. 주문별 시각의 상호 일관성도 검증한다.

인덱스: (restaurant_id, order_status, created_at), (user_id, created_at). 식당에는 자기 주문의 연락처만 제공한다. 기존 주문은 차량·픽업 위치 원본 수정의 영향을 받지 않는다. ETA 목적지는 주문 스냅샷 좌표다.

## public.order_items — 주문 항목
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK | 항목 ID |
| order_id | uuid FK → orders.id | 주문 |
| menu_name_snapshot | text | 주문 당시 메뉴명 |
| quantity | integer CHECK > 0 | 수량 |
| unit_price_krw | bigint CHECK >= 0 | 주문 당시 원화 단가, 결제 기능과 별개 |
| created_at / updated_at | timestamptz | 기록 시각 |

order_id 인덱스. 주문·항목은 한 트랜잭션에서 저장하고 항목 없는 주문을 허용하지 않는다. 메뉴 마스터는 후속 상세 설계 대상으로, menu_id FK는 실제 테이블 확정 후 추가한다. 메뉴명·가격은 클라이언트 값을 신뢰하지 않고 서버가 검증된 메뉴 데이터에서 복사해야 한다.

## public.cooking_reservations — 조리 예약
| 필드 | 타입/제약 | 용도 |
|---|---|---|
| id | uuid PK | 예약 ID |
| restaurant_id | uuid FK → restaurants.id | 수용량을 공유하는 매장 |
| order_id | uuid UNIQUE | 주문당 현재 예약 1개 |
| planned_start_at / planned_end_at | timestamptz | 예정 조리 구간 [시작, 종료) |
| released_at | timestamptz ? | 완료·취소로 실제 자리를 반납한 시각 |
| created_at / updated_at | timestamptz | 기록 시각 |

CHECK(planned_end_at > planned_start_at). (restaurant_id, order_id) 복합 FK → orders(restaurant_id, id), 주문 삭제 RESTRICT. 인덱스 (restaurant_id, planned_start_at), (restaurant_id, planned_end_at). 예약 변경 이력은 이 테이블을 중복 생성하는 대신 별도 이벤트 이력 테이블로 확장한다.

조리 예약 예정 시각은 이 테이블이 기준이다. orders에 scheduled_cook_start_at을 중복 저장하지 않고 API 응답에서 결합한다. estimated_ready_at은 실제 조리 시작 이후의 예상 완료 시각으로 구분한다. 별도 예약 상태 enum은 추가하지 않고 주문/조리 상태와 released_at으로 활성 여부를 판단한다.

## 수용량과 예약 규칙 — 제안
1. **MVP 가정: 주문 1건 = 조리 자리 1개.** 메뉴 수량이 달라도 식당이 주문 전체 조리시간에 반영한다. 수용량은 픽업 장소별이 아니라 매장 전체에 적용한다. 대량 주문의 가중치·설비별 자원은 후속 확장이다.
2. PENDING은 저장하되 아직 조리 자리를 점유하지 않는다. 식당 수락 시 조리시간을 입력하고 예약 가능한 구간을 확정한다. 예약 저장과 ACCEPTED + SCHEDULED 전이는 원자적으로 처리한다.
3. 목표 시작 = max(현재 시각, ETA - 조리시간 - 준비 여유시간), 예약 길이 = 조리시간. 완료 목표를 맞출 수 있는 구간을 우선 배정하고, 불가능하면 목표 시작 이후 가장 이른 수용 가능 구간으로 미룬다. 자동으로 더 일찍 조리하지 않는 안이다. 예상 지연을 식당 수락 화면과 사용자에게 표시한다.
4. 어떤 시각에서도 겹쳐 있는 활성 예약과 실제 조리 주문 수가 max_concurrent_orders 이하여야 한다. [시작, 종료)로 계산해 12:10 종료 자리에서 12:10 시작 가능. 후보와 겹치는 행 수의 단순 합이 아니라 구간별 최대 동시 점유를 검사한다.
5. 수락·예약 변경·조리 시작·완료·취소·수용량 변경은 같은 식당 단위의 DB 잠금과 트랜잭션으로 직렬화한다. NestJS가 호출하는 단일 DB 함수/트랜잭션에서 잠금 → 재조회 → 검사 → 저장하며, 조회와 저장을 별도 Supabase 요청으로 나누지 않는다. 프로세스 메모리 잠금만으로 보호하지 않는다.
6. 동일 요청의 재시도는 기존 결과를 반환한다. 예약 후보를 UI에서 조회한 결과는 잠정치이며, 최종 저장 직전에 반드시 다시 검사한다.
7. ETA/조리시간 변경 시 SCHEDULED만 다시 배정한다. 자기 기존 예약은 점유 계산에서 제외한다. 우선 다른 주문 예약은 움직이지 않고 자기 예약만 가능한 구간으로 옮기는 정책을 제안한다. 실패하면 트랜잭션을 롤백해 기존 예약을 유지하고 충돌을 반환한다.
8. 식당이 조리 시작을 누를 때 실제 점유량을 다시 검사한다. 시작 가능해야 COOKING으로 전환하고 cooking_started_at과 estimated_ready_at을 기록한다. 조기 시작도 동일 검사 대상이다. COOKING 진입이 LOCK이며 READY까지 ETA에 의한 예약 이동은 금지한다.
9. 실제 조리가 예정 종료를 넘겨도 READY 처리 전까지 자리는 점유 중이다. 지연 시 아직 시작하지 않은 예약을 재조정하고 사용자에게 예상 완료 갱신을 전달한다. 지연을 즉시 감지하지 못해도 실제 시작 시 재검사하므로 과도한 조리 시작을 막는다. 시작 차단 시 식당에 사유를 표시한다.
10. READY 진입 시 조리 자리를 반납(released_at 기록)한다. 음식 인도 대기·차량 도착 여부는 조리 자리를 점유하지 않는다. CANCELLED/REJECTED도 자원을 해제하고 예약·접근 알림을 중단한다. COOKING 이후 취소는 MVP에서 금지하는 안이다. COMPLETED는 READY 이후에만 가능하다.
11. max_concurrent_orders 변경 시 실제 조리 수와 미래 예약 전 구간을 검증한다. 기존 점유를 초과하게 만드는 감소는 거부한다. 식당이 예약을 정리한 뒤 변경하거나 다음 단계에서 적용 시점 기능을 추가한다.
12. 유효한 ETA가 없으면 PENDING을 유지하고 수락 예약을 확정하지 않는다. ETA가 목표 조리시간보다 짧으면 지금부터 가능한 구간을 예약하고 지연을 표시한다. 영업시간·휴무·최대 예약 기간이 아직 없어 무한 탐색하지 않도록 예약 가능 시간 범위를 구현 전에 확정해야 한다.

### 예시 (동시 처리 2건, 모든 시간은 한국시간)
- A: 12:00~12:15, B: 12:05~12:20이면 12:05~12:15는 수용량 2를 사용한다.
- C의 목표 시작이 12:10이고 조리시간 10분이면 12:10 배정 불가. 12:15~12:25에 예약한다.
- A가 12:15에도 조리 중이면 C를 실제로 시작시키지 않는다. A 완료 확인 후 C의 예약·예상 완료를 갱신한다.

## 추가 관계
users 1:N orders / restaurants 1:N orders / orders 1:N order_items.
orders 1:0..1 cooking_reservations (PENDING에는 예약 없음).
restaurants 1:N cooking_reservations. restaurant_pickup_locations 1:N orders.

알림·상태 전이 이력, 메뉴 마스터, 영업시간 테이블은 후속 상세 설계 범위다. 이 문서는 DB 마이그레이션이나 수용량 검사 코드가 아니다.

## 인증·접근·삭제 방침
- Supabase Auth 토큰을 NestJS가 검증하고, 모든 업무 데이터 요청은 NestJS를 경유한다.
- public 스키마 테이블은 RLS 활성화. 초기에는 클라이언트의 업무 테이블 직접 접근을 허용하지 않는다. 별도 직접 읽기 정책이 필요하면 이후 명시적으로 추가한다.
- 서버 전용 secret/service_role 키는 RLS를 우회하므로 NestJS 내부에서 사용자·식당 소속·역할을 반드시 검증한다. 키는 Next.js 브라우저 코드나 Pleos 앱에 포함하지 않는다.
- 고객은 본인 차량/프로필/주문만, 직원은 자신이 소속된 식당의 주문만 접근한다. 고객 프로필 전체를 식당 직원에게 노출하지 않는다.
- 인증 계정·식당 삭제 시 주문을 연쇄 삭제하지 않는다. 실제 삭제/익명화/연락처 보관 기간과 FK ON DELETE 정책은 주문 스키마와 함께 확정한다. 이번 초안은 운영용 삭제 정책이나 RLS SQL을 제공하지 않는다.

## 미확정 사항
- Supabase Auth 로그인 수단과 차량 앱에서 로그인 연결 방식.
- 직원 계정 초대·최초 OWNER 등록 방식.
- 수용량을 주문 건수 기준으로 셀지 확정. 현재는 주문 1건당 자리 1개로 제안.
- 예약 탐색 범위·영업시간, 지연 수락 안내 방식 확정.
- 조리 시작 이후 취소 금지, ETA 미수신 시 수락 보류 정책의 최종 확정.
- 개인정보 보관·삭제 정책.

## 공식 근거
- https://supabase.com/docs/guides/auth/managing-user-data : auth.users와 public 프로필 테이블 분리, PK 참조.
- https://supabase.com/docs/guides/database/postgres/row-level-security : RLS와 서버 전용 권한의 특성.
- https://supabase.com/docs/guides/auth/users : 서버 전용 secret 키의 RLS 우회 특성.
