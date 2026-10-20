// The design registry.
//
// v1 pins one design and registers it. There is no `PatternSource` interface
// and no plugin loader: the technical design §4.2 rules that `draft` is a
// hypothetical seam, and a one-implementation interface is a pass-through.
// Adding a design means adding a row here.

import { Aaron, about as aaronAbout } from '@freesewing/aaron'
import { degreeMeasurements } from '@freesewing/config'
import type {
  DesignAbout,
  FsPattern,
  FsPatternConfig,
  FsPatternConstructor,
} from './freesewing'
import type { DesignDetail, DesignSummary, MeasurementSchema, OptionSchema } from './types'

export interface Design {
  name: string
  summary: DesignSummary
  version: string
  config: FsPatternConfig
  create: (settings: unknown) => FsPattern
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const measureUnit = (name: string): 'mm' | 'degrees' =>
  degreeMeasurements.includes(name) ? 'degrees' : 'mm'

/**
 * One option, in the units a request uses.
 *
 * A `pct` option is authored as a percentage of a measurement but reaches
 * FreeSewing as a fraction: `{ pct: 8, min: 0, max: 20 }` resolves to a default
 * of `0.08` between `0` and `0.2`. The schema reports the resolved form, so a
 * caller can feed `default` straight back in and get exactly the design's
 * default — there is no unit conversion anywhere in the request path, and so no
 * way to be off by a factor of a hundred.
 *
 * `kind: 'pct'` is a hint to the editor that the number is a fraction of a
 * measurement and wants to be *displayed* as a percentage. It is not a unit.
 *
 * Anything this cannot describe is reported as `unsupported` rather than
 * guessed at.
 */
const optionSchema = (name: string, declaration: unknown): OptionSchema => {
  const bare = { name, min: null, max: null, menu: null }
  if (typeof declaration === 'boolean') return { ...bare, kind: 'bool', default: declaration }
  if (typeof declaration === 'number') return { ...bare, kind: 'number', default: declaration }
  if (typeof declaration === 'string') return { ...bare, kind: 'string', default: declaration }

  if (isRecord(declaration)) {
    const menu = typeof declaration['menu'] === 'string' ? declaration['menu'] : null
    const min = numberOrNull(declaration['min'])
    const max = numberOrNull(declaration['max'])
    const pct = numberOrNull(declaration['pct'])
    if (pct !== null) {
      return {
        name,
        kind: 'pct',
        default: pct / 100,
        min: min === null ? null : min / 100,
        max: max === null ? null : max / 100,
        menu,
      }
    }
    if (typeof declaration['bool'] === 'boolean') {
      return { name, kind: 'bool', default: declaration['bool'], min, max, menu }
    }
  }

  return { ...bare, kind: 'unsupported', default: null }
}

const optionSchemas = (config: FsPatternConfig): OptionSchema[] =>
  Object.entries(config.options ?? {})
    .map(([name, declaration]) => optionSchema(name, declaration))
    .sort((a, b) => a.name.localeCompare(b.name))

const measurementSchemas = (config: FsPatternConfig): MeasurementSchema[] => [
  ...(config.measurements ?? []).map((name) => ({ name, required: true, unit: measureUnit(name) })),
  ...(config.optionalMeasurements ?? []).map((name) => ({
    name,
    required: false,
    unit: measureUnit(name),
  })),
]

const toDesign = (ctor: FsPatternConstructor, about: DesignAbout): Design => ({
  name: about.id,
  summary: {
    name: about.id,
    title: about.name,
    description: about.description,
    tags: about.tags ?? [],
  },
  version: about.version,
  config: ctor.patternConfig,
  create: (settings: unknown): FsPattern => new ctor(settings),
})

const registry: Design[] = [toDesign(Aaron, aaronAbout)]

export const listDesigns = (): DesignSummary[] => registry.map((design) => design.summary)

export const findDesign = (name: string): Design | undefined =>
  registry.find((design) => design.name === name)

export const designDetail = (design: Design): DesignDetail => ({
  ...design.summary,
  version: design.version,
  options: optionSchemas(design.config),
  measurements: measurementSchemas(design.config),
})

/** The option names the design declares — anything else in a request is ignored. */
export const declaredOptions = (design: Design): ReadonlySet<string> =>
  new Set(Object.keys(design.config.options ?? {}))
