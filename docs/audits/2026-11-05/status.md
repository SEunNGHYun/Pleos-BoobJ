# 밥맞J 구현·실행 현황 조사

조사일: 2026-11-05 (한국시간). 대상: /Users/yunseunghyeon/Desktop/hyundai.
코드·스키마·설정을 편집하지 않고 기존 빌드/테스트만 수행했다. 이 보고서와 로그만 추가했다. 빌드 산출물·캐시는 검증 과정에서 갱신될 수 있다.

## 지침과 조사 범위
README.md, restaurant-web/AGENTS.md, supabase/README.md 및 기존 API/모델 문서를 확인했다. 루트·서버 AGENTS.md 및 별도 CLAUDE.md/GEMINI.md는 파일 탐색에서 발견되지 않았다. 발견된 AGENTS.md는 Next.js 소스 수정 전 설치된 버전의 문서를 확인하라는 지침이며 이번에는 웹 코드를 수정하지 않았다.

프로젝트 폴더는 접근 가능하다. .git 디렉터리가 없어 커밋·브랜치·원격 저장소 일치 여부는 확인 불가다. 계획 문서는 의도 확인에만 사용하고 완료 근거로 세지 않았다.

## 분류 기준
- 구현됨: 해당 계층에서 실제 코드와 실행/테스트 근거가 있다.
- 부분 구현: DB/골격 등 일부만 있으며 사용자부터 식당까지 전체 흐름은 미완료다.
- 미구현: 조사한 소스·설정에 해당 기능이 없다.
- 확인 불가: 장치·SDK·외부 환경 부족으로 실행이나 연동 성공을 확인하지 못했다.

