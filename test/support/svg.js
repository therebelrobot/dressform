// A small SVG reader, for one job: find every `<path d="…">` in a rendered
// pattern, group them by the part they belong to, and measure them.
//
// This is deliberately a second, independent implementation of curve length:
// a dense polyline sample of the curve the SVG actually carries. If it agrees
// with `DraftResult.pathLengths` to within 0.1 mm, then `pathLengths` describes
// the drawing rather than a tessellation of it — which is the whole point of
// the acceptance criterion in the product brief §7.

/** Every tag with the given name, as raw text. Attribute values here never contain `>`. */
const tagsNamed = (svg, name) => {
  const out = []
  const re = new RegExp(`<${name}\\b`, 'g')
  let match
  while ((match = re.exec(svg)) !== null) {
    const end = svg.indexOf('>', match.index)
    out.push({ start: match.index, text: svg.slice(match.index, end + 1) })
  }
  return out
}

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? match[1] : null
}

/**
 * The `d` attribute of each path, keyed by the FreeSewing part name the group
 * belongs to (`aaron.front`), in document order.
 */
export const pathsByPart = (svg) => {
  const groups = tagsNamed(svg, 'g')
    .map((tag) => ({ ...tag, id: attribute(tag.text, 'id') }))
    .filter((tag) => tag.id !== null && tag.id.includes('-part-'))
    .map((tag) => ({ start: tag.start, part: tag.id.slice(tag.id.lastIndexOf('-part-') + 6) }))

  const byPart = new Map(groups.map((group) => [group.part, []]))

  for (const path of tagsNamed(svg, 'path')) {
    let owner = null
    for (const group of groups) if (group.start < path.start) owner = group.part
    if (owner === null) continue
    const d = attribute(path.text, 'd')
    if (d !== null) byPart.get(owner).push(d)
  }

  return byPart
}

const NUMBERS = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

const commands = (d) => {
  const out = []
  const re = /([A-Za-z])([^A-Za-z]*)/g
  let match
  while ((match = re.exec(d)) !== null) {
    out.push({ op: match[1].toUpperCase(), args: (match[2].match(NUMBERS) ?? []).map(Number) })
  }
  return out
}

/**
 * The length of an SVG path, measured by walking it. Curves are sampled densely
 * enough that the sampling error is orders of magnitude below the tolerance the
 * test asserts.
 */
export const pathLength = (d, samples = 512) => {
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let total = 0

  const lineTo = (nx, ny) => {
    total += Math.hypot(nx - x, ny - y)
    x = nx
    y = ny
  }

  const curveTo = (x1, y1, x2, y2, nx, ny) => {
    const fromX = x
    const fromY = y
    let previousX = fromX
    let previousY = fromY
    for (let i = 1; i <= samples; i++) {
      const t = i / samples
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const c = 3 * u * t * t
      const e = t * t * t
      const px = a * fromX + b * x1 + c * x2 + e * nx
      const py = a * fromY + b * y1 + c * y2 + e * ny
      total += Math.hypot(px - previousX, py - previousY)
      previousX = px
      previousY = py
    }
    x = nx
    y = ny
  }

  for (const { op, args } of commands(d)) {
    for (let i = 0; i < args.length; i += op === 'C' ? 6 : 2) {
      if (op === 'M') {
        x = args[i]
        y = args[i + 1]
        startX = x
        startY = y
      } else if (op === 'L' || op === 'H' || op === 'V') {
        if (op === 'H') lineTo(args[i], y)
        else if (op === 'V') lineTo(x, args[i])
        else lineTo(args[i], args[i + 1])
      } else if (op === 'C') {
        curveTo(args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], args[i + 5])
      } else if (op === 'Z') {
        lineTo(startX, startY)
      }
    }
  }

  return total
}
