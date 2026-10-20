// Unit tests for `doc`: the node index, the opacity boundary, rename
// propagation, structural ops, and that an emitted module is a real module.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply, emit, open, readRegions } from '../src/doc/index.ts'
import { printAst } from '../src/doc/parser.ts'
import { printStatement } from '../src/doc/primitives.ts'

const corpus = (name) => readFileSync(new URL(`./support/corpus/${name}`, import.meta.url), 'utf8')
const CLEAN = corpus('clean.mjs')
const OPAQUE = corpus('opaque.mjs')

const openOrFail = (source) => {
  const result = open(source)
  assert.ok(result.ok, `expected the source to open: ${JSON.stringify(result.refusal)}`)
  return result.document
}

const modelled = (document) =>
  [...document.nodes.values()]
    .filter((node) => node.kind !== 'opaque')
    .map((node) => [node.id, node.kind, node.binding])

test('the index names every modelled node by part and binding, never by index', () => {
  const document = openOrFail(CLEAN)
  assert.equal(document.design, 'aaron')
  assert.deepEqual(modelled(document), [
    ['n:front.cb', 'point', 'points.cb'],
    ['n:front.shoulder', 'point', 'points.shoulder'],
    ['n:front.waist', 'point', 'points.waist'],
    ['n:front.armhole', 'path', 'paths.armhole'],
  ])
})

test('a point records how it was made and what it was made from', () => {
  const document = openOrFail(CLEAN)
  const cb = document.nodes.get('n:front.cb')
  const shoulder = document.nodes.get('n:front.shoulder')

  assert.equal(cb.via, 'ctor')
  assert.deepEqual(cb.args.map((arg) => arg.source), ['0', '0'])
  assert.equal(cb.value, null, 'doc does not evaluate; that is the evaluator’s slot')

  assert.equal(shoulder.via, 'shift')
  // The receiver travels in args[0] for the method forms.
  assert.deepEqual(shoulder.args.map((arg) => arg.source), [
    'points.cb',
    '-90',
    'measurements.shoulderToShoulder / 2',
  ])
})

test('a path records its op chain in the order it is written', () => {
  const document = openOrFail(CLEAN)
  const armhole = document.nodes.get('n:front.armhole')
  assert.deepEqual(armhole.ops.map((op) => op.type), ['move', 'curve', 'close'])
  assert.equal(armhole.ops[1].cp1.source, 'points.shoulder')
})

test('the opacity boundary names a reason per construct', () => {
  const document = openOrFail(OPAQUE)
  const reasons = [...document.nodes.values()]
    .filter((node) => node.kind === 'opaque')
    .map((node) => node.reason)

  assert.deepEqual(reasons, [
    'loop',
    'conditional-topology',
    'template-literal',
    'computed-name',
    'cross-part-store',
    'dynamic-macro',
    'unknown-call',
  ])
})

test('a partially opaque document still models the regions it can', () => {
  const document = openOrFail(OPAQUE)
  assert.deepEqual(modelled(document), [
    ['n:back.cb', 'point', 'points.cb'],
    ['n:back.waist', 'point', 'points.waist'],
    ['n:back.armhole', 'path', 'paths.armhole'],
  ])
})

test('every refusal carries a named reason and a span', () => {
  const document = openOrFail(OPAQUE)
  const opaque = [...document.nodes.values()].filter((node) => node.kind === 'opaque')
  for (const node of opaque) {
    assert.equal(typeof node.reason, 'string')
    assert.ok(node.bytes.length > 0, `${node.id} kept no bytes`)
    assert.ok(node.span.startLine >= 1 && node.span.endLine >= node.span.startLine)
  }
})

test('a fence that is never closed is refused, not repaired', () => {
  const result = open(`export const front = {\n  draft: () => {\n    // <dressform:region id="n:front.cb">\n    points.cb = new Point(0, 0)\n    return 1\n  },\n}\n`)
  assert.equal(result.ok, false)
  assert.equal(result.refusal.kind, 'unrepresentable-syntax')
  assert.match(result.refusal.message, /never closed/)
  assert.equal(result.refusal.spans.length, 1)
})

test('a nested fence is refused', () => {
  const source = [
    'export const front = {',
    '  draft: () => {',
    '    // <dressform:region id="n:front.outer">',
    '    // <dressform:region id="n:front.inner">',
    '    points.cb = new Point(0, 0)',
    '    // </dressform:region>',
    '    // </dressform:region>',
    '    return 1',
    '  },',
    '}',
    '',
  ].join('\n')

  const result = open(source)
  assert.equal(result.ok, false)
  assert.match(result.refusal.message, /nested/)
})

test('source that does not parse is refused with the parser error', () => {
  const result = open('export const front = { draft: ( { \n')
  assert.equal(result.ok, false)
  assert.equal(result.refusal.kind, 'unrepresentable-syntax')
  assert.match(result.refusal.message, /does not parse/)
})

