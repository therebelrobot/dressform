// The `doc` module — the deepest in the project.
//
// Interface: `open(src) → Document | Refusal` · `emit(doc) → src` ·
// `apply(doc, op) → Document`. Those three methods hide the entire round-trip
// problem: parsing, node identity, fence bookkeeping, opaque-region
// preservation, and rename propagation into the seam map.
//
// The governing invariant is **lossless or refuse** — never emit a Document the
// model cannot faithfully represent. The failure it prevents is specific: a user
// opens a design, the editor cannot represent their loop, they change a dart, it
// re-emits, and the loop is gone. Users abandon a tool the first time that
// happens.
//
// ## The fence ownership rule
//
// Recast attaches comments to nodes, and a fence marker is an ordinary comment.
// Measured against the installed versions, the rule is exact: **a statement's
// `comments` array is precisely the markers printed immediately above it.** So
// the second region's statement carries the first region's *closing* marker as
// well as its own *opening* marker, and a region's closing marker lives on
// whatever statement follows it.
//
// That makes the safe rewrite trivial and the inventive one catastrophic:
//
//   - Replacing a statement: copy the old node's `comments` array verbatim.
//   - Inventing fresh markers for a replaced statement: emits a file whose
//     regions are shuffled and duplicated. Verified against the installed
//     versions; do not do it.
//
// Structural changes therefore do not go through the comment machinery at all.
// They splice whole lines of the source and reparse, because the fence format is
// line-delimited and the source is the canonical document.

import { closeMarker, openMarker, readRegions, type Region } from './fence'
import { designName, indexSource } from './nodes'
import { parseExpression, parseSource, printTree, recast } from './parser'
import { bindingParts } from './primitives'
import { emptySeamMap } from '../seamgraph/types'
import type {
  ApplyResult,
  AstNode,
  Document,
  Node,
  NodeId,
  OpenResult,
  Op,
  PathNode,
  PointNode,
  Refusal,
} from './types'

export type {
  AddNodeOp,
  ApplyResult,
  Binding,
  Document,
  Formula,
  Node,
  NodeId,
  OpaqueNode,
  OpenResult,
  Op,
  PathNode,
  PathOp,
  PointCtor,
  PointNode,
  ProjectFile,
  Refusal,
  RefusalReason,
  RemoveNodeOp,
  RenameNodeOp,
  SetMeasurementOp,
  SetNodeFormulaOp,
  SetOptionOp,
  SetPathOpOp,
  SourceFile,
  Span,
} from './types'
export { readRegions, lineOffsets, openMarker, closeMarker } from './fence'
export type { Region } from './fence'
export { designName, partBodies } from './nodes'
export { emptySeamMap } from '../seamgraph/types'
export type { SeamEndpoint, SeamMap, SeamSpec } from '../seamgraph/types'

const refuse = (kind: Refusal['kind'], message: string, spans: Refusal['spans'] = []): Refusal => ({
  kind,
  message,
  spans,
})

const asTree = (document: Document): AstNode => document.tree as unknown as AstNode

/**
 * Open source as a Document, or decline and name the reason.
 *
 * A design the editor did not author has no fences, so it has no regions the
 * editor may rewrite. That is a refusal with `unknown-call` — the accurate
 * reason, since such a body is full of FreeSewing API calls outside the
 * vocabulary — and the caller degrades to inspector mode (§6.1's door rule).
 */
export const open = (source: string): OpenResult => {
  let tree: AstNode
  try {
    tree = parseSource(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      refusal: refuse('unrepresentable-syntax', `the source does not parse: ${message}`),
    }
  }

  const indexed = indexSource(source, tree)
  if (indexed.fenceRefusal !== null) return { ok: false, refusal: indexed.fenceRefusal }

  if (indexed.regions.length === 0) {
    return {
      ok: false,
      refusal: refuse(
        'unknown-call',
        'the source carries no editor regions, so the editor has nothing it may rewrite',
      ),
    }
  }

  const design = designName(tree)
  return {
    ok: true,
    document: {
      schemaVersion: 1,
      design,
      units: 'mm',
      tree: tree as Document['tree'],
      nodes: indexed.nodes,
      seams: emptySeamMap(design),
      settings: { measurements: {}, options: {} },
    },
  }
}

/**
 * Print the document. Recast reprints what changed and copies everything else
 * through byte-for-byte, so an unmodified document emits its own input exactly.
 */
export const emit = (document: Document): string => printTree(document.tree)

const isModelled = (node: Node | undefined): node is PointNode | PathNode =>
  node !== undefined && (node.kind === 'point' || node.kind === 'path')

