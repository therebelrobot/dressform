// `sim`'s solver core. Every expected number here is worked out on paper: XPBD
// with zero compliance projects a distance constraint exactly, so the algebra is
// the oracle and the solver has to agree with it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSim, DEFAULTS } from '../src/sim/index.ts'

const sep = (positions, a, b) =>
  Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  )

const run = (sim, frames, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) sim.step(dt)
  return sim.positions()
}

test('the defaults are the ones §7.2 fixes', () => {
  assert.equal(DEFAULTS.substeps, 15)
  assert.equal(DEFAULTS.damping, 0.99)
  assert.equal(DEFAULTS.gravity, -9.81)
  assert.equal(DEFAULTS.stretchCompliance, 0)
  assert.equal(DEFAULTS.shearCompliance, 0.001)
  assert.equal(DEFAULTS.seamShrinkFrames, 30)
})

test('a rigid distance constraint reaches its rest length exactly', () => {
  const sim = createSim({ gravity: 0, damping: 1 })
  sim.addParticles(Float64Array.from([0, 0, 0, 0, 0, 2]))
  // Given as 2 m apart, asked to be 1 m apart.
  sim.addDistance(0, 1, 1, 0)
  const positions = run(sim, 1)
  assert.ok(Math.abs(sep(positions, 0, 1) - 1) < 1e-9, `got ${sep(positions, 0, 1)}`)
})

test('a rigid constraint holds while the pair falls', () => {
  const sim = createSim()
  sim.addParticles(Float64Array.from([0, 0, 0, 0, 0, 0.5]))
  sim.addDistance(0, 1, 0.5, 0)
  const positions = run(sim, 120)

  // Both particles must have fallen.
  assert.ok(positions[1] < -0.5, `expected the pair to fall, y = ${positions[1]}`)
  // And the constraint must have held while they did.
  const length = sep(positions, 0, 1)
  assert.ok(Math.abs(length - 0.5) < 0.01, `rest length drifted to ${length.toFixed(4)}`)
})

test('a seam shrinks its rest length to closure across the stated frames', () => {
  const sim = createSim({ gravity: 0, damping: 1, seamShrinkFrames: 10 })
  sim.addParticles(Float64Array.from([0, 0, 0, 0, 0, 0.4]))
  sim.addSeam('side.left', 0, 1)

  // §7.1: the rest length starts at the current distance and reaches zero across
  // the first N frames, so the pair is half closed halfway through.
  run(sim, 5)
  const halfway = sep(sim.positions(), 0, 1)
  assert.ok(Math.abs(halfway - 0.2) < 0.02, `expected about 0.2 m at half way, got ${halfway.toFixed(4)}`)

  run(sim, 5)
  const closed = sep(sim.positions(), 0, 1)
  assert.ok(closed < 0.02, `expected near closure, got ${closed.toFixed(4)}`)
})

test('bake reports each seam’s remaining separation, and copies the geometry', () => {
  const sim = createSim({ gravity: 0, damping: 1, seamShrinkFrames: 4 })
  sim.addParticles(Float64Array.from([0, 0, 0, 0, 0, 0.3]))
  sim.addSeam('a', 0, 1)
  run(sim, 4)

  const snapshot = sim.bake()
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.units, 'metres')
  assert.equal(snapshot.particleCount, 2)
  assert.equal(snapshot.seams.length, 1)
  assert.equal(snapshot.seams[0].id, 'a')
  assert.ok(snapshot.seams[0].separation < 0.02)

  // The snapshot is a copy: stepping afterwards must not move it.
  const before = snapshot.positions[5]
  run(sim, 10)
  assert.equal(snapshot.positions[5], before)
})

test('a sheet of particles stays stable and keeps its rest lengths', () => {
  const SIZE = 5
  const SPACING = 0.05
  const sim = createSim({ substeps: 15 })
  const positions = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) positions.push(col * SPACING, 1, row * SPACING)
  }
  sim.addParticles(Float64Array.from(positions))

  const at = (row, col) => row * SIZE + col
  const edges = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (col + 1 < SIZE) edges.push([at(row, col), at(row, col + 1)])
      if (row + 1 < SIZE) edges.push([at(row, col), at(row + 1, col)])
    }
  }
  for (const [a, b] of edges) sim.addDistance(a, b, SPACING, 0)

  const after = run(sim, 180)

  for (const value of after) assert.ok(Number.isFinite(value), 'the sheet has a non-finite coordinate')
  assert.ok(after[1] < 1, 'the sheet should have fallen')

  let worst = 0
  for (const [a, b] of edges) {
    const length = sep(after, a, b)
    worst = Math.max(worst, Math.abs(length - SPACING) / SPACING)
  }
  // Rigid constraints, so this is a test of the projection holding up over time
  // rather than of a stiffness constant.
  assert.ok(worst < 0.05, `worst edge drifted ${(worst * 100).toFixed(2)}% from its rest length`)
})

test('the same scene twice is bit-identical — §7.3', () => {
  const build = () => {
    const sim = createSim()
    const positions = []
    for (let i = 0; i < 12; i++) positions.push(i * 0.03, 1 + (i % 3) * 0.02, (i % 4) * 0.03)
    sim.addParticles(Float64Array.from(positions))
    for (let i = 1; i < 12; i++) sim.addDistance(i - 1, i, 0.03, 0)
    sim.addSeam('s', 0, 11)
    return sim
  }

  const first = run(build(), 90)
  const second = run(build(), 90)

  assert.deepEqual(Array.from(first), Array.from(second), 'two runs disagreed')
  // Not just close: identical. A Set iterated in insertion order, or forces
  // summed in a shifting order, goes red here.
  assert.equal(Buffer.from(first.buffer).toString('base64'), Buffer.from(second.buffer).toString('base64'))
})

test('nothing moves if nothing asks it to', () => {
  const sim = createSim({ gravity: 0, damping: 1 })
  sim.addParticles(Float64Array.from([1, 2, 3, 4, 5, 6]))
  const positions = run(sim, 30)
  assert.deepEqual(Array.from(positions), [1, 2, 3, 4, 5, 6])
})

test('a zero or negative timestep is ignored rather than dividing by it', () => {
  const sim = createSim()
  sim.addParticles(Float64Array.from([0, 0, 0, 0, 1, 0]))
  sim.addDistance(0, 1, 1, 0)
  sim.step(0)
  sim.step(-1)
  assert.equal(sim.frame, 0)
  for (const value of sim.positions()) assert.ok(Number.isFinite(value))
})
