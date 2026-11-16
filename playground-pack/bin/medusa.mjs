#!/usr/bin/env node
// Medusa CLI 를 사용 통계를 끈 채로 부른다. 팩 안의 모든 Medusa 명령은 이것을 거친다.
//
//   XDG_CONFIG_HOME=<실습 환경>/config node medusa.mjs <start|db:migrate|user -e <e> -p <p>|build|...>
//
// - MEDUSA_DISABLE_TELEMETRY=true 를 넣는다. 그래도 Medusa CLI 는 configstore 로 사용자 설정 폴더에
//   telemetry.enabled: true 와 기기 ID 를 쓴다. 그래서 XDG_CONFIG_HOME 을 꼭 받고, 그 아래
//   medusa/config.json 에 telemetry.enabled: false 를 미리 쓴다. 사용자 홈(~/.config/medusa)은 건드리지 않는다
// - NODE_ENV 가 없으면 production
// - 작업 폴더는 이 파일 옆의 ../backend (팩에서는 운영 빌드, 저장소에서는 원본 백엔드). TESTHUB_MEDUSA_DIR 로 바꾼다
// - 새 프로세스를 띄우지 않고 이 프로세스에서 CLI 를 돌린다. 관리 프로세스가 끌 프로세스가 하나로 남는다
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const backend = resolve(process.env.TESTHUB_MEDUSA_DIR || join(here, "..", "backend"))

const xdg = process.env.XDG_CONFIG_HOME
if (!xdg) {
  console.error("medusa.mjs: XDG_CONFIG_HOME 이 없다. Medusa CLI 가 사용자 홈에 설정을 쓰지 않게 실습 환경 아래 폴더를 준다")
  process.exit(2)
}

const configFile = join(xdg, "medusa", "config.json")
let config = {}
if (existsSync(configFile)) {
  try {
    config = JSON.parse(readFileSync(configFile, "utf8"))
  } catch {
    config = {}
  }
}
if (config?.telemetry?.enabled !== false) {
  config = { ...config, telemetry: { ...(config.telemetry ?? {}), enabled: false } }
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
}

process.env.MEDUSA_DISABLE_TELEMETRY = "true"
process.env.NODE_ENV ||= "production"

// Medusa 2.18.0 의 @medusajs/utils(joiner-config-builder)는 모듈 파일 경로에 "dist" 라는 글자가 어디든 있으면
// 그 글자로 경로를 잘라 models 폴더를 찾는다. 상위 폴더 이름에 dist 가 들어가면(예: 사용자 이름 kdistel)
// 모듈을 못 읽어 시드와 서버가 "Service with alias ... was not found" 로 실패한다. 미리 알아보고 거절한다
const beforeModules = realpathSync(backend)
if (beforeModules.includes("dist")) {
  console.error(
    `medusa.mjs: Medusa 는 경로에 "dist" 라는 글자가 있으면 동작하지 않는다 (Medusa 2.18.0 결함): ${beforeModules}\n` +
      "실습 환경 폴더(TESTHUB_PLAYGROUND_HOME)를 dist 가 들어가지 않는 경로로 옮긴다",
  )
  process.exit(3)
}

const cli = join(backend, "node_modules", "@medusajs", "cli", "cli.js")
if (!existsSync(cli)) {
  console.error(`medusa.mjs: Medusa CLI 가 없다: ${cli}`)
  process.exit(2)
}
process.chdir(backend)
process.argv = [process.argv[0], cli, ...process.argv.slice(2)]
createRequire(cli)(cli)
