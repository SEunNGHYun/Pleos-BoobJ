# 밥맞J 픽업형 MVP 구현 현황 조사

조사일: 2026-11-03 (한국시간)  
대상: `/Users/yunseunghyeon/Desktop/hyundai`의 현재 파일. 외부 저장소·서비스와 백업 압축파일 내부는 현재 구현 판단에서 제외했다. 소스·빌드 설정 수정 없이 조사했으며 빌드 산출물과 캐시는 검증 과정에서 생성될 수 있다.

## 요약
현재 구현은 Android 모바일·차량 앱의 최소 실행 골격이다. 픽업 주문 기능, 식당 웹, 서버는 현재 조사 범위에서 미구현이다. 두 Android 앱의 Debug 빌드와 샘플 단위 테스트는 성공했다. Pleos 전용 SDK 호출, 실제 ETA 수신, 차량 호스트 실행 성공은 확인하지 못했다. 로컬에 Pleos 이름의 AVD가 있다는 사실만으로 실제 SDK 연동 성공으로 판단하지 않는다.

## 지침 확인
- 대상 폴더 전체에서 README 계열 파일, AGENTS.md, CLAUDE.md, GEMINI.md를 탐색했으나 발견하지 못했다. 상위 `/`, `/Users`, `/Users/yunseunghyeon`, `/Users/yunseunghyeon/Desktop`의 AGENTS.md도 없었다.
- `.agents`, `.codex`, `.git` 디렉터리가 대상 폴더에 없다. Git 이력·원격 저장소에 근거한 비교는 불가하다.
- 확인한 프로젝트 문서는 [2026-11-02-context.md](2026-11-02-context.md)다. 초기화 이력 및 기획 맥락이며 구현 완료 증거로 사용하지 않았다.
- 대화에서 확정된 상태값과 차량번호·전화번호 요구사항은 비교 기준이다. 현재 코드에 반영됐다는 의미가 아니다.

## 확인한 모듈과 기술 스택
| 경로 | 확인 내용 | 근거 |
|---|---|---|
| `mobile/` | Kotlin Android 애플리케이션, Jetpack Compose·Material3, Android Auto projected 의존성. 현재 빈 Surface/Box만 표시 | `mobile/build.gradle.kts`, `mobile/src/main/java/com/example/delivery/MainActivity.kt:13` |
| `automotive/` | Android Automotive 애플리케이션, AndroidX CarAppActivity 사용. 직접 작성한 main Kotlin 파일 없음 | `automotive/build.gradle.kts`, `automotive/src/main/AndroidManifest.xml:28` |
| `shared/` | Android 라이브러리. CarAppService → Session → Screen → MessageTemplate | `shared/build.gradle`, `shared/src/main/java/com/example/delivery/shared/`의 3개 Kotlin 파일 |
| 식당 웹 | 모듈·소스·실행 정의 미발견, 스택 확인 불가 | 전체 파일 탐색 및 `settings.gradle.kts`의 include 목록 |
| 서버 | 모듈·소스·실행 정의 미발견, 스택 확인 불가 | 동일 |

루트 프로젝트명은 `Delivery`, 앱 ID는 두 앱 모두 `com.example.delivery`다. Gradle에 선언된 모듈은 `:mobile`, `:automotive`, `:shared`뿐이다. 웹·서버의 경로나 언어를 가정하지 않았다.

설정 근거:
- `gradle/wrapper/gradle-wrapper.properties`: Gradle 9.5.0.
- `gradle/libs.versions.toml`: Android Gradle Plugin 9.3.3, Kotlin Compose 플러그인 2.2.10, Compose BOM 2026.02.01, Car App core/projected 1.4.0, automotive 1.7.0, JUnit 4.13.2.
- 세 모듈의 Android 설정: compile/target SDK 37, min SDK 30, Java 소스 호환성 11.
- `gradle/gradle-daemon-jvm.properties`: 데몬 toolchainVersion=25. Java 소스 호환성 및 Compose 플러그인 버전과 구분한다.
- `local.properties`: Android SDK 경로가 지정되어 있다. 검증 명령의 JAVA_HOME은 설치된 Android Studio 번들 JBR을 사용했다.

