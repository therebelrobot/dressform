// Turning a drafted Path into the polyline form `DraftResult` carries, plus the
// handful of measurements taken from it.
//
// Pure: it walks an op list and returns numbers. Nothing here calls FreeSewing
// for geometry, and nothing here computes a path *length* — the length comes
// from FreeSewing's own curve-accurate `Path.length()`, because a tessellated
// polyline under-reports a curve and the seam validator must not inherit that
// error (technical design §5).

import type { FsOp, FsPath, FsPoint } from './freesewing'

/** A point pair, as it appears in the contract. */
export type XY = [number, number]

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Roughly how much curve one sample covers, in millimetres. A cubic sampled
 * every 12 mm of chord keeps chord error far below the 0.1 mm the seam
 * validator works at, and a pattern this size stays a few thousand points.
 */
const MM_PER_SAMPLE = 12
const MIN_SAMPLES = 4
const MAX_SAMPLES = 64

const cubicAt = (p0: FsPoint, p1: FsPoint, p2: FsPoint, p3: FsPoint, t: number): XY => {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  ]
}

const far = (a: FsPoint, b: FsPoint): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The control polygon is a cheap upper bound on a cubic's arc length. */
const curveSamples = (p0: FsPoint, p1: FsPoint, p2: FsPoint, p3: FsPoint): number => {
  const span = far(p0, p1) + far(p1, p2) + far(p2, p3)
  const steps = Math.ceil(span / MM_PER_SAMPLE)
  return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, steps))
}

const samePoint = (a: XY, b: XY): boolean => a[0] === b[0] && a[1] === b[1]

/**
 * A path as a polyline. Every op contributes its endpoint, so the polyline
 * always contains the path's corners — which is what hit-testing a seam edge
 * needs — and curves contribute evenly spaced samples between them.
 */
export const tessellate = (path: FsPath): XY[] => {
  const out: XY[] = []
  const push = (p: FsPoint): void => {
    const xy: XY = [p.x, p.y]
    const last = out[out.length - 1]
    if (last === undefined || !samePoint(last, xy)) out.push(xy)
  }

  let current: FsPoint | null = null
  let start: FsPoint | null = null

  for (const op of path.ops as FsOp[]) {
    switch (op.type) {
      case 'move': {
        start = op.to
        push(op.to)
        current = op.to
        break
      }
      case 'line': {
        push(op.to)
        current = op.to
        break
      }
      case 'curve': {
        if (current === null) {
          push(op.to)
        } else {
          const steps = curveSamples(current, op.cp1, op.cp2, op.to)
          for (let i = 1; i <= steps; i++) {
            out.push(cubicAt(current, op.cp1, op.cp2, op.to, i / steps))
          }
        }
        current = op.to
        break
      }
      case 'close': {
        if (start !== null) push(start)
        current = start
        break
      }
    }
  }

  return out
}

export const polylineLength = (points: XY[]): number => {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a !== undefined && b !== undefined) total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

export const bounds = (points: XY[]): Box | null => {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export const boundsCentre = (box: Box): XY => [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]

/**
 * The area centroid of a closed polyline — where a piece actually sits, as
 * opposed to where its bounding box sits. Falls back to the box centre for a
 * shape with no area, which is what an open or self-overlapping path is.
 */
export const polygonCentroid = (points: XY[]): XY | null => {
  const box = bounds(points)
  if (box === null) return null

  let area = 0
  let x = 0
  let y = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a === undefined || b === undefined) continue
    const cross = a[0] * b[1] - b[0] * a[1]
    area += cross
    x += (a[0] + b[0]) * cross
    y += (a[1] + b[1]) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-9) return boundsCentre(box)
  return [x / (6 * area), y / (6 * area)]
}

/**
 * A segment through `centre` at `angleDegrees`, spanning as far as `box` allows
 * in both directions.
 *
 * The angle is FreeSewing's own: `Point.shift(deg, dist)` moves `+dist` along x
 * and then rotates `deg` clockwise, so 0° is right and 90° is down in the
 * pattern's y-down space.
 */
export const segmentThrough = (centre: XY, angleDegrees: number, box: Box): { from: XY; to: XY } => {
  const radians = (angleDegrees * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)

  const reach = (sign: number): number => {
    const parts: number[] = []
    if (Math.abs(dx) > 1e-9) {
      const limit = sign * dx > 0 ? box.maxX - centre[0] : centre[0] - box.minX
      parts.push(limit / Math.abs(dx))
    }
    if (Math.abs(dy) > 1e-9) {
      const limit = sign * dy > 0 ? box.maxY - centre[1] : centre[1] - box.minY
      parts.push(limit / Math.abs(dy))
    }
    return parts.length === 0 ? 0 : Math.max(0, Math.min(...parts))
  }

  const forward = reach(1)
  const backward = reach(-1)
  return {
    from: [centre[0] - dx * backward, centre[1] - dy * backward],
    to: [centre[0] + dx * forward, centre[1] + dy * forward],
  }
}
