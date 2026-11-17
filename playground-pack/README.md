# 웹 실습 팩

testhub 실습 환경의 웹 묶음에 들어가는 팩을 만듭니다. 팩에는 Medusa 2.18.0 서버와 관리자 화면, 상점(Next.js), 실습 환경이 쓰는 node 스크립트가 들어 있습니다.

- 팩은 팩을 만드는 컴퓨터(개발자, 릴리스 워크플로)에서 만듭니다. 학습자 컴퓨터에서는 받아서 풀기만 하고 npm 설치나 빌드를 하지 않습니다
- **팩은 운영체제와 상관없이 하나입니다.** 어느 운영체제에서 만들어도 같고, macOS arm64, macOS x64, Windows x64가 같은 팩을 받습니다
  - 운영체제마다 다른 것은 PostgreSQL 실행 파일(embedded-postgres의 플랫폼 패키지)뿐입니다. 팩에서 빼고 학습자 컴퓨터에서 그 운영체제의 것만 넣습니다. 데스크톱 앱은 설치 파일에 넣어 두고(`desktop/build-postgres.mjs`), 앱 밖에서는 `manifest.json`의 npm 주소에서 받아 sha512 무결성 값을 맞춰 봅니다
  - 빌드가 쓰는 네이티브 모듈(esbuild, rollup, msgpackr-extract의 플랫폼 패키지)도 뺍니다. 실행 중에는 쓰지 않습니다 (팩 시험이 확인합니다)
  - 대응표와 빼는 규칙: `lib/platforms.mjs`
- 설계: [실습 환경 화면 설계](../docs/superpowers/specs/2026-11-15-playground-design.md), 계획: [1단계 구현 계획](../docs/superpowers/plans/2026-11-15-playground-web.md)

## 만들기와 시험

Node 20 이상이 필요합니다.

```bash
cd playground-pack
npm ci                 # embedded-postgres, pg, playwright-core(시험용)
node build.mjs         # out/testhub-web-pack-<판>.tar.gz 와 .sha256 (약 100MB)
npm test               # 만든 팩을 임시 폴더에 풀고 이 운영체제의 PostgreSQL을 넣어 PostgreSQL, Medusa, 상점을 띄우고 브라우저로 담기까지 해 본다
```

- 다시 빌드할 때 `node build.mjs --skip-install`이면 `backend`, `storefront`의 `node_modules`가 있을 때 `npm ci`를 건너뜁니다
- 시험의 브라우저는 `playwright-core`(1.63.0)가 받은 Chromium입니다. 처음이면 `npx playwright-core install chromium`. 미리 설치한 Chrome을 쓰려면 `TESTHUB_CHROME_BINARY`
- 결과 폴더 이름을 `dist`로 하지 않습니다. 아래 `경로에 dist가 있으면` 참고
- 시험은 root로 돌면 PostgreSQL을 `postgres` 사용자로 띄웁니다 (컨테이너, CI). PostgreSQL은 root로 뜨지 않습니다

## 팩 구조 (풀었을 때)

```text
manifest.json           {"pack": "web", "version", "medusa": "2.18.0", "platform": "any", "postgres", "node_engines", "starter", "built_at"}
                        postgres: 플랫폼마다 {"name", "version", "url", "integrity"} (넣을 PostgreSQL 패키지)
LICENSES.md             제3자 소프트웨어와 npm 패키지 라이선스 목록 (빌드가 만든다)
package.json            embedded-postgres, pg
node_modules/           위 두 패키지. 받은 뒤 @embedded-postgres/<플랫폼>(PostgreSQL 실행 파일)이 들어온다
bin/db.mjs              PostgreSQL 제어
bin/medusa.mjs          Medusa CLI (사용 통계를 끄고 부른다)
backend/                Medusa 운영 빌드(.medusa/server)와 운영 의존성, public/admin(관리자 화면)
storefront/             상점 standalone 빌드 (server.js, .next/static, public). storefront/README.md 참고
```

### bin/db.mjs

```bash
node bin/db.mjs init <datadir>
node bin/db.mjs start <datadir> <port> [--until-stdin-closes]   # 준비되면 "PG READY"
node bin/db.mjs stop <datadir>                                  # "PG STOPPED" 또는 "PG NOT RUNNING"
node bin/db.mjs create <port> <db>
node bin/db.mjs snapshot <port>          # medusa -> medusa_seed
node bin/db.mjs reset <port>             # medusa_seed -> medusa
node bin/db.mjs publishable-key <port>   # 시드가 만든 publishable key
```