const findStatement = (tree: AstNode, node: Node): AstNode | null => {
  let found: AstNode | null = null
  recast.types.visit(tree as never, {
    visitExpressionStatement(path) {
      const current = path.node as unknown as AstNode
      if (
        current.loc?.start.line === node.span.startLine &&
        current.loc?.end.line === node.span.endLine
      ) {
        found = current
        return false
      }
      this.traverse(path)
    },
  })
  return found
}

/**
 * Replace a statement, carrying its comments across.
 *
 * This is the fence ownership rule, applied: the old node's `comments` array is
 * exactly the markers that print above this statement, so copying it verbatim
 * reproduces the layout exactly — no more, no less. Inventing fresh markers
 * instead emits a file whose regions are shuffled and duplicated.
 *
 * Nothing in `apply` currently rebuilds a whole statement — formulas are
 * rewritten in place so the reprint stays minimal — but node creation at M5
 * needs it, and it is the rule that makes it safe.
 */
export const replaceStatement = (tree: AstNode, target: AstNode, replacement: AstNode): boolean => {
  let replaced = false
  recast.types.visit(tree as never, {
    visitExpressionStatement(path) {
      if ((path.node as unknown as AstNode) === target) {
        replacement['comments'] = target['comments'] ?? []
        path.replace(replacement as never)
        replaced = true
        return false
      }
      this.traverse(path)
    },
  })
  return replaced
}

/**
 * Rebuild the tree and the derived index after a mutation.
 *
 * The printed source is reparsed rather than the mutated tree being indexed
 * directly, because a statement built by `apply` carries no source position: it
 * has never been printed, so it has no `loc`, and the index — which works in
 * lines — cannot see it. Printing and reparsing gives every node a position
 * again, and printing an unmodified tree is byte-identical, so nothing else
 * moves.
 */
const reindex = (document: Document, tree: AstNode): Document => {
  const source = printTree(tree as unknown as Document['tree'])
  const reparsed = parseSource(source) as unknown as AstNode
  return {
    ...document,
    tree: reparsed as Document['tree'],
    nodes: indexSource(source, reparsed).nodes,
  }
}

const isAnyNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'

const rightOf = (statement: AstNode): AstNode | null => {
  const expression = statement['expression']
  if (!isAnyNode(expression)) return null
  const right = expression['right']
  return isAnyNode(right) ? right : null
}

/**
 * Rewrite one formula in place, leaving every other byte of the statement alone.
 *
 * This is deliberately *not* "rebuild the statement from the node model". A
 * rebuilt chain has no source position, so recast prints it from scratch — which
 * flattens an author's five-line `new Path().move().curve().close()` into one
 * line every time they drag a control point. Replacing the changed argument
 * inside the tree it came from keeps the reprint to the formula that actually
 * changed, which is what "no reformatting" has to mean in practice.
 */
const rewriteFormula = (
  document: Document,
  node: PointNode | PathNode,
  index: number,
  expr: AstNode,
): Document => {
  const tree = asTree(document)
  const target = findStatement(tree, node)
  if (target === null) throw new Error(`could not find the source statement for \`${node.id}\``)

  const right = rightOf(target)
  if (right === null) throw new Error(`\`${node.id}\` has no assignment to rewrite`)

  if (node.kind === 'point') {
    if (node.via === 'ctor' && right.type !== 'NewExpression') {
      throw new Error(`\`${node.id}\` is not written as a constructor call`)
    }
    if (node.via !== 'ctor' && right.type !== 'CallExpression') {
      throw new Error(`\`${node.id}\` is not written as a method call`)
    }
    const slots = right['arguments']
    if (!Array.isArray(slots)) throw new Error(`\`${node.id}\` has no argument list`)
    // The receiver is `args[0]` for the method forms and is not a call argument.
    const slot = node.via === 'ctor' ? index : index - 1
    if (slot < 0 || slot >= slots.length) throw new Error(`\`${node.id}\` has no argument at ${index}`)
    ;(slots as AstNode[])[slot] = expr
    return reindex(document, tree)
  }

  // Paths: descend the chain to the call that carries the op we are rewriting.
  let call: AstNode = right
  for (let position = node.ops.length - 1; position > index; position--) {
    const callee = call['callee']
    if (!isAnyNode(callee)) throw new Error(`\`${node.id}\` has a broken op chain`)
    const inner = callee['object']
    if (!isAnyNode(inner)) throw new Error(`\`${node.id}\` has a broken op chain`)
    call = inner
  }
  const slots = call['arguments']
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error(`op ${index} of \`${node.id}\` takes no formula`)
  }
  ;(slots as AstNode[])[0] = expr
  return reindex(document, tree)
}

