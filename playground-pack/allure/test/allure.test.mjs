// Allure 팩 시험. 먼저 node build.mjs 로 팩을 만든 뒤 돈다 (npm test). 없으면 건너뛴다.
// 만든 tar.gz 를 다른 폴더에 풀어, 그 안의 파일만으로 보고서를 만든다 (학습자 컴퓨터와 같은 조건)
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { ALLURE_VERSION, nativeViolations, symlinks } from "../build.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const archiveName = `testhub-allure-pack-${pkg.version}.tar.gz`
const archive = join(root, "out", archiveName)

describe("만든 팩", { skip: !existsSync(archive) && `팩이 없다 (먼저 node build.mjs): ${archiveName}` }, () => {
  let pack
  let work

  before(() => {
    const expected = readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0]
    assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), expected, "sha256 이 다르다")
    work = mkdtempSync(join(tmpdir(), "allure-pack-"))
    pack = join(work, "pack")
    mkdirSync(pack)
    const r = spawnSync("tar", ["-xzf", archiveName, "-C", pack], { cwd: join(root, "out") })
    assert.equal(r.status, 0, String(r.stderr))
  })

  after(() => rmSync(work, { recursive: true, force: true }))

  test("manifest가 플랫폼 공통 Allure 팩이다", () => {
    const manifest = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8"))
    assert.equal(manifest.pack, "allure")
    assert.equal(manifest.platform, "any")
    assert.equal(manifest.version, pkg.version)
    assert.equal(manifest.allure, ALLURE_VERSION)
    assert.ok(existsSync(join(pack, "LICENSES.md")))
  })

  test("네이티브 모듈과 심볼릭 링크가 없다", () => {
    assert.deepEqual(nativeViolations(join(pack, "node_modules")), [])
    assert.deepEqual(symlinks(pack), [])
  })

  test("파일 하나짜리 보고서를 만든다", { timeout: 120_000 }, () => {
    const results = join(work, "results")
    mkdirSync(results)
    const now = Date.now()
    const result = (name, status) => ({
      uuid: `u-${name}`,
      historyId: `h-${name}`,
      name,
      fullName: `suite#${name}`,
      status,
      start: now,
      stop: now + 50,
      labels: [{ name: "suite", value: "점검" }],
    })
    for (const [name, status] of [["통과하는 테스트", "passed"], ["실패하는 테스트", "failed"]]) {
      writeFileSync(join(results, `u-${name}-result.json`), JSON.stringify(result(name, status)), "utf8")
    }
    const config = join(work, "allurerc.mjs")
    writeFileSync(
      config,
      `export default { name: "시험 보고서", output: ${JSON.stringify(join(work, "report"))}, plugins: { awesome: { options: { singleFile: true } } } }\n`,
      "utf8"
    )
    const r = spawnSync(process.execPath, [join(pack, "node_modules", "allure", "cli.js"), "generate", results, "--config", config, "--clean"], {
      cwd: work,
      encoding: "utf8",
      timeout: 100_000,
    })
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    const html = readFileSync(join(work, "report", "index.html"), "utf8")
    assert.match(html, /시험 보고서/)
    const summary = JSON.parse(readFileSync(join(work, "report", "summary.json"), "utf8"))
    assert.deepEqual(
      [summary.stats.total, summary.stats.passed, summary.stats.failed],
      [2, 1, 1]
    )
  })
})
