# 웹 실습 팩

testhub 실습 환경의 웹 번들에 들어가는 팩을 빌드합니다. 팩에는 Medusa 2.18.0 서버와 관리자 화면, 상점(Next.js), 실습 환경 제어용 Node 스크립트가 포함되어 있습니다.

- 팩은 빌드 머신(개발자 환경 또는 릴리스 워크플로)에서 생성합니다. 학습자 PC에서는 팩을 내려받아 압축만 풀면 되며, 별도의 `npm install`이나 빌드 과정이 필요 없습니다.
- **팩은 운영체제와 무관하게 단일 파일로 제공됩니다.** 어느 운영체제에서 빌드해도 동일하며, macOS arm64, macOS x64, Windows x64 모두 같은 팩을 사용합니다.
  - 운영체제별로 달라지는 요소는 PostgreSQL 실행 파일(`embedded-postgres`의 플랫폼 패키지)뿐입니다. 이 부분은 팩에서 제외하고, 학습자 PC에서 해당 운영체제용 패키지만 설치합니다. 데스크톱 앱은 설치 파일에 기본 내장하며(`desktop/build-postgres.mjs`), 앱 외부 환경에서는 `manifest.json`의 npm 경로에서 내려받아 `sha512` 무결성 체크섬을 검증합니다.
  - 빌드 시점에만 쓰이는 네이티브 모듈(`esbuild`, `rollup`, `msgpackr-extract`의 플랫폼 패키지)도 제외합니다. 런타임에는 사용되지 않습니다(팩 테스트로 검증함).
  - 플랫폼 대응표와 제외 규칙: `lib/platforms.mjs`
- 설계 문서: [실습 환경 화면 설계](../docs/superpowers/specs/2026-11-15-playground-design.md), 구현 계획: [1단계 구현 계획](../docs/superpowers/plans/2026-11-15-playground-web.md)

## 빌드 및 테스트

Node 20 이상이 필요합니다.

```bash
cd playground-pack
npm ci                 # embedded-postgres, pg, playwright-core(테스트용) 설치
node build.mjs         # out/testhub-web-pack-<버전>.tar.gz 및 .sha256 생성 (약 100MB)
npm test               # 빌드한 팩을 임시 폴더에 풀고 현재 OS용 PostgreSQL을 배치한 뒤 PostgreSQL, Medusa, 상점을 기동하여 브라우저 장바구니 담기까지 테스트한다
```

- 재빌드 시 `backend`, `storefront`의 `node_modules`가 이미 있으면 `node build.mjs --skip-install` 옵션으로 `npm ci`를 건너뛸 수 있습니다.
- 테스트용 브라우저는 `playwright-core`(1.63.0)가 설치한 Chromium을 사용합니다. 처음 실행 시 `npx playwright-core install chromium`을 실행하세요. 시스템에 설치된 Chrome을 사용하려면 `TESTHUB_CHROME_BINARY`를 지정합니다.
- 빌드 결과 폴더 이름을 `dist`로 지정하지 마세요. 아래 `경로에 dist가 있으면` 항목을 참고하세요.
- 테스트가 `root` 권한으로 실행되면(컨테이너, CI 환경) PostgreSQL은 `postgres` 사용자로 기동합니다(PostgreSQL은 `root` 계정으로 직접 실행되지 않습니다).

## 팩 구조 (압축 해제 후)

```text
manifest.json           {"pack": "web", "version", "medusa": "2.18.0", "platform": "any", "postgres", "node_engines", "starter", "built_at"}
                        postgres: 플랫폼별 {"name", "version", "url", "integrity"} (설치할 PostgreSQL 패키지 정보)
LICENSES.md             서드파티 소프트웨어 및 npm 패키지 라이선스 목록 (빌드 시 자동 생성)
package.json            embedded-postgres, pg
node_modules/           위 두 패키지. 설치 후 @embedded-postgres/<플랫폼>(PostgreSQL 실행 파일)이 추가됨
bin/db.mjs              PostgreSQL 제어 스크립트
bin/medusa.mjs          Medusa CLI 래퍼 (사용 통계 비활성화 포함)
backend/                Medusa 운영 빌드(.medusa/server)와 운영 의존성, public/admin(관리자 화면)
storefront/             상점 스탠드얼론(standalone) 빌드 (server.js, .next/static, public). storefront/README.md 참고
```

