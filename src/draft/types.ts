// The `draft` module's public contracts.
//
// `DraftRequest` and `DraftResult` are `docs/technical-design.md` §6.1 and §6.2,
// fixed before implementation began. `DesignSummary`, `DesignDetail`, and the
// schema shapes they carry are what `GET /designs` and `GET /designs/:design`
// answer with; §6.4 names the routes and leaves the payload to this module.

/** §6.1. `sa` is a literal zero: simulation models net shapes. */
export interface DraftRequest {
  design: string
  measurements: Record<string, number>
  options?: Record<string, number | boolean | string>
  sa?: 0
}

/** A named path, as the 2D surface and the seam editor need it. */
export interface DraftPathGeometry {
  /** `armhole`, `neck`, `shoulder` — never an index. */
  path: string
  role: 'outline' | 'internal'
  /**
   * The path as a polyline, for rendering and hit-testing. Curves are sampled,
   * so this is *not* the length reference — `pathLengths` is.
   */
  points: Array<[number, number]>
}

/** §6.2. */
export interface DraftPiece {
  /** Stable, from FreeSewing's part name — `aaron.front`. */
  id: string
  /** The display name: the part name without its design prefix. */
  name: string
  /** The id of the piece this one mirrors, when the draft itself supplies it. */
  mirrorOf: string | null
  paths: DraftPathGeometry[]
  /** Millimetres, curve-accurate. The seam validator's reference. */
  pathLengths: Record<string, number>
  /** `at` is the fraction along `path`, in [0, 1]. */
  notches: Array<{ path: string; at: number }>
  grainline: { from: [number, number]; to: [number, number] } | null
  centroid: [number, number]
}

export type DraftWarningCode =
  /** A request option the design does not declare. */
  | 'option-ignored'
  /** A drafted part that is a piece but contributed no drawable path. */
  | 'part-without-paths'
  /** A declared grain angle that could not be turned into a segment. */
  | 'grainline-unresolved'

/**
 * Something worth telling the caller that did not stop the draft. Warnings are
 * values, not exceptions: a draft that drew everything is still a draft.
 */
export interface DraftWarning {
  code: DraftWarningCode
  message: string
  /** The piece the warning is about, when it is about one. */
  piece?: string
}

/** §6.2. */
export interface DraftResult {
  schemaVersion: 1
  design: string
  units: 'mm'
  /** In millimetres, from the laid-out pattern. */
  boundingBox: { width: number; height: number }
  pieces: DraftPiece[]
  svg: string
  warnings: DraftWarning[]
}

/** What a design looks like before you ask it for anything. */
export interface DesignSummary {
  name: string
  title: string
  description: string
  tags: string[]
}

/**
 * A design's declared options, in the design's own terms.
 *
 * `pct` options are declared as a percentage of a measurement, so `default: 8`
 * means 8 percent, not 8 millimetres — the same convention the design source
 * uses, kept rather than converted.
 */
export interface OptionSchema {
  name: string
  kind: 'pct' | 'bool' | 'number' | 'string' | 'unsupported'
  default: number | boolean | string | null
  min: number | null
  max: number | null
  menu: string | null
}

export interface MeasurementSchema {
  name: string
  /** Required measurements are named by the design; the rest are optional. */
  required: boolean
  unit: 'mm' | 'degrees'
}

export interface DesignDetail extends DesignSummary {
  version: string
  options: OptionSchema[]
  measurements: MeasurementSchema[]
}