## 구현 현황표
분류: 구현됨=범위 내 코드와 검증 근거 존재, 부분 구현=골격만 존재, 미구현=현재 전체 소스·설정에서 구현 미발견, 확인 불가=환경 또는 외부 실행 증거 부족.

| 항목 | 판정 | 확인 근거 및 한계 |
|---|---|---|
| Android 모듈 구성·APK 생성 | 구현됨 | `settings.gradle.kts`, 두 `assembleDebug` 성공 및 APK 메타데이터 |
| 사용자 앱 화면 | 부분 구현 | `MainActivity.kt:13`의 빈 Compose 화면. 메뉴·주문 UI 없음 |
| 차량 앱 진입 경로 | 부분 구현 | `MyCarAppService.kt:8`, `MyCarAppSession.kt:8`, `MyCarAppScreen.kt:9`. 화면은 고정 문구 “새 화면 준비 중”뿐 |
| Android Auto/Automotive 선언 | 구현됨 | 양 앱 Manifest, shared Manifest, `shared/src/main/res/xml/automotive_app_desc.xml`. 선언·빌드 범위의 판단 |
| 실제 Pleos 호스트·SDK 연동 | 확인 불가 | AndroidX 의존성/호스트 선언 존재. Pleos 전용 의존성·호출 미발견. 연결 장치·실행 성공 증거 없음 |
| 식당 웹 | 미구현 | 웹 진입점·패키지 정의·소스 미발견 |
| 서버·DB·영속화 | 미구현 | 서버 진입점·라우트·DB 모델·저장 로직 미발견 |
| 메뉴·픽업 위치 등록/조회 | 미구현 | main Kotlin 4개 파일에 해당 로직 없음 |
| 주문 모델·차량번호·전화번호 | 미구현 | DTO/entity/model·입력·저장 구현 미발견 |
| 주문 생성·수락·거절·취소·완료 API | 미구현 | 라우트·클라이언트·API 계약 파일 미발견 |
| 주문 상태 모델 | 미구현 | PENDING/ACCEPTED/REJECTED/CANCELLED/COMPLETED 정의 및 전이 없음 |
| 조리 상태 모델 | 미구현 | UNSCHEDULED/SCHEDULED/COOKING/READY 정의 및 전이 없음 |
| 차량 상태 모델 | 미구현 | UNKNOWN/EN_ROUTE/NEARBY/ARRIVED 정의 및 전이 없음 |
| 수락 시 조리시간 입력·변경 | 미구현 | 관련 UI·서버 처리 없음 |
| ETA 수신·조리 예약 계산·LOCK | 미구현 | 위치·ETA 공급자·계산·스케줄러·전이 처리 없음 |
| 도착 3분 전 알림·상태 동기화 | 미구현 | 이벤트·통신·알림 구현 없음 |
| 주문 단위·통합 테스트 | 미구현 | 테스트는 산술·패키지명 샘플뿐 |
| 샘플 단위 테스트 | 구현됨 | mobile/automotive 각각 1개, 실패·오류 0개. 업무 동작 검증 아님 |
| 앱 설치·실행·기기 테스트 | 확인 불가 | 장치 없음, connected 테스트는 의존성 해석 단계에서 실패 |

전체 소스 탐색은 생성물·캐시·백업을 제외해 수행했다. main Kotlin은 `MainActivity.kt` 25줄, `MyCarAppScreen.kt` 14줄, `MyCarAppService.kt` 15줄, `MyCarAppSession.kt` 11줄로 전부 읽었다. `pleos|order|pending|accepted|cooking|eta|retrofit|ktor|okhttp|http|mock|fake|fixture` 검색 결과는 주로 XML namespace·문서 주석이었다. 기능 부재 판단은 검색만이 아니라 전체 소스와 빌드 의존성 열람에 근거한다.

