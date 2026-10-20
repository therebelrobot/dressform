// The primitive vocabulary — editor spec §7.
//
// The editor models a fixed set of construction primitives, chosen to mirror
// FreeSewing's API one-for-one. Every primitive it adds is one FreeSewing can
// already express, so the editor can never draw something the target cannot
// compile. Anything outside this table is `unknown-call` and goes opaque, and
// adding a primitive is a deliberate act with a test rather than an emergent
// consequence of supporting one more method.
//
// This file reads a statement out of the tree and prints one back. Printing
// reuses the original expression nodes, so a formula the user did not touch is
// reprinted by recast from its own source and comes back byte-identical.

import { printAst, recast } from './parser'
import type {
  AstNode,
  Binding,
  Formula,
  Node,
  NodeId,
  PathNode,
  PathOp,
  PointCtor,
  PointNode,
  Span,
} from './types'

const builders = recast.types.builders

/** §7. The point forms, and the method each one is written as. */
const POINT_METHODS: Record<string, PointCtor> = {
  shift: 'shift',
  rotate: 'rotate',
  translate: 'translate',
}

/** §7. The path ops, in the order they appear in a chain. */
const PATH_METHODS = new Set(['move', 'line', 'curve', 'close', 'offset'])

export interface StatementContext {
  id: NodeId
  binding: Binding
  span: Span
}

const isNode = (value: unknown, type: string): value is AstNode =>
  typeof value === 'object' && value !== null && (value as AstNode).type === type

const isAnyNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'

const identifierName = (node: unknown): string | null =>
  isNode(node, 'Identifier') && typeof node['name'] === 'string' ? node['name'] : null

const arrayOf = (value: unknown): AstNode[] => (Array.isArray(value) ? (value as AstNode[]) : [])

const formula = (expr: AstNode): Formula => ({
  expr,
  source: printAst(expr).trim(),
  // Geometry is the evaluator's job, and the evaluator is the emitted code.
  evaluated: null,
})

/** `<object>.<property> = …`, with a literal key. */
export const readBinding = (statement: AstNode): { object: string; property: string } | null => {
  if (!isNode(statement, 'ExpressionStatement')) return null
  const expression = statement['expression']
  if (!isNode(expression, 'AssignmentExpression') || expression['operator'] !== '=') return null
  const left = expression['left']
  if (!isNode(left, 'MemberExpression') || left['computed'] === true) return null
  const object = identifierName(left['object'])
  const property = identifierName(left['property'])
  if (object === null || property === null) return null
  return { object, property }
}

const rightHandSide = (statement: AstNode): AstNode | null => {
  if (!isNode(statement, 'ExpressionStatement')) return null
  const expression = statement['expression']
  if (!isNode(expression, 'AssignmentExpression')) return null
  const right = expression['right']
  return isAnyNode(right) ? right : null
}

const readPoint = (rhs: AstNode, context: StatementContext): PointNode | null => {
  if (isNode(rhs, 'NewExpression')) {
    if (identifierName(rhs['callee']) !== 'Point') return null
    const args = arrayOf(rhs['arguments'])
    if (args.length !== 2) return null
    return {
      kind: 'point',
      id: context.id,
      binding: context.binding,
      via: 'ctor',
      args: args.map(formula),
      value: null,
      span: context.span,
    }
  }

  if (!isNode(rhs, 'CallExpression')) return null
  const callee = rhs['callee']
  if (!isNode(callee, 'MemberExpression') || callee['computed'] === true) return null
  const method = identifierName(callee['property'])
  if (method === null) return null
  const via = POINT_METHODS[method]
  if (via === undefined) return null

  const receiver = callee['object']
  if (!isAnyNode(receiver)) return null
  const args = arrayOf(rhs['arguments'])
  // Every method form takes exactly two arguments: shift(angle, distance),
  // rotate(angle, origin), translate(dx, dy).
  if (args.length !== 2) return null

  return {
    kind: 'point',
    id: context.id,
    binding: context.binding,
    via,
    // The receiver travels in `args`: without it the node could not be printed,
    // and the contract gives `args` no other home for it.
    args: [formula(receiver), ...args.map(formula)],
    value: null,
    span: context.span,
  }
}

