// The `place` module.
//
// Interface: `place(draft, body, hints) → PlacedPiece[]`. Depth: category
// classification, tangent-plane mapping, inflation gap, seam-aware orientation.
//
// ## What placement is for
//
// The simulation cannot start from flat geometry floating in space: it needs
// every piece to begin *near where it belongs*, clear of the body, with its seam
// edges pointed at their partners. Get that wrong and the drape either converges
// to a tangle or pulls the garment through the form. §7.2 fixes the seed: a
// 30 mm inflation gap, so nothing starts inside the body.
//
// ## The mapping, and what it is not
//
// A piece is wrapped around a **cylinder fitted to the body at one height**,
// offset by the gap: flat `x` becomes an angle, flat `y` becomes height, and the
// radius at each angle is the body's own at that height. That is a tangent-plane
// mapping in the sense §4.1 means — it gets the piece onto the surface, oriented
// and outside it — and it is deliberately not a conformal unfold. Wrapping a
// flat panel onto a torso exactly is a different problem, and the simulation is
// what actually conforms the cloth. Placement's job is to give it a good start.
//
// The upshot is that the mapping is a small descriptor rather than a baked mesh:
// `sim` builds its particle grid in the piece's own 2D coordinates — because
// particle density along an edge is a simulation parameter (§7.2), not a
// placement one — and lifts each particle through `lift`. One mapping, two
// consumers, and no triangulation here.

import type { MeasurementSet, TriangleMesh } from '../avatar/index'
import type { DraftPiece, DraftResult } from '../draft/index'
import type { ResolvedSeams } from '../seamgraph/index'

export type { TriangleMesh }

/** What a piece is, which is what decides where it goes. */
export type PieceCategory =
  | 'bodice-front'
  | 'bodice-back'
  | 'band'
  | 'collar'
  | 'sleeve'
  | 'skirt'
  | 'unknown'

/**
 * How a piece's flat coordinates become scene coordinates.
 *
 * `lift` is the whole interface: hand it a point in the piece's own 2D space and
 * it returns metres in scene space. `radius` is the body's radius per angular
 * bucket at the anchor height, so the cylinder is fitted rather than guessed.
 */
export interface CylinderMap {
  /** The vertical axis of the body, as `[x, z]`. */
  axis: [number, number]
  /** The scene height that the piece's flat `y = 0` lands at. */
  baseY: number
  /** The flat `x` that lands on `startAngle`. */
  centreX: number
  /** Radians. Where the piece's centre sits around the axis. */
  startAngle: number
  /** Metres travelled around the axis per metre of flat `x`. */
  metresPerRadian: number
  /** The body's radius at each angular bucket, at the anchor height. */
  radius: number[]
  gapM: number
}

export interface PlacedPiece {
  id: string
  category: PieceCategory
  /** The piece's boundary, path by path, lifted into scene space and re-flattened. */
  paths: Array<{ path: string; points: Float64Array }>
  map: CylinderMap
  /** Where the piece's centre landed. */
  anchor: [number, number, number]
  /** The seams this piece takes part in, by id — the orientation used them. */
  seams: string[]
}

export interface PlaceHints {
  /** §7.2's inflation gap. Defaults to 30 mm. */
  inflationGapM?: number
  /** Angular buckets used to fit the cylinder. Defaults to 64. */
  buckets?: number
  /** Resolved seams, so a piece can be turned to face its partner. */
  seams?: ResolvedSeams
  /** Free parameters a placement may want; unused today, kept for §4.1's signature. */
  measurements?: MeasurementSet
}

/** §7.2. Keeps pieces clear of the body at frame zero. */
export const DEFAULT_INFLATION_GAP_M = 0.03

const DEFAULT_BUCKETS = 64

/** Candidate angles tried when turning a piece to face a partner. */
const ORIENTATION_STEPS = 72

/** Where a piece of each kind starts, before any seam pulls it. */
const DEFAULT_ANGLE: Record<PieceCategory, number> = {
  // `+z` is the front of the body and `+x` is the model's right, so the front
  // sits at a quarter turn and the back at three quarters.
  'bodice-front': Math.PI / 2,
  'bodice-back': -Math.PI / 2,
  band: 0,
  collar: Math.PI / 2,
  sleeve: 0,
  skirt: Math.PI / 2,
  unknown: Math.PI / 2,
}