### bin/db.mjs

```bash
node bin/db.mjs init <datadir>
node bin/db.mjs start <datadir> <port> [--until-stdin-closes]   # 준비되면 "PG READY" 출력
node bin/db.mjs stop <datadir>                                  # "PG STOPPED" 또는 "PG NOT RUNNING" 출력
node bin/db.mjs create <port> <db>
node bin/db.mjs snapshot <port>          # medusa -> medusa_seed 복제
node bin/db.mjs reset <port>             # medusa_seed -> medusa 초기화
node bin/db.mjs publishable-key <port> [token]   # 시드가 생성한 publishable key 조회. token을 주면 그 값으로 고정한 뒤 조회
```

- 접속 주소는 `postgres://postgres:postgres@localhost:<port>/medusa`입니다. 서버는 `localhost`에서만 연결을 수신 대기(listen)합니다.
- `start`는 `pg_ctl`로 서버를 실행하며, 서버 로그는 `<datadir>/postgres.log`에 기록됩니다. Windows에서 관리자 권한으로 실행되더라도 `pg_ctl`은 권한을 낮춘 토큰으로 실행합니다(PostgreSQL은 관리자 권한 직접 실행을 거부함).
- `start`는 `SIGINT`, `SIGTERM` 시그널을 받으면 서버를 종료합니다. PostgreSQL이 먼저 종료된 경우(외부 종료 또는 크래시) 종료 코드 `1`로 끝납니다. `--until-stdin-closes` 옵션을 주면 표준 입력(stdin)이 닫힐 때도 함께 종료합니다. Windows에서는 POSIX 시그널을 전달할 수 없으므로 관리 프로세스가 표준 입력을 닫아 종료를 알립니다.
- `start`를 실행한 Node 프로세스가 강제 종료되면 PostgreSQL 프로세스가 남을 수 있습니다. 이때 `stop`이 잔여 프로세스를 정리합니다. `postmaster.pid`의 PID만 신뢰하지 않고, 해당 포트로 접속해 `data_directory`가 이 폴더와 일치하는지 검증한 뒤에만 `pg_ctl stop`을 호출합니다(기존 PID가 다른 프로그램에 재할당되었을 가능성 차단). `start` 역시 기동 전 동일한 정리 절차를 수행합니다.
- 내장 PostgreSQL에는 `pg_dump`가 없으므로 초기화는 템플릿 DB 복제 방식으로 처리합니다. 시드 적재 직후 `snapshot`을 찍어 두고, 초기화 시 `reset`으로 복원합니다. Medusa가 실행 중인 상태에서도 초기화할 수 있으며 Medusa는 자동으로 재연결합니다.

### bin/medusa.mjs

```bash
XDG_CONFIG_HOME=<실습 환경>/config DATABASE_URL=... PORT=... node bin/medusa.mjs db:migrate   # 마이그레이션과 시드 적재
XDG_CONFIG_HOME=<실습 환경>/config ... node bin/medusa.mjs start
XDG_CONFIG_HOME=<실습 환경>/config ... node bin/medusa.mjs user -e admin@example.com -p <비밀번호>
```

