#!/usr/bin/env node
// 실습 환경의 PostgreSQL 제어. 팩 안에서 Electron Node나 시스템 Node로 실행된다.
//
//   node db.mjs init <datadir>
//   node db.mjs start <datadir> <port> [--until-stdin-closes]
//       준비되면 stdout에 "PG READY" 한 줄. SIGINT, SIGTERM에 끈다.
//       --until-stdin-closes이면 표준 입력이 닫힐 때도 끈다 (Windows는 신호를 보낼 수 없어서 부모가 입력을 닫는다)
//       데이터 폴더에 지난 실행의 서버가 남아 있으면 그 서버가 이 데이터 폴더의 것인지 확인하고 끈 뒤 시작한다
//       PostgreSQL이 먼저 끝나면 종료 코드 1로 끝난다. 띄우기는 pg_ctl이 하고 로그는 <datadir>/postgres.log
//   node db.mjs stop <datadir>
//       남은 서버를 끈다. 서버에 접속해 data_directory가 이 폴더인지 확인한 뒤에만 pg_ctl로 끈다
//       (postmaster.pid의 PID가 다른 프로그램에 다시 쓰였을 수 있어서다). "PG STOPPED" 또는 "PG NOT RUNNING"
//   node db.mjs create <port> <db>          없으면 만든다
//   node db.mjs snapshot <port>             medusa를 복제해 medusa_seed를 만든다 (있으면 바꾼다)
//   node db.mjs reset <port>                medusa를 지우고 medusa_seed에서 다시 만든다
//   node db.mjs publishable-key <port> [token]
//                                           시드가 만든 publishable key를 stdout에 쓴다. token을 주면 그 값으로 바꾼 뒤 쓴다.
//                                           앱처럼 빌드할 때 키를 넣는 것이 쓰도록 값을 고정할 때 쓴다 (`pk_` 뒤 문자열)
//   node db.mjs reader <port> <password>    읽기 전용 계정 testhub_reader를 만든다 (있으면 비밀번호만 바꾼다).
//                                           학습자의 DB 검증 테스트가 쓴다. snapshot 전에 해야 초기화한 DB에도 권한이 남는다
//
// 접속: localhost, 사용자 postgres, 비밀번호 postgres. 서버는 localhost에서만 수신 대기(listen)한다 (PostgreSQL 기본값).
// 내장 PostgreSQL에는 pg_dump가 없어 초기화는 템플릿 DB 복제로 한다.
// root로 실행되면(컨테이너, CI) PostgreSQL이 root로 뜨지 않으므로 postgres 사용자로 띄운다. 학습자 컴퓨터는 해당 없다.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { platform } from "node:os"
import { join } from "node:path"
import EmbeddedPostgres from "embedded-postgres"
import pg from "pg"

const USER = "postgres"
const PASSWORD = "postgres"
const DB = "medusa"
const READER = "testhub_reader"
const SEED_DB = "medusa_seed"
const isRoot = typeof process.getuid === "function" && process.getuid() === 0

function fail(message, code = 2) {
  console.error(`db.mjs: ${message}`)
  process.exit(code)
}

function cluster(datadir, port = 5432) {
  return new EmbeddedPostgres({
    databaseDir: datadir,
    port: Number(port),
    user: USER,
    password: PASSWORD,
    persistent: true,
    createPostgresUser: isRoot,
    onLog: () => {},
    onError: (e) => console.error(String(e?.message ?? e)),
  })
}

async function withClient(port, database, fn) {
  const client = new pg.Client({ host: "localhost", port: Number(port), user: USER, password: PASSWORD, database })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const ident = (name) => `"${name.replaceAll('"', '""')}"`

async function terminate(client, database) {
  await client.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [database],
  )
}

// postmaster.pid: 1행 PID, 2행 데이터 폴더, 4행 포트
function readPidFile(datadir) {
  const file = `${datadir}/postmaster.pid`
  if (!existsSync(file)) return null
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  return { pid: Number(lines[0]), port: Number(lines[3]) }
}

