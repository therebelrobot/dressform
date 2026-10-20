// The derived node index — editor spec §3 and §3.1.
//
// `tree` is canonical; `nodes` is rebuilt on parse and updated on apply. It is
// never the source of truth, and a disagreement between `nodes` and `tree` is a
// bug in `nodes`.
//
// Two things identify a node and they do different jobs: the **binding**
// (`points.shoulder`) is the human-facing identity and the primary key, and the
// **id** (`n:front.shoulder`) is derived from the binding and carried in the
// fence. An index is never an identity — indices shift across edits and
// silently corrupt a seam map.

import { lineOffsets, readRegions, spanOfLines, type Region } from './fence'
import { expressionReason, refusalReason } from './opacity'
import { readBinding, readStatement } from './primitives'
import type {
  AstNode,
  Formula,
  Node,
  NodeId,
  PathNode,
  PointNode,
  Refusal,
  RefusalReason,
  Span,
} from './types'

/**
 * The vocabulary can accept a statement whose *formulas* are still not
 * representable — `new Point(0, macro('x'))` is a well-formed constructor call
 * and an unmodellable node at the same time. So the formulas are checked
 * separately, and a hit makes the region opaque rather than letting the editor
 * believe it owns something it cannot reprint.
 */
const formulaReason = (node: PointNode | PathNode): RefusalReason | null => {
  const formulas: Formula[] =
    node.kind === 'point'
      ? node.args
      : node.ops.flatMap((op) =>
          op.type === 'curve'
            ? [op.cp1, op.cp2, op.to]
            : op.type === 'close'
              ? []
              : op.type === 'offset'
                ? [op.distance]
                : [op.to],
        )

  for (const item of formulas) {
    const reason = expressionReason(item.expr)
    if (reason !== null) return reason
  }
  return null
}

const STATEMENT_TYPES = new Set([
  'ExpressionStatement',
  'VariableDeclaration',
  'ReturnStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'IfStatement',
  'SwitchStatement',
  'TryStatement',
  'FunctionDeclaration',
  'ThrowStatement',
])

const isAnyNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'

const childrenOf = (node: AstNode): AstNode[] => {
  const out: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') continue
    if (isAnyNode(value)) out.push(value)
    else if (Array.isArray(value)) for (const entry of value) if (isAnyNode(entry)) out.push(entry)
  }
  return out
}

const lineOf = (node: AstNode): { startLine: number; endLine: number } | null => {
  const loc = node.loc
  if (loc === undefined || loc === null) return null
  return { startLine: loc.start.line, endLine: loc.end.line }
}

interface Positioned {
  node: AstNode
  startLine: number
  endLine: number
  depth: number
}

/** Every statement in the file, with its nesting depth among statements. */
const statements = (tree: AstNode): Positioned[] => {
  const out: Positioned[] = []
  const walk = (node: AstNode, depth: number): void => {
    const isStatement = STATEMENT_TYPES.has(node.type)
    const lines = lineOf(node)
    if (isStatement && lines !== null) out.push({ node, ...lines, depth })
    for (const child of childrenOf(node)) walk(child, isStatement ? depth + 1 : depth)
  }
  walk(tree, 0)
  return out
}

export interface PartBody {
  /** The design, from the prefix of `name: 'aaron.front'`. Null when undeclared. */
  design: string | null
  /** The part's local name — `front`. */
  part: string
  startLine: number
  endLine: number
}

/** A function's block body, whether it is written `draft: () => {}` or `draft() {}`. */
const bodyOf = (value: unknown): AstNode | null => {
  if (!isAnyNode(value)) return null
  const candidate = value['body']
  if (isAnyNode(candidate) && candidate.type === 'BlockStatement') return candidate
  return null
}

/** Every `draft` function body, with what its own object declares about itself. */
export const partBodies = (tree: AstNode): PartBody[] => {
  const out: PartBody[] = []
  const walk = (node: AstNode): void => {
    if (node.type === 'ObjectExpression') {
      const properties = Array.isArray(node['properties']) ? (node['properties'] as AstNode[]) : []
      let declared: string | null = null
      let body: AstNode | null = null

      for (const property of properties) {
        const key = property['key']
        const name = isAnyNode(key) && typeof key['name'] === 'string' ? key['name'] : null
        if (name === 'name') {
          const value = property['value']
          if (isAnyNode(value) && typeof value['value'] === 'string') declared = value['value']
        }
        if (name === 'draft') body = bodyOf(property['value'])
      }

      if (body !== null) {
        const lines = lineOf(body)
        if (lines !== null) {
          const dot = declared?.indexOf('.') ?? -1
          out.push({
            design: declared !== null && dot > 0 ? declared.slice(0, dot) : null,
            part: declared !== null && dot > 0 ? declared.slice(dot + 1) : (declared ?? 'part'),
            ...lines,
          })
        }
      }
    }
    for (const child of childrenOf(node)) walk(child)
  }
  walk(tree)
  return out
}

