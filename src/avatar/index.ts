// The `avatar` module.
//
// Interface: `build(reference, measurements) → TriangleMesh`. Depth:
// reference-body selection, per-region non-uniform scaling, landmark
// identification.
//
// ## What this does, and what it deliberately does not
//
// Technical design §7.4: **the body scales from the same measurement set the
// pattern was drafted from; it is not anatomically morphed.** Consistency
// between draft and body is what makes a strain number mean anything, and
// anatomical fidelity is a later concern. So this measures a region's girth on
// the reference body, works out the factor that turns it into the requested
// girth, and scales the surface there. Nothing here moves a feature.
//
// ## Why the anchors are rig joints and not silhouettes
//
// The first version of this module found the chest, waist, and hips by looking
// for the widest and narrowest cross-sections in windows of height. It was
// wrong in two ways, and only one of them was a bug. The bug was measuring the
// windows from `y = 0` when the mesh's floor sits at `y = −0.845`, so the
// windows were empty. The modelling error was worse: **the widest loop at chest
// height is not the chest.** With the arms at the sides the slice merges them
// into the torso and reports a 1.36 m "girth" for a body whose chest is 1.0 m.
//
// Both go away by reading the mesh's own rig. `joint-spine-1` is the chest,
// `joint-spine-3` is the natural waist, `joint-pelvis` is the seat, and the
// shoulder joints give the width beyond which a segment belongs to an arm. The
// joint table is CC0 data shipped with the body, so this is a lookup rather
// than an inference — and a lookup cannot drift.
//
// ## The signature, and why it takes the body
//
// §4.1 writes `build(measurements) → TriangleMesh`. The reference body has to
// come from somewhere, and a synchronous function cannot do I/O: the browser
// fetches a one-megabyte body, the command line reads one off disk. So the
// caller loads it and passes it in, which is what keeps `build` pure and sync.
// The module's depth is unchanged; only where the mesh comes from moved.

import {
  REQUIRED_JOINTS,
  TORSO_BANDS,
  type BodyBand,
  type Boundaries,
  type Landmark,
  type MeasurementSet,
  type ReferenceBody,
  type TriangleMesh,
} from './types'

export type {
  BodyBand,
  Boundaries,
  Landmark,
  MeasurementSet,
  MeshScaling,
  ReferenceBody,
  TriangleMesh,
} from './types'
export { REQUIRED_JOINTS, TORSO_BANDS } from './types'

/**
 * How far a band's influence reaches, as a fraction of the body's height. Wide
 * enough that the surface between chest and waist interpolates instead of
 * stepping.
 */
const BAND_HALFWIDTH = 0.08

/**
 * The weight given to "scale nothing" before any band has a say. Without it the
 * head and feet inherit whatever the nearest band decided; with it they keep
 * their own size, because a band's influence decays with distance.
 */
const NEUTRAL_WEIGHT = 0.35

/**
 * How far past a shoulder joint a torso segment may sit before it is an arm's.
 * The deltoid reaches past the joint; the upper arm starts beyond that.
 */
const DELTOID_ALLOWANCE = 1.15

/** Endpoint keying resolution when chaining a cross-section: 0.1 mm. */
const KEY_SCALE = 1e4

const isBodyVertex = (index: number, bodyRange: [number, number]): boolean =>
  index >= bodyRange[0] && index <= bodyRange[1]

/**
 * The perimeter of each closed loop where the plane `y` cuts the body.
 *
 * Segment lengths are summed per connected component rather than by walking each
 * loop in order: on a closed surface every component *is* a closed loop, so the
 * sum of its segments is its perimeter and the ordering buys nothing.
 *
 * `lateralLimit` drops any segment whose midpoint sits further out than that,
 * which is how the arms stop counting towards a chest measurement. Summing all
 * loops would report a girth nobody has; summing the wrong loop reports a
 * plausible number that is also wrong, which is the worse failure.
 */
