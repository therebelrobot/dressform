#!/usr/bin/env node
// Fails the build if a bundle references an origin the project has not signed off on.
//
// A hit is a string in the code, not necessarily a network call — three.js carries
// documentation links in error messages. Every origin is therefore a deliberate
// decision, and the scan goes red on anything new.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ALLOWLIST_FILE = 'scripts/origin-allowlist.txt'
const ALLOWLIST = new Set(
  readFileSync(ALLOWLIST_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.toLowerCase()),
)

const REQUIRED = ['dist/server.js', 'dist/web/app.js']
const missing = REQUIRED.filter((f) => !existsSync(f))
if (missing.length) {
  console.error(`origin scan: refusing to report a pass — missing ${missing.join(', ')}`)
  console.error('run `npm run build:all` first')
  process.exit(1)
}

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}
walk('dist')

const ORIGIN = /https?:\/\/([A-Za-z0-9.-]+)/g
const found = new Map()

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(ORIGIN)) {
    const host = match[1].toLowerCase()
    if (!found.has(host)) found.set(host, new Set())
    found.get(host).add(relative('.', file))
  }
}

const strays = [...found].filter(([host]) => !ALLOWLIST.has(host))

console.log(`origin scan: ${files.length} bundle files, ${found.size} distinct origins`)
for (const [host, where] of [...found].sort()) {
  const verdict = ALLOWLIST.has(host) ? 'allowed' : 'STRAY  '
  console.log(`  ${verdict}  ${host}  (${[...where].sort().join(', ')})`)
}

if (strays.length) {
  console.error('\nUnexpected external origin in the bundle.')
  console.error(`Add it to ${ALLOWLIST_FILE} only after confirming it is inert.`)
  process.exit(1)
}

console.log('no stray origins')
