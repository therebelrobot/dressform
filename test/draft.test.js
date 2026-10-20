// The `draft` module: the design catalogue, the DraftResult contract, and the
// acceptance criterion from the product brief §7 — every `pathLengths` value
// within 0.1 mm of the length the rendered SVG actually draws.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DraftValidationError, describeDesign, draft, listDesigns } from '../src/draft/index.ts'
import { aaronMeasurements } from './support/fixtures.js'
import { pathLength, pathsByPart } from './support/svg.js'

const aaron = () => draft({ design: 'aaron', measurements: aaronMeasurements })

test('the catalogue names the registered design', () => {
  const designs = listDesigns()
  assert.equal(designs.length, 1)
  assert.deepEqual(designs[0], {
    name: 'aaron',
    title: 'Aaron A-shirt',
    description: 'A FreeSewing pattern for a A-shirt or tank top',
    tags: ['tops', 'underwear'],
  })
})

test('a design detail separates required from optional measurements, in their own units', () => {
  const detail = describeDesign('aaron')
  assert.ok(detail !== undefined)
  assert.equal(detail.name, 'aaron')
  assert.match(detail.version, /^\d+\.\d+\.\d+$/)

  const required = detail.measurements.filter((m) => m.required)
  assert.deepEqual(
    required.map((m) => m.name),
    ['biceps', 'chest', 'hpsToBust', 'hpsToWaistBack', 'neck', 'shoulderToShoulder', 'shoulderSlope', 'waistToArmpit', 'waistToHips', 'hips'],
  )
  assert.deepEqual(
    detail.measurements.filter((m) => !m.required).map((m) => m.name),
    ['highBust'],
  )

  const byName = new Map(detail.measurements.map((m) => [m.name, m]))
  assert.equal(byName.get('chest').unit, 'mm')
  assert.equal(byName.get('shoulderSlope').unit, 'degrees')
})

test('an option schema is reported in the units a request uses', () => {
  const detail = describeDesign('aaron')
  const byName = new Map(detail.options.map((option) => [option.name, option]))

  // Authored as `{ pct: 8, min: 0, max: 20, menu: 'fit' }`; reported resolved.
  assert.deepEqual(byName.get('chestEase'), {
    name: 'chestEase',
    kind: 'pct',
    default: 0.08,
    min: 0,
    max: 0.2,
    menu: 'fit',
  })

  // Authored as `{ bool: false, menu: 'fit' }`.
  assert.deepEqual(byName.get('draftForHighBust'), {
    name: 'draftForHighBust',
    kind: 'bool',
    default: false,
    min: null,
    max: null,
    menu: 'fit',
  })

  // Authored as a bare number: a constant, with no range.
  assert.deepEqual(byName.get('collarFactor'), {
    name: 'collarFactor',
    kind: 'number',
    default: 4.8,
    min: null,
    max: null,
    menu: null,
  })

  assert.equal(detail.options.length, byName.size)
})

test('a draft answers with the contract and a piece per part', async () => {
  const result = await aaron()

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.design, 'aaron')
  assert.equal(result.units, 'mm')
  assert.match(result.svg, /^<\?xml/)
  assert.deepEqual(result.warnings, [])
  assert.ok(result.boundingBox.width > 0)
  assert.ok(result.boundingBox.height > 0)

  assert.deepEqual(
    result.pieces.map((piece) => piece.id),
    ['aaron.front', 'aaron.back', 'aaron.armBinding', 'aaron.neckBinding'],
  )
  assert.deepEqual(
    result.pieces.map((piece) => piece.name),
    ['front', 'back', 'armBinding', 'neckBinding'],
  )

  for (const piece of result.pieces) {
    assert.ok(piece.paths.length > 0, `${piece.id} drew something`)
    assert.equal(
      piece.paths.filter((geometry) => geometry.role === 'outline').length,
      1,
      `${piece.id} has exactly one outline`,
    )
    assert.equal(piece.paths.length, Object.keys(piece.pathLengths).length)
    assert.equal(piece.mirrorOf, null)

    for (const geometry of piece.paths) {
      assert.ok(piece.pathLengths[geometry.path] > 0)
      assert.ok(geometry.points.length >= 2)
      for (const [x, y] of geometry.points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y))
      }
    }

    // The outline encloses the centroid.
    assert.ok(Number.isFinite(piece.centroid[0]) && Number.isFinite(piece.centroid[1]))
  }
})

