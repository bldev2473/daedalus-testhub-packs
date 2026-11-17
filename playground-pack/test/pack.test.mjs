// 웹 실습 팩 시험. 먼저 node build.mjs 로 팩을 만든 뒤 돈다 (npm test).
// 만든 tar.gz 를 임시 폴더에 풀고, 그 안의 파일만으로 PostgreSQL 과 Medusa 를 띄운다. 학습자 컴퓨터와 같은 조건이다.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { checkLicenses, MEDUSA_VERSION, medusaVersionViolations } from "../lib/checks.mjs"
import { FAULT_CONFLICTS, FAULTS } from "../lib/faults.mjs"
import { platformPackagesLeft, POSTGRES_PACKAGES, postgresPackages } from "../lib/platforms.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const platform = `${process.platform}-${process.arch}`
// 팩은 운영체제와 상관없이 하나다. 풀고 나서 이 운영체제의 PostgreSQL 을 넣는다 (학습자 컴퓨터와 같다)
const archiveName = `testhub-web-pack-${pkg.version}.tar.gz`
const archive = join(root, "out", archiveName)
const isRoot = typeof process.getuid === "function" && process.getuid() === 0

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once("error", reject)
    s.listen(0, "localhost", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// root 로 돌면 PostgreSQL 은 postgres 사용자로 뜬다. 그 사용자가 임시 폴더를 지나갈 수 있어야 한다
function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  if (isRoot) chmodSync(d, 0o755)
  return d
}

function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180_000, ...opts })
  if (r.status !== 0) throw new Error(`node ${args.join(" ")} 실패 (${r.status}):\n${r.stdout}\n${r.stderr}`)
  return r.stdout.trim()
}

// 줄을 기다린다. 프로세스가 먼저 끝나면 실패
function waitForLine(child, text, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => reject(new Error(`${timeoutMs}ms 안에 "${text}" 가 오지 않았다:\n${buf}`)), timeoutMs)
    const onData = (d) => {
      buf += d
      if (buf.includes(text)) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", (d) => (buf += d))
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`"${text}" 전에 끝났다 (${code}):\n${buf}`))
    })
  })
}

