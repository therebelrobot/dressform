// `seamgraph`, against synthetic maps and hand-computed arc lengths.
//
// Every expected number here is worked out on paper first. The interesting one
// is the reparameterisation case: a polyline whose length disagrees with the
// curve it approximates, where the cut has to land against the curve.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolve, subArc } from '../src/seamgraph/index.ts'

const polyline = (points) =>
  points.reduce((total, point, index) => {
    if (index === 0) return 0
    const previous = points[index - 1]
    return total + Math.hypot(point[0] - previous[0], point[1] - previous[1])
  }, 0)

/** A DraftResult shaped object with explicit lengths, so curves can be faked. */
const draft = (entries) => ({
  schemaVersion: 1,
  design: 'aaron',
  units: 'mm',
  boundingBox: { width: 0, height: 0 },
  svg: '',
  warnings: [],
  pieces: Object.entries(entries).map(([id, paths]) => ({
    id,
    name: id.split('.').pop(),
    mirrorOf: null,
    paths: Object.entries(paths).map(([path, { points }]) => ({ path, role: 'outline', points })),
    pathLengths: Object.fromEntries(
      Object.entries(paths).map(([path, { points, length }]) => [path, length ?? polyline(points)]),
    ),
    notches: [],
    grainline: null,
    centroid: [0, 0],
  })),
})

const seamMap = (overrides = {}) => ({
  schemaVersion: 1,
  design: 'aaron',
  units: 'mm',
  lengthTolerance: 2.0,
  sides: { mirror: [] },
  seams: [],
  ...overrides,
})

const straight = () => draft({ 'aaron.front': { seam: { points: [[0, 0], [200, 0]] } } })

test('sub-arcs cut by fraction, and report curve-accurate lengths', () => {
  const points = [[0, 0], [200, 0]]

  assert.deepEqual(subArc(points, 200, [0, 1]), { points: [[0, 0], [200, 0]], length: 200 })
  assert.deepEqual(subArc(points, 200, [0.25, 0.75]), { points: [[50, 0], [150, 0]], length: 100 })
  // A reversed fraction is the same arc, not a negative one.
  assert.deepEqual(subArc(points, 200, [0.75, 0.25]), { points: [[50, 0], [150, 0]], length: 100 })
  // Fractions are clamped, so an out-of-range authoring mistake cannot escape.
  assert.equal(subArc(points, 200, [-1, 2]).length, 200)
})

test('a cut lands against the curve, not against the tessellation', () => {
  // A right-angle polyline 200 long standing in for a curve 220 long. Half the
  // curve is 110, and in polyline terms that is 110 · 200/220 = 100 — exactly
  // the corner.
  const arc = subArc([[0, 0], [100, 0], [100, 100]], 220, [0, 0.5])
  assert.equal(arc.length, 110)
  assert.deepEqual(arc.points, [[0, 0], [100, 0]])
})

test('a degenerate path has no arc to give', () => {
  assert.equal(subArc([], 10, [0, 1]), null)
  assert.equal(subArc([[0, 0]], 10, [0, 1]), null)
  assert.equal(subArc([[0, 0], [0, 0]], 0, [0, 1]), null)
})

test('direction reversal reverses the polyline, not the length', () => {
  const map = seamMap({
    seams: [
      {
        id: 'shoulder.left',
        a: { piece: 'aaron.front', path: 'seam', fraction: [0, 0.5], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0.5, 1], direction: 'reverse' },
      },
    ],
  })

  const resolved = resolve(map, straight())
  assert.deepEqual(resolved.failures, [])
  assert.equal(resolved.seams.length, 1)

  const seam = resolved.seams[0]
  assert.deepEqual(seam.a.points, [[0, 0], [100, 0]])
  assert.deepEqual(seam.b.points, [[200, 0], [100, 0]], 'the reversed edge runs head-to-tail')
  assert.equal(seam.a.length, 100)
  assert.equal(seam.b.length, 100)
})

