// Unit tests for the pure helpers, against geometry whose answer is known
// before the code runs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Path, Point } from '@freesewing/core'

import {
  bounds,
  boundsCentre,
  polygonCentroid,
  polylineLength,
  segmentThrough,
  tessellate,
} from '../src/draft/geometry.ts'

/** Trigonometry does not land on the round numbers a reader expects. */
const close = (actual, expected, tolerance = 1e-9) => {
  assert.equal(actual.length, expected.length, `lengths: ${actual} vs ${expected}`)
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= tolerance,
      `[${index}]: ${value} vs ${expected[index]}`,
    )
  })
}

const closeSegment = (actual, expected) => {
  close(actual.from, expected.from)
  close(actual.to, expected.to)
}

test('a straight line tessellates to its own two endpoints', () => {
  const path = new Path().move(new Point(0, 0)).line(new Point(300, 0))
  assert.deepEqual(tessellate(path), [
    [0, 0],
    [300, 0],
  ])
  assert.equal(polylineLength(tessellate(path)), 300)
})

test('a cubic is tessellated between its endpoints, not beyond them', () => {
  const path = new Path()
    .move(new Point(0, 0))
    .curve(new Point(0, 100), new Point(100, 100), new Point(100, 0))

  const points = tessellate(path)
  assert.deepEqual(points[0], [0, 0])
  assert.deepEqual(points[points.length - 1], [100, 0])
  assert.ok(points.length > 4, `expected samples along the curve, got ${points.length}`)

  // The curve bulges downwards, so every interior sample lies y > 0.
  for (const [, y] of points.slice(1, -1)) assert.ok(y > 0)
})

test('a tessellation under-reports a curve, within the tolerance the seam validator uses', () => {
  const path = new Path()
    .move(new Point(0, 0))
    .curve(new Point(0, 400), new Point(300, 400), new Point(300, 0))

  const exact = path.length()
  const sampled = polylineLength(tessellate(path))

  // An inscribed polyline is always shorter than the arc it approximates. This
  // is why `pathLengths` comes from the curve and not from `points`
  // (technical design §5).
  assert.ok(sampled < exact, `sampled ${sampled} should be under the exact ${exact}`)
  assert.ok(exact - sampled < 0.1, `chord error ${(exact - sampled).toFixed(4)} mm is over 0.1 mm`)
})

test('bounds and their centre', () => {
  const box = bounds([
    [10, -5],
    [30, 25],
    [-2, 7],
  ])
  assert.deepEqual(box, { minX: -2, minY: -5, maxX: 30, maxY: 25 })
  assert.deepEqual(boundsCentre(box), [14, 10])
  assert.equal(bounds([]), null)
})

test('the centroid of a square is its middle', () => {
  close(
    polygonCentroid([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]),
    [5, 5],
  )
})

test('a shape with no area falls back to its bounding box', () => {
  // A degenerate "polygon": every point on one line.
  close(
    polygonCentroid([
      [0, 0],
      [4, 0],
      [8, 0],
    ]),
    [4, 0],
  )
})

test('a grainline at 0° runs across the box, and at 90° down it', () => {
  const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
  const centre = [50, 25]

  closeSegment(segmentThrough(centre, 0, box), { from: [0, 25], to: [100, 25] })
  closeSegment(segmentThrough(centre, 90, box), { from: [50, 0], to: [50, 50] })
  // 270° is up, in the pattern's y-down space: FreeSewing's `shift(270, d)`.
  closeSegment(segmentThrough(centre, 270, box), { from: [50, 50], to: [50, 0] })
})
