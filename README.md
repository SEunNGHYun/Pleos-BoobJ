# 밥맞J 픽업형 MVP

Pleos 차량 앱, 식당 웹, 중앙 서버, Supabase 스키마를 같은 프로젝트에서 관리하는 모노레포입니다.

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

## 시작

Node.js 22.9 이상과 npm이 필요합니다. 로컬 검증 환경은 Node.js 26입니다.

```sh
npm ci
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

Android는 기존과 동일하게 Android Studio 또는 `./gradlew :mobile:assembleDebug :automotive:assembleDebug`로 빌드합니다. 루트 npm build는 Android 빌드를 포함하지 않습니다.

## 현재 구현 범위

식당 웹 시작 화면, 중앙 서버 연결 상태/재시도, 식당·메뉴·픽업 위치 등록 API, 사용자 주문 생성·조회·픽업 장소 API, 식당 주문 목록·수락·거절 API, 공통 상태 계약을 제공합니다. 로컬 DB 설정은 `npm run local:setup` 후 `npm run dev`로 실행합니다. [차량 주문·식당 접수 시연](docs/api/two-screen-demo.md)은 로컬 DB와 MOCK ETA를 사용합니다. Supabase 호스팅/Auth 연결은 후속 작업입니다. 임의의 주문·매출·식당 fixture를 실제 데이터로 표시하지 않습니다.

[API 입력·응답과 로컬 계정 사용 방법](docs/api/pickup.md) 및 [식당 주문 접수 API](docs/api/restaurant-receipt.md)를 참고하세요. 개발 계정 토큰은 `.local/credentials.json`에 저장되며 로컬 모드는 운영 환경에서 사용하지 않습니다.

health의 `status=ok`는 API 프로세스 응답만 의미합니다. `database=not_configured`는 연결 설정 없음, `not_verified`는 URL만 설정됐지만 실제 DB 접속은 확인하지 않았다는 뜻입니다. `local_ready`는 로컬 개발 DB가 초기화됐다는 뜻입니다. 서버 전용 키는 웹/차량 앱에 포함하지 않습니다.

[DB 실행·적용 안내](supabase/README.md), [DB 모델](docs/architecture/supabase-data-model.md).
