// The `draft` module.
//
// Interface: `draft(req: DraftRequest) → Promise<DraftResult>`, plus the design
// catalogue `GET /designs` and `GET /designs/:design` answer with.
//
// Depth: FreeSewing's version drift, the `parts`-vs-`stacks` shape, option
// interpolation, measurement defaults, Bézier → polyline tessellation, edge
// classification, and the net-shape (`sa: 0`) assertion all live behind that
// one call.
//
// Everything here reads the *drafted pattern objects*, not FreeSewing's
// rendered SVG, so path lengths come from real curves. The SVG is produced too
// — for printing — and `test/draft.test.js` cross-checks the two.

import { declaredOptions, designDetail, findDesign, listDesigns, type Design } from './designs'
import { DraftValidationError, type DraftFieldError } from './errors'
import {
  bounds,
  boundsCentre,
  polygonCentroid,
  segmentThrough,
  tessellate,
  type Box,
  type XY,
} from './geometry'
import type { FsCutlistEntry, FsPart, FsPath, FsPattern, FsSnippet, FsStore } from './freesewing'
import type {
  DesignDetail,
  DraftPiece,
  DraftPathGeometry,
  DraftRequest,
  DraftResult,
  DraftWarning,
} from './types'

export type {
  DesignDetail,
  DesignSummary,
  DraftPiece,
  DraftPathGeometry,
  DraftRequest,
  DraftResult,
  DraftWarning,
  DraftWarningCode,
  MeasurementSchema,
  OptionSchema,
} from './types'
export { DraftValidationError, type DraftFieldError } from './errors'
export type { Design } from './designs'
export { listDesigns }

/** `GET /designs/:design`, or undefined when the design is not registered. */
export const describeDesign = (name: string): DesignDetail | undefined => {
  const design = findDesign(name)
  return design === undefined ? undefined : designDetail(design)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

interface ValidatedRequest {
  design: Design
  measurements: Record<string, number>
  options: Record<string, number | boolean | string>
}

/**
 * The request, or a refusal naming every field that is wrong.
 *
 * The split this draws with the HTTP layer: a body that is not a JSON object is
 * malformed and the transport says so with a 400. A body that *is* a request
 * but asks for something the design cannot answer is a refusal, and it comes
 * back as a 422 carrying these fields.
 */
const validate = (request: DraftRequest): ValidatedRequest => {
  const body: unknown = request
  if (!isRecord(body)) {
    throw new DraftValidationError('the request is not an object', [
      { field: '', message: 'expected an object' },
    ])
  }

  const fields: DraftFieldError[] = []

  const designName = body['design']
  const named = typeof designName === 'string' && designName.length > 0
  if (!named) fields.push({ field: 'design', message: 'required, and must be a non-empty string' })
  const design = named ? findDesign(designName) : undefined
  if (named && design === undefined) {
    fields.push({ field: 'design', message: `no design named \`${designName}\`` })
  }

  const measurements: Record<string, number> = {}
  const supplied = body['measurements']
  if (!isRecord(supplied)) {
    fields.push({ field: 'measurements', message: 'required, and must be an object of millimetres' })
  } else {
    for (const [name, value] of Object.entries(supplied)) {
      if (typeof value === 'number' && Number.isFinite(value)) measurements[name] = value
      else fields.push({ field: `measurements.${name}`, message: 'must be a finite number' })
    }
    for (const name of design?.config.measurements ?? []) {
      if (measurements[name] === undefined) {
        fields.push({ field: `measurements.${name}`, message: 'required by this design' })
      }
    }
  }

  const options: Record<string, number | boolean | string> = {}
  const suppliedOptions = body['options']
  if (suppliedOptions !== undefined) {
    if (!isRecord(suppliedOptions)) {
      fields.push({ field: 'options', message: 'must be an object when present' })
    } else {
      for (const [name, value] of Object.entries(suppliedOptions)) {
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
          options[name] = value
        } else {
          fields.push({ field: `options.${name}`, message: 'must be a number, boolean, or string' })
        }
      }
    }
  }

  if (fields.length > 0 || design === undefined) {
    throw new DraftValidationError('the draft request was refused', fields)
  }
  return { design, measurements, options }
}

/**
 * Net shapes only. `sa` is a literal zero in the contract *and* a real setting
 * FreeSewing will happily resolve to something else, so it is checked rather
 * than trusted.
 */
const assertNetShape = (pattern: FsPattern): void => {
  for (const settings of pattern.settings ?? []) {
    if (settings.sa !== 0) {
      throw new Error(
        `draft: FreeSewing resolved sa to ${String(settings.sa)}; the adapter drafts net shapes only`,
      )
    }
  }
}

const draftFailures = (store: FsStore | undefined): string[] =>
  (store?.logs?.error ?? [])
    .map((entry) => String(entry))
    .filter((entry) => entry.length > 0 && entry !== 'undefined')

const classOf = (path: FsPath): string => {
  const declared = path.attributes.get('class')
  return typeof declared === 'string' ? declared : ''
}

const isOutline = (path: FsPath): boolean => classOf(path).split(/\s+/).includes('fabric')

const mirrorOf = (part: FsPart): string | null => {
  const declared = part.attributes.get('data-mirror')
  return typeof declared === 'string' && declared.length > 0 ? declared : null
}