async function pgCtlPath() {
  const plat = { darwin: "darwin", linux: "linux", win32: "windows" }[platform()]
  const mod = await import(`@embedded-postgres/${plat}-${process.arch}`)
  return mod.pg_ctl
}

function postgresIds() {
  if (!isRoot) return {}
  const id = (flag) => Number(spawnSync("id", [flag, USER], { encoding: "utf8" }).stdout.trim())
  return { uid: id("-u"), gid: id("-g") }
}

// 남은 서버가 이 데이터 폴더의 것이면 끈다. 끈 것이 있으면 true
async function stopLeftover(datadir) {
  const info = readPidFile(datadir)
  if (!info) return false
  let ours = false
  try {
    const dir = await withClient(info.port, "postgres", async (c) => (await c.query("show data_directory")).rows[0].data_directory)
    ours = realpathSync(dir) === realpathSync(datadir)
  } catch {
    // 접속이 안 되면 서버가 없다. 남은 postmaster.pid 는 PostgreSQL 이 다음 시작 때 스스로 정리한다
    return false
  }
  if (!ours) return false
  const r = spawnSync(await pgCtlPath(), ["stop", "-D", datadir, "-m", "fast", "-w", "-t", "30"], {
    encoding: "utf8",
    ...postgresIds(),
  })
  if (r.status !== 0) fail(`남은 서버를 끄지 못했다: ${r.stderr || r.stdout}`, 1)
  return true
}

const [cmd, ...args] = process.argv.slice(2)

