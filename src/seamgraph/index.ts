// The `seamgraph` module.
//
// Interface: `resolve(map, draft) → ResolvedSeams`. Depth: mirror expansion,
// path-fraction sub-selection, direction reversal, arc-length
// reparameterisation, and length-tolerance checks.
//
// Nothing here simulates and nothing here places. It answers one question —
// which sub-arc of which path sews to which, and how long each one is — because
// that answer is what turns a class of silent physics failures into an
// immediate named error. A seam whose two edges differ by more than the
// configured tolerance is reported *before* anything is draped.
//
// ## Arc-length reparameterisation, and why it is not the polyline's job
//
// `DraftPiece.paths[].points` is a tessellation; an inscribed polyline
// under-reports a curve (technical design §5). So fractions are measured against
// `pathLengths`, which is curve-accurate, and the polyline is only used to work
// out *where* a cut lands. Concretely: a polyline of tessellated length `p`
// represents a curve of length `L`, so a cut at arc length `s` sits at `s·p/L`
// along the polyline. Sub-arc lengths are then reported as `(to − from)·L`.
//
// Getting this wrong is subtle rather than obvious: the two agree to a few
// hundredths of a millimetre, which is inside most tolerances and well outside
// the one this project works at.

import type { DraftResult } from '../draft/index'
import type {
  ResolvedEdge,
  ResolvedSeam,
  ResolvedSeams,
  ResolutionFailure,
  SeamEndpoint,
  SeamMap,
  SeamSide,
  SeamSpec,
} from './types'

export type {
  ResolvedEdge,
  ResolvedSeam,
  ResolvedSeams,
  ResolutionFailure,
  SeamEndpoint,
  SeamMap,
  SeamSide,
  SeamSpec,
} from './types'
export { DEFAULT_LENGTH_TOLERANCE, emptySeamMap } from './types'

type XY = [number, number]

const distance = (a: XY, b: XY): number => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Cumulative polyline lengths, so a cut is a scan rather than a rescan. */
const cumulative = (points: XY[]): number[] => {
  const out = [0]
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    if (previous === undefined || current === undefined) continue
    out.push((out[i - 1] ?? 0) + distance(previous, current))
  }
  return out
}

/** The point `along` polyline units from the start. */
const pointAlong = (points: XY[], cum: number[], along: number): XY => {
  const last = points[points.length - 1]
  if (points.length === 0 || last === undefined) return [0, 0]
  for (let i = 1; i < points.length; i++) {
    const start = cum[i - 1]
    const end = cum[i]
    const from = points[i - 1]
    const to = points[i]
    if (start === undefined || end === undefined || from === undefined || to === undefined) continue
    if (along <= end || i === points.length - 1) {
      const span = end - start
      const t = span <= 0 ? 0 : (along - start) / span
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    }
  }
  return last
}

/**
 * The sub-arc between two arc-length fractions, in curve units.
 *
 * Returns null when the path has no length to subdivide — a degenerate path is a
 * resolution failure rather than an empty seam.
 */
export const subArc = (
  points: XY[],
  curveLength: number,
  fraction: [number, number],
): { points: XY[]; length: number } | null => {
  if (points.length < 2 || curveLength <= 0) return null

  const cum = cumulative(points)
  const polylineLength = cum[cum.length - 1] ?? 0
  if (polylineLength <= 0) return null

  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const from = clamp(Math.min(fraction[0], fraction[1]))
  const to = clamp(Math.max(fraction[0], fraction[1]))

  // Curve units to polyline units. This single ratio is the reparameterisation.
  const scale = polylineLength / curveLength
  const startAlong = from * curveLength * scale
  const endAlong = to * curveLength * scale

  const out: XY[] = [pointAlong(points, cum, startAlong)]
  for (let i = 1; i < points.length - 1; i++) {
    const at = cum[i]
    if (at !== undefined && at > startAlong && at < endAlong) {
      const point = points[i]
      if (point !== undefined) out.push(point)
    }
  }
  out.push(pointAlong(points, cum, endAlong))

  return { points: out, length: (to - from) * curveLength }
}

const reverse = (edge: ResolvedEdge): ResolvedEdge => ({
  ...edge,
  points: [...edge.points].reverse(),
  direction: edge.direction === 'forward' ? 'reverse' : 'forward',
})

interface DraftIndex {
  lengthOf: (piece: string, path: string) => number | undefined
  pointsOf: (piece: string, path: string) => XY[] | undefined
}

const indexDraft = (draft: DraftResult): DraftIndex => {
  const pieces = new Map(draft.pieces.map((piece) => [piece.id, piece]))
  return {
    lengthOf: (piece, path) => pieces.get(piece)?.pathLengths[path],
    pointsOf: (piece, path) =>
      pieces.get(piece)?.paths.find((geometry) => geometry.path === path)?.points,
  }
}

