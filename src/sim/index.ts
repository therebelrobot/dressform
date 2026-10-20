// The `sim` module — in progress.
//
// Interface: `createSim(options)` · `sim.addParticles(positions)` ·
// `sim.addDistance(a, b)` · `sim.addSeam(id, a, b)` · `sim.step(dt)` ·
// `sim.bake() → Snapshot`. Depth, eventually: constraint projection, collision
// queries, self-collision, determinism, worker protocol.
//
// ## What is here, and what is not
//
// **Here:** the solver core — particles, XPBD distance projection, seam
// projection that shrinks to closure across the first frames, and §7.3's
// determinism. That is the foundation everything else is bolted onto, and
// determinism in particular is cheapest to get right before there is anything to
// get wrong: it is a property of *iteration order*, and iteration order is easy
// to keep fixed while the code is small and hard to recover once it is not.
//
// **Not here yet:** collision against the body, self-collision, bending, and the
// worker protocol. So §7's criterion — no particle more than 2 mm inside the body
// mesh — is *not* yet measurable, and this module must not be described as
// passing it. Collision is the next slice, and it needs a spatial hash over the
// body's 37k triangles: a brute-force nearest-triangle search per particle per
// substep is 15 × N × 37k, which is not a thing.
//
// ## Model
//
// XPBD, following the structure in Müller's Ten Minute Physics tutorials 11, 14,
// and 15. Each frame is `substeps` Gauss-Seidel passes. Compliance is stored as
// `alpha = compliance / h²` per the XPBD formulation, so a compliance of zero is
// a rigid constraint and a larger number is a springier one.
//
// §7.1 orders the constraints by priority — distance, bending, seam, collision.
// Distance and seam are the two here, in that order, because seam closure wants
// the pieces already settled before it starts pulling them together.

/** X, Y, Z, in metres. */
export type Vec3 = [number, number, number]

export interface SimOptions {
  /** §7.2: 15. Raise this before touching compliance if the drape is unstable. */
  substeps?: number
  /** §7.2: 0.99. */
  damping?: number
  /** §7.2: −9.81 m/s². */
  gravity?: number
  /** §7.2: zero means stiff. Applies to every distance constraint without its own. */
  stretchCompliance?: number
  /** §7.1: a seam's rest length reaches zero across this many frames. */
  seamShrinkFrames?: number
}

/**
 * §7.2's table, in one place.
 *
 * `shearCompliance` is recorded here and **not accepted by `SimOptions`**, on
 * purpose. Shear constraints arrive with the particle grid, which needs the
 * piece triangulation `place` deliberately does not do, and an option the solver
 * silently ignores is worse than an option that does not exist yet: it reads as
 * working. A test pins this constant so §7.2's number does not drift while the
 * constraint is missing.
 */
export const DEFAULTS = {
  substeps: 15,
  damping: 0.99,
  gravity: -9.81,
  stretchCompliance: 0,
  shearCompliance: 0.001,
  seamShrinkFrames: 30,
} as const

interface DistanceConstraint {
  a: number
  b: number
  restLength: number
  compliance: number
}

interface SeamConstraint {
  id: string
  a: number
  b: number
  /** The distance the pair started at, and what the rest length shrinks from. */
  startLength: number
  restLength: number
  /** Frames elapsed, for the shrink. Counts frames, not substeps. */
  frames: number
}

export interface Snapshot {
  schemaVersion: 1
  units: 'metres'
  particleCount: number
  positions: Float64Array
  /** Per seam: how far apart its two particles still are. The closure residue. */
  seams: Array<{ id: string; a: number; b: number; separation: number }>
}

export interface Sim {
  /** Append particles, returning the index the first one landed at. */
  addParticles(positions: Float64Array): number
  /** A distance constraint. Rest length defaults to the distance as given. */
  addDistance(a: number, b: number, restLength?: number, compliance?: number): void
  /** §7.1's seam: starts at its current distance and shrinks to zero. */
  addSeam(id: string, a: number, b: number): void
  step(dt: number): void
  positions(): Float64Array
  bake(): Snapshot
  readonly particleCount: number
  readonly frame: number
}

