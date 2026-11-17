// 팩은 운영체제와 상관없이 하나다. 운영체제마다 다른 것은 PostgreSQL 실행 파일(embedded-postgres 의 플랫폼 패키지)뿐이라
// 팩에서 빼고, 학습자 컴퓨터에서 그 운영체제의 것만 넣는다 (데스크톱 앱은 설치 파일에 넣어 두고, 아니면 npm 에서 받는다).
// build.mjs, 팩 시험, 데스크톱 앱 빌드(desktop/build-postgres.mjs)가 함께 쓴다
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join, sep } from "node:path"

// 지원 플랫폼(process.platform-process.arch)과 그 플랫폼의 PostgreSQL 패키지. linux-x64 는 개발과 CI 용
export const POSTGRES_PACKAGES = {
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "win32-x64": "@embedded-postgres/windows-x64",
  "linux-x64": "@embedded-postgres/linux-x64",
}

/** lockfile 에서 플랫폼마다 PostgreSQL 패키지의 판, 주소, 무결성 값을 읽는다 (manifest.json 의 postgres) */
export function postgresPackages(lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"))
  const out = {}
  for (const [platform, name] of Object.entries(POSTGRES_PACKAGES)) {
    const entry = lock.packages?.[`node_modules/${name}`]
    if (!entry?.resolved || !entry?.integrity) throw new Error(`lockfile 에 ${name} 의 주소와 무결성 값이 없다`)
    out[platform] = { name, version: entry.version, url: entry.resolved, integrity: entry.integrity }
  }
  return out
}

/**
 * 운영체제나 CPU 에 묶인 것을 지운다. 지운 경로(root 기준)를 돌려준다
 * - package.json 에 os 나 cpu 가 있는 패키지 (PostgreSQL, esbuild, rollup, msgpackr-extract 의 플랫폼 패키지)
 * - esbuild 가 설치하며 bin 에 복사해 둔 실행 파일
 * 실행 중에는 쓰지 않는다 (빌드 도구이거나 없으면 JS 로 대신 도는 선택 모듈). 팩 시험이 이것을 확인한다
 */
export function removePlatformPackages(root) {
  const removed = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      const p = join(dir, e.name)
      if (e.name.startsWith("@")) {
        walk(p)
        continue
      }
      const pj = join(p, "package.json")
      if (existsSync(pj)) {
        let meta = {}
        try {
          meta = JSON.parse(readFileSync(pj, "utf8"))
        } catch {
          // 읽을 수 없는 package.json 은 건드리지 않는다
        }
        if (meta.os || meta.cpu) {
          rmSync(p, { recursive: true, force: true })
          removed.push(p.slice(root.length + 1))
          continue
        }
        if (meta.name === "esbuild" && existsSync(join(p, "bin"))) {
          rmSync(join(p, "bin"), { recursive: true, force: true })
          removed.push(`${p.slice(root.length + 1)}/bin`)
        }
      }
      if (existsSync(join(p, "node_modules"))) walk(join(p, "node_modules"))
    }
  }
  for (const nm of ["node_modules", "backend/node_modules", "storefront/node_modules"]) walk(join(root, nm))
  return removed.sort()
}

/** 운영체제나 CPU 에 묶인 패키지가 남았는지 (팩 시험용). 남은 경로 목록 */
export function platformPackagesLeft(root) {
  const left = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      const p = join(dir, e.name)
      if (e.name.startsWith("@")) {
        walk(p)
        continue
      }
      const pj = join(p, "package.json")
      if (existsSync(pj)) {
        try {
          const meta = JSON.parse(readFileSync(pj, "utf8"))
          if (meta.os || meta.cpu) left.push(p.slice(root.length + 1).split(sep).join("/"))
        } catch {
          // 무시
        }
      }
      if (existsSync(join(p, "node_modules"))) walk(join(p, "node_modules"))
    }
  }
  for (const nm of ["node_modules", "backend/node_modules", "storefront/node_modules"]) walk(join(root, nm))
  return left.sort()
}
