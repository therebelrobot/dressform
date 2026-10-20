// The `avatar` module's contracts.
//
// `TriangleMesh` is technical design §6.5's `SceneBundle.body`, so it lives here
// where the module that produces it is. Everything else is this module's own.

/** Millimetres, keyed by FreeSewing measurement name. */
export type MeasurementSet = Record<string, number>

export interface Landmark {
  /** `chestFront`, `shoulderRight`, … */
  name: string
  position: [number, number, number]
}

/** One body region, and the measurement that set its girth. */
export interface BodyBand {
  region: string
  measurement: string
  /** The reference body's own girth at this level, in metres. */
  referenceM: number
  /** What the request asks for, in metres. */
  targetM: number
  /** `targetM / referenceM`. */
  scale: number
  /** The level itself, in metres above the floor of the scaled body. */
  y: number
}

export interface MeshScaling {
  /** Which reference body was used: `male-young`, `female-young`. */
  body: string
  /** Vertical scale applied, from the request's own vertical measurements. */
  verticalScale: number
  /** The finished height, in metres. */
  stature: number
  bands: BodyBand[]
  /** Anything the caller should show the user rather than swallow. */
  warnings: string[]
}

/**
 * A scaled reference body.
 *
 * `positions` is a flat `[x, y, z, …]` in metres, Y-up, right-handed, with the
 * feet at `y = 0` and the body centred on `x = 0` — so a landmark's height is
 * directly comparable with a measurement. `indices` is a flat triangle list.
 *
 * `landmarks` and `scaling` ride on the mesh rather than being returned beside
 * it, because §6.5 hands the SceneBundle a `TriangleMesh` and `fit` needs the
 * landmarks too: `avatar` survives the deletion test on the strength of two
 * callers, and both of them want the same object.
 */
export interface TriangleMesh {
  positions: Float64Array
  indices: Uint32Array
  landmarks: Landmark[]
  scaling: MeshScaling
}

export interface Boundaries {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * A reference body as `scripts/build-bodies.py` writes it.
 *
 * `joints` and `bodyRange` come from the mesh's named vertex groups, not from
 * measuring the silhouette. They are what makes an anchor a fact: the rig says
 * where the pelvis is, so nothing has to infer it from where the body is
 * narrowest.
 */
export interface ReferenceBody {
  schemaVersion: 1
  /** `male-young`. */
  id: string
  gender: string
  /** The mesh's own height in metres, before any scaling. */
  height: number
  scales: number[]
  vertexCount: number
  triangleCount: number
  /** `[first, last]` vertices of the body itself, excluding eyes, teeth, and hair helpers. */
  bodyRange: [number, number]
  /** Rig joint positions, in the mesh's own frame. */
  joints: Record<string, [number, number, number]>
  positions: Float64Array
  indices: Uint32Array
}

/**
 * The three torso bands, each pinned to a rig joint rather than to a window of
 * heights. The correspondence is anthropometric: the upper spine joint is the
 * chest, the third is the natural waist, the pelvis is the seat.
 *
 * Only the torso is banded. Limbs and head scale with the vertical scale alone,
 * which is the honest limit of "per-region non-uniform scaling" without morphing
 * — see technical design §7.4.
 */
export const TORSO_BANDS: Array<{ region: string; measurement: string; joint: string }> = [
  { region: 'chest', measurement: 'chest', joint: 'joint-spine-1' },
  { region: 'waist', measurement: 'waist', joint: 'joint-spine-3' },
  { region: 'hips', measurement: 'hips', joint: 'joint-pelvis' },
]

/** The joints `build` needs to find. Missing ones are a warning, not a crash. */
export const REQUIRED_JOINTS = [
  'joint-neck',
  'joint-l-shoulder',
  'joint-r-shoulder',
  ...TORSO_BANDS.map((band) => band.joint),
]

// There is deliberately no options object. The three shipped variants are a
// uniform scale of the reference body, and a uniform scale is the caller's
// business — `avatar`'s job is the measurement-driven scaling §7.4 describes,
// and mixing the two in one function is how a band's level ends up in a
// different frame from the vertices it is scaling.
