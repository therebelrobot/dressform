// `avatar`: that the reference bodies scale from a measurement set the way §7.4
// says — by measurement, not by morphing — and that a landmark is on the body.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { build, crossSections, girthAt, loadReferenceBody } from '../src/avatar/index.ts'

const load = (name) =>
  loadReferenceBody(JSON.parse(readFileSync(new URL(`../assets/bodies/${name}.json`, import.meta.url), 'utf8')))

const MALE = load('male-young')
const FEMALE = load('female-young')

// A complete measurement set: the ten `aaron` requires, plus the waist that
// `avatar` bands on and that a bodice pattern does not always declare.
const MEASUREMENTS = {
  biceps: 350,
  chest: 1000,
  waist: 820,
  hips: 840,
  hpsToBust: 280,
  hpsToWaistBack: 470,
  neck: 380,
  shoulderToShoulder: 450,
  shoulderSlope: 13,
  waistToArmpit: 210,
  waistToHips: 130,
}

/** The lateral cut that keeps an arm out of a chest measurement. */
const limitFor = (body) => Math.abs(body.joints['joint-l-shoulder'][0]) * 1.15

/** A body-shaped view of a built mesh, so the same measurement can be re-run. */
const asBody = (reference, mesh) => ({ ...reference, positions: mesh.positions })

test('anchors come from the rig, not from the silhouette', () => {
  for (const body of [MALE, FEMALE]) {
    const chest = body.joints['joint-spine-1'][1]
    const waist = body.joints['joint-spine-3'][1]
    const hips = body.joints['joint-pelvis'][1]
    assert.ok(chest > waist, `${body.id}: spine-1 is above spine-3`)
    assert.ok(waist > hips, `${body.id}: spine-3 is above the pelvis`)
    // Shoulders are outboard of the midline and symmetric about it.
    const left = body.joints['joint-l-shoulder'][0]
    const right = body.joints['joint-r-shoulder'][0]
    assert.ok(Math.abs(left + right) < 1e-3, `${body.id}: shoulder joints are symmetric`)
    assert.ok(left > 0 && right < 0, `${body.id}: left is +x and right is -x`)
  }
})

test('the girths it measures are anatomically plausible', () => {
  const expected = { chest: [0.8, 1.2], waist: [0.6, 0.9], hips: [0.8, 1.1] }
  const joints = { chest: 'joint-spine-1', waist: 'joint-spine-3', hips: 'joint-pelvis' }

  for (const body of [MALE, FEMALE]) {
    const limit = limitFor(body)
    for (const [region, joint] of Object.entries(joints)) {
      const y = body.joints[joint][1]
      const girth = girthAt(body, y, limit)
      const [low, high] = expected[region]
      assert.ok(girth >= low && girth <= high, `${body.id} ${region}: ${girth.toFixed(3)} m outside ${low}–${high}`)
    }
  }
})

test('without the lateral cut the arms inflate the chest, which is the whole point', () => {
  for (const body of [MALE, FEMALE]) {
    const y = body.joints['joint-spine-1'][1]
    const uncut = girthAt(body, y, Infinity)
    const cut = girthAt(body, y, limitFor(body))
    assert.ok(uncut > cut, `${body.id}: expected the uncut slice to be larger`)
    assert.ok(uncut > 1.2, `${body.id}: expected arms to push the uncut girth past 1.2 m, got ${uncut.toFixed(3)}`)
  }
})

test('helper geometry is excluded, or the head would cut into dozens of loops', () => {
  const neck = MALE.joints['joint-neck'][1]
  const loops = crossSections(MALE, neck, Infinity)
  // Eyes, teeth, and hair sit above the body's vertex range and would multiply
  // this. The body alone is one neck loop.
  assert.ok(loops.length <= 3, `expected a clean neck slice, got ${loops.length} loops`)
})

test('scaling moves the measured girth onto what was asked for', () => {
  for (const body of [MALE, FEMALE]) {
    const mesh = build(body, MEASUREMENTS)
    const built = asBody(body, mesh)
    const limit = limitFor(body)

    assert.deepEqual(mesh.scaling.warnings, [], `${body.id} should warn about nothing here`)
    assert.equal(mesh.scaling.bands.length, 3)

    for (const band of mesh.scaling.bands) {
      const measured = girthAt(built, band.y, limit)
      const error = Math.abs(measured - band.targetM) / band.targetM
      assert.ok(
        error < 0.12,
        `${body.id} ${band.region}: asked for ${band.targetM.toFixed(3)} m, got ${measured.toFixed(3)} m (${(error * 100).toFixed(1)}% out)`,
      )
    }
  }
})

test('the vertical scale follows the vertical measurement, not the reference height', () => {
  const tight = build(MALE, { ...MEASUREMENTS, waistToHips: 100 })
  const loose = build(MALE, { ...MEASUREMENTS, waistToHips: 180 })
  assert.ok(loose.scaling.verticalScale > tight.scaling.verticalScale)
  assert.ok(loose.scaling.stature > tight.scaling.stature)
})

test('a missing vertical measurement is a warning, not a silent guess', () => {
  const { waistToHips, hpsToWaistBack, ...bodice } = MEASUREMENTS
  assert.ok(waistToHips > 0 && hpsToWaistBack > 0)
  const mesh = build(MALE, bodice)
  assert.equal(mesh.scaling.verticalScale, 1)
  assert.ok(mesh.scaling.warnings.some((warning) => warning.includes('no vertical measurement')))
})

test('every landmark is a point on the body, not a point near it', () => {
  const mesh = build(MALE, MEASUREMENTS)
  assert.equal(mesh.landmarks.length, 8)

  for (const landmark of mesh.landmarks) {
    const [x, y, z] = landmark.position
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${landmark.name} is finite`)
    assert.ok(y >= -1e-6 && y <= mesh.scaling.stature + 1e-6, `${landmark.name} sits within the body's height`)

    // Some vertex must be within a millimetre of the reported point.
    let nearest = Infinity
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(mesh.positions[i] - x, mesh.positions[i + 1] - y, mesh.positions[i + 2] - z)
      if (d < nearest) nearest = d
    }
    assert.ok(nearest < 1e-3, `${landmark.name} is ${nearest.toFixed(4)} m from any vertex`)
  }
})

test('the built mesh is the reference body’s topology, moved', () => {
  const mesh = build(MALE, MEASUREMENTS)
  assert.equal(mesh.positions.length, MALE.positions.length)
  assert.equal(mesh.indices, MALE.indices, 'indices are shared, not copied')
  for (const value of mesh.positions) assert.ok(Number.isFinite(value))
  assert.equal(mesh.scaling.body, 'male-young')
  assert.ok(mesh.scaling.stature > 1.2 && mesh.scaling.stature < 2.2)
})

test('the same request builds the same body twice', () => {
  assert.equal(
    Buffer.from(build(FEMALE, MEASUREMENTS).positions.buffer).toString('base64'),
    Buffer.from(build(FEMALE, MEASUREMENTS).positions.buffer).toString('base64'),
  )
})

test('a truncated or jointless body is refused, not half-loaded', () => {
  const document = JSON.parse(readFileSync(new URL('../assets/bodies/male-young.json', import.meta.url), 'utf8'))
  assert.throws(() => loadReferenceBody({ ...document, vertexCount: document.vertexCount + 1 }), /truncated/)
  assert.throws(() => loadReferenceBody({ ...document, joints: undefined }), /joints/)
  assert.throws(() => loadReferenceBody({ ...document, schemaVersion: 2 }), /schemaVersion/)
})