type EdgeResult = { ok: true; edge: ResolvedEdge } | { ok: false; failure: ResolutionFailure }

const resolveEndpoint = (
  seam: string,
  endpoint: SeamEndpoint,
  index: DraftIndex,
): EdgeResult => {
  const missing = (message: string): EdgeResult => ({
    ok: false,
    failure: { seam, piece: endpoint.piece, path: endpoint.path, message },
  })

  const points = index.pointsOf(endpoint.piece, endpoint.path)
  if (points === undefined) {
    return missing(`\`${endpoint.piece}.${endpoint.path}\` is not a path in the draft`)
  }

  const length = index.lengthOf(endpoint.piece, endpoint.path)
  if (length === undefined) {
    return missing(`\`${endpoint.piece}.${endpoint.path}\` has no drafted length`)
  }

  const arc = subArc(points, length, endpoint.fraction)
  if (arc === null) {
    return missing(`\`${endpoint.piece}.${endpoint.path}\` has no length to subdivide`)
  }

  const edge: ResolvedEdge = {
    piece: endpoint.piece,
    path: endpoint.path,
    points: arc.points,
    length: arc.length,
    fraction: endpoint.fraction,
    direction: endpoint.direction,
  }
  return { ok: true, edge: endpoint.direction === 'reverse' ? reverse(edge) : edge }
}

const seamTouchesMirror = (spec: SeamSpec, mirrored: ReadonlySet<string>): boolean =>
  mirrored.has(spec.a.piece) || mirrored.has(spec.b.piece)

/**
 * The other side of a mirrored seam.
 *
 * A piece in `sides.mirror` exists twice on the body, and `sides.mirror` is the
 * only place that duplication is expressed — so the resolver is what expands it,
 * once. The convention that makes it possible is in the id: `shoulder.left`
 * becomes `shoulder.right`. An id with no side suffix gains one.
 */
const otherSide = (id: string): string => {
  if (id.endsWith('.left')) return `${id.slice(0, -'.left'.length)}.right`
  if (id.endsWith('.right')) return `${id.slice(0, -'.right'.length)}.left`
  return `${id}.right`
}

const sideOf = (id: string): SeamSide | null => {
  if (id.endsWith('.left')) return 'left'
  if (id.endsWith('.right')) return 'right'
  return null
}

const resolveOne = (
  spec: SeamSpec,
  side: SeamSide | null,
  index: DraftIndex,
  lengthTolerance: number,
): { seam: ResolvedSeam } | { failures: ResolutionFailure[] } => {
  const a = resolveEndpoint(spec.id, spec.a, index)
  const b = resolveEndpoint(spec.id, spec.b, index)
  if (!a.ok || !b.ok) {
    const failures: ResolutionFailure[] = []
    if (!a.ok) failures.push(a.failure)
    if (!b.ok) failures.push(b.failure)
    return { failures }
  }

  const lengthDelta = a.edge.length - b.edge.length
  return {
    seam: {
      id: spec.id,
      side,
      a: a.edge,
      b: b.edge,
      lengthDelta,
      verdict: Math.abs(lengthDelta) <= lengthTolerance ? 'ok' : 'mismatch',
    },
  }
}

/**
 * Resolve a seam map against a draft.
 *
 * A seam that cannot resolve is reported and skipped rather than throwing: the
 * caller needs to see *every* broken seam, not the first one, because a seam map
 * is authored in one sitting and fixed in one sitting.
 */
export const resolve = (map: SeamMap, draft: DraftResult): ResolvedSeams => {
  const index = indexDraft(draft)
  const mirrored = new Set(map.sides.mirror)
  const seams: ResolvedSeam[] = []
  const failures: ResolutionFailure[] = []
  const expanded = new Set<string>()

  for (const spec of map.seams) {
    const primary = resolveOne(spec, sideOf(spec.id), index, map.lengthTolerance)
    if ('failures' in primary) {
      failures.push(...primary.failures)
      continue
    }
    seams.push(primary.seam)

    if (!seamTouchesMirror(spec, mirrored)) continue

    for (const piece of [spec.a.piece, spec.b.piece]) {
      if (mirrored.has(piece)) expanded.add(piece)
    }

    const mirroredId = otherSide(spec.id)
    const mirrorSpec: SeamSpec = { ...spec, id: mirroredId }
    const second = resolveOne(mirrorSpec, sideOf(mirroredId), index, map.lengthTolerance)
    if ('failures' in second) failures.push(...second.failures)
    else seams.push(second.seam)
  }

  return {
    schemaVersion: 1,
    design: map.design,
    units: 'mm',
    lengthTolerance: map.lengthTolerance,
    seams,
    failures,
    mirrored: [...expanded].sort(),
  }
}