export const crossSections = (
  reference: ReferenceBody,
  y: number,
  lateralLimit = Infinity,
): number[] => {
  const { positions, indices, bodyRange } = reference

  const parent = new Map<number, number>()
  const find = (id: number): number => {
    let root = id
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root
    let walk = id
    while (walk !== root) {
      const next = parent.get(walk) ?? walk
      parent.set(walk, root)
      walk = next
    }
    return root
  }

  const ids = new Map<string, number>()
  const idOf = (x: number, z: number): number => {
    const key = `${Math.round(x * KEY_SCALE)}:${Math.round(z * KEY_SCALE)}`
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    const id = ids.size
    ids.set(key, id)
    parent.set(id, id)
    return id
  }

  const segments: Array<{ a: number; b: number; length: number }> = []

  // Interpolated crossing of an edge with the plane, or null when it does not.
  const crossing = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): [number, number] | null => {
    const da = ay - y
    const db = by - y
    if (da === db) return null
    if ((da > 0) === (db > 0)) return null
    const t = da / (da - db)
    return [ax + (bx - ax) * t, az + (bz - az) * t]
  }

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] ?? 0
    const ib = indices[i + 1] ?? 0
    const ic = indices[i + 2] ?? 0
    // Helper geometry — eyes, teeth, hair — sits above the body's vertex range
    // and cuts into dozens of tiny loops if it is not excluded.
    if (!isBodyVertex(ia, bodyRange) || !isBodyVertex(ib, bodyRange) || !isBodyVertex(ic, bodyRange)) {
      continue
    }

    const ax = positions[ia * 3] ?? 0, ay = positions[ia * 3 + 1] ?? 0, az = positions[ia * 3 + 2] ?? 0
    const bx = positions[ib * 3] ?? 0, by = positions[ib * 3 + 1] ?? 0, bz = positions[ib * 3 + 2] ?? 0
    const cx = positions[ic * 3] ?? 0, cy = positions[ic * 3 + 1] ?? 0, cz = positions[ic * 3 + 2] ?? 0

    if ((ay < y && by < y && cy < y) || (ay > y && by > y && cy > y)) continue

    const hits: Array<[number, number]> = []
    for (const hit of [
      crossing(ax, ay, az, bx, by, bz),
      crossing(bx, by, bz, cx, cy, cz),
      crossing(cx, cy, cz, ax, ay, az),
    ]) {
      if (hit !== null) hits.push(hit)
    }
    const first = hits[0]
    const second = hits[1]
    if (first === undefined || second === undefined) continue

    const length = Math.hypot(second[0] - first[0], second[1] - first[1])
    if (length <= 0) continue
    if (Math.abs((first[0] + second[0]) / 2) > lateralLimit) continue

    // `idOf` registers a new endpoint as its own root. Re-setting it here would
    // reset the union it may already belong to, which silently turns every
    // segment into its own one-segment "loop" and reports a chord as a girth.
    const a = idOf(first[0], first[1])
    const b = idOf(second[0], second[1])
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
    segments.push({ a, b, length })
  }

  const totals = new Map<number, number>()
  for (const segment of segments) {
    const root = find(segment.a)
    totals.set(root, (totals.get(root) ?? 0) + segment.length)
  }

  return [...totals.values()].sort((a, b) => b - a)
}

/**
 * The trunk's girth at a level.
 *
 * The kept segments are **summed**, not reduced to the largest component. When
 * the arms touch the torso the slice is one merged loop, and cutting it at the
 * shoulder width leaves two arcs rather than one loop; taking the largest would
 * report half a chest as a chest. Summing them reconstructs the trunk either
 * way. An uncut adult male chest comes out at 0.97 m, which is what a chest is.
 */
export const girthAt = (reference: ReferenceBody, y: number, lateralLimit: number): number =>
  crossSections(reference, y, lateralLimit).reduce((total, loop) => total + loop, 0)

const bounds = (positions: Float64Array): Boundaries => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis] ?? 0
      if (value < (min[axis] ?? Infinity)) min[axis] = value
      if (value > (max[axis] ?? -Infinity)) max[axis] = value
    }
  }
  return { min, max }
}

export const boundsOf = bounds

/**
 * The vertical scale the request implies, from `waistToHips` and the rig.
 *
 * Both ends of that measurement are joints this module already reads, so the
 * reference span is measured rather than assumed. `hpsToWaistBack` is the
 * fallback for a bodice-only set. Neither present means no vertical information
 * at all, which is a warning and a scale of one — not a silent guess.
 */