## 현황표
| 기능/계층 | 분류 | 근거와 확인 범위 |
|---|---|---|
| 모노레포·서버 실행 기반 | 구현됨 | 루트 package.json의 npm workspaces, server/src/app.ts 및 app.module.ts. 웹·서버 빌드, HTTP 스모크 성공 |
| 주문 생성 API | 구현됨 | server/src/pickup/pickup.controller.ts의 POST orders, pickup.service.ts의 createOrder, input.ts, migration 003의 create_menu_pickup_order. API 테스트로 실제 초기 상태·항목·위치 저장과 멱등성 검증 |
| 주문 상세·주문 픽업 장소 조회 API | 구현됨 | GET orders/:id, GET orders/:id/pickup-location. 주문자/식당 소속 검사와 위치 스냅샷 테스트 통과 |
| 주문 최초 저장(접수 대기) | 구현됨 | PENDING/UNSCHEDULED/UNKNOWN 저장 및 응답. 주문 생성은 조리 예약을 만들지 않음 |
| 식당의 주문 목록·수락/거절 API | 부분 구현 | migration 002의 reserve_cooking 및 close_pickup_order에는 수락/거절 처리 존재. controller에는 해당 API와 목록 경로 없음. DB 함수 테스트를 접수 API 완료로 간주하지 않음 |
| 메뉴 등록·조회 | 구현됨 | POST restaurants의 menus 입력, GET restaurants/:id/menus, migration 003의 menus 테이블. 이름·원화 가격·판매 가능 여부 저장 |
| 메뉴별 조리시간 | 미구현 | menus 스키마·입력에 조리시간 필드 없음. 기존 합의는 수락 시 주문 전체 조리시간 입력이며 accepted_cook_duration_minutes 컬럼과 예약 함수 인수만 존재 |
| 식당 복수 픽업 위치 등록·조회·주문 연결 | 구현됨 | restaurant_pickup_locations, POST restaurants, GET restaurants/:id/pickup-locations, 주문 FK와 위치 스냅샷. 타 식당 위치 차단 테스트 통과 |
| 픽업 장소의 물리적 공간/주차 자리 예약 | 미구현 | 위치별 공간 수·주차 슬롯·점유 기간·공간 예약 테이블/코드 없음. 조리 수용량 예약과 구분해야 함 |
| 식당 조리 수용량 예약 | 부분 구현 | restaurants.max_concurrent_orders + cooking_reservations, reserve_cooking에서 구간 최대 점유 검사. DB 테스트 통과하나 서버 예약 API/식당 화면 없음 |
| 차량 ETA 수신 | 미구현 | eta_at/eta_updated_at 저장 컬럼은 있으나 차량 측 읽기·전송·서버 수신 경로 없음. DB 테스트는 now()+interval로 시각을 직접 전달 |
| ETA 기반 조리 시작 예약 | 부분 구현 | reserve_cooking이 ETA-조리시간-여유시간과 7일 범위 수용량을 계산. DB 테스트 성공. 실제 ETA 공급자/API/자동 작업자 미연결 |
| LOCK | 부분 구현 | migration 002의 start_cooking, COOKING/READY 예약 변경 차단, 실제 조리 수 검사 및 미래 충돌 예약 재배정. DB 테스트 성공. 서버 호출 API·차량/식당 UI 없음 |
| 조리 완료·픽업 완료·취소 | 부분 구현 | mark_order_ready/close_pickup_order DB 함수와 상태 검사 존재. HTTP API 및 화면 없음 |
| 식당 웹 실행 | 구현됨 | restaurant-web의 Next.js 빌드 및 scripts/smoke.mjs에서 실제 HTTP 페이지·웹→NestJS health·API 중단 503 검증 성공 |
| 식당 업무 화면 | 부분 구현 | restaurant-web/src/app/page.tsx는 시작 안내와 ConnectionStatus만 표시. 등록/주문 목록/접수/조리 버튼 없음 |
| 차량·모바일 앱 빌드 | 구현됨 | Gradle assembleDebug 두 모듈 성공, APK 존재. 이는 차량 실행/업무 기능 성공과 별개 |
| 차량 주문/상태 화면 | 미구현 | MyCarAppScreen.kt는 “새 화면 준비 중” MessageTemplate, MainActivity.kt는 빈 Compose 화면 |
| 차량 앱 실제 실행 | 확인 불가 | adb devices -l에 기기 없음. AVD 이름 Pleos_Connect_v2.1.0은 있으나 부팅/설치/호스트 실행을 이번 조사에서 수행하지 않음 |
| 실제 SDK/실차 데이터 연동 | 확인 불가(미검증) | gradle/libs.versions.toml과 Manifest에 AndroidX Car App/Automotive 선언 존재. 소스·의존성 및 배포 AAR/JAR 탐색에서 Pleos 전용 SDK 호출/설정 미발견. AVD 존재를 SDK 성공 증거로 세지 않음 |
| 로컬 DB·개발 사용자 인증 | 구현됨 | server/src/database/local-database.ts의 PGlite 파일 저장·마이그레이션 이력·토큰 해시, auth.guard.ts. HTTP 테스트가 재시작 보존/소유권 검증 |
| 실제 Supabase 호스팅·Auth | 미구현 | 현재 어댑터는 LocalDatabase, .env.example은 향후 연결 자리. health의 SUPABASE_URL 감지만으로 DB 접속 성공을 뜻하지 않음 |

## 기술 스택과 파일 근거
- Kotlin/Android: mobile, automotive, shared. settings.gradle.kts의 세 모듈, Gradle 9.5.0, Android Gradle Plugin 9.3.3, Android SDK 37/min30. AndroidX Car App core/projected 1.4.0, automotive 1.7.0 선언.
- 식당 웹: restaurant-web/package.json의 Next.js 16.4.5, React 19.3.1, TypeScript.
- 서버: server/package.json의 NestJS 12.3.3, TypeScript, Zod 4.6.7, PGlite 0.5.15.
- 공통 계약: contracts/src/index.ts. 주문·조리·차량 세 상태 그룹을 분리.
- DB: supabase/migrations/20261104000100_core.sql, 20261104000200_reservations.sql, 20261104000300_menu_order_api.sql. 업무 테이블은 users/user_vehicles/restaurants/restaurant_members/restaurant_pickup_locations/orders/order_items/cooking_reservations/menus 총 9개.
- 테스트: server/test/app.test.mjs, server/test/pickup-api.test.mjs, supabase/tests/database.test.mjs. 테스트 사용자·식당·메뉴는 fixture이며 실제 차량 데이터가 아니다.

## 이번 실행 결과와 재현
루트 작업 디렉터리에서 아래 명령을 실행했다. npm 의존성 신규 설치, 스키마 재설계, 운영 DB 변경은 하지 않았다. 각 로그에는 명령과 종료 코드가 있다.