/**
 * What kind of piece this is, from its name and the paths it draws.
 *
 * The rules are ordered and deliberately narrow: a piece the classifier does not
 * recognise is `unknown` and still gets placed, because refusing to place it
 * would fail the drape for a naming convention rather than a modelling reason.
 */
export const classify = (piece: DraftPiece): PieceCategory => {
  const name = `${piece.id} ${piece.name}`.toLowerCase()
  const paths = piece.paths.map((geometry) => geometry.path.toLowerCase()).join(' ')

  if (/sleeve|armcap|armscye/.test(name)) return 'sleeve'
  if (/skirt|panel|gore|flounce/.test(name)) return 'skirt'
  if (/collar|neckline|hood/.test(name)) return 'collar'
  if (/binding|band|cuff|ribbing|belt|waistband|strap/.test(name)) return 'band'
  if (/front/.test(name)) return 'bodice-front'
  if (/back/.test(name)) return 'bodice-back'

  // Fall back to the paths, since a piece's name is the author's choice.
  if (/sleeve/.test(paths)) return 'sleeve'
  if (/neck|collar/.test(paths)) return 'collar'
  return 'unknown'
}

/** The height a category hangs from, read off the scaled body rather than assumed. */
const anchorHeightFor = (category: PieceCategory, body: TriangleMesh): number => {
  const at = (region: string): number | undefined =>
    body.scaling.bands.find((band) => band.region === region)?.y
  const chest = at('chest') ?? body.scaling.stature * 0.72
  const waist = at('waist') ?? body.scaling.stature * 0.62
  const hips = at('hips') ?? body.scaling.stature * 0.54

  switch (category) {
    case 'bodice-front':
    case 'bodice-back':
      // A bodice hangs from the shoulders, so its centre sits between the two.
      return (chest + waist) / 2
    case 'band':
    case 'collar':
      return chest + (chest - waist) * 0.6
    case 'sleeve':
      return chest
    case 'skirt':
      return hips
    default:
      return chest
  }
}

/** The body's own girth at a height, as the cylinder's circumference. */
const girthNear = (body: TriangleMesh, y: number): number => {
  let best = body.scaling.bands[0]
  for (const band of body.scaling.bands) {
    if (best === undefined || Math.abs(band.y - y) < Math.abs(best.y - y)) best = band
  }
  return best?.targetM ?? Math.PI * 0.3
}

/**
 * The body's radius per angular bucket at one height, so the cylinder follows
 * the form instead of being a circle drawn round it.
 *
 * Segments are not consulted here — this reads vertices, which is enough to fit
 * a surface to wrap onto. The lateral limit keeps the arms out, using the
 * shoulder landmarks the scaled body already carries.
 */
const radiusTable = (
  body: TriangleMesh,
  y: number,
  axis: [number, number],
  buckets: number,
  window: number,
): number[] => {
  const table = new Array<number>(buckets).fill(0)

  const right = body.landmarks.find((landmark) => landmark.name === 'shoulderRight')?.position[0]
  const left = body.landmarks.find((landmark) => landmark.name === 'shoulderLeft')?.position[0]
  const limit = right !== undefined && left !== undefined ? Math.abs(right - left) * 0.6 : Infinity

  for (let i = 0; i < body.positions.length; i += 3) {
    const vy = body.positions[i + 1] ?? 0
    if (Math.abs(vy - y) > window) continue
    const dx = (body.positions[i] ?? 0) - axis[0]
    const dz = (body.positions[i + 2] ?? 0) - axis[1]
    // The limit is on |x|, matching how the arms were told from the trunk.
    if (Math.abs(body.positions[i] ?? 0) > limit) continue
    const angle = Math.atan2(dz, dx)
    const bucket = Math.floor((((angle + Math.PI) / (2 * Math.PI)) * buckets) % buckets)
    const radius = Math.hypot(dx, dz)
    if (radius > (table[bucket] ?? 0)) table[bucket] = radius
  }

  // A bucket with nothing in it inherits the nearest one that has something,
  // so the surface has no holes to drop a piece through.
  const known = table.filter((value) => value > 0)
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0
  for (let i = 0; i < buckets; i++) if ((table[i] ?? 0) <= 0) table[i] = fallback

  return table
}

