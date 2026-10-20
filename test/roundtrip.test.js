// The round-trip property test. The central test of the project.
//
// For every design in the corpus and every generated edit sequence,
// `emit(apply(open(src), ops))` preserves all opaque bytes byte-for-byte and
// changes only fenced regions.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { apply, emit, open, readRegions } from '../src/doc/index.ts'

const corpus = (name) =>
  readFileSync(new URL(`./support/corpus/${name}`, import.meta.url), 'utf8')

const CLEAN = corpus('clean.mjs')
const OPAQUE = corpus('opaque.mjs')
const FOREIGN = corpus('foreign.mjs')

const openOrFail = (source) => {
  const result = open(source)
  assert.ok(result.ok, `expected ${JSON.stringify(source.slice(0, 20))} to open`)
  return result.document
}

const linesOf = (text) => text.split('\n')

/** Line numbers (1-based) whose text differs, plus whole-file shape changes. */
const changedLines = (before, after) => {
  const a = linesOf(before)
  const b = linesOf(after)
  const changed = new Set()
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) changed.add(i + 1)
  }
  return changed
}

const fencedLines = (source) => {
  const { regions } = readRegions(source)
  const inside = new Set()
  for (const region of regions) {
    for (let line = region.openLine; line <= region.closeLine; line++) inside.add(line)
  }
  return inside
}

/**
 * A deterministic generator. Seeded so a failure reproduces, and drawing only
 * from the modelled nodes, so the op set stays inside what the model owns.
 */
const makeRandom = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const FORMULAS = [
  '0',
  'measurements.chest / 4',
  'measurements.shoulderToShoulder',
  'measurements.chest - 120',
  'options.chestEase * 100',
  'points.cb.distance(points.waist)',
]

const generateOps = (document, count, seed) => {
  const random = makeRandom(seed)
  const modelled = [...document.nodes.values()].filter(
    (node) => node.kind === 'point' || node.kind === 'path',
  )
  assert.ok(modelled.length > 0, 'the corpus design has no modelled nodes to edit')

  const ops = []
  for (let i = 0; i < count; i++) {
    const node = modelled[Math.floor(random() * modelled.length)]
    const formula = FORMULAS[Math.floor(random() * FORMULAS.length)]

    if (node.kind === 'point') {
      // Index 0 is the receiver for the method forms; rewrite an argument.
      const index = node.via === 'ctor' ? Math.floor(random() * 2) : 1 + Math.floor(random() * 2)
      ops.push({ op: 'setFormula', id: node.id, index, source: formula })
    } else {
      const index = node.ops.findIndex((entry) => entry.type !== 'close')
      if (index === -1) continue
      ops.push({ op: 'setPathOp', id: node.id, index, source: formula })
    }
  }
  return ops
}

test('an unmodified document emits its own input byte-for-byte', () => {
  for (const [name, source] of [['clean', CLEAN], ['opaque', OPAQUE]]) {
    const document = openOrFail(source)
    assert.equal(emit(document), source, `${name}.mjs did not round-trip unmodified`)
  }
})

test('every generated edit sequence changes only fenced lines', () => {
  const source = CLEAN
  const inside = fencedLines(source)

  for (let seed = 1; seed <= 25; seed++) {
    let document = openOrFail(source)
    const ops = generateOps(document, 6, seed)

    for (const op of ops) {
      const result = apply(document, op)
      assert.ok(result.ok, `seed ${seed}: ${op.op} was refused: ${JSON.stringify(result.refusal)}`)
      document = result.document
    }

    const out = emit(document)
    const changed = changedLines(source, out)
    const outside = [...changed].filter((line) => !inside.has(line))
    assert.deepEqual(
      outside,
      [],
      `seed ${seed}: lines ${outside.join(', ')} changed outside any fenced region`,
    )
    assert.ok(changed.size > 0, `seed ${seed}: the edits changed nothing at all`)
  }
})

test('every opaque region survives byte-for-byte', () => {
  const source = OPAQUE
  const document = openOrFail(source)
  const inside = fencedLines(source)

  const opaque = [...document.nodes.values()].filter((node) => node.kind === 'opaque')
  assert.ok(opaque.length >= 7, `expected the corpus to exercise the table, saw ${opaque.length}`)

  const edited = apply(document, {
    op: 'setFormula',
    id: 'n:back.waist',
    index: 2,
    source: 'measurements.chest / 3',
  })
  assert.ok(edited.ok)

  const out = emit(edited.document)
  for (const node of opaque) {
    assert.ok(
      out.includes(node.bytes),
      `an opaque region's bytes were rewritten:\n${node.bytes}`,
    )
  }

  const outside = [...changedLines(source, out)].filter((line) => !inside.has(line))
  assert.deepEqual(outside, [], `lines ${outside.join(', ')} changed outside a fenced region`)
})

test('a reparse of unmodified output yields the same ids and bindings', () => {
  const first = openOrFail(CLEAN)
  const second = openOrFail(emit(first))

  const key = (document) =>
    [...document.nodes.values()].map((node) => [node.id, node.kind, node.binding ?? null])

  assert.deepEqual(key(second), key(first))
  assert.equal(second.design, first.design)
})

test('the same edit sequence produces the same bytes twice', () => {
  const run = () => {
    let document = openOrFail(CLEAN)
    for (const op of generateOps(document, 8, 7)) {
      const result = apply(document, op)
      assert.ok(result.ok)
      document = result.document
    }
    return emit(document)
  }
  assert.equal(run(), run())
})

test('opaque bytes are preserved even when the document is edited around them', () => {
  const document = openOrFail(OPAQUE)
  const edited = apply(document, {
    op: 'setFormula',
    id: 'n:back.cb',
    index: 0,
    source: '25',
  })
  assert.ok(edited.ok)
  const out = emit(edited.document)
  assert.match(out, /points\.cb = new Point\(25, 0\)/)
  assert.match(out, /for \(let i = 0; i < 3; i\+\+\) \{/)
  assert.match(out, /macro\('neckOpening'/)
})

test('a design the editor did not author is refused, not guessed at', () => {
  const result = open(FOREIGN)
  assert.equal(result.ok, false)
  assert.equal(result.refusal.kind, 'unknown-call')
  assert.match(result.refusal.message, /no editor regions/)
})