switch (cmd) {
  case "init": {
    const [datadir] = args
    if (!datadir) fail("사용법: init <datadir>")
    if (existsSync(`${datadir}/PG_VERSION`)) fail(`이미 만든 데이터 폴더다: ${datadir}`)
    await cluster(datadir).initialise()
    console.log("PG INIT")
    break
  }
  case "start": {
    const [datadir, port] = args
    if (!datadir || !port) fail("사용법: start <datadir> <port> [--until-stdin-closes]")
    await stopLeftover(datadir)
    // pg_ctl 로 띄운다. Windows 에서 관리자 권한으로 돌아도 pg_ctl 은 권한을 낮춘 토큰으로 postgres 를 띄운다
    // (postgres 를 직접 띄우면 "administrative permissions" 로 거절한다. GitHub 의 Windows 실행기가 그렇다).
    // stdio 를 넘기지 않는다: Windows 의 pg_ctl 이 띄운 서버가 핸들을 물려받으면 spawnSync 가 끝나지 않는다
    const ctl = await pgCtlPath()
    const log = join(datadir, "postgres.log")
    const started = spawnSync(ctl, ["start", "-D", datadir, "-w", "-t", "60", "-l", log, "-o", `-p ${Number(port)}`], {
      stdio: "ignore",
      ...postgresIds(),
    })
    if (started.status !== 0) {
      const tail = existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).slice(-20).join("\n") : "(로그 없음)"
      fail(`PostgreSQL을 시작하지 못했다 (pg_ctl 종료 코드 ${started.status}):\n${tail}`, 1)
    }
    console.log("PG READY")

    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      spawnSync(ctl, ["stop", "-D", datadir, "-m", "fast", "-w", "-t", "30"], { stdio: "ignore", ...postgresIds() })
      process.exit(0)
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    if (args.includes("--until-stdin-closes")) {
      process.stdin.on("end", stop)
      process.stdin.on("close", stop)
      process.stdin.resume()
    }
    // PostgreSQL 이 먼저 끝나면(다른 곳에서 껐거나 죽었다) 이 프로세스도 오류로 끝낸다. 관리 프로세스가 알아채게
    const alive = () => {
      const info = readPidFile(datadir)
      if (!info) return false
      try {
        process.kill(info.pid, 0)
        return true
      } catch (e) {
        return e.code === "EPERM"
      }
    }
    setInterval(() => {
      if (stopping || alive()) return
      console.error("db.mjs: PostgreSQL이 끝났다")
      process.exit(1)
    }, 1000)
    break
  }
  case "stop": {
    const [datadir] = args
    if (!datadir) fail("사용법: stop <datadir>")
    console.log((await stopLeftover(datadir)) ? "PG STOPPED" : "PG NOT RUNNING")
    break
  }
  case "create": {
    const [port, name] = args
    if (!port || !name) fail("사용법: create <port> <db>")
    await withClient(port, "postgres", async (c) => {
      const { rowCount } = await c.query("select 1 from pg_database where datname = $1", [name])
      if (!rowCount) await c.query(`create database ${ident(name)}`)
    })
    console.log(`DB ${name}`)
    break
  }
  case "snapshot": {
    const [port] = args
    if (!port) fail("사용법: snapshot <port>")
    await withClient(port, "postgres", async (c) => {
      await terminate(c, DB)
      await c.query(`drop database if exists ${ident(SEED_DB)}`)
      await c.query(`create database ${ident(SEED_DB)} template ${ident(DB)}`)
    })
    console.log("PG SNAPSHOT")
    break
  }
  case "reset": {
    const [port] = args
    if (!port) fail("사용법: reset <port>")
    await withClient(port, "postgres", async (c) => {
      const { rowCount } = await c.query("select 1 from pg_database where datname = $1", [SEED_DB])
      if (!rowCount) fail(`${SEED_DB}가 없다. 시드 직후 snapshot을 먼저 한다`, 1)
      await terminate(c, DB)
      await c.query(`drop database if exists ${ident(DB)} with (force)`)
      await c.query(`create database ${ident(DB)} template ${ident(SEED_DB)}`)
    })
    console.log("PG RESET")
    break
  }
  case "publishable-key": {
    const [port, fixed] = args
    if (!port) fail("사용법: publishable-key <port> [token]")
    if (fixed !== undefined && !/^pk_[0-9A-Za-z_-]{16,}$/.test(fixed)) fail("token은 pk_로 시작하는 16자 이상의 영문, 숫자, _, -이다")
    const live = "type = 'publishable' and revoked_at is null and deleted_at is null"
    const token = await withClient(port, DB, async (c) => {
      if (fixed !== undefined) {
        // 발급할 때 Medusa가 같이 남기는 redacted(앞 6자, 뒤 3자)도 맞춘다. 판매 채널 연결은 키 id로 이어져 있어 그대로 남는다
        await c.query(`update api_key set token = $1, redacted = $2 where ${live}`, [fixed, `${fixed.slice(0, 6)}***${fixed.slice(-3)}`])
      }
      const r = await c.query(`select token from api_key where ${live} order by created_at limit 1`)
      return r.rows[0]?.token
    })
    if (!token) fail("publishable key가 없다. 시드가 돌았는지 본다", 1)
    console.log(token)
    break
  }
  case "reader": {
    const [port, password] = args
    if (!port || !password) fail("사용법: reader <port> <password>")
    await withClient(port, "postgres", async (c) => {
      const { rowCount } = await c.query("select 1 from pg_roles where rolname = $1", [READER])
      // 비밀번호는 식별자가 아니라 문자열 리터럴이다. 작은따옴표를 겹쳐 쓴다
      const lit = `'${password.replaceAll("'", "''")}'`
      await c.query(`${rowCount ? "alter" : "create"} role ${ident(READER)} login password ${lit}`)
      await c.query(`grant connect on database ${ident(DB)} to ${ident(READER)}`)
    })
    await withClient(port, DB, async (c) => {
      await c.query(`grant usage on schema public to ${ident(READER)}`)
      await c.query(`grant select on all tables in schema public to ${ident(READER)}`)
      await c.query(`alter default privileges in schema public grant select on tables to ${ident(READER)}`)
    })
    console.log(`PG READER ${READER}`)
    break
  }
  default:
    fail(`모르는 명령: ${cmd ?? "(없음)"}. init, start, stop, create, snapshot, reset, publishable-key, reader`)
}
