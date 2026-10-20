// A draft request can fail in exactly one way worth naming: it asked for
// something the design cannot answer. That is a refusal with fields attached,
// not a crash, so the HTTP layer can turn it into a 422 that names what was
// wrong rather than a 500.

export interface DraftFieldError {
  /** A request path: `design`, `measurements.chest`, `options.chestEase`. */
  field: string
  message: string
}

export class DraftValidationError extends Error {
  readonly fields: DraftFieldError[]

  constructor(message: string, fields: DraftFieldError[]) {
    super(message)
    this.name = 'DraftValidationError'
    this.fields = fields
  }
}