/**
 * A point in the piece's own 2D space, in scene space.
 *
 * The one place the mapping is implemented, so `place`'s boundary and `sim`'s
 * particle grid cannot disagree about where a piece is.
 */
export const lift = (map: CylinderMap, x: number, y: number): [number, number, number] => {
  // The draft is in millimetres and the scene is in metres. The conversion
  // happens here, once, because this is the only place the two spaces meet —
  // and a piece placed without it comes out six hundred metres tall, which is
  // at least a failure you notice.
  const flatX = x / 1000
  const flatY = y / 1000
  const angle = map.startAngle + (flatX - map.centreX) / map.metresPerRadian
  const wrapped = ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  const buckets = map.radius.length
  const bucket = Math.min(buckets - 1, Math.max(0, Math.floor(((wrapped + Math.PI) / (2 * Math.PI)) * buckets)))
  const radius = (map.radius[bucket] ?? 0) + map.gapM

  return [map.axis[0] + Math.cos(angle) * radius, map.baseY + flatY, map.axis[1] + Math.sin(angle) * radius]
}

const flatBounds = (piece: DraftPiece): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const geometry of piece.paths) {
    for (const [x, y] of geometry.points) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, maxX, minY, maxY }
}

const placeOne = (
  piece: DraftPiece,
  category: PieceCategory,
  body: TriangleMesh,
  axis: [number, number],
  gapM: number,
  buckets: number,
  startAngle: number,
  seams: string[],
): PlacedPiece => {
  // The piece's bounds are in millimetres, like the rest of the draft; the map
  // is in metres, like the rest of the scene.
  const box = flatBounds(piece)
  const centreX = (box.minX + box.maxX) / 2 / 1000
  const centreY = (box.minY + box.maxY) / 2 / 1000
  const anchorY = anchorHeightFor(category, body)

  const girth = girthNear(body, anchorY)
  const map: CylinderMap = {
    axis,
    baseY: anchorY - centreY,
    centreX,
    startAngle,
    // A flat width `w` should cover `w` metres of a surface of circumference `g`,
    // which is `2πw/g` radians — so a metre of flat width is `g/2π` radians.
    metresPerRadian: girth / (2 * Math.PI),
    radius: radiusTable(body, anchorY, axis, buckets, body.scaling.stature * 0.03),
    gapM,
  }

  const paths = piece.paths.map((geometry) => {
    const points = new Float64Array(geometry.points.length * 3)
    geometry.points.forEach(([x, y], index) => {
      const [px, py, pz] = lift(map, x, y)
      points[index * 3] = px
      points[index * 3 + 1] = py
      points[index * 3 + 2] = pz
    })
    return { path: geometry.path, points }
  })

  return {
    id: piece.id,
    category,
    paths,
    map,
    // Where the piece's own centre landed. The orientation search compares these
    // to keep pieces off each other, so it is the centroid, not a surface point.
    anchor: lift(map, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2),
    seams,
  }
}

/** Mean distance between this piece's seamed edge and its placed partner's. */
const seamCost = (
  candidate: CylinderMap,
  piece: DraftPiece,
  seamPath: string,
  partner: PlacedPiece,
  partnerPath: string,
): number => {
  const mine = piece.paths.find((geometry) => geometry.path === seamPath)
  const theirs = partner.paths.find((geometry) => geometry.path === partnerPath)
  if (mine === undefined || theirs === undefined || theirs.points.length === 0) return Infinity

  let total = 0
  for (const [x, y] of mine.points) {
    const [ax, ay, az] = lift(candidate, x, y)
    let nearest = Infinity
    for (let i = 0; i < theirs.points.length; i += 3) {
      const d = Math.hypot(
        (theirs.points[i] ?? 0) - ax,
        (theirs.points[i + 1] ?? 0) - ay,
        (theirs.points[i + 2] ?? 0) - az,
      )
      if (d < nearest) nearest = d
    }
    total += nearest
  }
  return total / mine.points.length
}