export const createSim = (options: SimOptions = {}): Sim => {
  const substeps = options.substeps ?? DEFAULTS.substeps
  const damping = options.damping ?? DEFAULTS.damping
  const gravity = options.gravity ?? DEFAULTS.gravity
  const stretch = options.stretchCompliance ?? DEFAULTS.stretchCompliance
  const shrinkFrames = options.seamShrinkFrames ?? DEFAULTS.seamShrinkFrames

  // Flat arrays, walked in index order. Nothing is keyed by object identity and
  // nothing is iterated out of a `Map` or a `Set` in a hot loop, because that is
  // where determinism goes to die (§7.3).
  let x = new Float64Array(0)
  let previous = new Float64Array(0)
  let velocity = new Float64Array(0)
  let inverseMass = new Float64Array(0)

  const distances: DistanceConstraint[] = []
  const seams: SeamConstraint[] = []
  let frame = 0

  const grow = (count: number): void => {
    const from = inverseMass.length
    const to = from + count
    if (to <= from) return
    const rx = new Float64Array(to * 3)
    rx.set(x)
    x = rx
    const rp = new Float64Array(to * 3)
    rp.set(previous)
    previous = rp
    const rv = new Float64Array(to * 3)
    rv.set(velocity)
    velocity = rv
    const rm = new Float64Array(to)
    rm.fill(1)
    rm.set(inverseMass)
    inverseMass = rm
  }

  const separationOf = (a: number, b: number): number =>
    Math.hypot((x[a * 3] ?? 0) - (x[b * 3] ?? 0), (x[a * 3 + 1] ?? 0) - (x[b * 3 + 1] ?? 0), (x[a * 3 + 2] ?? 0) - (x[b * 3 + 2] ?? 0))

  const projectDistance = (constraint: DistanceConstraint, h: number): void => {
    const { a, b } = constraint
    const wa = inverseMass[a] ?? 0
    const wb = inverseMass[b] ?? 0
    const w = wa + wb
    if (w <= 0) return

    const dx = (x[a * 3] ?? 0) - (x[b * 3] ?? 0)
    const dy = (x[a * 3 + 1] ?? 0) - (x[b * 3 + 1] ?? 0)
    const dz = (x[a * 3 + 2] ?? 0) - (x[b * 3 + 2] ?? 0)
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (length === 0) return

    // XPBD: the compliance is scaled by the substep, so a stated stiffness means
    // the same thing at any substep count.
    const alpha = constraint.compliance / (h * h)
    const lambda = (length - constraint.restLength) / (w + alpha)
    const scale = lambda / length

    x[a * 3] = (x[a * 3] ?? 0) - dx * scale * wa
    x[a * 3 + 1] = (x[a * 3 + 1] ?? 0) - dy * scale * wa
    x[a * 3 + 2] = (x[a * 3 + 2] ?? 0) - dz * scale * wa
    x[b * 3] = (x[b * 3] ?? 0) + dx * scale * wb
    x[b * 3 + 1] = (x[b * 3 + 1] ?? 0) + dy * scale * wb
    x[b * 3 + 2] = (x[b * 3 + 2] ?? 0) + dz * scale * wb
  }

  const sim: Sim = {
    addParticles(positions: Float64Array): number {
      const count = Math.floor(positions.length / 3)
      const base = inverseMass.length
      grow(count)
      x.set(positions, base * 3)
      previous.set(positions, base * 3)
      return base
    },

    addDistance(a: number, b: number, restLength?: number, compliance?: number): void {
      distances.push({
        a,
        b,
        restLength: restLength ?? separationOf(a, b),
        compliance: compliance ?? stretch,
      })
    },

    addSeam(id: string, a: number, b: number): void {
      const start = separationOf(a, b)
      seams.push({ id, a, b, startLength: start, restLength: start, frames: 0 })
    },

    step(dt: number): void {
      if (dt <= 0 || substeps <= 0) return
      const h = dt / substeps

      // §7.1: the seam's rest length shrinks to zero across the first N frames,
      // which is what produces the seams-closing animation and lets the pieces
      // find each other before anything pulls.
      const shrink = shrinkFrames > 0 ? Math.min(1, (frame + 1) / shrinkFrames) : 1
      for (const seam of seams) seam.restLength = seam.startLength * (1 - shrink)

      for (let substep = 0; substep < substeps; substep++) {
        for (let i = 0; i < inverseMass.length; i++) {
          if ((inverseMass[i] ?? 0) === 0) continue
          previous[i * 3] = x[i * 3] ?? 0
          previous[i * 3 + 1] = x[i * 3 + 1] ?? 0
          previous[i * 3 + 2] = x[i * 3 + 2] ?? 0

          velocity[i * 3 + 1] = (velocity[i * 3 + 1] ?? 0) + gravity * h
          x[i * 3] = (x[i * 3] ?? 0) + (velocity[i * 3] ?? 0) * h
          x[i * 3 + 1] = (x[i * 3 + 1] ?? 0) + (velocity[i * 3 + 1] ?? 0) * h
          x[i * 3 + 2] = (x[i * 3 + 2] ?? 0) + (velocity[i * 3 + 2] ?? 0) * h
        }

        for (const constraint of distances) projectDistance(constraint, h)
        for (const seam of seams) {
          projectDistance({ a: seam.a, b: seam.b, restLength: seam.restLength, compliance: 0 }, h)
        }

        for (let i = 0; i < inverseMass.length; i++) {
          if ((inverseMass[i] ?? 0) === 0) continue
          for (let axis = 0; axis < 3; axis++) {
            const v = ((x[i * 3 + axis] ?? 0) - (previous[i * 3 + axis] ?? 0)) / h
            velocity[i * 3 + axis] = v * damping
          }
        }
      }

      for (const seam of seams) seam.frames++
      frame++
    },

    positions(): Float64Array {
      return x
    },

    bake(): Snapshot {
      const out = new Float64Array(x.length)
      out.set(x)
      return {
        schemaVersion: 1,
        units: 'metres',
        particleCount: inverseMass.length,
        positions: out,
        seams: seams.map((seam) => ({
          id: seam.id,
          a: seam.a,
          b: seam.b,
          separation: separationOf(seam.a, seam.b),
        })),
      }
    },

    get particleCount(): number {
      return inverseMass.length
    },

    get frame(): number {
      return frame
    },
  }

  return sim
}
