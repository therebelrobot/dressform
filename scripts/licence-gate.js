#!/usr/bin/env node
// Fails the build on any dependency licence outside the allowlist.
// Mechanical, so the licence rule never becomes a review-time judgement call.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ALLOW = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD',
  'Unlicense', 'CC0-1.0', 'Zlib',
])

const root = 'node_modules'
if (!existsSync(root)) {
  console.log('licence gate: no node_modules — nothing to inspect')
  process.exit(0)
}

// One entry of the pre-SPDX `licenses` field. Both forms are still published:
// `["MIT"]` and `[{ type: "MIT" }]`. Reading only the object form reports a
// genuinely MIT package as unlicensed, which is a false failure, not a safe one.
const licenceEntry = (entry) => {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry.type === 'string') return entry.type
  return null
}

const readLicence = (pkgPath) => {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.license === 'string') return pkg.license
    if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type

    if (Array.isArray(pkg.licenses)) {
      const joined = pkg.licenses.map(licenceEntry).filter(Boolean).join(' OR ')
      // An expression we could not read is a missing licence, not a stray one:
      // it belongs in the "no licence field found" bucket so a human looks.
      return joined.length > 0 ? joined : null
    }

    return null
  } catch {
    return null
  }
}

const expressionOk = (lic) => {
  if (!lic) return false
  return lic
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim().replace(/^\(|\)$/g, ''))
    .every((part) => ALLOW.has(part))
}

const seen = new Map()

const collect = (dir, depth = 0) => {
  if (depth > 4 || !existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.name.startsWith('@')) {
      collect(full, depth)
      continue
    }
    const pkg = join(full, 'package.json')
    if (!existsSync(pkg)) continue
    seen.set(entry.name, readLicence(pkg))
    const nested = join(full, 'node_modules')
    if (existsSync(nested)) collect(nested, depth + 1)
  }
}

collect(root)

const denied = [...seen].filter(([, lic]) => lic && !expressionOk(lic))
const unknown = [...seen].filter(([, lic]) => !lic)

console.log(`licence gate: ${seen.size} packages inspected`)

if (denied.length || unknown.length) {
  if (denied.length) {
    console.error('\nOutside the allowlist:')
    for (const [name, lic] of denied) console.error(`  ${name}  ${lic}`)
  }
  if (unknown.length) {
    console.error('\nNo licence field found:')
    for (const [name] of unknown) console.error(`  ${name}`)
  }
  console.error(`\nallowlist: ${[...ALLOW].join(', ')}`)
  process.exit(1)
}

console.log('all licences inside the allowlist')