const parseFormula = (source: string, where: string): AstNode => {
  try {
    return parseExpression(source)
  } catch (error) {
    throw new Error(`the formula for \`${where}\` does not parse: ${String(error)}`)
  }
}

const setFormula = (document: Document, id: string, index: number, source: string): Document => {
  const node = document.nodes.get(id)
  if (!isModelled(node) || node.kind !== 'point') {
    throw new Error(`\`${id}\` is not a modelled point; refusing to rewrite it`)
  }
  if (node.args[index] === undefined) throw new Error(`\`${id}\` has no argument at index ${index}`)
  return rewriteFormula(document, node, index, parseFormula(source, `${id} argument ${index}`))
}

const setPathOp = (document: Document, id: string, index: number, source: string): Document => {
  const node = document.nodes.get(id)
  if (!isModelled(node) || node.kind !== 'path') {
    throw new Error(`\`${id}\` is not a modelled path; refusing to rewrite it`)
  }
  const op = node.ops[index]
  if (op === undefined) throw new Error(`\`${id}\` has no op at index ${index}`)
  if (op.type === 'close') {
    throw new Error(`op ${index} of \`${id}\` is a \`close\`, which takes no formula`)
  }
  return rewriteFormula(document, node, index, parseFormula(source, `${id} op ${index}`))
}

// ---------------------------------------------------------------------------
// Structural ops: splice lines, then reparse.
// ---------------------------------------------------------------------------

const splice = (document: Document, atLine: number, insert: string[], dropLines = 0): Document => {
  const lines = printTree(document.tree).split('\n')
  const at = Math.max(0, Math.min(lines.length, atLine))
  lines.splice(at, dropLines, ...insert)
  const tree = parseSource(lines.join('\n')) as unknown as AstNode
  return reindex(document, tree)
}

const regionFor = (document: Document, id: NodeId, regions: Region[]): Region | undefined => {
  const node = document.nodes.get(id)
  if (node === undefined) return undefined
  return regions.find((region) => region.bodyStartLine === node.span.startLine)
}

const addNode = (document: Document, op: Extract<Op, { op: 'addNode' }>): Document => {
  const regions = readRegions(printTree(document.tree)).regions
  const anchor = op.after === null ? regions[regions.length - 1] : regionFor(document, op.after, regions)
  if (anchor === undefined) {
    throw new Error('there is no region to insert the new node after')
  }

  const property = bindingParts(op.binding)[1]
  if (property.length === 0) throw new Error(`\`${op.binding}\` is not a usable binding`)
  const part = anchor.id.slice(2, anchor.id.indexOf('.'))
  const body = op.source.trim()
  if (body.length === 0) throw new Error('the new node has no source')

  return splice(document, anchor.closeLine, [
    '',
    openMarker(`n:${part}.${property}`, anchor.indent),
    `${anchor.indent}${body}`,
    closeMarker(anchor.indent),
  ])
}

const removeNode = (document: Document, id: NodeId): Document => {
  const regions = readRegions(printTree(document.tree)).regions
  const region = regionFor(document, id, regions)
  if (region === undefined) throw new Error(`no region owns \`${id}\``)

  // Drop the region's open and close markers with it, plus the blank line above
  // it when one is there. Both markers belong to this region; leaving either
  // behind would orphan one.
  const lines = printTree(document.tree).split('\n')
  const before = lines[region.openLine - 2]
  const from = before !== undefined && before.trim() === '' ? region.openLine - 1 : region.openLine
  return splice(document, from - 1, [], region.closeLine - from + 1)
}

/**
 * Rename a node's binding — editor spec §6.2.
 *
 * Renaming has a blast radius beyond the source, which is why it is a `doc`
 * invariant rather than an editor nicety: seams reference bindings by name, so a
 * rename that is not followed orphans a seam silently. Every reference in the
 * tree is rewritten, the node id is re-keyed, and every `SeamSpec` reference
 * follows.
 *
 * If a reference sits inside an opaque region, the rename is **refused** and the
 * span is named. That is the honest outcome: renaming through a region the
 * editor cannot rewrite would orphan a seam, which is exactly the class of bug
 * the seam map exists to make visible.
 */
