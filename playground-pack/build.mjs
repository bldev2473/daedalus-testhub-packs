#!/usr/bin/env node
// 웹 실습 팩을 만든다. 팩을 만드는 컴퓨터(개발자, 릴리스 워크플로)에서만 돈다. 학습자 컴퓨터에서는 받아서 풀기만 한다.
//
//   node build.mjs [--skip-install]
//
// 결과: out/testhub-web-pack-<판>.tar.gz 와 .sha256, 푼 모양 그대로의 out/stage/
// 결과 폴더 이름을 dist 로 하지 않는다. 경로에 dist 가 있으면 Medusa 가 동작하지 않는다 (bin/medusa.mjs 참고)
// 팩은 운영체제와 상관없이 하나다. 어느 운영체제에서 만들어도 같다. 운영체제마다 다른 PostgreSQL 실행 파일과
// 네이티브 모듈은 빼고, PostgreSQL 은 학습자 컴퓨터에서 그 운영체제의 것만 넣는다 (lib/platforms.mjs).
// 어떤 PostgreSQL 을 넣을지(판, 주소, 무결성 값)는 manifest.json 의 postgres 에 적는다
//
// --skip-install: backend, storefront 의 node_modules 가 있으면 npm ci 를 건너뛴다 (개발 중 반복 빌드용)
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkLicenses, MEDUSA_VERSION, medusaVersionViolations } from "./lib/checks.mjs"
import { postgresPackages, removePlatformPackages } from "./lib/platforms.mjs"

const root = dirname(fileURLToPath(import.meta.url))
const backend = join(root, "backend")
const storefront = join(root, "storefront")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const dist = join(root, "out")
const stage = join(dist, "stage")
const packName = `testhub-web-pack-${pkg.version}`
const skipInstall = process.argv.includes("--skip-install")

// 스타터 출처 (README 와 manifest 에 남긴다)
const STARTER = {
  repo: "medusajs/dtc-starter",
  commit: "1fc1edd6c91f4992b89750b6d5cd39bc9baed503",
  paths: ["apps/backend", "apps/storefront"],
  // 1fc1edd 뒤의 상류 커밋에서 상점에 가져온 것 (storefront/README.md 참고)
  storefront_upstream_fixes: ["1d897a2", "9b93e68", "8d414f2"],
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
// 빌드 중 Medusa 설정이 빌드하는 사람의 홈에 남지 않게 한다 (bin/medusa.mjs 가 XDG_CONFIG_HOME 을 요구한다)
const xdg = join(tmpdir(), `testhub-web-pack-xdg-${process.pid}`)
const env = { ...process.env, XDG_CONFIG_HOME: xdg, MEDUSA_DISABLE_TELEMETRY: "true", NEXT_TELEMETRY_DISABLED: "1" }

function step(title) {
  console.log(`\n== ${title}`)
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && cmd === npm })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 실패 (${cwd}, 종료 코드 ${r.status})`)
}

function removeBinDirs(dir) {
  // node_modules/.bin 은 심볼릭 링크라 Windows 에서 풀기가 까다롭고, 팩은 cli.js 를 직접 부른다
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (entry.name === ".bin" && dir.endsWith("node_modules")) rmSync(p, { recursive: true, force: true })
    else removeBinDirs(p)
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function licensesMarkdown(packages) {
  const rows = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((p) => `| ${p.name} | ${p.version} | ${p.license} |`)
  return `# 웹 실습 팩 라이선스 고지

이 팩은 testhub(Apache-2.0)가 학습용으로 만든 것입니다. 들어 있는 제3자 소프트웨어와 라이선스는 아래와 같습니다.