- Medusa 환경 변수: `DATABASE_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, `JWT_SECRET`, `COOKIE_SECRET`, `PORT`. `NODE_ENV`가 지정되지 않으면 `production`으로 동작합니다.
- **사용 통계(텔레메트리) 비활성화**: `MEDUSA_DISABLE_TELEMETRY=true`를 설정하고, `XDG_CONFIG_HOME`을 반드시 지정해 그 아래 `medusa/config.json`에 `telemetry.enabled: false`를 기록합니다. 환경 변수만 설정하면 Medusa CLI가 텔레메트리 안내를 띄우고 사용자 홈의 `~/.config/medusa/config.json`에 `enabled: true`와 기기 ID를 기록할 수 있기 때문입니다.
- 자식 프로세스를 새로 생성하지 않고 현재 Node 프로세스 안에서 CLI를 실행합니다. 관리 프로세스가 제어할 프로세스를 하나로 유지하기 위함입니다.
- 백엔드 경로에 `dist` 문자열이 포함되어 있으면 종료 코드 `3`으로 실행을 거부합니다(아래 참고).

### 경로에 dist가 있으면 Medusa가 동작하지 않는 문제

Medusa 2.18.0의 `@medusajs/utils`(`modules-sdk/joiner-config-builder.js`)는 모델 디렉터리를 탐색할 때 모듈 파일의 전체 경로에 `dist`라는 문자열이 **어디에든** 포함되어 있으면 그 위치를 기준으로 경로를 잘라냅니다. 원래는 패키지 자체의 `dist` 폴더를 찾기 위한 로직이지만, 상위 폴더 경로에 `dist`가 포함되면(예: `/Users/kdistel/...`, `.../dist/stage/...`) 엉뚱한 경로를 참조하게 됩니다. 그 결과 모듈을 불러오지 못해 시드는 `Service with alias "shipping_profile" was not found`로, 서버는 `Service with alias "api_key" was not found` 오류로 실패합니다.

- `bin/medusa.mjs`가 이를 사전에 감지하고 원인을 안내하며 실행을 거부합니다.
- 실습 환경 폴더(`TESTHUB_PLAYGROUND_HOME`)는 `dist` 문자열이 포함되지 않는 경로여야 합니다. 관리 프로세스가 이를 검사하여 문제가 있으면 다른 경로를 선택하도록 안내해야 합니다.
- 동일한 이유로 팩 빌드 결과 폴더 이름도 `out/`을 사용합니다.

### 상점

`node storefront/server.js`로 실행하며 `MEDUSA_BACKEND_URL`, `MEDUSA_PUBLISHABLE_KEY`, `PORT`, `HOSTNAME=localhost`, `DEFAULT_REGION=dk` 환경 변수를 전달합니다. 서버 주소와 키는 런타임에 읽으므로 포트를 변경해도 다시 빌드할 필요가 없습니다. 수정 내역과 사유는 [storefront/README.md](storefront/README.md)에 정리되어 있습니다.

- 빌드 시점에 Medusa 서버가 필요하지 않습니다(사전 정적 렌더링 페이지 없음).
- 브라우저는 Medusa 백엔드를 직접 호출하지 않습니다. 따라서 Medusa의 `STORE_CORS`에는 상점 주소 하나만 허용하면 됩니다.
- Next.js는 기동 후 프로세스 이름을 `next-server (v15.5.21)`로 변경합니다. 명령줄 문자열로 프로세스를 찾지 말고 PID로 관리해야 합니다.

## 출처와 수정 내역

- 백엔드와 상점은 [medusajs/dtc-starter](https://github.com/medusajs/dtc-starter)(MIT)의 커밋 `1fc1edd6c91f4992b89750b6d5cd39bc9baed503` 내 `apps/backend`, `apps/storefront`를 기반으로 합니다. `create-medusa-app@2.18.0`이 내려받는 저장소이며, 2.19.0 업그레이드 직전의 마지막 커밋입니다. 원문 라이선스는 `backend/LICENSE.dtc-starter`, `storefront/LICENSE.dtc-starter`에 있습니다.
- 백엔드에서 수정한 사항(상점은 [storefront/README.md](storefront/README.md) 참고):
  - `eslint.config.ts`와 `lint` 스크립트를 제거했습니다(모노레포 루트의 ESLint 설정에 의존함).
  - `package.json`에 `picomatch: 4.0.7` 의존성과 `overrides: {fdir: 6.5.0}`을 추가했습니다. 원인은 아래 lockfile 문제를 참고하세요.
- 시드 데이터는 스타터 기본 구성을 그대로 사용합니다: 지역 `Europe` 1개(gb, de, dk, se, fr, es, it), 통화 EUR 및 USD, 상품 4개, publishable key 1개. 상품 이미지 10장은 Medusa의 S3 버킷(`medusa-public-images.s3.eu-west-1.amazonaws.com`)을 가리키므로 인터넷에 연결되지 않으면 이미지가 표시되지 않습니다.

### lockfile 문제와 우회 방법

스타터를 원본 그대로 npm으로 설치하면 `npm ci`가 lockfile 검증 오류를 발생시킵니다(`lock file's picomatch@2.3.2 does not satisfy ...`).

