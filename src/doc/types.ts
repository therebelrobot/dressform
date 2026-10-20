// The `doc` module's contracts.
//
// `Document`, `Node`, `Formula`, `Span`, `ProjectFile`, and `Refusal` are
// `docs/editor-spec.md` §3, §4.3 and §5, fixed before implementation began.
// Two fields are typed `| null` here where the spec writes a bare value —
// `PointNode.value` and `Formula.evaluated` — because `doc` does not evaluate.
// Filling them is the evaluator's job, and the evaluator is the emitted code;
// see §10 of the editor spec. `doc` never computes geometry, which is what
// keeps the preview from diverging from what ships.

import type { SeamMap } from '../seamgraph/types'

/** `n:front.shoulder`. Built from the part name and the binding; never an index. */
export type NodeId = string

/** Where a node lives in the source: `points.shoulder`. */
export type Binding = string

/**
 * Why the editor declines to model or emit something. A closed set: a refusal
 * the UI cannot name is a refusal the user cannot act on.
 */
export type RefusalReason =
  | 'loop' // for / while / do
  | 'conditional-topology' // if / switch / ternary that changes what is built
  | 'unknown-call' // a call outside the primitive vocabulary
  | 'computed-name' // points['cp' + i]
  | 'template-literal'
  | 'cross-part-store' // store.get(...) / store.set(...)
  | 'dynamic-macro' // a macro() whose output the model cannot see
  | 'unrepresentable-syntax'

/** A source range. Offsets are into the document's source text. */
export interface Span {
  start: number
  end: number
  /** 1-based, for diagnostics. */
  startLine: number
  endLine: number
}

/**
 * Recast's AST nodes are untyped. This is the shape `doc` reads, and the index
 * signature is what lets a visitor reach children without a cast at every step.
 */
export interface AstNode {
  type: string
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null
  start?: number | null
  end?: number | null
  [key: string]: unknown
}

export interface SourceFile extends AstNode {
  type: 'File'
}

/**
 * The expression that computes a node, and what it came out as.
 *
 * `source` is kept beside the AST node rather than derived from it: it is what
 * round-trips, and reprinting an expression we did not change must produce the
 * same bytes it arrived as.
 */
export interface Formula {
  expr: AstNode
  source: string
  /** Filled by the evaluator, which is the emitted code. Null until then. */
  evaluated: number | number[] | null
}

/** How a point was made. One per row of the primitive vocabulary. */
export type PointCtor = 'ctor' | 'shift' | 'rotate' | 'translate'

/**
 * A point.
 *
 * `args` is the whole argument list of `via`, *including the receiver* for the
 * method forms: `shift` carries `[receiver, angle, distance]`, `ctor` carries
 * `[x, y]`. Without the receiver in `args` the node could not be printed, and
 * the spec's `args: Formula[]` has no other field for it.
 */
export interface PointNode {
  kind: 'point'
  id: NodeId
  binding: Binding
  via: PointCtor
  args: Formula[]
  value: [number, number] | null
  span: Span
}

export type PathOpType = 'move' | 'line' | 'curve' | 'close' | 'offset'

export type PathOp =
  | { type: 'move'; to: Formula }
  | { type: 'line'; to: Formula }
  | { type: 'curve'; cp1: Formula; cp2: Formula; to: Formula }
  | { type: 'close' }
  | { type: 'offset'; distance: Formula }

/** One evaluated piece of a path. */
export interface Segment {
  type: PathOpType
  points: Array<[number, number]>
}

export interface PathNode {
  kind: 'path'
  id: NodeId
  binding: Binding
  ops: PathOp[]
  value: Segment[] | null
  span: Span
}

export interface OpaqueNode {
  kind: 'opaque'
  id: NodeId
  span: Span
  /** The original source, verbatim. */
  bytes: string
  reason: RefusalReason
}

export type Node = PointNode | PathNode | OpaqueNode

export type DocumentState = 'modelled' | 'partial' | 'unmodelled'

export interface Document {
  schemaVersion: 1
  /** A single word, `[a-z]` only. */
  design: string
  units: 'mm'
  /** The parsed root, Recast-compatible. Canonical. */
  tree: SourceFile
  /** Derived index over `tree`. Never the source of truth. */
  nodes: Map<NodeId, Node>
  seams: SeamMap
  settings: { measurements: Record<string, number>; options: Record<string, unknown> }
}

/**
 * A refusal is a value, not an exception: callers decide whether it degrades to
 * inspector mode or blocks the operation.
 */
export interface Refusal {
  kind: RefusalReason
  message: string
  spans: Span[]
  suggestion?: string
}

export interface ProjectFile {
  schemaVersion: 1
  /** The tree as source text — what Recast round-trips faithfully — plus nodes. */
  document: { design: string; units: 'mm'; source: string; seams: SeamMap; settings: Document['settings'] }
  /** The `.mjs` last emitted, for diffing. */
  exportedSource: string | null
}

// ---------------------------------------------------------------------------
// Operations. `apply(doc, op)` is the only mutation path (editor spec §4.2).
// ---------------------------------------------------------------------------

export interface SetNodeFormulaOp {
  op: 'setFormula'
  id: NodeId
  /**
   * Which entry of `PointNode.args` to rewrite. `args` carries the receiver at
   * index 0 for the method forms, so `shift(angle, distance)` rewrites 1 and 2.
   */
  index: number
  /** The rewritten formula, as source. */
  source: string
}

export interface SetPathOpOp {
  op: 'setPathOp'
  id: NodeId
  /** Which op in the chain — its endpoint, or an offset's distance. */
  index: number
  /** The rewritten formula, as source. */
  source: string
}

export interface AddNodeOp {
  op: 'addNode'
  /** Where the new node's region is inserted: after this node, or at the end. */
  after: NodeId | null
  binding: Binding
  /** The statement to emit, as source. */
  source: string
}

export interface RemoveNodeOp {
  op: 'removeNode'
  id: NodeId
}

export interface RenameNodeOp {
  op: 'renameNode'
  id: NodeId
  /** The new binding property name — `waist`, not `points.waist`. */
  to: string
}

export interface SetMeasurementOp {
  op: 'setMeasurement'
  name: string
  value: number
}

export interface SetOptionOp {
  op: 'setOption'
  name: string
  value: unknown
}

export type Op =
  | SetNodeFormulaOp
  | SetPathOpOp
  | AddNodeOp
  | RemoveNodeOp
  | RenameNodeOp
  | SetMeasurementOp
  | SetOptionOp

/** What `open` answers: a document, or the reason it declined. */
export type OpenResult =
  | { ok: true; document: Document }
  | { ok: false; refusal: Refusal }

/** What `apply` answers. A refused op leaves the document untouched. */
export type ApplyResult =
  | { ok: true; document: Document }
  | { ok: false; refusal: Refusal }