const verticalScaleFrom = (
  joints: Record<string, [number, number, number]>,
  measurements: MeasurementSet,
  warnings: string[],
): number => {
  const candidates: Array<[string, number]> = [
    ['waistToHips', (joints['joint-spine-3']?.[1] ?? 0) - (joints['joint-pelvis']?.[1] ?? 0)],
    [
      'hpsToWaistBack',
      (joints['joint-l-shoulder']?.[1] ?? 0) - (joints['joint-spine-3']?.[1] ?? 0),
    ],
  ]

  for (const [name, referenceSpan] of candidates) {
    const value = measurements[name]
    if (value === undefined || referenceSpan <= 0) continue
    return value / 1000 / referenceSpan
  }

  warnings.push('no vertical measurement the schema knows — the reference stature is kept')
  return 1
}

/** The outermost vertex on one axis within a window around a level. */
const surfaceAt = (
  positions: Float64Array,
  y: number,
  axis: 0 | 2,
  direction: 1 | -1,
  window: number,
): [number, number, number] => {
  let best: [number, number, number] = [0, y, 0]
  let bestValue = direction === 1 ? -Infinity : Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const vy = positions[i + 1] ?? 0
    if (Math.abs(vy - y) > window) continue
    const value = positions[i + axis] ?? 0
    if (direction === 1 ? value > bestValue : value < bestValue) {
      bestValue = value
      best = [positions[i] ?? 0, vy, positions[i + 2] ?? 0]
    }
  }
  return best
}

export const build = (reference: ReferenceBody, measurements: MeasurementSet): TriangleMesh => {
  const warnings: string[] = []
  const joints = reference.joints

  for (const name of REQUIRED_JOINTS) {
    if (joints[name] === undefined) warnings.push(`the reference body has no \`${name}\``)
  }

  // The mesh's floor is not `y = 0`, so every anchor is lifted into a frame the
  // measurements are in: metres above the floor.
  const source = reference.positions
  const floor = bounds(source).min[1]
  const shoulders = [joints['joint-l-shoulder'], joints['joint-r-shoulder']]
  const shoulderHalfWidth = Math.max(
    Math.abs(shoulders[0]?.[0] ?? 0),
    Math.abs(shoulders[1]?.[0] ?? 0),
  )
  if (shoulderHalfWidth <= 0) {
    warnings.push('the shoulder joints are missing, so no arm can be told from the trunk')
  }
  const lateralLimit = shoulderHalfWidth > 0 ? shoulderHalfWidth * DELTOID_ALLOWANCE : Infinity

  const verticalScale = verticalScaleFrom(joints, measurements, warnings)

  const bands: BodyBand[] = []
  for (const band of TORSO_BANDS) {
    const joint = joints[band.joint]
    if (joint === undefined) {
      warnings.push(`\`${band.joint}\` is missing, so the ${band.region} keeps its own girth`)
      continue
    }
    const requested = measurements[band.measurement]
    if (requested === undefined) {
      warnings.push(`\`${band.measurement}\` is missing, so the ${band.region} keeps its own girth`)
      continue
    }
    const referenceM = girthAt(reference, joint[1], lateralLimit)
    if (referenceM <= 0) {
      warnings.push(`the ${band.region} cross-section could not be measured on this body`)
      continue
    }
    bands.push({
      region: band.region,
      measurement: band.measurement,
      referenceM,
      targetM: requested / 1000,
      scale: requested / 1000 / referenceM,
      // Reported in the finished frame: metres above the floor, after scaling.
      y: (joint[1] - floor) * verticalScale,
    })
  }

  // Bands and vertices are both read in the scaled frame — `(y − floor) ×
  // verticalScale`. Mixing that with the mesh's own frame is how a band ends up
  // weighting the wrong part of the body, and it looks like a plausible body.
  const horizontalScaleAt = (scaledY: number): number => {
    let numerator = NEUTRAL_WEIGHT
    let denominator = NEUTRAL_WEIGHT
    const span = reference.height * BAND_HALFWIDTH * verticalScale
    for (const band of bands) {
      if (span <= 0) continue
      const weight = Math.exp(-(((scaledY - band.y) / span) ** 2))
      numerator += weight * band.scale
      denominator += weight
    }
    return numerator / denominator
  }

  const sourceBox = bounds(source)
  const zCentre = (sourceBox.min[2] + sourceBox.max[2]) / 2
  const positions = new Float64Array(source.length)

  for (let i = 0; i < source.length; i += 3) {
    const scaledY = ((source[i + 1] ?? 0) - floor) * verticalScale
    const factor = horizontalScaleAt(scaledY)
    positions[i] = (source[i] ?? 0) * factor
    positions[i + 1] = scaledY
    positions[i + 2] = zCentre + ((source[i + 2] ?? 0) - zCentre) * factor
  }

  // Centre on x so a landmark's x is a lateral offset, and put the head at the top.
  const box = bounds(positions)
  const shiftX = (box.min[0] + box.max[0]) / 2
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] ?? 0) - shiftX
  }

  const stature = box.max[1] - box.min[1]
  const window = stature * 0.02
  const bandY = (region: string): number => bands.find((band) => band.region === region)?.y ?? 0

  const landmarks: Landmark[] = [
    { name: 'shoulderRight', position: surfaceAt(positions, bandY('chest'), 0, 1, window * 3) },
    { name: 'shoulderLeft', position: surfaceAt(positions, bandY('chest'), 0, -1, window * 3) },
    { name: 'chestFront', position: surfaceAt(positions, bandY('chest'), 2, 1, window) },
    { name: 'chestBack', position: surfaceAt(positions, bandY('chest'), 2, -1, window) },
    { name: 'waistFront', position: surfaceAt(positions, bandY('waist'), 2, 1, window) },
    { name: 'waistBack', position: surfaceAt(positions, bandY('waist'), 2, -1, window) },
    { name: 'hipFront', position: surfaceAt(positions, bandY('hips'), 2, 1, window) },
    { name: 'hipBack', position: surfaceAt(positions, bandY('hips'), 2, -1, window) },
  ]

  return {
    positions,
    indices: reference.indices,
    landmarks,
    scaling: { body: reference.id, verticalScale, stature, bands, warnings },
  }
}