const readPath = (rhs: AstNode, context: StatementContext): PathNode | null => {
  const ops: PathOp[] = []
  let cursor: AstNode = rhs

  while (isNode(cursor, 'CallExpression')) {
    const callee = cursor['callee']
    if (!isNode(callee, 'MemberExpression') || callee['computed'] === true) return null
    const method = identifierName(callee['property'])
    if (method === null || !PATH_METHODS.has(method)) return null
    const args = arrayOf(cursor['arguments'])

    if (method === 'close') {
      if (args.length !== 0) return null
      ops.unshift({ type: 'close' })
    } else if (method === 'curve') {
      if (args.length !== 3) return null
      const [cp1, cp2, to] = args
      if (cp1 === undefined || cp2 === undefined || to === undefined) return null
      ops.unshift({ type: 'curve', cp1: formula(cp1), cp2: formula(cp2), to: formula(to) })
    } else if (method === 'offset') {
      if (args.length !== 1) return null
      const [distance] = args
      if (distance === undefined) return null
      ops.unshift({ type: 'offset', distance: formula(distance) })
    } else {
      if (args.length !== 1) return null
      const [to] = args
      if (to === undefined) return null
      ops.unshift({ type: method as 'move' | 'line', to: formula(to) })
    }

    cursor = callee['object'] as AstNode
  }

  // The chain has to bottom out at an empty `new Path()`.
  if (!isNode(cursor, 'NewExpression')) return null
  if (identifierName(cursor['callee']) !== 'Path') return null
  if (arrayOf(cursor['arguments']).length !== 0) return null
  if (ops.length === 0 || ops[0]?.type !== 'move') return null

  return {
    kind: 'path',
    id: context.id,
    binding: context.binding,
    ops,
    value: null,
    span: context.span,
  }
}

/** A statement as a modelled node, or null when it is outside the vocabulary. */
export const readStatement = (statement: AstNode, context: StatementContext): Node | null => {
  const boundary = readBinding(statement)
  if (boundary === null) return null
  const rhs = rightHandSide(statement)
  if (rhs === null) return null

  if (boundary.object === 'points') return readPoint(rhs, context)
  if (boundary.object === 'paths') return readPath(rhs, context)
  return null
}

// ---------------------------------------------------------------------------
// Printing a node back to a statement.
// ---------------------------------------------------------------------------

/** The binding a node owns, as `['points', 'shoulder']`. */
export const bindingParts = (binding: Binding): [string, string] => {
  const dot = binding.indexOf('.')
  return dot === -1 ? [binding, ''] : [binding.slice(0, dot), binding.slice(dot + 1)]
}

const member = (object: AstNode, property: string): AstNode =>
  builders.memberExpression(object as never, builders.identifier(property) as never) as unknown as AstNode

/**
 * The arguments to print. A `ctor` point has no receiver in `args`, so its
 * arguments are all of them; every method form keeps the receiver at index 0.
 */
const pointArguments = (node: PointNode): AstNode[] =>
  (node.via === 'ctor' ? node.args : node.args.slice(1)).map((arg) => arg.expr)

const statementOf = (left: AstNode, right: AstNode): AstNode =>
  builders.expressionStatement(
    builders.assignmentExpression('=', left as never, right as never) as never,
  ) as unknown as AstNode

/** The statement a modelled node is emitted as, as an AST node. */
export const printStatement = (node: PointNode | PathNode): AstNode => {
  const [object, property] = bindingParts(node.binding)
  const left = member(builders.identifier(object) as unknown as AstNode, property)

  if (node.kind === 'point') {
    if (node.via === 'ctor') {
      const right = builders.newExpression(
        builders.identifier('Point') as never,
        pointArguments(node) as never,
      ) as unknown as AstNode
      return statementOf(left, right)
    }
    const receiver = node.args[0]?.expr
    if (receiver === undefined) throw new Error(`point \`${node.id}\` has no receiver to print`)
    const right = builders.callExpression(
      member(receiver, node.via) as never,
      pointArguments(node) as never,
    ) as unknown as AstNode
    return statementOf(left, right)
  }

  let chain = builders.newExpression(builders.identifier('Path') as never, [] as never) as unknown as AstNode
  for (const op of node.ops) {
    if (op.type === 'close') {
      chain = builders.callExpression(member(chain, 'close') as never, [] as never) as unknown as AstNode
    } else if (op.type === 'curve') {
      chain = builders.callExpression(member(chain, 'curve') as never, [
        op.cp1.expr,
        op.cp2.expr,
        op.to.expr,
      ] as never) as unknown as AstNode
    } else if (op.type === 'offset') {
      chain = builders.callExpression(member(chain, 'offset') as never, [
        op.distance.expr,
      ] as never) as unknown as AstNode
    } else {
      chain = builders.callExpression(member(chain, op.type) as never, [
        op.to.expr,
      ] as never) as unknown as AstNode
    }
  }

  return statementOf(left, chain)
}

export { builders }