- 접속은 `postgres://postgres:postgres@localhost:<port>/medusa`입니다. 서버는 localhost에서만 듣습니다
- `start`는 `pg_ctl`로 서버를 띄우고, 서버 로그는 `<datadir>/postgres.log`에 남습니다. Windows에서 관리자 권한으로 돌아도 `pg_ctl`은 권한을 낮춘 토큰으로 띄웁니다 (PostgreSQL은 관리자 권한으로 직접 띄우면 거절합니다)
- `start`는 SIGINT, SIGTERM에 끕니다. PostgreSQL이 먼저 끝나면(다른 곳에서 껐거나 죽었다) 종료 코드 1로 끝납니다. `--until-stdin-closes`이면 표준 입력이 닫힐 때도 끕니다. Windows에서는 신호를 보낼 수 없어서, 관리 프로세스가 입력을 닫습니다
- `start`를 띄운 node가 강제 종료되면 PostgreSQL은 남습니다. `stop`이 그것을 끕니다. 이때 `postmaster.pid`의 PID만 믿지 않고, 그 포트로 접속해 `data_directory`가 이 폴더인지 확인한 뒤에만 `pg_ctl stop`을 합니다 (PID가 다른 프로그램에 다시 쓰였을 수 있어서입니다). `start`도 시작 전에 같은 정리를 합니다
- 묶음 PostgreSQL에는 `pg_dump`가 없어 초기화는 템플릿 DB 복제로 합니다. 시드 직후 `snapshot`, 초기화 때 `reset`. Medusa를 켜 둔 채로 해도 되고 Medusa가 다시 연결합니다

### bin/medusa.mjs

```bash
XDG_CONFIG_HOME=<실습 환경>/config DATABASE_URL=... PORT=... node bin/medusa.mjs db:migrate   # 마이그레이션과 시드
XDG_CONFIG_HOME=<실습 환경>/config ... node bin/medusa.mjs start
XDG_CONFIG_HOME=<실습 환경>/config ... node bin/medusa.mjs user -e admin@example.com -p <비밀번호>
```

- Medusa 환경 변수: `DATABASE_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, `JWT_SECRET`, `COOKIE_SECRET`, `PORT`. `NODE_ENV`가 없으면 production입니다
- **사용 통계를 끕니다.** `MEDUSA_DISABLE_TELEMETRY=true`를 넣고, `XDG_CONFIG_HOME`을 꼭 받아 그 아래 `medusa/config.json`에 `telemetry.enabled: false`를 씁니다. 환경 변수만 주면 Medusa CLI가 사용 통계 안내를 띄우고 사용자 홈의 `~/.config/medusa/config.json`에 `enabled: true`와 기기 ID를 씁니다
- 새 프로세스를 띄우지 않고 그 프로세스 안에서 CLI를 돌립니다. 관리 프로세스가 끌 프로세스가 하나입니다
- 백엔드 경로에 `dist`라는 글자가 있으면 종료 코드 3으로 거절합니다 (아래)

### 경로에 dist가 있으면 Medusa가 동작하지 않는다

Medusa 2.18.0의 `@medusajs/utils`(`modules-sdk/joiner-config-builder.js`)는 모델 폴더를 찾을 때, 모듈 파일의 전체 경로에 `dist`라는 글자가 **어디든** 있으면 그 글자를 기준으로 경로를 자릅니다. 패키지 자신의 `dist` 폴더를 노린 것이지만, 상위 폴더 이름에 `dist`가 있으면(예: `/Users/kdistel/...`, `.../dist/stage/...`) 엉뚱한 곳을 봅니다. 그러면 모듈을 읽지 못해 시드가 `Service with alias "shipping_profile" was not found`로, 서버가 `Service with alias "api_key" was not found`로 실패합니다.

- `bin/medusa.mjs`가 미리 알아보고 이유를 밝혀 거절합니다
- 실습 환경 폴더(`TESTHUB_PLAYGROUND_HOME`)는 `dist`가 들어가지 않는 경로여야 합니다. 관리 프로세스(구현 계획 Task 4~6)가 이것을 확인하고, 안 되면 다른 경로를 고르게 해야 합니다
- 같은 이유로 빌드 결과 폴더는 `out/`입니다

### 상점

`node storefront/server.js`로 띄우고 `MEDUSA_BACKEND_URL`, `MEDUSA_PUBLISHABLE_KEY`, `PORT`, `HOSTNAME=localhost`, `DEFAULT_REGION=dk`를 줍니다. 주소와 키는 실행 중에 읽으므로 포트를 바꿔도 다시 빌드하지 않습니다. 고친 것과 이유는 [storefront/README.md](storefront/README.md)에 있습니다.

- 빌드에 Medusa가 필요 없습니다 (미리 그리는 페이지가 없습니다)
- 브라우저는 Medusa를 직접 부르지 않습니다. Medusa의 `STORE_CORS`는 상점 주소 하나면 됩니다
- Next.js는 뜨고 나면 프로세스 이름을 `next-server (v15.5.21)`로 바꿉니다. 명령줄로 찾지 말고 PID로 관리합니다

## 출처와 고친 것

- 백엔드와 상점은 [medusajs/dtc-starter](https://github.com/medusajs/dtc-starter)(MIT)의 커밋 `1fc1edd6c91f4992b89750b6d5cd39bc9baed503` `apps/backend`, `apps/storefront`입니다. `create-medusa-app@2.18.0`이 받는 저장소이고, 2.19.0으로 올리기 전의 마지막 커밋입니다. 원문 라이선스는 `backend/LICENSE.dtc-starter`, `storefront/LICENSE.dtc-starter`
- 백엔드에서 고친 것 (상점은 [storefront/README.md](storefront/README.md))
  - `eslint.config.ts`와 `lint` 스크립트를 뺐습니다 (모노레포 루트의 eslint 설정에 기댑니다)
  - `package.json`에 `picomatch: 4.0.7` 의존성과 `overrides: {fdir: 6.5.0}`을 더했습니다. 아래 lockfile 문제 때문입니다
- 시드는 스타터 그대로입니다: 지역 `Europe` 하나(gb, de, dk, se, fr, es, it), EUR과 USD, 상품 4개, publishable key 하나. 상품 이미지 10장은 Medusa의 S3(`medusa-public-images.s3.eu-west-1.amazonaws.com`)를 가리킵니다. 인터넷에 연결되지 않으면 이미지가 보이지 않습니다

### lockfile 문제와 우회

스타터를 그대로 npm으로 설치하면 lockfile을 `npm ci`가 거절합니다 (`lock file's picomatch@2.3.2 does not satisfy ...`).