/** Anchor heights in the finished frame, for `place` and for the readout. */
export const anchorHeights = (mesh: TriangleMesh): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const band of mesh.scaling.bands) out[band.region] = band.y
  return out
}

/**
 * A reference body from its parsed JSON, with the geometry as typed arrays.
 *
 * The document was checked when it was generated; this checks what a caller's
 * `JSON.parse` produced, because a truncated fetch is a thing that happens and a
 * body that is silently half a metre shorter is worse than a refusal.
 */
export const loadReferenceBody = (document: unknown): ReferenceBody => {
  if (typeof document !== 'object' || document === null) {
    throw new Error('a reference body must be an object')
  }
  const body = document as Record<string, unknown>
  const positions = body['positions']
  const indices = body['indices']

  if (body['schemaVersion'] !== 1) {
    throw new Error(`unsupported body schemaVersion ${String(body['schemaVersion'])}`)
  }
  if (!Array.isArray(positions) || !Array.isArray(indices)) {
    throw new Error('a reference body needs `positions` and `indices`')
  }
  if (positions.length !== Number(body['vertexCount']) * 3) {
    throw new Error('the reference body is truncated')
  }

  const bodyRange = body['bodyRange']
  if (!Array.isArray(bodyRange) || bodyRange.length !== 2) {
    throw new Error('a reference body needs a `bodyRange`')
  }

  const joints = body['joints']
  if (typeof joints !== 'object' || joints === null) {
    throw new Error('a reference body needs `joints`; regenerate it with scripts/build-bodies.py')
  }

  return {
    schemaVersion: 1,
    id: String(body['id']),
    gender: String(body['gender'] ?? 'unknown'),
    height: Number(body['height']),
    scales: Array.isArray(body['scales']) ? (body['scales'] as number[]) : [1],
    vertexCount: Number(body['vertexCount']),
    triangleCount: Number(body['triangleCount']),
    bodyRange: [Number(bodyRange[0]), Number(bodyRange[1])],
    joints: joints as Record<string, [number, number, number]>,
    positions: Float64Array.from(positions as number[]),
    indices: Uint32Array.from(indices as number[]),
  }
}
