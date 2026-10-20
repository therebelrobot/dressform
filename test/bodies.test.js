// The CC0 reference bodies: that they are what the manifest says they are, and
// that they are actually two different meshes.
//
// That last one is not paranoia. The first attempt at generating these applied a
// target that upstream ships as a 604-byte stub, which produced the unmodified
// base mesh twice under two names — and nothing about file size or vertex count
// would have caught it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const here = new URL('../', import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(`assets/bodies/${name}`, here), 'utf8'))

const manifest = read('manifest.json')
const pairs = manifest.bodies.map((entry) => ({ entry, body: read(entry.file) }))

test('the manifest is CC0, and pinned to one upstream commit', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.licence, 'CC0-1.0')
  assert.match(manifest.upstream.commit, /^[0-9a-f]{40}$/)
  assert.match(manifest.upstream.baseMeshSha256, /^[0-9a-f]{64}$/)
  assert.ok(manifest.licenceFiles.some((url) => url.includes('LICENSE.ASSETS.md')))
  assert.equal(manifest.bodies.length, 2)
})

test('each body records the digest of the target that made it', () => {
  for (const { entry } of pairs) {
    assert.match(entry.target, /macrodetails\/.+\.target$/)
    assert.match(entry.targetSha256, /^[0-9a-f]{64}$/)
    // A stub target applies no offsets, which is how the wrong mesh got shipped.
    assert.ok(entry.targetOffsets > 1000, `${entry.id} applied only ${entry.targetOffsets} offsets`)
  }
})

test('each body is metres and y-up, matching the coordinate system it is for', () => {
  for (const { body } of pairs) {
    assert.equal(body.schemaVersion, 1)
    assert.equal(body.units, 'metres')
    assert.equal(body.up, '+y')
    assert.equal(body.axes.x, 'right')
    assert.equal(body.axes.y, 'up')
    assert.equal(body.axes.z, 'front')
  }
})

test('the arrays have the length the counts claim, and every position is finite', () => {
  for (const { entry, body } of pairs) {
    assert.equal(body.positions.length, body.vertexCount * 3, `${entry.id} positions`)
    assert.equal(body.indices.length, body.triangleCount * 3, `${entry.id} indices`)
    for (const value of body.positions) {
      assert.ok(Number.isFinite(value), `${entry.id} has a non-finite position`)
    }
  }
})

test('every triangle index lands inside the vertex array, and none is orphaned', () => {
  for (const { entry, body } of pairs) {
    const referenced = new Set()
    for (const index of body.indices) {
      assert.ok(Number.isInteger(index) && index >= 0 && index < body.vertexCount)
      referenced.add(index)
    }
    // A mangled index list usually shows up as a pile of unreferenced vertices.
    const used = referenced.size / body.vertexCount
    assert.ok(used > 0.99, `${entry.id} references only ${(used * 100).toFixed(1)}% of its vertices`)
  }
})

test('the declared bounds and height are the geometry’s own', () => {
  for (const { entry, body } of pairs) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < body.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = body.positions[i + axis]
        if (value < min[axis]) min[axis] = value
        if (value > max[axis]) max[axis] = value
      }
    }

    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(min[axis] - body.bounds.min[axis]) < 1e-3, `${entry.id} min ${axis}`)
      assert.ok(Math.abs(max[axis] - body.bounds.max[axis]) < 1e-3, `${entry.id} max ${axis}`)
    }

    const height = max[1] - min[1]
    assert.ok(Math.abs(height - body.height) < 1e-3, `${entry.id} height`)
    assert.ok(Math.abs(height - entry.height) < 1e-3, `${entry.id} height in the manifest`)
  }
})

test('both bodies are a plausible human, and the male is the taller', () => {
  const [male, female] = pairs
  assert.equal(male.entry.gender, 'male')
  assert.equal(female.entry.gender, 'female')
  assert.ok(male.body.height > female.body.height)
  for (const { body } of pairs) assert.ok(body.height > 1.2 && body.height < 2.2)
})

test('the two bodies are genuinely different meshes', () => {
  const [male, female] = pairs
  assert.equal(male.body.vertexCount, female.body.vertexCount, 'same base mesh, so same topology')
  assert.deepEqual(male.body.indices, female.body.indices, 'same base mesh, so same triangles')

  let differing = 0
  for (let i = 0; i < male.body.positions.length; i++) {
    if (male.body.positions[i] !== female.body.positions[i]) differing++
  }
  const share = differing / male.body.positions.length
  assert.ok(share > 0.5, `only ${(share * 100).toFixed(1)}% of coordinates differ between the bodies`)
})

test('the three variants are a uniform scale around one', () => {
  assert.equal(manifest.scales.length, 3)
  assert.deepEqual(manifest.scales, [0.95, 1.0, 1.05])
  assert.ok(manifest.scales.includes(1))
  for (const { body } of pairs) assert.deepEqual(body.scales, manifest.scales)
})

test('the generator is committed and is the one the manifest names', () => {
  const script = new URL(manifest.generator.script, here)
  assert.ok(existsSync(script), `${manifest.generator.script} is missing`)
  const source = readFileSync(script, 'utf8')
  // The stub trap is guarded in code, not only in prose.
  assert.match(source, /carries no offsets/)
  assert.match(manifest.generator.note, /GPLv3/)
})