## 실제 연동과 모의 데이터 구분
| 구분 | 관찰 | 판단 |
|---|---|---|
| 실제 라이브러리 의존성 | AndroidX Car App core/projected/automotive 선언 및 빌드 성공 | 실제 AndroidX 기반 구성. Pleos 실차 실행 성공과는 별개 |
| 실제 차량 데이터 | 차량번호·GPS·속도·ETA 읽기 코드 없음 | 미구현 |
| Pleos 환경 흔적 | `emulator -list-avds` 결과 `Pleos_Connect_v2.1.0`, 로컬 AVD descriptor 존재 | AVD 설정 존재만 확인. 이미지 정상 부팅·SDK 버전은 검증 안 함 |
| 모의 업무 데이터 | 주문·식당·메뉴·ETA fixture/fake/repository 미발견 | 모의 데이터 기반 MVP도 구현되지 않음 |
| 고정 표시 문구 | `MyCarAppScreen.kt:11`의 “새 화면 준비 중” | 화면 placeholder. 차량 데이터나 주문 데이터 아님 |
| 테스트 상수 | `2 + 2`, `com.example.delivery` | 샘플 테스트 값. 업무 데이터 아님 |

## 빌드·실행 검증과 재현 절차
작업 디렉터리는 대상 루트다. 아래 명령은 소스를 변경하지 않는다. Gradle은 기존 캐시 접근 권한이 필요하다.

### 1. Debug 빌드 및 단위 테스트: 성공
```sh
cd /Users/yunseunghyeon/Desktop/hyundai
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :mobile:assembleDebug :automotive:assembleDebug :mobile:testDebugUnitTest :automotive:testDebugUnitTest --offline
```
권한이 허용된 실행 결과: `BUILD SUCCESSFUL in 3s`, 종료 코드 0, 99 actionable tasks (13 executed, 86 up-to-date). 증분 빌드이며 clean 빌드·네트워크 신규 환경 검증은 아니다.

산출물:
- `mobile/build/outputs/apk/debug/mobile-debug.apk`
- `automotive/build/outputs/apk/debug/automotive-debug.apk`
- 양 폴더의 `output-metadata.json`에서 앱 ID·산출물 이름 확인.
- `mobile/build/test-results/testDebugUnitTest/TEST-com.example.delivery.ExampleUnitTest.xml`
- `automotive/build/test-results/testDebugUnitTest/TEST-com.example.delivery.ExampleUnitTest.xml`

각 XML: tests=1, failures=0, errors=0, skipped=0. 각각 `addition_isCorrect`뿐이다.

초기 제한된 실행에서는 `~/.gradle/wrapper/dists/gradle-9.5.0-bin/.../gradle-9.5.0-bin.zip.lck (Operation not permitted)`로 종료 코드 1. 동일 명령을 기존 캐시 접근 권한으로 재실행해 성공했다. 소스 오류로 분류하지 않는다. Gradle 10 비호환 deprecated 기능 경고는 남아 있다.

### 2. 장치·AVD 확인
```sh
/Users/yunseunghyeon/Library/Android/sdk/platform-tools/adb devices -l
/Users/yunseunghyeon/Library/Android/sdk/emulator/emulator -list-avds
```
첫 adb 시도는 `could not install *smartsocket* listener: Operation not permitted`, `cannot connect to daemon`으로 실패. 권한을 허용한 동일 명령은 종료 코드 0, `List of devices attached` 아래 장치가 없는 결과였다. AVD 목록은 `Pleos_Connect_v2.1.0`을 반환했다. 이번 조사에서는 에뮬레이터를 새로 부팅하거나 앱을 설치하지 않았다. 따라서 화면 렌더링·호스트 호환성·실제 SDK 동작은 확인 불가다.

