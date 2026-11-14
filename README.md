# 집밥 타이밍 · 밥맞J

출발 전에 음식을 주문하고 식당을 경유지로 설정해, 이동 중 식당이 지정한 픽업 구역에서 차에서 내리지 않고 음식을 받는 Pleos 차량용 앱입니다.

## 서비스 소개와 시연

[서비스 소개](소개/README.md) · [차량용 서명된 릴리스 APK](apk/yunseunghyeon-babmatj-release.apk) · [시연 영상](소개/babmatj-pickup-demo.mp4) · [흐름도](소개/흐름도.md) · [단계별 캡처](소개/flows/README.md)

## 구성

| 경로 | 기술·역할 |
|---|---|
| `automotive/` | 기존 Android Automotive 차량 앱 |
| `mobile/` | 기존 Android 모바일 앱 |
| `shared/` | Android 공통 Car App 코드 |
| `restaurant-web/` | Next.js 16 / React 19 / TypeScript 식당 웹 |
| `server/` | NestJS 12 / TypeScript 중앙 API |
| `contracts/` | API 응답 타입과 주문·조리·차량 상태 정의 |
| `supabase/` | PostgreSQL 마이그레이션과 DB 테스트 |
| `docs/` | 설계·구현 조사 문서 |

JavaScript 영역은 npm workspaces, Android 영역은 기존 Gradle 프로젝트로 관리합니다. 루트 `package-lock.json`이 워크스페이스 의존성 기준입니다. `supabase/tests/package-lock.json`은 기존 DB 단독 테스트 실행을 위해 유지합니다.

## 테스트 환경과 필요한 설정

| 항목 | 환경 |
|---|---|
| 차량 에뮬레이터 | Pleos Connect v2.1.0, Android API 34, ARM64 |
| 화면 규격 | 가로 2560 × 1440 px, 160 dpi |
| 빌드·실행 도구 | Android Studio, Android SDK 및 ADB, Node.js 22.9 이상과 npm. 로컬 웹·서버 검증에는 Node.js 26 사용 |
| 주문 시연 | 로컬 PGlite DB, 식당·차량 개발 계정, ADB 포트 연결, 식당에서 입력한 MOCK ETA |
| 경유 거리 조회 | 서버의 `KAKAO_FREE_ROUTING_KEY`와 Pleos 내비의 출발지·목적지 좌표 |

## 실행 방법

저장소 루트에서 시연 DB와 식당 데이터를 준비한 뒤 웹과 API를 시작합니다.

```sh
npm ci
npm run local:setup
npm run local:seed
npm run dev
```

- 식당 웹: http://127.0.0.1:3000
- NestJS 상태 확인: http://127.0.0.1:3001/api/health
- 웹 경유 상태 확인: http://127.0.0.1:3000/api/health

`npm run dev`는 공통 계약을 먼저 빌드하고 웹·서버를 함께 실행합니다. Ctrl+C로 함께 종료합니다. 개별 개발은 `npm run dev:web`, `npm run dev:server`를 사용합니다. 공통 계약을 수정하면 개발 명령을 재시작하거나 `npm run build --workspace @babmatj/contracts`를 실행합니다.

필요한 경우 `server/.env.example`을 `server/.env`로, `restaurant-web/.env.example`을 `restaurant-web/.env.local`로 복사해 설정합니다. 기본 포트에서는 파일 없이 실행됩니다. 웹은 서버 측 `API_BASE_URL`로만 NestJS에 연결하므로 브라우저용 CORS 설정이나 DB 비밀 키가 필요하지 않습니다.

서버 포트는 `server/.env`의 PORT/HOST로 변경할 수 있습니다. 웹 포트 변경 시 `npm run dev --workspace @babmatj/restaurant-web -- --port 3100`처럼 지정합니다. 환경 설정 변경 후 해당 프로세스를 재시작합니다.

## 검증·배포 빌드

```sh
npm run build
npm run typecheck
npm test
npm run test:smoke
```

`npm test`는 NestJS HTTP 동작과 기존 DB 테스트를 실행합니다. `test:smoke`는 빌드된 웹·서버를 임시 포트에 띄워 페이지, Next.js→NestJS 연결, 서버 중단 시 응답을 검증하고 프로세스를 종료합니다. 로컬 포트 사용 권한이 필요합니다.

프로덕션 빌드 실행은 별도 터미널에서 다음과 같습니다.

```sh
npm run start --workspace @babmatj/server
npm run start --workspace @babmatj/restaurant-web
```

차량용 릴리스 APK는 루트에서 `./gradlew :automotive:assembleRelease`로 빌드합니다. 제출용 서명 APK는 `apk/yunseunghyeon-babmatj-release.apk`에 있습니다. 같은 앱의 업데이트에는 동일한 서명 키를 사용합니다. 로컬 주문 시연은 `./gradlew :automotive:assembleDebug`로 빌드한 디버그 APK와 개발 계정 설정을 사용합니다. [시연 실행 안내](docs/api/two-screen-demo.md)

## 현재 구현 범위

차량 앱은 목적지 기반 식당 검색, 메뉴·픽업 장소 선택, 주문 및 상태 조회를 지원합니다. 식당 웹은 주문 수락·거절, 조리 일정 및 공간 예약 확인, 수동 조리 시작·준비 완료·입장·인도 처리를 지원합니다. 시연은 로컬 DB와 MOCK ETA를 사용합니다. 호스팅 Supabase·Auth 연결은 후속 범위입니다.

[API 입력·응답과 로컬 계정 사용 방법](docs/api/pickup.md) 및 [식당 주문 접수 API](docs/api/restaurant-receipt.md)를 참고하세요. 개발 계정 토큰은 `.local/credentials.json`에 저장되며 로컬 모드는 운영 환경에서 사용하지 않습니다.

health의 `status=ok`는 API 프로세스 응답만 의미합니다. `database=not_configured`는 연결 설정 없음, `not_verified`는 URL만 설정됐지만 실제 DB 접속은 확인하지 않았다는 뜻입니다. `local_ready`는 로컬 개발 DB가 초기화됐다는 뜻입니다. 서버 전용 키는 웹/차량 앱에 포함하지 않습니다.

[DB 실행·적용 안내](supabase/README.md), [DB 모델](docs/architecture/supabase-data-model.md).
