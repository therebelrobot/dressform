// The SeamMap contract — technical design §6.3, editor spec §9.
//
// The type lives here because `seamgraph` owns resolution; `doc` imports it
// because `Document.seams` is part of the document model. Nothing in this file
// resolves anything — that is `seamgraph/index.ts`, at M3.

/** One end of a seam. */
export interface SeamEndpoint {
  piece: string
  path: string
  /**
   * The sub-arc of the path this end covers, by arc-length parameter. One named
   * path can sew to two partners: a side seam interrupted by a dart, an armhole
   * shared between a sleeve and itself.
   */
  fraction: [number, number]
  /**
   * Seams run head-to-tail in opposite directions. Naming the reversal makes
   * the most common bug in garment simulation reviewable rather than invisible.
   */
  direction: 'forward' | 'reverse'
}

export interface SeamSpec {
  /** `shoulder.left` */
  id: string
  a: SeamEndpoint
  b: SeamEndpoint
  notes?: string
}

export interface SeamMap {
  schemaVersion: 1
  design: string
  units: 'mm'
  /** Millimetres. A longer mismatch than this is named before any simulation runs. */
  lengthTolerance: number
  /** Piece ids that exist twice on the body. The only place a piece is duplicated. */
  sides: { mirror: string[] }
  seams: SeamSpec[]
}

// ---------------------------------------------------------------------------
// What resolution produces. Technical design §4.1 names the interface
// `resolve(map, draft) → ResolvedSeams` and §6.3 fixes the input; the output
// shape is this module's, and it is what `place` and `sim` consume.
// ---------------------------------------------------------------------------

export interface ResolvedEdge {
  piece: string
  path: string
  /** The sub-arc, already in the seam's direction, as a polyline. */
  points: Array<[number, number]>
  /**
   * Curve-accurate arc length of the sub-arc, in millimetres — measured against
   * `DraftPiece.pathLengths`, never against the polyline.
   */
  length: number
  fraction: [number, number]
  direction: 'forward' | 'reverse'
}

/** Which copy of a mirrored piece this seam belongs to. Null when it is not mirrored. */
export type SeamSide = 'left' | 'right'

export interface ResolvedSeam {
  /** `shoulder.left`. A mirrored piece yields a second seam, `shoulder.right`. */
  id: string
  side: SeamSide | null
  a: ResolvedEdge
  b: ResolvedEdge
  /** `a.length − b.length`. The number the editor shows before anything is simulated. */
  lengthDelta: number
  verdict: 'ok' | 'mismatch'
}

/**
 * A seam that did not resolve. It always names the offending `piece.path`,
 * because "resolution failed" without a location is not actionable.
 */
export interface ResolutionFailure {
  seam: string
  piece: string
  path: string
  message: string
}

export interface ResolvedSeams {
  schemaVersion: 1
  design: string
  units: 'mm'
  lengthTolerance: number
  seams: ResolvedSeam[]
  failures: ResolutionFailure[]
  /** Names the mirrored pieces that were expanded, so the count is reviewable. */
  mirrored: string[]
}

/** The default tolerance, from technical design §6.3. */
export const DEFAULT_LENGTH_TOLERANCE = 2.0

export const emptySeamMap = (design: string): SeamMap => ({
  schemaVersion: 1,
  design,
  units: 'mm',
  lengthTolerance: DEFAULT_LENGTH_TOLERANCE,
  sides: { mirror: [] },
  seams: [],
})
