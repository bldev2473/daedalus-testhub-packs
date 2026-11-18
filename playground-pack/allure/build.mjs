#!/usr/bin/env node
// Allure 팩을 만든다. 팩을 만드는 컴퓨터(개발자, 릴리스 워크플로)에서만 돈다. 학습자 컴퓨터에서는 받아서 풀기만 한다.
//
//   node build.mjs
//
// 결과: out/testhub-allure-pack-<판>.tar.gz 와 .sha256, 푼 모양 그대로의 out/stage/
// 팩은 운영체제와 상관없이 하나다. Allure 3 CLI(allure 패키지)와 그 의존성만 들어 있고 네이티브 모듈은 없다.
// 실행은 node node_modules/allure/cli.js generate <결과 폴더> --config <설정 파일>
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkLicenses } from "../lib/checks.mjs"

export const ALLURE_VERSION = "3.33.0"

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const dist = join(root, "out")
const stage = join(dist, "stage")
const packName = `testhub-allure-pack-${pkg.version}`
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
// COPYFILE_DISABLE: macOS 의 tar 가 ._ 파일을 묶지 않게 한다 (묶으면 풀 때 .js 옆에 깨진 파일이 생긴다)
const env = { ...process.env, CI: "1", COPYFILE_DISABLE: "1" }

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

function dirSizeMb(dir) {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(join(e.parentPath ?? e.path, e.name)).size
  }
  return Math.round(total / 1024 / 1024)
}

function main() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
  const locked = lock.packages?.["node_modules/allure"]?.version
  if (pkg.dependencies.allure !== ALLURE_VERSION || locked !== ALLURE_VERSION) {
    throw new Error(`allure ${ALLURE_VERSION} 으로 고정하지 않았다 (package.json ${pkg.dependencies.allure}, lock ${locked})`)
  }

  step("팩 폴더 만들기")
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(root, f), join(stage, f))

  step("Allure 설치")
  run(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], stage)
  removeBinDirs(stage)
  for (const link of symlinks(join(stage, "node_modules"))) {
    console.log(`링크를 지움: ${link}`)
    rmSync(link, { force: true })
  }

  step("플랫폼 공통인지 검사 (네이티브 모듈 없음)")
  const native = nativeViolations(join(stage, "node_modules"))
  if (native.length) throw new Error(`네이티브 모듈이 들어 있다. 팩은 플랫폼 공통이어야 한다:\n  ${native.join("\n  ")}`)

  step("라이선스 검사")
  const exceptions = existsSync(join(root, "license-exceptions.json"))
    ? JSON.parse(readFileSync(join(root, "license-exceptions.json"), "utf8")).packages ?? {}
    : {}
  const { packages, violations, unusedExceptions } = checkLicenses([join(stage, "node_modules")], exceptions)
  if (violations.length) throw new Error(`라이선스 검사 실패:\n  ${violations.join("\n  ")}`)
  if (unusedExceptions.length) throw new Error(`쓰지 않는 라이선스 예외: ${unusedExceptions.join(", ")}`)
  const rows = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((p) => `| ${p.name} | ${p.version} | ${p.license} |`)
  writeFileSync(
    join(stage, "LICENSES.md"),
    `# Allure 팩 라이선스 고지\n\n이 팩은 testhub(Apache-2.0)가 실행 결과의 보고서를 만들려고 묶은 것입니다. 들어 있는 제3자 소프트웨어와 라이선스는 아래와 같습니다.\n\n- Allure Report ${ALLURE_VERSION} (Apache-2.0): https://github.com/allure-framework/allure3\n\n| 패키지 | 판 | 라이선스 |\n| --- | --- | --- |\n${rows.join("\n")}\n`
  )
  console.log(`패키지 ${packages.size}개`)

  step("manifest.json")
  writeFileSync(
    join(stage, "manifest.json"),
    JSON.stringify(
      {
        pack: "allure",
        version: pkg.version,
        platform: "any",
        allure: ALLURE_VERSION,
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
