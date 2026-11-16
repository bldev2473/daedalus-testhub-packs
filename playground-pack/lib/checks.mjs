// 팩 빌드와 시험이 함께 쓰는 검사: Medusa 판 고정, 의존성 라이선스
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const MEDUSA_VERSION = "2.18.0"
// @medusajs 이름이지만 Medusa 본체와 판을 따로 매기는 패키지 (디자인 시스템)
export const MEDUSA_OWN_VERSIONS = { "@medusajs/ui": "4.2.0" }

// 팩에 넣을 수 없는 라이선스. 이름에 이 말이 들어가면 실패다 (LGPL 도 포함)
export const FORBIDDEN_LICENSES = ["GPL", "AGPL", "SSPL", "BUSL", "Commons-Clause", "Elastic"]

/** package-lock.json 의 @medusajs 패키지 판이 고정한 판이 아니면 그 목록을 돌려준다 */
export function medusaVersionViolations(lockfilePath) {
  const lock = JSON.parse(readFileSync(lockfilePath, "utf8"))
  const out = []
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    const m = key.match(/(?:^|\/)node_modules\/(@medusajs\/[^/]+)$/)
    if (!m) continue
    const want = MEDUSA_OWN_VERSIONS[m[1]] ?? MEDUSA_VERSION
    if (meta.version !== want) out.push(`${m[1]}@${meta.version} (기대 ${want}, ${key})`)
  }
  return out
}

function licenseOf(pkg) {
  let l = pkg.license
  if (l && typeof l === "object") l = l.type
  if (!l && Array.isArray(pkg.licenses)) l = pkg.licenses.map((x) => x?.type ?? x).join(" OR ")
  return typeof l === "string" && l.trim() ? l.trim() : null
}

/** node_modules 폴더(중첩 포함)의 패키지를 모두 모은다. 결과: Map<"이름@판", {name, version, license, dir}> */
export function collectPackages(nodeModulesDirs) {
  const found = new Map()
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue
      const path = join(dir, entry.name)
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        walk(path)
        continue
      }
      const pj = join(path, "package.json")
      if (!existsSync(pj)) continue
      let pkg
      try {
        pkg = JSON.parse(readFileSync(pj, "utf8"))
      } catch {
        continue
      }
      if (pkg.name && pkg.version) {
        found.set(`${pkg.name}@${pkg.version}`, {
          name: pkg.name,
          version: pkg.version,
          license: licenseOf(pkg),
          dir: path,
        })
      }
      walk(join(path, "node_modules"))
    }
  }
  for (const d of nodeModulesDirs) walk(d)
  return found
}

/**
 * 라이선스 검사. exceptions 는 license-exceptions.json 의 packages ({"이름@판": {license, evidence}}).
 * 결과: { packages, violations, unusedExceptions }
 */
export function checkLicenses(nodeModulesDirs, exceptions) {
  const packages = collectPackages(nodeModulesDirs)
  const violations = []
  const used = new Set()
  for (const [id, p] of packages) {
    let license = p.license
    if (!license) {
      const ex = exceptions[id]
      if (!ex) {
        violations.push(`${id}: 라이선스 표기가 없고 license-exceptions.json 에도 없다 (${p.dir})`)
        continue
      }
      used.add(id)
      license = ex.license
      p.license = `${ex.license} (예외: ${ex.evidence})`
    }
    const bad = FORBIDDEN_LICENSES.find((f) => license.toUpperCase().includes(f.toUpperCase()))
    if (bad) violations.push(`${id}: 금지 라이선스 ${license}`)
  }
  const unusedExceptions = Object.keys(exceptions).filter((id) => !used.has(id))
  return { packages, violations, unusedExceptions }
}
