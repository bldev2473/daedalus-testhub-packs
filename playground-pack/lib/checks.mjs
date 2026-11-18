// 팩 빌드와 시험이 함께 쓰는 검사: Medusa 판 고정, 의존성 라이선스, 압축 항목
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createGunzip } from "node:zlib"

/**
 * tar.gz 에서 이름이 ._ 로 시작하는 항목(macOS 의 AppleDouble 메타데이터)의 경로를 돌려준다.
 * 시스템 tar 는 이 항목을 속성으로 합쳐 보여 주지 않으므로 헤더를 직접 읽는다 (ustar, pax path, GNU 긴 이름)
 */
export async function appleDoubleEntries(archive) {
  const found = []
  const text = (b) => b.toString("utf8").replace(/\0.*$/s, "")
  let rest = Buffer.alloc(0)
  let skip = 0 // 건너뛸 내용 바이트
  let capture = null // 이름을 담은 pax, GNU 긴 이름 항목의 내용
  let nextName = null
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
    const data = rest.length ? Buffer.concat([rest, chunk]) : chunk
    let off = 0
    while (off < data.length) {
      if (skip > 0) {
        const n = Math.min(skip, data.length - off)
        skip -= n
        off += n
        continue
      }
      if (capture) {
        const n = Math.min(capture.padded - capture.got, data.length - off)
        capture.parts.push(data.subarray(off, off + n))
        capture.got += n
        off += n
        if (capture.got < capture.padded) continue
        const body = Buffer.concat(capture.parts).subarray(0, capture.size)
        if (capture.type === "L") nextName = text(body)
        else nextName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1] ?? null
        capture = null
        continue
      }
      if (data.length - off < 512) break
      const h = data.subarray(off, off + 512)
      off += 512
      if (h.every((b) => b === 0)) continue
      const size = parseInt(text(h.subarray(124, 136)).trim() || "0", 8)
      const padded = Math.ceil(size / 512) * 512
      const type = String.fromCharCode(h[156])
      if (type === "x" || type === "L") {
        capture = { type, size, padded, parts: [], got: 0 }
        continue
      }
      skip = padded
      if (type === "g") continue
      const prefix = text(h.subarray(345, 500))
      const name = nextName ?? (prefix ? `${prefix}/${text(h.subarray(0, 100))}` : text(h.subarray(0, 100)))
      nextName = null
      if (name.replace(/\/+$/, "").split("/").pop().startsWith("._")) found.push(name)
    }
    rest = data.subarray(off)
  }
  return found
}

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
 * 쓸 수 없는 라이선스인지. "MIT or GPL-2.0"처럼 둘 중 고르는(OR) 표기는 쓸 수 있는 쪽을 고르면 되므로,
 * 모든 선택지가 금지일 때만 금지다. AND나 하나뿐인 표기는 그대로 본다
 */
export function forbidden(license) {
  const isBad = (l) => FORBIDDEN_LICENSES.some((f) => l.toUpperCase().includes(f.toUpperCase()))
  const choices = license.split(/\s+or\s+/i).map((l) => l.replace(/[()]/g, "").trim())
  return choices.every(isBad)
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
    if (forbidden(license)) violations.push(`${id}: 금지 라이선스 ${license}`)
  }
  const unusedExceptions = Object.keys(exceptions).filter((id) => !used.has(id))
  return { packages, violations, unusedExceptions }
}