/**
 * Put every piece of a draft on a scaled body.
 *
 * Pieces are placed in an order that lets a piece use its partner: bodices
 * first, then the things that wrap them, then whatever else. A piece with a
 * seam to something already placed is turned through a full circle in
 * `ORIENTATION_STEPS` steps and kept at the angle whose seam edge comes out
 * nearest its partner's — which is what makes a sleeve start at its armhole
 * rather than on the far side of the torso.
 */
export const place = (draft: DraftResult, body: TriangleMesh, hints: PlaceHints = {}): PlacedPiece[] => {
  const gapM = hints.inflationGapM ?? DEFAULT_INFLATION_GAP_M
  const buckets = hints.buckets ?? DEFAULT_BUCKETS
  const seams = hints.seams

  // The body's vertical axis, from its own bounding box: `avatar` centres the
  // body on `x`, and the depth centre is wherever the form actually sits.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < body.positions.length; i += 3) {
    const x = body.positions[i] ?? 0
    const z = body.positions[i + 2] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const axis: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2]

  const order: PieceCategory[] = ['bodice-front', 'bodice-back', 'skirt', 'band', 'collar', 'sleeve', 'unknown']
  const classified = draft.pieces.map((piece) => ({ piece, category: classify(piece) }))
  const sorted = [...classified].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))

  const placed: PlacedPiece[] = []

  for (const { piece, category } of sorted) {
    const mine = (seams?.seams ?? []).filter(
      (seam) => seam.a.piece === piece.id || seam.b.piece === piece.id,
    )

    let startAngle = DEFAULT_ANGLE[category]

    // Turn to face the first partner already on the body, if there is one.
    for (const seam of mine) {
      const partnerId = seam.a.piece === piece.id ? seam.b.piece : seam.a.piece
      const partner = placed.find((candidate) => candidate.id === partnerId)
      if (partner === undefined) continue

      const minePath = seam.a.piece === piece.id ? seam.a.path : seam.b.path
      const partnerPath = seam.a.piece === piece.id ? seam.b.path : seam.a.path

      const probe = placeOne(piece, category, body, axis, gapM, buckets, startAngle, []).map
      const box = flatBounds(piece)
      const centreXmm = (box.minX + box.maxX) / 2
      const centreYmm = (box.minY + box.maxY) / 2
      const halfWidthM = (box.maxX - box.minX) / 2 / 1000

      // A *refinement*, not a search of the whole circle. A panel that wraps
      // most of the way round a torso has a seam edge almost everywhere, so
      // minimising seam distance over 360° drags the back panel round to lie
      // beside the front one — a better seam and a worse garment. The category's
      // default angle already says which side of the body this piece belongs to;
      // this only nudges it.
      let best = startAngle
      let bestCost = Infinity
      for (let step = 0; step < ORIENTATION_STEPS; step++) {
        const angle = startAngle + ((step / (ORIENTATION_STEPS - 1)) - 0.5) * (Math.PI / 2)
        const candidate = { ...probe, startAngle: angle }

        // Nearest seam is not enough on its own. Unconstrained, the search finds
        // the coincident angle — seam distance zero — and lays the back panel on
        // top of the front one. So a candidate that would overlap something
        // already placed is not a candidate.
        const centre = lift(candidate, centreXmm, centreYmm)
        const overlapping = placed.some(
          (other) =>
            Math.hypot(
              other.anchor[0] - centre[0],
              other.anchor[1] - centre[1],
              other.anchor[2] - centre[2],
            ) < halfWidthM,
        )
        if (overlapping) continue

        const cost = seamCost(candidate, piece, minePath, partner, partnerPath)
        if (cost < bestCost) {
          bestCost = cost
          best = angle
        }
      }
      startAngle = best
      break
    }

    placed.push(
      placeOne(piece, category, body, axis, gapM, buckets, startAngle, mine.map((seam) => seam.id)),
    )
  }

  return placed
}
