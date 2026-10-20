// `place`: that pieces land the right way round, human-sized, off each other,
// and clear of the body by the gap §7.2 fixes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { build, loadReferenceBody } from '../src/avatar/index.ts'
import { draft } from '../src/draft/index.ts'
import { emptySeamMap, resolve } from '../src/seamgraph/index.ts'
import { classify, DEFAULT_INFLATION_GAP_M, lift, place } from '../src/place/index.ts'

const MEASUREMENTS = {
  biceps: 350, chest: 1000, waist: 820, hips: 840, hpsToBust: 280, hpsToWaistBack: 470,
  neck: 380, shoulderToShoulder: 450, shoulderSlope: 13,
  waistToArmpit: 210, waistToHips: 130,
}

const body = build(
  loadReferenceBody(JSON.parse(readFileSync(new URL('../assets/bodies/male-young.json', import.meta.url), 'utf8'))),
  MEASUREMENTS,
)
const aaron = await draft({ design: 'aaron', measurements: MEASUREMENTS })

const sideSeam = () => {
  const map = emptySeamMap('aaron')
  map.seams = [
    {
      id: 'side.left',
      a: { piece: 'aaron.front', path: 'seam', fraction: [0, 1], direction: 'forward' },
      b: { piece: 'aaron.back', path: 'seam', fraction: [0, 1], direction: 'reverse' },
    },
  ]
  return resolve(map, aaron)
}

const centred = (p) => Math.hypot(p.anchor[0], p.anchor[2])

test('a piece is classified by what it is, not by where it sits', () => {
  const byName = (id) => classify(aaron.pieces.find((piece) => piece.id === id))
  assert.equal(byName('aaron.front'), 'bodice-front')
  assert.equal(byName('aaron.back'), 'bodice-back')
  assert.equal(byName('aaron.armBinding'), 'band')
  assert.equal(byName('aaron.neckBinding'), 'band')

  const synthetic = (id, name, paths) => ({ id, name, paths: paths.map((path) => ({ path })) })
  assert.equal(classify(synthetic('x', 'sleeve', [])), 'sleeve')
  assert.equal(classify(synthetic('x', 'p', ['hem'])), 'unknown')
  assert.equal(classify(synthetic('x', 'flounce', [])), 'skirt')
  // Paths decide when the name does not.
  assert.equal(classify(synthetic('x', 'p', ['neckline'])), 'collar')
})

test('every piece is placed, and none of them is a hundred metres tall', () => {
  const placed = place(aaron, body, { seams: sideSeam() })
  assert.equal(placed.length, aaron.pieces.length)

  for (const piece of placed) {
    for (const geometry of piece.paths) {
      for (let i = 0; i < geometry.points.length; i += 3) {
        const y = geometry.points[i + 1]
        // A millimetre/metre mix-up puts a bodice 650 m in the air, which is the
        // failure this asserts against.
        assert.ok(y > -0.5 && y < 3, `${piece.id}: y ${y.toFixed(3)} m is not on a person`)
        assert.ok(Math.abs(geometry.points[i]) < 1.5, `${piece.id}: x is off the body`)
      }
    }
  }
})

test('the front goes on the front and the back on the back', () => {
  const placed = place(aaron, body, { seams: sideSeam() })
  const front = placed.find((piece) => piece.id === 'aaron.front')
  const back = placed.find((piece) => piece.id === 'aaron.back')

  // +z is the front of the body, so the front panel's centre sits at positive z
  // and the back panel's at negative z.
  assert.ok(front.anchor[2] > 0, `front at z ${front.anchor[2].toFixed(3)}`)
  assert.ok(back.anchor[2] < 0, `back at z ${back.anchor[2].toFixed(3)}`)
  assert.ok(front.anchor[2] > back.anchor[2])
})

test('pieces that occupy a side do not land on top of each other', () => {
  // Bands and collars are excluded on purpose: they are rings around the axis,
  // so two of them have the same centre by construction and saying otherwise
  // would be asserting a bug.
  const placed = place(aaron, body, { seams: sideSeam() }).filter(
    (piece) => piece.category !== 'band' && piece.category !== 'collar',
  )
  assert.ok(placed.length >= 2)
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]
      const b = placed[j]
      const gap = Math.hypot(
        a.anchor[0] - b.anchor[0],
        a.anchor[1] - b.anchor[1],
        a.anchor[2] - b.anchor[2],
      )
      assert.ok(gap > 0.05, `${a.id} and ${b.id} are ${gap.toFixed(3)} m apart`)
    }
  }
})

test('the inflation gap is applied, and is 30 mm by default', () => {
  assert.equal(DEFAULT_INFLATION_GAP_M, 0.03)

  const map = {
    axis: [0, 0],
    baseY: 0,
    centreX: 0,
    startAngle: 0,
    metresPerRadian: 1,
    radius: [1, 1, 1, 1],
    gapM: 0.03,
  }
  // Straight out along +x at flat x = 0 is the axis plus the fitted radius plus
  // the gap, and nothing else.
  const [x, y, z] = lift(map, 0, 0)
  assert.ok(Math.abs(x - 1.03) < 1e-9, `expected 1.03, got ${x}`)
  assert.ok(Math.abs(y) < 1e-9)
  assert.ok(Math.abs(z) < 1e-9)

  // And a no-gap map is exactly on the surface, so the gap is the difference.
  const [bare] = lift({ ...map, gapM: 0 }, 0, 0)
  assert.ok(Math.abs(bare - 1) < 1e-9)
})

test('lift converts millimetres to metres, once', () => {
  const map = {
    axis: [0, 0], baseY: 0, centreX: 0, startAngle: 0,
    metresPerRadian: 1, radius: [1], gapM: 0,
  }
  // 1000 mm of flat width is one metre, which at one metre per radian is one
  // radian around the axis.
  const [x, , z] = lift(map, 1000, 0)
  assert.ok(Math.abs(Math.atan2(z, x) - 1) < 1e-9, `expected one radian, got ${Math.atan2(z, x)}`)
  // 500 mm of flat height is half a metre up.
  const [, up] = lift(map, 0, 500)
  assert.ok(Math.abs(up - 0.5) < 1e-9)
})

test('placement is deterministic', () => {
  const a = place(aaron, body, { seams: sideSeam() })
  const b = place(aaron, body, { seams: sideSeam() })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})
