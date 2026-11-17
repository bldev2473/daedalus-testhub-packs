#!/usr/bin/env node
// Appium 팩을 만든다. 팩을 만드는 컴퓨터(개발자, 릴리스 워크플로)에서만 돈다. 학습자 컴퓨터에서는 받아서 풀기만 한다.
//
//   node build.mjs
//
// 결과: out/testhub-appium-pack-<판>.tar.gz 와 .sha256, 푼 모양 그대로의 out/stage/
// 팩은 운영체제와 상관없이 하나다.
// - Appium 의 선택 의존성(sharp: 이미지 처리 네이티브 모듈)은 뺀다. 운영체제마다 다른 실행 파일이라 하나로 묶을 수 없고,
//   Appium 은 sharp 를 그 기능(이미지 비교, 화면 이미지 크기 조절)을 쓸 때만 불러서 없어도 켜지고 테스트가 돈다
// - uiautomator2 드라이버는 APPIUM_HOME(팩 안의 appium-home/)에 미리 설치해 둔다
// - appium-home/node_modules/.cache 는 지운다. 거기 든 extensions.yaml 에 설치한 컴퓨터의 절대 경로(installPath)가 있어서,
//   Appium 이 첫 실행 때 새 위치로 다시 만든다 (옮긴 폴더에서 드라이버가 로드되는 것을 확인했다)
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkLicenses } from "../lib/checks.mjs"

export const APPIUM_VERSION = "3.9.1"
export const UIAUTOMATOR2_VERSION = "8.7.3"

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const dist = join(root, "out")
const stage = join(dist, "stage")
const packName = `testhub-appium-pack-${pkg.version}`
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
// 선택 의존성을 빼고 설치한다 (appium driver install 이 부르는 npm 도 같은 환경 변수를 읽는다)
// COPYFILE_DISABLE: macOS 의 tar 가 ._ 파일을 묶지 않게 한다 (묶으면 풀 때 .js 옆에 깨진 파일이 생긴다)
const env = {
  ...process.env,
  npm_config_omit: "optional",
  APPIUM_HOME: join(stage, "appium-home"),
  CI: "1",
  COPYFILE_DISABLE: "1",
}