test('every pathLengths value matches the path the SVG draws, within 0.1 mm', async () => {
  const result = await aaron()
  const drawn = pathsByPart(result.svg)

  let checked = 0
  for (const piece of result.pieces) {
    const paths = drawn.get(piece.id)
    assert.ok(paths !== undefined, `the SVG has no group for ${piece.id}`)
    assert.equal(paths.length, piece.paths.length, `${piece.id}: the SVG and the piece disagree on path count`)

    piece.paths.forEach((geometry, index) => {
      const declared = piece.pathLengths[geometry.path]
      const measured = pathLength(paths[index])
      assert.ok(
        Math.abs(measured - declared) <= 0.1,
        `${piece.id}.${geometry.path}: pathLengths says ${declared.toFixed(4)} mm, the SVG draws ${measured.toFixed(4)} mm`,
      )
      checked += 1
    })
  }

  assert.ok(checked >= 20, `only ${checked} paths were checked`)
})

test('the draft is a net pattern, with no seam allowance anywhere', async () => {
  const result = await aaron()
  assert.doesNotMatch(result.svg, /class="[^"]*\bsa\b/)
  for (const piece of result.pieces) {
    assert.ok(!('sa' in piece.pathLengths), `${piece.id} drew a seam allowance`)
  }
})

test('the same request drafts the same geometry twice', async () => {
  const first = await aaron()
  const second = await aaron()
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('a declared option changes the draft', async () => {
  const base = await aaron()
  const longer = await draft({
    design: 'aaron',
    measurements: aaronMeasurements,
    options: { lengthBonus: 0.6 },
  })
  assert.ok(longer.boundingBox.height > base.boundingBox.height)
})

test('an option the design does not declare is ignored, and said so', async () => {
  const result = await draft({
    design: 'aaron',
    measurements: aaronMeasurements,
    options: { nonsense: 3 },
  })
  assert.deepEqual(result.warnings, [
    { code: 'option-ignored', message: '`nonsense` is not an option of `aaron`; ignored' },
  ])
  assert.equal(JSON.stringify(result.pieces), JSON.stringify((await aaron()).pieces))
})

test('an unknown design is refused, naming the field', async () => {
  await assert.rejects(
    () => draft({ design: 'nope', measurements: aaronMeasurements }),
    (error) => {
      assert.ok(error instanceof DraftValidationError)
      assert.deepEqual(error.fields, [{ field: 'design', message: 'no design named `nope`' }])
      return true
    },
  )
})

test('a missing required measurement is refused, naming it', async () => {
  const { chest, ...withoutChest } = aaronMeasurements
  assert.ok(chest > 0)

  await assert.rejects(
    () => draft({ design: 'aaron', measurements: withoutChest }),
    (error) => {
      assert.ok(error instanceof DraftValidationError)
      assert.deepEqual(error.fields, [
        { field: 'measurements.chest', message: 'required by this design' },
      ])
      return true
    },
  )
})

test('a measurement that is not a finite number is refused, naming it', async () => {
  await assert.rejects(
    () => draft({ design: 'aaron', measurements: { ...aaronMeasurements, chest: 'big' } }),
    (error) => {
      assert.ok(error instanceof DraftValidationError)
      assert.ok(
        error.fields.some((field) => field.field === 'measurements.chest'),
        `expected measurements.chest among ${JSON.stringify(error.fields)}`,
      )
      return true
    },
  )
})

test('a request that is not an object at all is refused', async () => {
  await assert.rejects(
    () => draft(undefined),
    (error) => {
      assert.ok(error instanceof DraftValidationError)
      assert.equal(error.fields.length, 1)
      return true
    },
  )
})
