// Appium 팩 시험. 먼저 node build.mjs 로 팩을 만든 뒤 돈다 (npm test).
// 만든 tar.gz 를 다른 폴더에 풀고, 그 안의 파일만으로 Appium 을 띄운다. 학습자 컴퓨터와 같은 조건이다.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { APPIUM_VERSION, nativeViolations, symlinks, UIAUTOMATOR2_VERSION } from "../build.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const archiveName = `testhub-appium-pack-${pkg.version}.tar.gz`
const archive = join(root, "out", archiveName)

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

async function statusOf(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`)
    return r.status === 200 ? await r.json() : null
  } catch {
    return null
  }
}

describe("만든 Appium 팩", { skip: !existsSync(archive) && `팩이 없다 (먼저 node build.mjs): ${archiveName}` }, () => {
  let pack
  let env
  let server

  before(() => {
    const expected = readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0]
    assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), expected, "sha256 이 다르다")
    pack = mkdtempSync(join(tmpdir(), "appium-pack-"))
    const r = spawnSync("tar", ["-xzf", archiveName, "-C", pack], { cwd: join(root, "out") })
    assert.equal(r.status, 0, String(r.stderr))
    // 데이터 폴더(APPIUM_HOME)는 팩 안의 appium-home. 안드로이드 도구는 없는 컴퓨터를 가정한다
    env = { ...process.env, APPIUM_HOME: join(pack, "appium-home"), ANDROID_HOME: "", ANDROID_SDK_ROOT: "" }
  })

  after(() => {
    if (server && server.exitCode === null) server.kill("SIGKILL")
    rmSync(pack, { recursive: true, force: true })
  })

  const appium = (...args) =>
    spawnSync(process.execPath, [join(pack, "node_modules", "appium", "index.js"), ...args], { env, encoding: "utf8", timeout: 120_000 })

  test("manifest 가 판과 플랫폼 공통을 적는다", () => {
    const m = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8"))
    assert.equal(m.pack, "appium")
    assert.equal(m.version, pkg.version)
    assert.equal(m.platform, "any")
    assert.equal(m.appium, APPIUM_VERSION)
    assert.equal(m.uiautomator2, UIAUTOMATOR2_VERSION)
    assert.ok(existsSync(join(pack, "LICENSES.md")))
    // 만든 컴퓨터의 절대 경로가 든 캐시는 팩에 없다. Appium 이 첫 실행 때 새 위치로 다시 만든다
    assert.ok(!existsSync(join(pack, "appium-home", "node_modules", ".cache")))
  })

  test("네이티브 모듈이 없다 (운영체제와 상관없이 하나)", () => {
    assert.deepEqual(nativeViolations(join(pack, "node_modules")), [])
    assert.deepEqual(nativeViolations(join(pack, "appium-home", "node_modules")), [])
    assert.ok(!existsSync(join(pack, "node_modules", "sharp")), "sharp 는 뺀다")
  })

  test("macOS tar 가 묶는 ._ 파일이 없다", () => {
    const stray = readdirSync(pack, { recursive: true }).filter((f) => String(f).split(/[\\/]/).pop().startsWith("._"))
    assert.deepEqual(stray, [])
  })

  test("심볼릭 링크가 없다 (안전한 압축 풀기와 Windows 를 위해)", () => {
    assert.deepEqual(symlinks(pack), [])
  })

  test("압축을 푼 폴더에서 driver list 에 uiautomator2 8.7.3 이 나온다", () => {
    const r = appium("driver", "list", "--installed")
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout + r.stderr, new RegExp(`uiautomator2@${UIAUTOMATOR2_VERSION.replace(/\./g, "\\.")}`))
    // 옮긴 폴더에서 다시 만든 목록이 이 폴더를 가리킨다
    const yaml = readFileSync(join(pack, "appium-home", "node_modules", ".cache", "appium", "extensions.yaml"), "utf8")
    assert.match(yaml, new RegExp(`installPath: ${pack.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  })

  test("서버가 켜지고 /status 가 준비됐다고 답하며 드라이버를 불러온다", async () => {
    const port = await freePort()
    let log = ""
    server = spawn(process.execPath, [join(pack, "node_modules", "appium", "index.js"), "--address", "127.0.0.1", "--port", String(port)], { env })
    server.stdout.on("data", (d) => (log += d))
    server.stderr.on("data", (d) => (log += d))
    let status = null
    for (let i = 0; i < 60 && !status; i++) {
      status = await statusOf(port)
      if (!status) await new Promise((r) => setTimeout(r, 500))
    }
    assert.ok(status, `60 초 안에 켜지지 않았다:\n${log}`)
    assert.equal(status.value.ready, true)
    assert.equal(status.value.build.version, APPIUM_VERSION)
    assert.match(log, /AndroidUiautomator2Driver has been successfully loaded/)
    server.kill("SIGKILL")
  })
})