function step(title) {
  console.log(`\n== ${title}`)
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && cmd === npm })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 실패 (${cwd}, 종료 코드 ${r.status})`)
}

/** 팩 안의 네이티브 모듈(.node)과 운영체제, CPU 를 가리는 패키지를 찾는다. 있으면 팩이 플랫폼 공통이 아니다 */
export function nativeViolations(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith(".node")) out.push(p)
      else if (entry.name === "package.json" && p.includes("node_modules")) {
        try {
          const meta = JSON.parse(readFileSync(p, "utf8"))
          if (meta.os || meta.cpu) out.push(`${p} (os/cpu: ${JSON.stringify(meta.os ?? meta.cpu)})`)
        } catch {}
      }
    }
  }
  walk(dir)
  return out
}

/** 폴더 안의 심볼릭 링크 목록 */
export function symlinks(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isSymbolicLink()) out.push(join(e.parentPath ?? e.path, e.name))
  }
  return out
}

function removeBinDirs(dir) {
  // node_modules/.bin 은 심볼릭 링크라 Windows 에서 풀기가 까다롭고, 팩은 index.js 를 직접 부른다
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

function dirSizeMb(dir) {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(join(e.parentPath ?? e.path, e.name)).size
  }
  return Math.round(total / 1024 / 1024)
}

function main() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
  const locked = lock.packages?.["node_modules/appium"]?.version
  if (pkg.dependencies.appium !== APPIUM_VERSION || locked !== APPIUM_VERSION) {
    throw new Error(`appium ${APPIUM_VERSION} 으로 고정하지 않았다 (package.json ${pkg.dependencies.appium}, lock ${locked})`)
  }

  step("팩 폴더 만들기")
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(root, f), join(stage, f))

  step("Appium 설치 (선택 의존성 제외)")
  run(npm, ["ci", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], stage)

  step(`uiautomator2 드라이버 ${UIAUTOMATOR2_VERSION} 설치`)
  mkdirSync(env.APPIUM_HOME, { recursive: true })
  run(process.execPath, [join(stage, "node_modules", "appium", "index.js"), "driver", "install", `uiautomator2@${UIAUTOMATOR2_VERSION}`], stage)
  rmSync(join(env.APPIUM_HOME, "node_modules", ".cache"), { recursive: true, force: true })
  removeBinDirs(stage)
  removeBinDirs(env.APPIUM_HOME)
  // appium driver install 이 드라이버 폴더 안에 만든 appium 링크(만든 컴퓨터의 절대 경로)를 지운다. 링크가 없어도
  // 드라이버는 위쪽 폴더로 올라가며 팩의 node_modules/appium 을 찾는다 (appium-home 이 팩 안에 있어서). 링크는
  // 안전한 압축 풀기(절대 경로 링크 거절)와 Windows 에서도 문제가 된다
  for (const link of [...symlinks(join(stage, "node_modules")), ...symlinks(join(env.APPIUM_HOME, "node_modules"))]) {
    console.log(`링크를 지움: ${link}`)
    rmSync(link, { force: true })
  }

  step("플랫폼 공통인지 검사 (네이티브 모듈 없음)")
  const native = [...nativeViolations(join(stage, "node_modules")), ...nativeViolations(join(env.APPIUM_HOME, "node_modules"))]
  if (native.length) throw new Error(`네이티브 모듈이 들어 있다. 팩은 플랫폼 공통이어야 한다:\n  ${native.join("\n  ")}`)

  step("라이선스 검사")
  const exceptions = existsSync(join(root, "license-exceptions.json"))
    ? JSON.parse(readFileSync(join(root, "license-exceptions.json"), "utf8")).packages ?? {}
    : {}
  const { packages, violations, unusedExceptions } = checkLicenses(
    [join(stage, "node_modules"), join(env.APPIUM_HOME, "node_modules")],
    exceptions
  )
  if (violations.length) throw new Error(`라이선스 검사 실패:\n  ${violations.join("\n  ")}`)
  if (unusedExceptions.length) throw new Error(`쓰지 않는 라이선스 예외: ${unusedExceptions.join(", ")}`)
  const rows = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((p) => `| ${p.name} | ${p.version} | ${p.license} |`)
  writeFileSync(
    join(stage, "LICENSES.md"),
    `# Appium 팩 라이선스 고지\n\n이 팩은 testhub(Apache-2.0)가 학습용으로 만든 것입니다. 들어 있는 제3자 소프트웨어와 라이선스는 아래와 같습니다.\n\n- Appium ${APPIUM_VERSION} (Apache-2.0): https://github.com/appium/appium\n- appium-uiautomator2-driver ${UIAUTOMATOR2_VERSION} (Apache-2.0): https://github.com/appium/appium-uiautomator2-driver\n\n| 패키지 | 판 | 라이선스 |\n| --- | --- | --- |\n${rows.join("\n")}\n`
  )
  console.log(`패키지 ${packages.size}개`)

  step("manifest.json")
  writeFileSync(
    join(stage, "manifest.json"),
    JSON.stringify(
      {
        pack: "appium",
        version: pkg.version,
        platform: "any",
        appium: APPIUM_VERSION,
        uiautomator2: UIAUTOMATOR2_VERSION,
        node_engines: pkg.engines.node,
        built_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  )

  step("묶기")
  mkdirSync(dist, { recursive: true })
  const archive = `${packName}.tar.gz`
  rmSync(join(dist, archive), { force: true })
  // 경로에 드라이브 문자(C:)가 들어가면 GNU tar 가 원격 호스트로 읽는다. 상대 경로만 쓴다
  run("tar", ["-czf", archive, "-C", "stage", "."], dist)
  const hex = sha256(join(dist, archive))
  writeFileSync(join(dist, `${archive}.sha256`), `${hex}  ${archive}\n`)
  const mb = (statSync(join(dist, archive)).size / 1024 / 1024).toFixed(1)
  console.log(`\n완료: out/${archive} (${mb}MB, 풀면 ${dirSizeMb(stage)}MB, sha256 ${hex.slice(0, 12)}…)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