export const rename = (document: Document, id: NodeId, to: string): ApplyResult => {
  const node = document.nodes.get(id)
  if (!isModelled(node)) {
    return {
      ok: false,
      refusal: refuse('unrepresentable-syntax', `\`${id}\` is not a modelled node, so it cannot be renamed`),
    }
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(to)) {
    return { ok: false, refusal: refuse('computed-name', `\`${to}\` is not a usable binding name`) }
  }

  const [object, from] = bindingParts(node.binding)
  const tree = asTree(document)

  const opaque = [...document.nodes.values()].find(
    (candidate) =>
      candidate.kind === 'opaque' && candidate.bytes.includes(`${object}.${from}`),
  )
  if (opaque !== undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'unrepresentable-syntax',
        message: `\`${object}.${from}\` is referenced inside an opaque region, so renaming it would orphan a seam`,
        spans: [opaque.span],
        suggestion: 'Edit that region in a text editor, or leave the name alone.',
      },
    }
  }

  const target = findStatement(tree, node)
  if (target === null) {
    return { ok: false, refusal: refuse('unrepresentable-syntax', `no source statement for \`${id}\``) }
  }

  // 1 — rewrite every reference to the renamed binding in the tree.
  recast.types.visit(tree as never, {
    visitMemberExpression(path) {
      const current = path.node as unknown as AstNode
      const object0 = current['object']
      const property = current['property']
      const onObject =
        typeof object0 === 'object' && object0 !== null && (object0 as AstNode)['name'] === object
      const isFrom =
        typeof property === 'object' && property !== null && (property as AstNode)['name'] === from
      if (current['computed'] !== true && onObject && isFrom) {
        ;(property as AstNode)['name'] = to
      }
      this.traverse(path)
    },
  })

  // 2 — re-key the fence marker, which carries the id derived from the binding.
  const part = id.slice(2, id.indexOf('.'))
  const newId = `n:${part}.${to}`
  for (const comment of ((target['comments'] as AstNode[] | undefined) ?? [])) {
    if (typeof comment['value'] === 'string' && comment['value'].includes(`id="${id}"`)) {
      comment['value'] = comment['value'].replace(`id="${id}"`, `id="${newId}"`)
    }
  }

  // 3 — reparse, rebuild the index, then re-key the seams. Never orphan one.
  const source = printTree(tree as unknown as Document['tree'])
  const reparsed = parseSource(source) as unknown as AstNode
  const indexed = indexSource(source, reparsed)
  const nodes = new Map<NodeId, Node>()
  for (const [key, current] of indexed.nodes) {
    nodes.set(key === id ? newId : key, key === id ? { ...current, id: newId } : current)
  }

  const seams = {
    ...document.seams,
    seams: document.seams.seams.map((seam) => ({
      ...seam,
      a: seam.a.piece === object && seam.a.path === from ? { ...seam.a, path: to } : seam.a,
      b: seam.b.piece === object && seam.b.path === from ? { ...seam.b, path: to } : seam.b,
    })),
  }

  return {
    ok: true,
    document: { ...document, tree: reparsed as Document['tree'], nodes, seams },
  }
}

/**
 * The only mutation path — editor spec §4.2.
 *
 * 1. Applies the operation to `tree`.
 * 2. Rebuilds the affected `nodes` entries.
 * 3. Leaves the markers of every region it did not touch alone.
 * 4. Returns a new Document.
 *
 * A policy refusal — a rename through an opaque region — comes back as a Refusal
 * with the document untouched. An operation that cannot be performed at all also
 * comes back as a Refusal rather than throwing, because the editor must show the
 * user something.
 */
export const apply = (document: Document, op: Op): ApplyResult => {
  if (op.op === 'setMeasurement') {
    return {
      ok: true,
      document: {
        ...document,
        settings: {
          ...document.settings,
          measurements: { ...document.settings.measurements, [op.name]: op.value },
        },
      },
    }
  }

  if (op.op === 'setOption') {
    return {
      ok: true,
      document: {
        ...document,
        settings: {
          ...document.settings,
          options: { ...document.settings.options, [op.name]: op.value },
        },
      },
    }
  }

  if (op.op === 'renameNode') return rename(document, op.id, op.to)

  try {
    switch (op.op) {
      case 'setFormula':
        return { ok: true, document: setFormula(document, op.id, op.index, op.source) }
      case 'setPathOp':
        return { ok: true, document: setPathOp(document, op.id, op.index, op.source) }
      case 'addNode':
        return { ok: true, document: addNode(document, op) }
      case 'removeNode':
        return { ok: true, document: removeNode(document, op.id) }
      default:
        return { ok: false, refusal: refuse('unrepresentable-syntax', 'unknown operation') }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, refusal: refuse('unrepresentable-syntax', message) }
  }
}
