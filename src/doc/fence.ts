// The fence format — editor spec §4.1.
//
// Emitted source marks every region the editor owns with an ordinary line
// comment. A comment is the right container because it is valid JavaScript, it
// survives formatting, it is invisible in a diff that does not touch it, and it
// costs one line per node. The alternative — a separate mapping file — would
// drift the moment somebody edited the source in another editor, which is
// precisely the situation the fencing exists to survive.
//
// Regions are read and written in LINES, never in byte offsets. Recast expands
// tabs before it parses, so a node's column (and therefore its byte offset) can
// disagree with the original text; line numbers survive that expansion intact.
// Since a region is delimited by whole lines, lines are the correct unit.

import type { Refusal, Span } from './types'

export interface Region {
  id: string
  /** The region's own id, as read. */
  openLine: number
  /** First line of the body — the statement the region wraps. */
  bodyStartLine: number
  bodyEndLine: number
  closeLine: number
  /** The indentation the markers sit at, reused when the region is rewritten. */
  indent: string
}

const OPEN = /^([ \t]*)\/\/[ \t]*<dressform:region[ \t]+id="([^"]*)">[ \t]*$/
const CLOSE = /^([ \t]*)\/\/[ \t]*<\/dressform:region>[ \t]*$/

export const openMarker = (id: string, indent: string): string =>
  `${indent}// <dressform:region id="${id}">`

export const closeMarker = (indent: string): string => `${indent}// </dressform:region>`

/** Offsets of the first character of every line, 1-based by index. */
export const lineOffsets = (source: string): number[] => {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

/** A span covering whole lines. Line-aligned on purpose; see the note above. */
export const spanOfLines = (starts: number[], source: string, startLine: number, endLine: number): Span => {
  const start = starts[startLine - 1] ?? 0
  const lastStart = starts[endLine - 1] ?? start
  const newline = source.indexOf('\n', lastStart)
  return {
    start,
    end: newline === -1 ? source.length : newline,
    startLine,
    endLine,
  }
}

/**
 * Every fenced region in the source, in document order, or a refusal if the
 * fences themselves are malformed. A malformed fence is not recoverable: the
 * editor would not know which bytes it is allowed to rewrite.
 */
export const readRegions = (source: string): { regions: Region[]; refusal: Refusal | null } => {
  const lines = source.split('\n')
  const starts = lineOffsets(source)
  const regions: Region[] = []
  const open: Region[] = []
  let refusal: Refusal | null = null

  const refuse = (message: string, line: number): void => {
    refusal ??= {
      kind: 'unrepresentable-syntax',
      message,
      spans: [spanOfLines(starts, source, line, line)],
    }
  }

  lines.forEach((text, index) => {
    const lineNumber = index + 1
    const opened = OPEN.exec(text)
    if (opened !== null) {
      const indent = opened[1] ?? ''
      const region: Region = {
        id: opened[2] ?? '',
        openLine: lineNumber,
        bodyStartLine: lineNumber + 1,
        bodyEndLine: lineNumber,
        closeLine: lineNumber,
        indent,
      }
      // Rule 1: every modelled node is wrapped in exactly one region. Nesting
      // would break that, so it is a refusal rather than a puzzle.
      if (open.length > 0) refuse('a region is nested inside another region', lineNumber)
      open.push(region)
      regions.push(region)
      return
    }

    if (CLOSE.test(text)) {
      const region = open.pop()
      if (region === undefined) {
        refuse('a region is closed without being opened', lineNumber)
        return
      }
      region.bodyEndLine = lineNumber - 1
      region.closeLine = lineNumber
      if (region.bodyEndLine < region.bodyStartLine) {
        region.bodyEndLine = region.bodyStartLine - 1
      }
      return
    }
  })

  for (const unclosed of open) refuse(`region \`${unclosed.id}\` is never closed`, unclosed.openLine)

  return { regions, refusal }
}

/** The marker pair for a region, as it will be printed. */
export const renderFence = (id: string, body: string[], indent: string): string =>
  [openMarker(id, indent), ...body, closeMarker(indent)].join('\n')
