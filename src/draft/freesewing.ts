// The FreeSewing runtime shapes this module walks.
//
// FreeSewing ships no type declarations, so these are written by hand and held
// to the installed version by `test/draft.test.js`. They are deliberately
// structural and deliberately partial: they name only the facts the draft
// contract needs, and nothing in this file is re-exported as a public contract.
//
// `docs/technical-design.md` §13 records which of these were confirmed against
// the installed version and which remain assumptions.

export interface FsPoint {
  x: number
  y: number
}

export type FsOp =
  | { type: 'move'; to: FsPoint }
  | { type: 'line'; to: FsPoint }
  | { type: 'curve'; cp1: FsPoint; cp2: FsPoint; to: FsPoint }
  | { type: 'close' }

export interface FsPath {
  name: string | false
  hidden: boolean
  ops: FsOp[]
  attributes: { get(name: string): unknown }
  length(withMoves?: boolean): number
  divide(): FsPath[]
  start(): FsPoint
  /** The point on this path closest to `p`, or a point not on the path at all. */
  projectPoint(p: FsPoint): FsPoint
  /** Arc length from the start of the path to `p`, or null when `p` is off the path. */
  measureAlong(p: FsPoint): number | null
}

export interface FsSnippet {
  /** The id of the snippet in the SVG `defs` section: `notch`, `bnotch`, `logo`, … */
  def: string
  anchor: FsPoint
}

export interface FsPart {
  name: string
  stack: string
  hidden: boolean
  paths: Record<string, FsPath>
  points: Record<string, FsPoint>
  snippets: Record<string, FsSnippet>
  attributes: { get(name: string): unknown }
}

export interface FsStore {
  get(key: string): unknown
  logs: { warn: unknown[]; error: unknown[] }
}

export interface FsSettings {
  sa: number
  measurements: Record<string, number>
  options: Record<string, unknown>
  absoluteOptions: Record<string, number | null>
}

export interface FsPattern {
  settings: FsSettings[]
  /** Keyed by set index, then by part name. */
  parts: Record<string, Record<string, FsPart>>
  setStores: FsStore[]
  /** Set by layout, which happens during `render()`. Millimetres. */
  width: number
  height: number
  draft(): FsPattern
  render(): string
  /**
   * Private, and the only expression of "this part is a dependency, not a
   * piece": it consults both the design's `partHide` config and each drafted
   * part's own `hidden` flag. Reimplementing it here would be a second copy of
   * a rule this module does not own.
   */
  __isPartHidden(partName: string): boolean
}

export interface FsPatternConfig {
  /** Option defaults. A plain value is a constant; an object carries its own schema. */
  options: Record<string, unknown>
  /** Measurement names the design cannot draft without. */
  measurements: string[]
  /** Measurement names the design uses when present. */
  optionalMeasurements: string[]
  /** Parts that exist to be inherited from, and are never pieces. */
  partHide?: Record<string, boolean>
}

export interface FsPatternConstructor {
  new (settings: unknown): FsPattern
  patternConfig: FsPatternConfig
}

/** One part's cutting instructions, from the set store's `cutlist`. */
export interface FsCutlistEntry {
  /** The grain angle in degrees, FreeSewing's `Point.shift` convention. */
  grain?: number
  grainOrigin?: string
  /** The fold line, when the design declares a cut-on-fold. */
  cutOnFold?: [FsPoint, FsPoint]
}

export interface DesignAbout {
  id: string
  name: string
  description: string
  version: string
  tags?: string[]
}
