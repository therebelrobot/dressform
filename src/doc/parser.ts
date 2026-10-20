// Recast drives both directions of `doc`. This file is the parser half.
//
// Recast 0.24.0's own `recast/parsers/babel` asks `@babel/parser` 8 for
// `pipelineOperator: { proposal: 'minimal' }`, and Babel 8 rejects that option
// outright, so the two packages do not work together as shipped. Recast
// documents the escape: supply your own parser object. Babel 8 enables modern
// syntax by default, so the plugin list is empty — verified against FreeSewing's
// own idiom, including template literals, optional chaining, and nullish
// coalescing. `tokens: true` matters: without `ast.tokens` recast falls back to
// esprima's tokenizer, which cannot read modern syntax and would misalign every
// node.
//
// Editor spec §13.1 asked for this to be settled before `doc` was built on top
// of it. It was: see `test/roundtrip.test.js`.

import { parse as babelParse } from '@babel/parser'
import * as recast from 'recast'
import type { AstNode, SourceFile } from './types'

const parser = {
  parse(source: string): AstNode {
    return babelParse(source, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      tokens: true,
    }) as unknown as AstNode
  },
}

const bare = (source: string): AstNode =>
  babelParse(source, {
    sourceType: 'module',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    tokens: true,
  }) as unknown as AstNode

/** Parse source into a Recast-compatible tree, or throw. Callers catch and refuse. */
export const parseSource = (source: string): SourceFile =>
  recast.parse(source, { parser }) as unknown as SourceFile

/**
 * Parse a fragment the editor produced — a formula, or a whole statement.
 *
 * Fragments have no original position, so recast formats them rather than
 * reproducing them. That is correct: a fragment is new text, and there is
 * nothing to reproduce.
 */
export const parseExpression = (source: string): AstNode => {
  const file = bare(`const __fragment = ${source}\n`)
  const statement = (file['program'] as AstNode)['body'] as AstNode[]
  const declaration = statement[0]?.['declarations'] as AstNode[] | undefined
  const init = declaration?.[0]?.['init']
  if (init === undefined || init === null || typeof init !== 'object') {
    throw new Error(`could not parse the expression \`${source}\``)
  }
  return init as AstNode
}

/** Parse one statement. Throws when the source is not exactly one statement. */
export const parseStatement = (source: string): AstNode => {
  const file = bare(source)
  const body = (file['program'] as AstNode)['body'] as AstNode[] | undefined
  const first = body?.[0]
  if (body?.length !== 1 || first === undefined) {
    throw new Error(`expected exactly one statement, got \`${source}\``)
  }
  return first
}

/**
 * Print any node. Recast reprints only what changed and copies everything else
 * through verbatim, which is the entire round-trip mechanism (editor spec §4).
 * An unmodified tree prints byte-identically to its input.
 */
export const printAst = (node: AstNode): string => recast.print(node as never).code

export const printTree = (tree: SourceFile): string => printAst(tree)

export { recast }