- `@medusajs/admin-vite-plugin`이 `fdir@6.1.1`을 쓰고, `fdir`은 `picomatch`를 선택적 peer(`3.x`, 6.5.0은 `^3 || ^4`)로 둡니다
- npm이 루트의 `fdir`을 루트의 `picomatch@2.3.2`에 이어 lockfile에 적고, `npm ci`는 그것을 어긋났다고 봅니다
- 우회: `fdir`을 6.5.0으로 덮어쓰고(`overrides`), 루트에 `picomatch@4.0.7`을 직접 둡니다. 2판이 필요한 패키지(`micromatch`, `anymatch`, `readdirp`, `jest-util`)는 각자 아래에 2판을 둡니다
- 이 우회로 `medusa build`가 `.medusa/server`에 복사한 lockfile로도 `npm ci --omit=dev`가 됩니다

## 라이선스 검사

빌드는 팩에 든 npm 패키지(약 1000개)의 라이선스를 모두 봅니다 ([lib/checks.mjs](lib/checks.mjs)).

- GPL 계열(LGPL, AGPL 포함), SSPL, BUSL, Commons Clause, Elastic이 있으면 실패합니다
- `package.json`에 라이선스 표기가 없으면 [license-exceptions.json](license-exceptions.json)에 이름@판과 근거가 있을 때만 통과합니다. 지금 예외는 관리자 화면 패키지 5개(Medusa 저장소 v2.18.0 루트 MIT)와 `connect-dynamodb@3.0.5`(패키지 안의 LICENSE.txt, MIT)입니다
- `@medusajs` 패키지가 2.18.0이 아니면 실패합니다 (`@medusajs/ui`는 4.2.0). 백엔드와 상점 lockfile 둘 다 봅니다. 2.19.0부터 Enterprise Edition 패키지를 끌어오기 때문입니다
- 상점 standalone에 `sharp`가 따라오면 libvips(LGPL-3.0)에서 실패합니다. 그래서 상점 빌드에서 뺍니다 ([storefront/README.md](storefront/README.md))

## 수치 (2026-11-16, Linux x64, Node 22.23.4, 4코어)

| 항목 | 값 |
| --- | --- |
| 팩 | tar.gz 124MB, 풀었을 때 853MB, 파일 9.2만 개 (상점 없이는 tar.gz 111MB) |
| 빌드 | 2분 22초 (`--skip-install`. `medusa build`, 상점 `next build`, 운영 의존성 설치 포함). `npm ci`는 백엔드 22초, 상점 15초 더 |
| `npm test` | 65초 (시험 7건. 마이그레이션과 시드, Medusa와 상점 시작, 브라우저 담기, 초기화 포함) |
| 상점 시작 | 1초 안 |
| Medusa 시작 | 약 4초 |
| 초기화 | 약 0.3초 |

아래는 팩을 운영체제별로 따로 만들던 0.1.0 때 `.github/workflows/web-pack.yml`에서 잰 값입니다 (2026-11-16, Node 24). 지금은 공개 저장소 daedalus-testhub-packs가 Linux에서 팩 하나를 만들어 올리고, 앱을 빌드할 때 `release.yml`이 그 공개된 팩을 Windows(그리고 macOS)에서 풀어 테스트합니다.

| 플랫폼 | 팩 (tar.gz) | 빌드 | 테스트 |
| --- | --- | --- | --- |
| macOS arm64 | 약 221MB | 1분 52초 | 47초 |
| macOS x64 | 약 222MB | 6분 19초 | 2분 15초 |
| Windows x64 | 약 140MB | 3분 47초 | 2분 25초 |

macOS 팩이 큰 것은 PostgreSQL 실행 파일 때문입니다 (npm 표기, 풀었을 때 darwin 337MB, windows 109MB, linux 59MB).