- Medusa ${MEDUSA_VERSION} (MIT): https://github.com/medusajs/medusa
- 상점과 백엔드 스타터 (MIT): https://github.com/${STARTER.repo} 커밋 ${STARTER.commit}. 원문은 backend/LICENSE.dtc-starter, storefront/LICENSE.dtc-starter
- Next.js (MIT): 상점 standalone 서버에 들어 있습니다
- PostgreSQL 실행 파일 (PostgreSQL License): 팩에는 없다. 학습자 컴퓨터에서 그 운영체제의 embedded-postgres 플랫폼 패키지(@embedded-postgres/*)를 넣는다. 원문은 그 패키지의 LICENSE.md
- 시드 상품 이미지는 팩에 들어 있지 않습니다. 스타터 시드대로 Medusa 의 공개 이미지 주소(medusa-public-images.s3.eu-west-1.amazonaws.com)를 가리킵니다

아래는 팩에 든 npm 패키지 ${packages.size}개입니다. 원문은 각 패키지 폴더에 있습니다.

| 패키지 | 판 | 라이선스 |
| --- | --- | --- |
${rows.join("\n")}
`
}

try {
  step("Medusa 판 확인")
  const bad = [
    ...medusaVersionViolations(join(backend, "package-lock.json")),
    ...medusaVersionViolations(join(storefront, "package-lock.json")),
  ]
  if (bad.length) throw new Error(`@medusajs 패키지가 고정한 판이 아니다:\n  ${bad.join("\n  ")}`)

  step("백엔드 설치")
  if (skipInstall && existsSync(join(backend, "node_modules"))) console.log("건너뜀 (--skip-install)")
  else run(npm, ["ci", "--no-audit", "--no-fund"], backend)

  step("백엔드 운영 빌드 (medusa build)")
  run(process.execPath, [join(root, "bin", "medusa.mjs"), "build"], root)

  step("상점 설치")
  if (skipInstall && existsSync(join(storefront, "node_modules"))) console.log("건너뜀 (--skip-install)")
  else run(npm, ["ci", "--no-audit", "--no-fund"], storefront)

  step("상점 빌드 (next build, standalone)")
  // 상점은 Medusa 주소와 키를 실행 중에 읽고 미리 그리는 페이지가 없어 빌드에 Medusa 가 필요 없다.
  // 빌드에 Medusa 주소가 박히지 않게 관련 환경 변수를 비운다
  rmSync(join(storefront, ".next"), { recursive: true, force: true })
  for (const k of ["MEDUSA_BACKEND_URL", "MEDUSA_PUBLISHABLE_KEY", "NEXT_PUBLIC_MEDUSA_BACKEND_URL", "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"]) {
    delete env[k]
  }
  run(npm, ["run", "build"], storefront)

  step("팩 폴더 만들기")
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  cpSync(join(backend, ".medusa", "server"), join(stage, "backend"), { recursive: true })
  cpSync(join(backend, "LICENSE.dtc-starter"), join(stage, "backend", "LICENSE.dtc-starter"))
  run(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], join(stage, "backend"))

  cpSync(join(root, "bin"), join(stage, "bin"), { recursive: true })
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(root, f), join(stage, f))
  run(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], stage)

  // standalone 은 server.js 와 추적한 node_modules 만 있다. 정적 파일과 public 은 따로 옮긴다
  cpSync(join(storefront, ".next", "standalone"), join(stage, "storefront"), { recursive: true })
  cpSync(join(storefront, ".next", "static"), join(stage, "storefront", ".next", "static"), { recursive: true })
  cpSync(join(storefront, "public"), join(stage, "storefront", "public"), { recursive: true })
  cpSync(join(storefront, "LICENSE.dtc-starter"), join(stage, "storefront", "LICENSE.dtc-starter"))
  removeBinDirs(stage)

  step("운영체제에 묶인 것 빼기")
  // 팩을 하나로 만든다. 빌드한 컴퓨터의 PostgreSQL 과 네이티브 모듈을 뺀다
  for (const p of removePlatformPackages(stage)) console.log(`  뺌: ${p}`)
  const postgres = postgresPackages(join(root, "package-lock.json"))

  step("라이선스 확인")
  const exceptions = JSON.parse(readFileSync(join(root, "license-exceptions.json"), "utf8")).packages
  const { packages, violations, unusedExceptions } = checkLicenses(
    [join(stage, "node_modules"), join(stage, "backend", "node_modules"), join(stage, "storefront", "node_modules")],
    exceptions,
  )
  if (violations.length) throw new Error(`라이선스 검사 실패:\n  ${violations.join("\n  ")}`)
  if (unusedExceptions.length) console.log(`쓰지 않은 예외 (지워도 된다): ${unusedExceptions.join(", ")}`)
  writeFileSync(join(stage, "LICENSES.md"), licensesMarkdown(packages))
  console.log(`패키지 ${packages.size}개, 문제 없음`)

  const manifest = {
    pack: "web",
    version: pkg.version,
    medusa: MEDUSA_VERSION,
    platform: "any",
    node_engines: pkg.engines.node,
    postgres,
    starter: STARTER,
    built_at: new Date().toISOString(),
  }
  writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

  step("압축")
  const archive = `${packName}.tar.gz`
  rmSync(join(dist, archive), { force: true })
  // 경로에 드라이브 문자(C:)가 들어가면 GNU tar 가 원격 호스트로 읽는다. 상대 경로만 쓴다
  run("tar", ["-czf", archive, "-C", "stage", "."], dist)
  const hex = sha256(join(dist, archive))
  writeFileSync(join(dist, `${archive}.sha256`), `${hex}  ${archive}\n`)
  const mb = (readFileSync(join(dist, archive)).length / 1048576).toFixed(1)
  console.log(`\n완료: out/${archive} (${mb}MB, sha256 ${hex.slice(0, 12)}…)`)
} catch (e) {
  console.error(`\n빌드 실패: ${e.message}`)
  process.exitCode = 1
} finally {
  rmSync(xdg, { recursive: true, force: true })
}