/**
 * Where a notch sits on the path it marks, as a fraction.
 *
 * A snippet is anchored at a point; the path it belongs to is whichever one it
 * is nearest to, and the fraction is the arc-length position of its projection.
 * FreeSewing's own `projectPoint` does the projection, so the answer is exact
 * rather than nearest-sample.
 */
const notchesFor = (
  snippets: Record<string, FsSnippet>,
  paths: Array<{ name: string; path: FsPath; length: number }>,
): Array<{ path: string; at: number }> => {
  const out: Array<{ path: string; at: number }> = []

  for (const snippet of Object.values(snippets ?? {})) {
    if (snippet.def !== 'notch' && snippet.def !== 'bnotch') continue

    let best: { path: string; at: number; distance: number } | null = null
    for (const candidate of paths) {
      if (candidate.length <= 0) continue
      const onPath = candidate.path.projectPoint(snippet.anchor)
      if (onPath === null) continue
      const distance = Math.hypot(onPath.x - snippet.anchor.x, onPath.y - snippet.anchor.y)
      if (best !== null && distance >= best.distance) continue
      const along = candidate.path.measureAlong(onPath)
      best = {
        path: candidate.name,
        at: along === null ? 0 : clamp(along / candidate.length, 0, 1),
        distance,
      }
    }
    if (best !== null) out.push({ path: best.path, at: best.at })
  }

  return out
}

/** A piece's grainline: the declared grain angle, drawn as a segment through the piece. */
const grainlineFor = (
  entry: FsCutlistEntry | undefined,
  centre: XY,
  box: Box,
): DraftPiece['grainline'] => {
  const angle = entry?.grain
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null
  return segmentThrough(centre, angle, box)
}

const cutlistOf = (store: FsStore | undefined): Record<string, FsCutlistEntry> => {
  const raw = store?.get('cutlist')
  return isRecord(raw) ? (raw as Record<string, FsCutlistEntry>) : {}
}

const pieceOf = (
  partId: string,
  part: FsPart,
  cutlist: Record<string, FsCutlistEntry>,
): DraftPiece => {
  const paths: DraftPathGeometry[] = []
  const pathLengths: Record<string, number> = {}
  const measured: Array<{ name: string; path: FsPath; length: number }> = []
  const allPoints: XY[] = []
  let outline: XY[] = []

  for (const [name, path] of Object.entries(part.paths ?? {})) {
    if (path.hidden) continue
    const points = tessellate(path)
    const length = path.length()
    paths.push({ path: name, role: isOutline(path) ? 'outline' : 'internal', points })
    pathLengths[name] = length
    measured.push({ name, path, length })
    for (const point of points) allPoints.push(point)
    if (outline.length === 0 && isOutline(path)) outline = points
  }

  const box = bounds(allPoints)
  const shape = outline.length > 0 ? outline : allPoints
  const centroid = polygonCentroid(shape) ?? (box === null ? [0, 0] : boundsCentre(box))

  return {
    id: partId,
    name: partId.includes('.') ? partId.slice(partId.lastIndexOf('.') + 1) : partId,
    mirrorOf: mirrorOf(part),
    paths,
    pathLengths,
    notches: notchesFor(part.snippets, measured),
    grainline: box === null ? null : grainlineFor(cutlist[partId], centroid, box),
    centroid,
  }
}

const piecesOf = (
  pattern: FsPattern,
  store: FsStore | undefined,
  warnings: DraftWarning[],
): DraftPiece[] => {
  const drafted = pattern.parts?.[0] ?? {}
  const cutlist = cutlistOf(store)
  const pieces: DraftPiece[] = []

  for (const [partId, part] of Object.entries(drafted)) {
    if (pattern.__isPartHidden(partId)) continue
    const drawable = Object.values(part.paths ?? {}).some((path) => !path.hidden)
    if (!drawable) {
      warnings.push({
        code: 'part-without-paths',
        message: `part \`${partId}\` is a piece but drew no path`,
        piece: partId,
      })
      continue
    }
    pieces.push(pieceOf(partId, part, cutlist))
  }

  return pieces
}

export const draft = async (request: DraftRequest): Promise<DraftResult> => {
  const { design, measurements, options } = validate(request)
  const warnings: DraftWarning[] = []

  const declared = declaredOptions(design)
  for (const name of Object.keys(options)) {
    if (!declared.has(name)) {
      warnings.push({
        code: 'option-ignored',
        message: `\`${name}\` is not an option of \`${design.name}\`; ignored`,
      })
    }
  }

  const pattern = design.create({ sa: 0, measurements, options })
  pattern.draft()
  assertNetShape(pattern)

  const store = pattern.setStores?.[0]
  const failures = draftFailures(store)
  if (failures.length > 0) {
    throw new DraftValidationError(`\`${design.name}\` could not be drafted`, [
      { field: 'measurements', message: failures.slice(0, 5).join('; ') },
    ])
  }

  // `render()` is what lays the pattern out, so width and height only mean
  // anything once it has run.
  const svg = pattern.render()

  const pieces = piecesOf(pattern, store, warnings)
  if (pieces.length === 0) {
    throw new DraftValidationError(`\`${design.name}\` drafted no pieces`, [
      { field: 'design', message: 'the design produced nothing to draft' },
    ])
  }

  return {
    schemaVersion: 1,
    design: design.name,
    units: 'mm',
    boundingBox: { width: pattern.width, height: pattern.height },
    pieces,
    svg,
    warnings,
  }
}