const scrubbed = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, '')

/**
 * The design's name — `aaron`. It is written once, in the prefix of a part's
 * `name`, so it is read rather than guessed. The contract requires a single
 * `[a-z]`-only word, so anything else is scrubbed.
 */
export const designName = (tree: AstNode): string => {
  for (const body of partBodies(tree)) {
    if (body.design === null) continue
    const name = scrubbed(body.design)
    if (name.length > 0) return name
  }

  let exported: string | null = null
  const walk = (node: AstNode): void => {
    if (exported !== null) return
    if (node.type === 'VariableDeclarator') {
      const id = node['id']
      if (isAnyNode(id) && typeof id['name'] === 'string') exported = id['name']
    }
    for (const child of childrenOf(node)) walk(child)
  }
  walk(tree)

  const name = scrubbed(exported ?? '')
  return name.length > 0 ? name : 'design'
}

export interface Indexed {
  nodes: Map<NodeId, Node>
  regions: Region[]
  /** One per region the vocabulary declined, in document order. */
  refusals: Refusal[]
  /** Set when the fences themselves are malformed — an unrepresentable document. */
  fenceRefusal: Refusal | null
}

/** The design a region belongs to, by containment, falling back to the last one before it. */
const partFor = (bodies: PartBody[], region: Region, fallback: string): string => {
  const containing = bodies.find(
    (body) => body.startLine <= region.bodyStartLine && body.endLine >= region.bodyEndLine,
  )
  if (containing !== undefined) return containing.part
  const preceding = bodies.filter((body) => body.startLine < region.bodyStartLine).pop()
  return preceding?.part ?? fallback
}

/**
 * Build the node index from the tree and the fences.
 *
 * A region whose body is exactly one statement, expressed in the primitive
 * vocabulary, is a modelled node. Anything else is opaque, with the reason the
 * offending construct names. A region that is opaque keeps its bytes verbatim;
 * nothing here rewrites anything.
 */
export const buildNodes = (source: string, tree: AstNode, regions: Region[]): Indexed => {
  const starts = lineOffsets(source)
  const bodies = partBodies(tree)
  const all = statements(tree)
  const fallback = designName(tree)
  const nodes = new Map<NodeId, Node>()
  const refusals: Refusal[] = []

  for (const region of regions) {
    const part = partFor(bodies, region, fallback)
    const inside = all.filter(
      (entry) => entry.startLine >= region.bodyStartLine && entry.endLine <= region.bodyEndLine,
    )
    const shallowest = inside.reduce<number | null>(
      (least, entry) => (least === null || entry.depth < least ? entry.depth : least),
      null,
    )
    const top = inside.filter((entry) => entry.depth === shallowest)
    const span = spanOfLines(starts, source, region.bodyStartLine, region.bodyEndLine)
    const bytes = source.slice(span.start, span.end)

    const only = top.length === 1 ? top[0] : undefined
    const boundary = only === undefined ? null : readBinding(only.node)

    let node: Node | null = null
    if (only !== undefined && boundary !== null) {
      node = readStatement(only.node, {
        id: `n:${part}.${boundary.property}`,
        binding: `${boundary.object}.${boundary.property}`,
        span,
      })
    }

    const modelled: PointNode | PathNode | null =
      node !== null && (node.kind === 'point' || node.kind === 'path') ? node : null
    const inFormulas = modelled === null ? null : formulaReason(modelled)

    if (modelled !== null && inFormulas === null) {
      nodes.set(modelled.id, modelled)
      continue
    }

    // Opaque. The region is not the editor's to rewrite, so its bytes are kept.
    const reason =
      inFormulas ??
      (only === undefined ? 'unrepresentable-syntax' : refusalReason(only.node))
    const id = boundary !== null ? `n:${part}.${boundary.property}` : `n:${part}.region@${region.openLine}`
    const opaque: Node = { kind: 'opaque', id, span: span as Span, bytes, reason }
    nodes.set(id, opaque)
    refusals.push({
      kind: reason,
      message:
        only === undefined
          ? `region \`${region.id}\` holds ${top.length} statements; the editor models one node per region`
          : `region \`${region.id}\` is not a construction the editor can model`,
      spans: [span],
      suggestion: 'The bytes are preserved; edit them in a text editor.',
    })
  }

  return { nodes, regions, refusals, fenceRefusal: null }
}

/** Read the fences and the node index together. */
export const indexSource = (source: string, tree: AstNode): Indexed => {
  const { regions, refusal } = readRegions(source)
  if (refusal !== null) {
    return { nodes: new Map(), regions: [], refusals: [refusal], fenceRefusal: refusal }
  }
  return buildNodes(source, tree, regions)
}