- `@medusajs/admin-vite-plugin`이 `fdir@6.1.1`에 의존하고, `fdir`은 `picomatch`를 선택적 peer 의존성(`3.x`, 6.5.0 버전은 `^3 || ^4`)으로 둡니다.
- npm이 루트의 `fdir`을 루트의 `picomatch@2.3.2`와 연결해 lockfile에 기록하면서 `npm ci`가 버전 불일치로 거부합니다.
- 우회 방법: `overrides`로 `fdir`을 `6.5.0`으로 고정하고, 루트에 `picomatch@4.0.7`을 직접 설치했습니다. 메이저 버전 2(v2)가 필요한 패키지(`micromatch`, `anymatch`, `readdirp`, `jest-util`)는 각 패키지 하위 경로에 2.x 버전을 별도로 유지합니다.
- 이 우회 구성을 통해 `medusa build`가 `.medusa/server`에 복사한 lockfile에서도 `npm ci --omit=dev`가 정상 동작합니다.

## 라이선스 검사

빌드 시 팩에 포함되는 모든 npm 패키지(약 1,000개)의 라이선스를 전수 검사합니다([lib/checks.mjs](lib/checks.mjs)).

- GPL 계열(LGPL, AGPL 포함), SSPL, BUSL, Commons Clause, Elastic 라이선스가 발견되면 빌드가 실패합니다.
- `package.json`에 라이선스 표기가 누락된 패키지는 [license-exceptions.json](license-exceptions.json)에 `이름@버전`과 근거가 등록되어 있어야 통과합니다. 현재 등록된 예외는 관리자 화면 패키지 5개(Medusa 저장소 v2.18.0 루트 MIT 라이선스)와 `connect-dynamodb@3.0.5`(패키지 내 `LICENSE.txt`, MIT 라이선스)입니다.
- `@medusajs` 패키지가 2.18.0 버전이 아니면 실패합니다(`@medusajs/ui`는 4.2.0). 백엔드와 상점 lockfile을 모두 검사합니다. 2.19.0부터 Enterprise Edition 패키지가 의존성으로 포함되기 때문입니다.
- 상점 스탠드얼론 빌드에 `sharp`가 포함되면 `libvips`(LGPL-3.0) 때문에 검사에 실패합니다. 따라서 상점 빌드에서 제외합니다([storefront/README.md](storefront/README.md)).

## 벤치마크 수치 (2026-11-16, Linux x64, Node 22.23.4, 4코어)

| 항목 | 측정값 |
| --- | --- |
| 팩 크기 | `tar.gz` 124MB, 압축 해제 시 853MB, 파일 약 9.2만 개 (상점 제외 시 `tar.gz` 111MB) |
| 빌드 시간 | 2분 22초 (`--skip-install` 기준. `medusa build`, 상점 `next build`, 운영 의존성 설치 포함). `npm ci` 포함 시 백엔드 22초, 상점 15초 추가 |
| `npm test` | 65초 (테스트 7건. 마이그레이션과 시드, Medusa 및 상점 기동, 브라우저 담기, 초기화 포함) |
| 상점 시작 | 1초 이내 |
| Medusa 시작 | 약 4초 |
| 초기화 | 약 0.3초 |

아래는 팩을 운영체제별로 별도 빌드하던 0.1.0 버전 당시 `.github/workflows/web-pack.yml`에서 측정한 값입니다(2026-11-16, Node 24). 현재는 공개 저장소 `daedalus-testhub-packs`가 Linux에서 단일 팩을 빌드해 배포하고, 데스크톱 앱 빌드 시 `release.yml`이 해당 공개 팩을 Windows 및 macOS에서 압축 해제해 테스트합니다.

| 플랫폼 | 팩 크기 (`tar.gz`) | 빌드 시간 | 테스트 시간 |
| --- | --- | --- | --- |
| macOS arm64 | 약 221MB | 1분 52초 | 47초 |
| macOS x64 | 약 222MB | 6분 19초 | 2분 15초 |
| Windows x64 | 약 140MB | 3분 47초 | 2분 25초 |

macOS용 팩이 컸던 이유는 PostgreSQL 실행 파일 크기 때문입니다(npm 기준 압축 해제 시 darwin 337MB, windows 109MB, linux 59MB).
