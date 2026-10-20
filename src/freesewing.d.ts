// FreeSewing ships no type declarations. These ambient modules are the narrow
// surface `src/draft` imports; the structural shapes they return live in
// `src/draft/freesewing.ts`.
//
// `@freesewing/aaron` is the pinned design the M1 smoke test drafts.
// `@freesewing/config` is where measurement units live — and it is a direct
// dependency rather than a transitive one because two of FreeSewing's own
// published plugins import it without declaring it. See
// `docs/technical-design.md` §10 and §13.

declare module '@freesewing/aaron' {
  export const Aaron: import('./draft/freesewing').FsPatternConstructor
  export const about: import('./draft/freesewing').DesignAbout
}

declare module '@freesewing/config' {
  /** Every measurement name FreeSewing knows. */
  export const measurements: string[]
  /** The subset measured in degrees rather than millimetres. */
  export const degreeMeasurements: string[]
}