test('a rename rewrites every reference and re-keys the fence', () => {
  const document = openOrFail(CLEAN)
  const result = apply(document, { op: 'renameNode', id: 'n:front.shoulder', to: 'hps' })
  assert.ok(result.ok, JSON.stringify(result.refusal))

  const out = emit(result.document)
  assert.match(out, /<dressform:region id="n:front\.hps">/)
  assert.match(out, /points\.hps = points\.cb\.shift\(-90, measurements\.shoulderToShoulder \/ 2\)/)
  // The reference inside a *different* region followed.
  assert.match(out, /\.move\(points\.hps\)/)
  assert.match(out, /\.curve\(points\.hps, points\.waist, points\.cb\)/)

  // Only the renamed binding moved; a measurement whose name merely contains it
  // did not.
  assert.equal(out.includes('points.shoulder'), false)
  assert.match(out, /measurements\.shoulderToShoulder/)

  // And the index agrees.
  assert.deepEqual(modelled(result.document).map(([id]) => id), [
    'n:front.cb',
    'n:front.hps',
    'n:front.waist',
    'n:front.armhole',
  ])
})

test('a rename through an opaque region is refused, and names the span', () => {
  const document = openOrFail(OPAQUE)
  // `points.cb` is referenced inside the opaque macro region.
  const result = apply(document, { op: 'renameNode', id: 'n:back.cb', to: 'nape' })

  assert.equal(result.ok, false)
  assert.match(result.refusal.message, /opaque region/)
  assert.equal(result.refusal.spans.length, 1)
  assert.ok(result.refusal.suggestion.length > 0)
})

test('a rename to something that is not a binding name is refused', () => {
  const document = openOrFail(CLEAN)
  const result = apply(document, { op: 'renameNode', id: 'n:front.cb', to: 'not a name' })
  assert.equal(result.ok, false)
  assert.equal(result.refusal.kind, 'computed-name')
})

test('an opaque region cannot be rewritten', () => {
  const document = openOrFail(OPAQUE)
  const opaque = [...document.nodes.values()].find((node) => node.reason === 'loop')
  const result = apply(document, { op: 'setFormula', id: opaque.id, index: 0, source: '1' })
  assert.equal(result.ok, false)
  assert.match(result.refusal.message, /not a modelled point/)
})

test('adding a node inserts a fenced region that survives a reparse', () => {
  const document = openOrFail(CLEAN)
  const result = apply(document, {
    op: 'addNode',
    after: 'n:front.waist',
    binding: 'points.hip',
    source: 'points.hip = points.waist.shift(0, 30)',
  })
  assert.ok(result.ok, JSON.stringify(result.refusal))

  const out = emit(result.document)
  assert.match(out, /<dressform:region id="n:front\.hip">/)
  assert.match(out, /points\.hip = points\.waist\.shift\(0, 30\)/)

  // The proof that the markers landed where they belong: reopening finds it.
  const reopened = openOrFail(out)
  assert.ok(reopened.nodes.get('n:front.hip'))
  assert.deepEqual(modelled(reopened).map(([id]) => id), [
    'n:front.cb',
    'n:front.shoulder',
    'n:front.waist',
    'n:front.hip',
    'n:front.armhole',
  ])
})

test('removing a node takes its region with it and leaves the rest intact', () => {
  const document = openOrFail(CLEAN)
  const result = apply(document, { op: 'removeNode', id: 'n:front.shoulder' })
  assert.ok(result.ok, JSON.stringify(result.refusal))

  const out = emit(result.document)
  assert.equal(out.includes('n:front.shoulder'), false)

  const reopened = openOrFail(out)
  assert.deepEqual(modelled(reopened).map(([id]) => id), [
    'n:front.cb',
    'n:front.waist',
    'n:front.armhole',
  ])
  // The fence count and the node count still agree.
  const { regions } = readRegions(out)
  assert.equal(regions.length, 3)
})

test('measurements and options live on the document, not in the source', () => {
  const document = openOrFail(CLEAN)
  const withMeasurement = apply(document, { op: 'setMeasurement', name: 'chest', value: 1000 })
  assert.ok(withMeasurement.ok)
  assert.equal(withMeasurement.document.settings.measurements.chest, 1000)
  assert.equal(emit(withMeasurement.document), CLEAN)

  const withOption = apply(withMeasurement.document, { op: 'setOption', name: 'chestEase', value: 0.08 })
  assert.ok(withOption.ok)
  assert.equal(withOption.document.settings.options.chestEase, 0.08)
})

test('a node prints back as the statement it was read from', () => {
  const document = openOrFail(CLEAN)
  const squeeze = (text) => text.replace(/\s+/g, '').replace(/;$/, '')

  // `printStatement` is the "emit is a printer" half of the vocabulary. Nothing
  // in `apply` rebuilds a statement, but node creation at M5 will.
  assert.equal(
    squeeze(printAst(printStatement(document.nodes.get('n:front.shoulder')))),
    squeeze('points.shoulder = points.cb.shift(-90, measurements.shoulderToShoulder / 2)'),
  )
  assert.equal(
    squeeze(printAst(printStatement(document.nodes.get('n:front.cb')))),
    squeeze('points.cb = new Point(0, 0)'),
  )
  assert.equal(
    squeeze(printAst(printStatement(document.nodes.get('n:front.armhole')))),
    squeeze('paths.armhole = new Path().move(points.shoulder).curve(points.shoulder, points.waist, points.cb).close()'),
  )
})

test('an emitted module is a module: it imports and exposes its design', async () => {
  const document = openOrFail(CLEAN)
  const directory = mkdtempSync(join(tmpdir(), 'dressform-'))
  const file = join(directory, 'emitted.mjs')
  writeFileSync(file, emit(document))

  const loaded = await import(pathToFileURL(file).href)
  assert.equal(typeof loaded.front, 'object')
  assert.equal(loaded.front.name, 'aaron.front')
  assert.equal(typeof loaded.front.draft, 'function')
})