test('a length mismatch is named before anything is simulated', () => {
  const entry = draft({
    'aaron.front': { seam: { points: [[0, 0], [200, 0]] } },
    'aaron.back': { seam: { points: [[0, 0], [210, 0]] } },
  })
  const map = seamMap({
    seams: [
      {
        id: 'side.left',
        a: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.back', path: 'seam', fraction: [0, 1], direction: 'reverse' },
      },
    ],
  })

  const resolved = resolve(map, entry)
  const seam = resolved.seams[0]
  assert.equal(seam.a.length, 200)
  assert.equal(seam.b.length, 210)
  assert.equal(seam.lengthDelta, -10)
  assert.equal(seam.verdict, 'mismatch')
})

test('a delta inside the tolerance is ok, and the tolerance is the map’s', () => {
  const entry = draft({
    'aaron.front': { seam: { points: [[0, 0], [200, 0]] } },
    'aaron.back': { seam: { points: [[0, 0], [201, 0]] } },
  })
  const endpoint = (piece) => ({
    piece,
    path: 'seam',
    fraction: [0, 1],
    direction: 'forward',
  })
  const seams = [
    { id: 'side.left', a: endpoint('aaron.front'), b: endpoint('aaron.back') },
  ]

  assert.equal(resolve(seamMap({ seams }), entry).seams[0].verdict, 'ok')
  // One millimetre of tolerance still passes; half a millimetre does not.
  assert.equal(resolve(seamMap({ seams, lengthTolerance: 0.5 }), entry).seams[0].verdict, 'mismatch')
})

test('a seam pointing at an absent path fails, naming the piece and the path', () => {
  const map = seamMap({
    seams: [
      {
        id: 'armhole.left',
        a: { piece: 'aaron.front', path: 'armhole', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
      },
    ],
  })

  const resolved = resolve(map, straight())
  assert.deepEqual(resolved.seams, [], 'the broken seam is skipped, not half-resolved')
  assert.equal(resolved.failures.length, 1)
  assert.equal(resolved.failures[0].piece, 'aaron.front')
  assert.equal(resolved.failures[0].path, 'armhole')
  assert.match(resolved.failures[0].message, /aaron\.front\.armhole/)
})

test('every broken seam is reported, not just the first', () => {
  const map = seamMap({
    seams: [
      {
        id: 'one',
        a: { piece: 'aaron.nope', path: 'seam', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
      },
      {
        id: 'two',
        a: { piece: 'aaron.front', path: 'nothing', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
      },
    ],
  })

  assert.equal(resolve(map, straight()).failures.length, 2)
})

test('a mirrored piece is expanded once, into a left and a right seam', () => {
  const map = seamMap({
    sides: { mirror: ['aaron.front'] },
    seams: [
      {
        id: 'shoulder.left',
        a: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'reverse' },
      },
    ],
  })

  const resolved = resolve(map, straight())
  assert.deepEqual(
    resolved.seams.map((seam) => [seam.id, seam.side]),
    [
      ['shoulder.left', 'left'],
      ['shoulder.right', 'right'],
    ],
  )
  assert.deepEqual(resolved.mirrored, ['aaron.front'])
})

test('an unmirrored piece is not expanded, and carries no side', () => {
  const map = seamMap({
    seams: [
      {
        id: 'shoulder',
        a: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'reverse' },
      },
    ],
  })

  const resolved = resolve(map, straight())
  assert.equal(resolved.seams.length, 1)
  assert.equal(resolved.seams[0].side, null)
  assert.deepEqual(resolved.mirrored, [])
})

test('resolution is deterministic', () => {
  const map = seamMap({
    sides: { mirror: ['aaron.front'] },
    seams: [
      {
        id: 'shoulder.left',
        a: { piece: 'aaron.front', path: 'seam', fraction: [0, 0.5], direction: 'forward' },
        b: { piece: 'aaron.front', path: 'seam', fraction: [0.5, 1], direction: 'reverse' },
      },
    ],
  })

  assert.equal(JSON.stringify(resolve(map, straight())), JSON.stringify(resolve(map, straight())))
})