async function waitForHttp(url, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${url} 이 ${timeoutMs}ms 안에 응답하지 않았다`)
}

function exited(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${timeoutMs}ms 안에 끝나지 않았다`)), timeoutMs)
    child.once("exit", (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

// db.mjs start 를 정상으로 끈다. Windows 는 SIGTERM 이 강제 종료라 정리 처리가 돌지 않으므로
// 관리 프로세스처럼 표준 입력을 닫는다 (--until-stdin-closes 로 띄워야 한다)
function stopPg(p) {
  if (process.platform === "win32") p.stdin.end()
  else p.kill("SIGTERM")
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = createServer()
    s.once("error", () => resolve(true))
    s.listen(port, "localhost", () => s.close(() => resolve(false)))
  })

describe("저장소", () => {
  test("lockfile 의 @medusajs 패키지는 모두 고정한 판이다", () => {
    assert.deepEqual(medusaVersionViolations(join(root, "backend", "package-lock.json")), [])
    const lock = JSON.parse(readFileSync(join(root, "backend", "package-lock.json"), "utf8"))
    assert.equal(lock.packages["node_modules/@medusajs/medusa"].version, MEDUSA_VERSION)
    assert.equal(lock.packages["node_modules/@medusajs/ui"].version, "4.2.0")
    // 2.19 부터 끌려오는 Enterprise Edition 패키지가 없다
    for (const ee of ["auth-oidc", "audit"]) assert.equal(lock.packages[`node_modules/@medusajs/${ee}`], undefined, ee)
  })

  test("라이선스 검사가 표기 없는 패키지와 금지 라이선스를 잡는다", () => {
    const d = tempDir("pack-lic-")
    try {
      const mk = (name, body) => {
        mkdirSync(join(d, "node_modules", name), { recursive: true })
        writeFileSync(join(d, "node_modules", name, "package.json"), JSON.stringify(body))
      }
      mk("ok", { name: "ok", version: "1.0.0", license: "MIT" })
      mk("bare", { name: "bare", version: "1.0.0" })
      mk("copyleft", { name: "copyleft", version: "1.0.0", license: "LGPL-3.0" })
      const r = checkLicenses([join(d, "node_modules")], { "bare@1.0.0": { license: "MIT", evidence: "시험" }, "gone@1.0.0": {} })
      assert.equal(r.violations.length, 1)
      assert.match(r.violations[0], /copyleft@1\.0\.0: 금지/)
      assert.deepEqual(r.unusedExceptions, ["gone@1.0.0"])
      const r2 = checkLicenses([join(d, "node_modules")], {})
      assert.ok(r2.violations.some((v) => v.startsWith("bare@1.0.0: 라이선스 표기가 없고")))
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

describe("만든 팩", { skip: !existsSync(archive) && `팩이 없다 (먼저 node build.mjs): ${archiveName}` }, () => {
  let pack // 푼 팩
  let work // 데이터 폴더, 홈, 설정 폴더
  const procs = []

  before(() => {
    const expected = readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0]
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex")
    assert.equal(actual, expected, "sha256 이 다르다")
    pack = tempDir("pack-x-")
    const r = spawnSync("tar", ["-xzf", archiveName, "-C", pack], { cwd: join(root, "out") })
    assert.equal(r.status, 0, String(r.stderr))
    if (isRoot) chmodSync(pack, 0o755)
    // 학습자 컴퓨터에서 관리자가 하듯 이 운영체제의 PostgreSQL 패키지를 넣는다 (여기서는 이 폴더의 npm ci 결과에서)
    const pg = POSTGRES_PACKAGES[platform]
    cpSync(join(root, "node_modules", pg), join(pack, "node_modules", pg), { recursive: true, verbatimSymlinks: true })
    work = tempDir("pack-w-")
    mkdirSync(join(work, "home"))
  })

  after(async () => {
    for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL")
    // 시험이 중간에 실패해 남은 서버를 끈다
    for (const d of ["pg", "pg-store"]) {
      if (pack && existsSync(join(work, d, "postmaster.pid"))) {
        spawnSync(process.execPath, [join(pack, "bin", "db.mjs"), "stop", join(work, d)])
      }
    }
    rmSync(pack, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  test("풀면 manifest, backend, bin 이 있고 .bin 링크가 없다", () => {
    const manifest = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8"))
    assert.equal(manifest.pack, "web")
    assert.equal(manifest.medusa, MEDUSA_VERSION)
    assert.equal(manifest.platform, "any")
    assert.deepEqual(manifest.postgres, postgresPackages(join(root, "package-lock.json")))
    assert.equal(manifest.version, pkg.version)
    for (const f of ["bin/db.mjs", "bin/medusa.mjs", "backend/medusa-config.js", "backend/public/admin/index.html", "storefront/server.js", "storefront/.next/static", "storefront/public/favicon.ico", "storefront/LICENSE.dtc-starter", "LICENSES.md", "backend/LICENSE.dtc-starter"]) {
      assert.ok(existsSync(join(pack, f)), f)
    }
    const bins = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        if (e.name === ".bin") bins.push(join(dir, e.name))
        else walk(join(dir, e.name))
      }
    }
    walk(pack)
    assert.deepEqual(bins, [])
  })

  test("팩에 운영체제에 묶인 패키지가 없다 (넣은 PostgreSQL 만 있다)", () => {
    assert.deepEqual(platformPackagesLeft(pack), [`node_modules/${POSTGRES_PACKAGES[platform]}`])
    assert.equal(existsSync(join(pack, "backend", "node_modules", "esbuild", "bin")), false)
  })

  test("팩의 운영 의존성 라이선스가 검사를 통과한다", () => {
    const exceptions = JSON.parse(readFileSync(join(root, "license-exceptions.json"), "utf8")).packages
    const r = checkLicenses([join(pack, "node_modules"), join(pack, "backend", "node_modules"), join(pack, "storefront", "node_modules")], exceptions)
    assert.deepEqual(r.violations, [])
    assert.ok(r.packages.size > 500)
  })

  test("db, 마이그레이션과 시드, Medusa, 스냅숏과 초기화, 끄기", { timeout: 300_000 }, async () => {
    const datadir = join(work, "pg")
    const pgPort = await freePort()
    const medusaPort = await freePort()
    const home = join(work, "home")
    const xdg = join(work, "config")
    const db = (...a) => node([join(pack, "bin", "db.mjs"), ...a])

    assert.equal(db("init", datadir), "PG INIT")
    const pgProc = spawn(process.execPath, [join(pack, "bin", "db.mjs"), "start", datadir, String(pgPort), "--until-stdin-closes"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    procs.push(pgProc)
    await waitForLine(pgProc, "PG READY", 60_000)
    assert.equal(db("create", String(pgPort), "medusa"), "DB medusa")

    const medusaEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: xdg,
      DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/medusa`,
      STORE_CORS: "http://localhost:8000",
      ADMIN_CORS: `http://localhost:${medusaPort}`,
      AUTH_CORS: `http://localhost:${medusaPort},http://localhost:8000`,
      JWT_SECRET: "test-jwt",
      COOKIE_SECRET: "test-cookie",
      PORT: String(medusaPort),
    }
    delete medusaEnv.MEDUSA_DISABLE_TELEMETRY
    node([join(pack, "bin", "medusa.mjs"), "db:migrate"], { env: medusaEnv })

    // 사용 통계 설정은 XDG_CONFIG_HOME 에만 있고 꺼져 있다. 사용자 홈에는 아무것도 쓰지 않는다
    assert.equal(JSON.parse(readFileSync(join(xdg, "medusa", "config.json"), "utf8")).telemetry.enabled, false)
    assert.deepEqual(readdirSync(home), [])

    const key = db("publishable-key", String(pgPort))
    assert.match(key, /^pk_/)
    db("snapshot", String(pgPort))

    const medusa = spawn(process.execPath, [join(pack, "bin", "medusa.mjs"), "start"], { env: medusaEnv, stdio: ["ignore", "pipe", "pipe"] })
    procs.push(medusa)
    let medusaLog = ""
    medusa.stdout.on("data", (d) => (medusaLog += d))
    medusa.stderr.on("data", (d) => (medusaLog += d))
    const base = `http://localhost:${medusaPort}`
    await waitForHttp(`${base}/health`, 90_000).catch((e) => {
      throw new Error(`${e.message}\n${medusaLog.slice(-3000)}`)
    })
    const products = async () => {
      const r = await fetch(`${base}/store/products?fields=title,*images`, { headers: { "x-publishable-api-key": key } })
      assert.equal(r.status, 200)
      return (await r.json()).products
    }
    const list = await products()
    assert.equal(list.length, 4)
    assert.equal((await fetch(`${base}/app/`)).status, 200)

    // 상품을 지운 뒤 초기화하면 시드 상태로 돌아오고, 켜 둔 Medusa 가 다시 연결한다
    const pg = createRequire(join(pack, "package.json"))("pg")
    const client = new pg.Client({ host: "localhost", port: pgPort, user: "postgres", password: "postgres", database: "medusa" })
    await client.connect()
    await client.query("update product set deleted_at = now() where handle = 't-shirt'")
    await client.end()
    assert.equal((await products()).length, 3)
    assert.equal(db("reset", String(pgPort)), "PG RESET")
    let after = []
    for (let i = 0; i < 40 && after.length !== 4; i++) {
      await new Promise((r) => setTimeout(r, 250))
      after = await products().catch(() => [])
    }
    assert.equal(after.length, 4)
    assert.deepEqual(readdirSync(home), [], "Medusa 를 켜고 써도 사용자 홈에 아무것도 쓰지 않는다")

    medusa.kill("SIGTERM")
    await exited(medusa, 30_000)

    // 표준 입력을 닫으면 PostgreSQL 이 꺼진다 (Windows 에서 관리 프로세스가 쓰는 방법)
    pgProc.stdin.end()
    assert.equal(await exited(pgProc, 30_000), 0)
    assert.equal(await portOpen(pgPort), false)
    assert.equal(db("stop", datadir), "PG NOT RUNNING")
  })

  test("상점: Medusa 와 상점을 기본값이 아닌 포트로 띄워도 상품을 보이고 담기가 된다", { timeout: 300_000 }, async () => {
    const datadir = join(work, "pg-store")
    const [pgPort, medusaPort, storePort] = [await freePort(), await freePort(), await freePort()]
    const home = join(work, "home-store")
    mkdirSync(home)
    const db = (...a) => node([join(pack, "bin", "db.mjs"), ...a])
    const store = `http://localhost:${storePort}`

    db("init", datadir)
    const pgProc = spawn(process.execPath, [join(pack, "bin", "db.mjs"), "start", datadir, String(pgPort), "--until-stdin-closes"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    procs.push(pgProc)
    await waitForLine(pgProc, "PG READY", 60_000)
    db("create", String(pgPort), "medusa")
    const medusaEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(work, "config-store"),
      DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/medusa`,
      STORE_CORS: store,
      ADMIN_CORS: `http://localhost:${medusaPort}`,
      AUTH_CORS: `http://localhost:${medusaPort},${store}`,
      JWT_SECRET: "test-jwt",
      COOKIE_SECRET: "test-cookie",
      PORT: String(medusaPort),
    }
    node([join(pack, "bin", "medusa.mjs"), "db:migrate"], { env: medusaEnv })
    const key = db("publishable-key", String(pgPort))
    const medusa = spawn(process.execPath, [join(pack, "bin", "medusa.mjs"), "start"], { env: medusaEnv, stdio: "ignore" })
    procs.push(medusa)
    await waitForHttp(`http://localhost:${medusaPort}/health`, 90_000)

    const front = spawn(process.execPath, [join(pack, "storefront", "server.js")], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(storePort),
        HOSTNAME: "localhost",
        MEDUSA_BACKEND_URL: `http://localhost:${medusaPort}`,
        MEDUSA_PUBLISHABLE_KEY: key,
        DEFAULT_REGION: "dk",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    procs.push(front)
    let frontLog = ""
    front.stdout.on("data", (d) => (frontLog += d))
    front.stderr.on("data", (d) => (frontLog += d))
    await waitForHttp(`${store}/dk/store`, 60_000)

    // 브라우저 묶음에 Medusa 주소와 키가 박히지 않는다 (실행 중에 받는다)
    const bundle = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name))
        else if (e.name.endsWith(".js")) bundle.push(readFileSync(join(dir, e.name), "utf8"))
      }
    }
    walk(join(pack, "storefront", ".next", "static"))
    const all = bundle.join("\n")
    assert.ok(bundle.length > 10)
    assert.equal(all.includes("localhost:9000"), false, "브라우저 묶음에 기본 Medusa 주소가 있다")
    assert.equal(all.includes(key), false)

    const { chromium } = createRequire(join(root, "package.json"))("playwright-core")
    const browser = await chromium.launch(process.env.TESTHUB_CHROME_BINARY ? { executablePath: process.env.TESTHUB_CHROME_BINARY } : {})
    try {
      const page = await browser.newPage()
      const browserToMedusa = []
      page.on("request", (r) => r.url().includes(`:${medusaPort}/`) && browserToMedusa.push(r.url()))

      await page.goto(`${store}/dk/store`)
      await page.getByTestId("product-wrapper").first().waitFor({ timeout: 30_000 })
      assert.equal(await page.getByTestId("product-wrapper").count(), 4)
      // 옵션 선택기는 서버 액션으로 옵션을 가져온다
      await page.getByText("Size", { exact: true }).first().waitFor({ timeout: 15_000 })

      await page.goto(`${store}/dk/products/t-shirt`)
      const add = page.getByTestId("add-product-button")
      // 상류 1d897a2: 옵션을 고르기 전에는 품절이 아니라 옵션을 고르라고 한다
      assert.equal((await add.innerText()).trim(), "Select variant")
      await page.getByTestId("option-button").filter({ hasText: /^Black$/ }).first().click()
      await page.getByTestId("option-button").filter({ hasText: /^L$/ }).first().click()
      assert.equal((await add.innerText()).trim(), "Add to cart")
      await add.click()
      await page.getByTestId("nav-cart-link").filter({ hasText: "(1)" }).first().waitFor({ timeout: 15_000 })

      assert.deepEqual(browserToMedusa, [], "브라우저가 Medusa 를 직접 부르지 않는다")
    } finally {
      await browser.close()
    }

    const pg = createRequire(join(pack, "package.json"))("pg")
    const client = new pg.Client({ host: "localhost", port: pgPort, user: "postgres", password: "postgres", database: "medusa" })
    await client.connect()
    const { rows } = await client.query("select count(*)::int as n from cart_line_item")
    await client.end()
    assert.equal(rows[0].n, 1)
    assert.doesNotMatch(frontLog, /Error|error/, frontLog.slice(-2000))
    assert.deepEqual(readdirSync(home), [], "상점이 사용자 홈에 아무것도 쓰지 않는다")

    front.kill("SIGTERM")
    medusa.kill("SIGTERM")
    await exited(front, 15_000)
    await exited(medusa, 30_000)
    stopPg(pgProc)
    assert.equal(await exited(pgProc, 30_000), 0)
  })

  test("결함: 끄면 증상이 없고, 켜면 결함마다 증상이 나온다 (API, DB, 화면)", { timeout: 600_000 }, async () => {
    const datadir = join(work, "pg-faults")
    const [pgPort, medusaPort, storePort] = [await freePort(), await freePort(), await freePort()]
    const home = join(work, "home-faults")
    mkdirSync(home)
    const db = (...a) => node([join(pack, "bin", "db.mjs"), ...a])
    const store = `http://localhost:${storePort}`
    const base = `http://localhost:${medusaPort}`

    // 팩이 지원하는 결함 번호가 manifest 에 있다
    const manifest = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8"))
    assert.deepEqual(manifest.faults, FAULTS.map((f) => f.id))
    assert.deepEqual(manifest.fault_conflicts, FAULT_CONFLICTS)

    db("init", datadir)
    const pgProc = spawn(process.execPath, [join(pack, "bin", "db.mjs"), "start", datadir, String(pgPort), "--until-stdin-closes"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    procs.push(pgProc)
    await waitForLine(pgProc, "PG READY", 60_000)
    db("create", String(pgPort), "medusa")
    const medusaEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(work, "config-faults"),
      DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/medusa`,
      STORE_CORS: store,
      ADMIN_CORS: base,
      AUTH_CORS: `${base},${store}`,
      JWT_SECRET: "test-jwt",
      COOKIE_SECRET: "test-cookie",
      PORT: String(medusaPort),
    }
    node([join(pack, "bin", "medusa.mjs"), "db:migrate"], { env: medusaEnv })
    // 읽기 전용 계정은 스냅숏 전에 만든다. 초기화한 DB 에도 권한이 남는다
    assert.equal(db("reader", String(pgPort), "reader-pw"), "PG READER testhub_reader")
    db("snapshot", String(pgPort))
    const key = db("publishable-key", String(pgPort))
    const pg = createRequire(join(pack, "package.json"))("pg")

    // 학습자의 DB 검증이 쓰는 읽기 전용 계정: 읽을 수 있고 쓸 수 없다. 초기화한 뒤에도 같다
    const asReader = async (fn) => {
      const c = new pg.Client({ host: "localhost", port: pgPort, user: "testhub_reader", password: "reader-pw", database: "medusa" })
      await c.connect()
      try {
        return await fn(c)
      } finally {
        await c.end()
      }
    }
    const readerCheck = async () =>
      asReader(async (c) => {
        assert.equal((await c.query("select count(*)::int as n from product")).rows[0].n, 4)
        await assert.rejects(c.query("delete from cart_line_item"), /permission denied/)
      })
    await readerCheck()
    db("reset", String(pgPort))
    await readerCheck()

    let medusa, front
    const up = async (faults) => {
      const env = { ...medusaEnv, ...(faults ? { TESTHUB_FAULTS: faults } : {}) }
      medusa = spawn(process.execPath, [join(pack, "bin", "medusa.mjs"), "start"], { env, stdio: "ignore" })
      procs.push(medusa)
      await waitForHttp(`${base}/health`, 90_000)
      front = spawn(process.execPath, [join(pack, "storefront", "server.js")], {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          PORT: String(storePort),
          HOSTNAME: "localhost",
          MEDUSA_BACKEND_URL: base,
          MEDUSA_PUBLISHABLE_KEY: key,
          DEFAULT_REGION: "dk",
          ...(faults ? { TESTHUB_FAULTS: faults } : {}),
        },
        stdio: "ignore",
      })
      procs.push(front)
      await waitForHttp(`${store}/dk/store`, 60_000)
    }
    const down = async () => {
      front.kill("SIGTERM")
      medusa.kill("SIGTERM")
      await exited(front, 15_000)
      await exited(medusa, 30_000)
    }

    // 결함마다 증상을 본다. 증상이 있으면 true
    const api = async (method, path, body) => {
      const t0 = Date.now()
      const r = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json", "x-publishable-api-key": key },
        body: body && JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      return { status: r.status, data, ms: Date.now() - t0 }
    }
    const symptoms = async (screen = true) => {
      const region = (await api("GET", "/store/regions")).data.regions[0].id
      const shirt = (await api("GET", "/store/products?fields=*variants&handle=t-shirt")).data.products[0]
      const variant = (t) => shirt.variants.find((v) => v.title === t).id
      const cart = async () => (await api("POST", "/store/carts", { region_id: region })).data.cart.id
      const dbQty = (id) =>
        asReader(async (c) =>
          (await c.query("select quantity from cart_line_item where cart_id = $1 and deleted_at is null", [id])).rows.map((r) => Number(r.quantity)),
        )
      const s = {}
      // F01, F04: M / Black 2개를 담고 다시 조회, DB 확인
      let id = await cart()
      const added = await api("POST", `/store/carts/${id}/line-items`, { variant_id: variant("M / Black"), quantity: 2 })
      const again = (await api("GET", `/store/carts/${id}`)).data.cart.items.map((i) => i.quantity)
      s.F01 = added.status === 200 && added.data.cart.items[0]?.quantity === 1
      s.F04 = added.status === 200 && added.data.cart.items.length === 1 && again.length === 0 && (await dbQty(id)).length === 0
      // F02: XL / Black
      id = await cart()
      s.F02 = (await api("POST", `/store/carts/${id}/line-items`, { variant_id: variant("XL / Black"), quantity: 1 })).status === 500
      // F08: 담은 뒤 수량을 0으로 바꾼다. 정상이면 항목이 지워진다
      id = await cart()
      const line = (await api("POST", `/store/carts/${id}/line-items`, { variant_id: variant("S / White"), quantity: 1 })).data.cart.items[0]
      s.F08 = line ? (await api("POST", `/store/carts/${id}/line-items/${line.id}`, { quantity: 0 }), (await dbQty(id)).join() === "0") : false
      // F05: 상품 목록 10번 중 2번 이상 2.5초를 넘는다
      let slow = 0
      for (let i = 0; i < 10; i++) if ((await api("GET", "/store/products?limit=5")).ms > 2500) slow++
      s.F05 = slow >= 2

      if (!screen) return s
      // 화면: 정렬(F07), 같은 상품 두 번 담은 뒤 머리글 개수(F06), 장바구니 화면 소계와 API 합계(F03)
      const { chromium } = createRequire(join(root, "package.json"))("playwright-core")
      const browser = await chromium.launch(process.env.TESTHUB_CHROME_BINARY ? { executablePath: process.env.TESTHUB_CHROME_BINARY } : {})
      try {
        const page = await browser.newPage()
        await page.goto(`${store}/dk/store?sortBy=price_asc`)
        await page.getByTestId("product-wrapper").first().waitFor({ timeout: 30_000 })
        const order = await page.getByTestId("product-wrapper").evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0]))
        s.F07 = order[0] !== "Medusa T-Shirt"
        const add = async (path, opts, count) => {
          await page.goto(`${store}/dk/products/${path}`)
          for (const o of opts) await page.getByTestId("option-button").filter({ hasText: new RegExp(`^${o}$`) }).first().click()
          await page.getByTestId("add-product-button").click()
          await page.getByTestId("nav-cart-link").filter({ hasText: `(${count})` }).first().waitFor({ timeout: 15_000 }).catch(() => {})
        }
        await add("t-shirt", ["Black", "M"], 1)
        await add("t-shirt", ["Black", "M"], 2)
        s.F06 = (await page.getByTestId("nav-cart-link").first().innerText()).includes("(1)")
        await add("sweatshirt", ["M"], 3)
        await page.goto(`${store}/dk/cart`)
        const ui = Number(await page.getByTestId("cart-subtotal").getAttribute("data-value", { timeout: 20_000 }))
        const cartId = (await page.context().cookies()).find((c) => c.name === "_medusa_cart_id")?.value
        const apiCart = (await api("GET", `/store/carts/${cartId}`)).data.cart
        s.F03 = apiCart.items.length >= 2 && ui !== Number(apiCart.item_subtotal)
      } finally {
        await browser.close()
      }
      return s
    }

    // F04 는 담은 상품을 지워, 담은 뒤를 보는 결함(F03, F06, F08)을 볼 수 없게 한다 (함께 켜지 않는다: FAULT_CONFLICTS).
    // 그래서 세 묶음으로 나눠 켠다. 묶음마다 켠 결함만 증상이 나와야 한다
    const expect = (on) => Object.fromEntries(FAULTS.map((f) => [f.id, on.includes(f.id)]))
    await up("")
    assert.deepEqual(await symptoms(), expect([]), "결함을 켜지 않으면 증상이 없다")
    await down()
    for (const group of [["F01", "F02", "F05", "F08"], ["F04"], ["F03", "F06", "F07"]]) {
      db("reset", String(pgPort))
      await up(group.join(","))
      const screen = !group.includes("F04")
      const seen = await symptoms(screen)
      const want = expect(group)
      if (!screen) for (const id of ["F03", "F06", "F07", "F08"]) delete want[id], delete seen[id]
      assert.deepEqual(seen, want, `켠 결함(${group.join(",")})만 증상이 나온다`)
      await down()
    }

    // 결함을 켜고 쓴 뒤 초기화하면 데이터는 시드 직후로 돌아온다
    db("reset", String(pgPort))
    assert.equal(await asReader(async (c) => (await c.query("select count(*)::int as n from cart")).rows[0].n), 0)

    stopPg(pgProc)
    assert.equal(await exited(pgProc, 30_000), 0)
  })

  test("관리 프로세스가 강제 종료돼 남은 PostgreSQL 을 stop 이 끄고, start 가 남은 것을 정리한다", { timeout: 120_000 }, async () => {
    const datadir = join(work, "pg")
    const port = await freePort()
    const db = (...a) => node([join(pack, "bin", "db.mjs"), ...a])
    const start = () => {
      const p = spawn(process.execPath, [join(pack, "bin", "db.mjs"), "start", datadir, String(port), "--until-stdin-closes"], {
        stdio: ["pipe", "pipe", "pipe"],
      })
      procs.push(p)
      return p
    }

    let p = start()
    await waitForLine(p, "PG READY", 60_000)
    p.kill("SIGKILL") // 노드만 죽는다. PostgreSQL 은 남는다
    await exited(p, 10_000)
    assert.equal(await portOpen(port), true, "SIGKILL 뒤에도 PostgreSQL 이 남아 있어야 이 시험이 뜻이 있다")
    assert.equal(db("stop", datadir), "PG STOPPED")
    assert.equal(await portOpen(port), false)

    p = start()
    await waitForLine(p, "PG READY", 60_000)
    p.kill("SIGKILL")
    await exited(p, 10_000)
    p = start() // 남은 서버를 정리하고 다시 뜬다
    await waitForLine(p, "PG READY", 60_000)
    stopPg(p)
    assert.equal(await exited(p, 30_000), 0)
    assert.equal(await portOpen(port), false)

    // 다른 곳에서 PostgreSQL 을 끄면 start 도 오류로 끝난다 (남아 있지 않는다)
    p = start()
    await waitForLine(p, "PG READY", 60_000)
    assert.equal(db("stop", datadir), "PG STOPPED")
    assert.equal(await exited(p, 30_000), 1)
  })
})
