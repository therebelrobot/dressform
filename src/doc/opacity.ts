// The opacity boundary — editor spec §5.
//
// A region is opaque when its source span intersects a construct the model does
// not represent. Every rule here produces a *named* reason, because a refusal
// the UI cannot name is a refusal the user cannot act on.
//
// The detection is deliberately conservative. A conditional that only chooses a
// number — an ease value, say — is representable as a formula and stays
// editable; a conditional that chooses between two different path constructions
// is not, and goes opaque. Getting this boundary wrong in the permissive
// direction is how a tool silently destroys someone's work.

import type { AstNode, RefusalReason } from './types'

const isNode = (value: unknown, type: string): value is AstNode =>
  typeof value === 'object' && value !== null && (value as AstNode).type === type

const isAnyNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'

const children = (node: AstNode): AstNode[] => {
  const out: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') continue
    if (isAnyNode(value)) out.push(value)
    else if (Array.isArray(value)) for (const entry of value) if (isAnyNode(entry)) out.push(entry)
  }
  return out
}

/** Statement-level constructs. Each is opaque for its own named reason. */
export const statementReason = (statement: AstNode): RefusalReason | null => {
  switch (statement.type) {
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
      return 'loop'
    case 'IfStatement':
    case 'SwitchStatement':
      // A conditional that changes *what gets built* is not a formula.
      return 'conditional-topology'
    case 'ExpressionStatement':
      return null
    default:
      return 'unrepresentable-syntax'
  }
}

/**
 * Formula-level primitives — editor spec §7's formula rows.
 *
 * Anything else called inside a formula is `unknown-call`, which is what makes
 * `utils.*`, `macro`, and an arbitrary `Math.` helper opaque rather than
 * silently modelled.
 */
const FORMULA_METHODS = new Set(['distance', 'angle', 'shift', 'rotate', 'translate'])
const FORMULA_CONSTRUCTORS = new Set(['Point', 'Path'])
const STORE_METHODS = new Set(['get', 'set'])

const memberProperty = (node: unknown): string | null => {
  if (!isNode(node, 'MemberExpression') || node['computed'] === true) return null
  const property = node['property']
  return isNode(property, 'Identifier') && typeof property['name'] === 'string'
    ? property['name']
    : null
}

const objectName = (node: unknown): string | null => {
  if (!isNode(node, 'Identifier')) return null
  return typeof node['name'] === 'string' ? node['name'] : null
}

/**
 * The first named reason an expression is not representable, or null. Reason
 * order matters: a `store.get()` is reported as `cross-part-store` rather than
 * the `unknown-call` it also is, because the specific name is the actionable
 * one.
 */
export const expressionReason = (node: AstNode): RefusalReason | null => {
  if (isNode(node, 'TemplateLiteral')) return 'template-literal'

  if (isNode(node, 'SpreadElement') || isNode(node, 'RestElement')) return 'unrepresentable-syntax'
  if (isNode(node, 'ArrowFunctionExpression') || isNode(node, 'FunctionExpression')) {
    return 'unrepresentable-syntax'
  }

  // `points['cp' + i]` — a key the model cannot resolve to a binding.
  if (isNode(node, 'MemberExpression') && node['computed'] === true) {
    const property = node['property']
    if (!isNode(property, 'StringLiteral') && !isNode(property, 'Literal')) return 'computed-name'
  }

  if (isNode(node, 'CallExpression')) {
    const callee = node['callee']
    if (objectName(callee) === 'macro') return 'dynamic-macro'
    const onStore = objectName(isNode(callee, 'MemberExpression') ? callee['object'] : null)
    const method = memberProperty(callee)
    if (onStore === 'store' && method !== null && STORE_METHODS.has(method)) return 'cross-part-store'

    const called = objectName(callee) ?? method
    if (called !== null && !FORMULA_METHODS.has(called)) return 'unknown-call'
  }

  if (isNode(node, 'NewExpression')) {
    const called = objectName(node['callee'])
    if (called !== null && !FORMULA_CONSTRUCTORS.has(called)) return 'unknown-call'
  }

  for (const child of children(node)) {
    const reason = expressionReason(child)
    if (reason !== null) return reason
  }

  return null
}

/**
 * Why this statement is not a modelled node, given that the vocabulary already
 * declined it. The named reason if a specific construct caused it, `unknown-call`
 * otherwise — which is exactly what a foreign design full of FreeSewing API
 * calls is.
 */
export const refusalReason = (statement: AstNode): RefusalReason => {
  const atStatement = statementReason(statement)
  if (atStatement !== null) return atStatement
  return expressionReason(statement) ?? 'unknown-call'
}