| 실행 | 결과 | 로그 |
|---|---|---|
| npm run build | 종료 0, 공통 계약/NestJS/Next.js 빌드 성공 | [web-server-build.log](web-server-build.log) |
| npm run typecheck | 종료 0 | [typecheck.log](typecheck.log) |
| npm test | 종료 0, API 13개(그룹/하위 포함) + DB 8개 통과 | [api-db-tests.log](api-db-tests.log) |
| npm run test:smoke | 종료 0, 페이지·health 통신·중단 응답 성공 | [web-server-smoke.log](web-server-smoke.log) |
| 두 Android assembleDebug 및 단위 테스트 | 종료 0, 99 tasks up-to-date. 증분 빌드 결과 | [android-build-excerpt.log](android-build-excerpt.log) |
| Android 단위 테스트 --rerun-tasks | 종료 0, 61 tasks executed | [android-unit-tests.log](android-unit-tests.log) |
| adb devices -l / emulator -list-avds | 종료 0, 연결 기기 없음 / Pleos AVD 이름 1개 | [android-environment.log](android-environment.log) |

Android 명령의 JAVA_HOME은 /Applications/Android Studio.app/Contents/jbr/Contents/Home을 사용했다.

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :mobile:assembleDebug :automotive:assembleDebug :mobile:testDebugUnitTest :automotive:testDebugUnitTest --offline
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :mobile:testDebugUnitTest :automotive:testDebugUnitTest --offline --rerun-tasks
```

두 Android 테스트 XML은 각각 tests=1/failures=0/errors=0/skipped=0이다. 테스트 내용은 2+2=4인 샘플이며 차량·주문 기능을 검증하지 않는다. Gradle 10과 호환되지 않는 deprecated 기능 경고가 있다. 실제 기기가 없어 connected Android 테스트는 실행하지 않았다. 과거 조사에서 발생한 UTP 캐시 오류를 오늘 발생한 오류로 재기록하지 않았다.

이번 실행한 검사에서 실패는 없었다. SDK/차량 실행 불가는 테스트 실패가 아니라 환경 부재에 따른 미검증이다. Android build 로그는 도구 출력 발췌이며 단위 테스트 재실행 로그는 전체 저장했다.

## 장애·미완료 목록
1. 서버에 식당 주문 목록·수락·거절·조리 시작 경로가 없어 DB 기능을 사용자 흐름으로 호출할 수 없다.
2. 식당 웹은 연결 확인만 가능하다. 주문 관리 화면과 API 연결이 필요하다.
3. 차량 화면·메뉴 선택·주문 전송·상태 표시가 없다. 실제 ETA 공급 경로도 없다.
4. 실행 중인 장치/차량 호스트가 없어 Pleos 실행 및 SDK 호환성을 검증하지 못했다. 전용 SDK·API 확보 여부부터 확인해야 한다.
5. 픽업 장소의 공간 예약은 모델/정책 자체가 없다. 기존 max_concurrent_orders는 주방 조리 수용량이므로 공간 예약으로 사용하면 안 된다.
6. 메뉴별 조리시간은 미구현이다. 기존 주문 수락 시 조리시간 방식과 어느 정책을 사용할지 구분해야 한다.
7. 실제 Supabase/Auth·운영 인증 미연결. 현재 개발 토큰·로컬 DB는 production 사용을 차단한다.
8. 독립 PostgreSQL 세션의 경쟁 요청, 실제 ETA 변동, 장시간 조리 지연 자동 감지·알림은 미검증/미구현이다.
9. .git이 없어 원격 저장소·커밋 기준 감사는 불가하다. 현재 디렉터리의 파일 기준 결과다.

당장 테스트를 통과했다는 이유로 위 연결·화면·SDK·공간 예약을 완료 처리하지 않았다.

## 후속 SDK 조사 참고
후속 조사에서 Gradle 공용 캐시의 NaviHelper 3.0.5 AAR 및 Pleos 이미지 실파일을 발견했고, 읽기 전용 AVD 부팅·기존 APK 설치를 확인했다. 앞선 장치 없음 결과는 그 검사 시점의 결과다. 실제 SDK 호출은 여전히 미검증이며 최신 세부 결과는 [SDK 검증표](../../sdk/2026-11-05-pleos-weekend-readiness.md)를 참고한다.