### 3. 기존 기기 테스트: 실패
```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :mobile:connectedDebugAndroidTest :automotive:connectedDebugAndroidTest --offline --continue
```
종료 코드 1, `BUILD FAILED in 714ms`. 핵심 오류:
```text
Configuration cache state could not be cached
Could not resolve all files for configuration ':mobile:unified-test-platform-android-test-plugin-host-additional-test-output'.
Could not resolve com.android.tools.utp:android-test-plugin-host-additional-test-output:32.3.3.
No cached version ... available for offline mode.
```
configuration-cache 직렬화 오류에 위 의존성 해석 실패가 함께 보고되었다. 기기 테스트 실제 실행 전 실패했으므로 테스트 assertion 실패나 “장치 없음으로 Gradle 실패”라고 해석하지 않는다. 원본 보고서는 `build/reports/configuration-cache/6721k6xcb56kjinh0snmeop73/51zq7wyyf3zf3q13u3ya3j5p3/configuration-cache-report.html`. 빌드 산출물이므로 향후 삭제될 수 있다.

후속 검증에는 필요한 테스트 의존성을 받을 수 있는 환경과 실행 중인 적합한 장치/호스트가 필요하다. 온라인 재시도·에뮬레이터 부팅은 이번 조사 결과에 포함되지 않는다. 기존 기기 테스트는 패키지명 검사뿐이며 차량 화면 테스트는 아니다.

### 4. 식당 웹·서버 실행
현재 코드·실행 명령 정의가 없으므로 실행 시도할 대상이 없다. 임의의 기술 스택이나 포트로 실행하지 않았다. 다른 저장소에 존재하는지는 확인 불가다.

## 다음 작업의 장애 요인
| 우선순위 | 장애 요인 | 확인 근거 | 해소에 필요한 작업 |
|---|---|---|---|
| 1 | 서버·식당 웹 구현 기반 없음 | 모듈/소스/실행 정의 미발견 | 실제 배치 위치와 기술 스택 결정, 서버·식당 클라이언트 구성 |
| 1 | 확정한 상태 모델·API 계약이 코드에 없음 | main 소스 전체 확인 | 주문/조리/차량 모델과 전이 허용 조건, API 요청·응답 명세 작성 |
| 1 | ETA 데이터 경로 불명 | 차량 데이터 호출 없음 | 사용 가능한 Pleos 데이터 공급 방식 검증, 모의 ETA 공급자와 실제 공급자 구분 |
| 1 | Pleos 실행 증거 없음 | AVD만 존재, adb 장치 목록 비어 있음 | 적합한 에뮬레이터/호스트 부팅 후 설치·실행 검증 |
| 2 | 기기 테스트 도구 오프라인 캐시 누락 | UTP 32.3.3 해석 실패 | 의존성 확보 후 기기 테스트 재실행 |
| 2 | 업무 테스트 전무 | 샘플 산술/패키지명 테스트만 존재 | 예약 재계산·LOCK·취소·종료 상태·알림 중복 방지 검증 |
| 2 | 차량 호스트 허용 정책이 개발용 | `MyCarAppService.kt`의 ALLOW_ALL_HOSTS_VALIDATOR | 대상 호스트 신뢰 정책 확인 및 배포 전 정책 정리 |
| 2 | 두 앱 ID 동일 | 양 앱 Gradle 및 APK 메타데이터 | 같은 장치에 동시 설치가 필요할 경우 설치 구성 검토 |
| 3 | 의존성 버전 차이 | core/projected 1.4.0 vs automotive 1.7.0 | 실호스트 검증 시 호환성 확인. 현재 빌드 실패 원인이라고 단정하지 않음 |
| 3 | README·Git 메타데이터 없음 | 루트 및 지침 탐색 | 실행 안내·원본 저장소 위치·변경 관리 방법 정리 |

이 문서는 조사 결과이며 새 아키텍처·구현 계획의 승인 문서가 아니다. 현재 폴더 밖의 코드/서비스 부재, 실제 차량 SDK 미지원 여부를 단정하지 않는다.
