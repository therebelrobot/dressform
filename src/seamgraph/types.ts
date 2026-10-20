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
