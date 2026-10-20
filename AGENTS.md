# Agent notes

Read these before changing anything.

| Document | Owns |
|---|---|
| `docs/product-brief.md` | Why this exists, scope, the v1/v2 split, acceptance criteria |
| `docs/technical-design.md` | Modules, seams, contracts, simulation, delivery plan |
| `docs/editor-spec.md` | The document model, fencing, opacity, the invariant |
| `docs/adr/` | Decisions that are hard to reverse |

## Invariants that do not bend

- **Lossless or refuse.** Never emit a Document the model cannot faithfully represent. Three
  modes: fully modelled emits freely; partially opaque emits only fenced regions and
  preserves the rest byte-for-byte; unmodelled is read-only with emit disabled. Opening a
  design that cannot be modelled enters inspector mode and names the reason — it is never
  edited and never silently flattened.
- **Identity is `piece.path` and `node.id`.** An index is never an identity.
- **One evaluator, and it is the emitted code.** Emit, import, draft. A second evaluator
  needs a measured reason and a test asserting agreement.
- **Vocabulary is FreeSewing's.** Add a primitive only when FreeSewing can already express it.
- **`seamgraph` has two producers** — editor-authored and a hand-authored JSON sidecar. Both
  stay, because the drape path must work without the editor.
- **No Rust.** The local toolchain predates 1.85.

## Conventions

TypeScript strict. Import paths carry no extension. npm. `tsx` for dev, esbuild for the
bundle. Unlicense. Hostnames in every file read `example.com` or `<docker-host>`. Nothing in
CI pushes commits, tags, or releases.

Tests run under `node --import tsx --test` so they can import `src/` directly — extensionless
imports need the loader. Run `npm run build` first when a test boots `dist/server.js`. New
third-party packages need a row in the dependency register (`docs/technical-design.md` §10)
and must clear the licence gate.

## Where the work is

`docs/technical-design.md` §11 is the plan and the status. In place and green locally: M0
(scaffold), M1 (`draft` behind `POST /draft`), M2 (`doc`, the AST document model), and M3's
`seamgraph`, `avatar`, `place`, and `sim`'s solver core.

**Do these next, in this order.**

1. **The particle mesh.** This is the missing link, and it comes first because nothing else can
   run without it. `place` produces a `CylinderMap`; `sim` consumes particles and distance
   constraints. **Nothing builds the one from the other, so `sim` currently has nothing to
   simulate** — and therefore nothing to collide with, either. It needs the triangulation
   `place` deliberately does not do: ear-clip or Delaunay each piece's flat outline, build a
   grid whose density is §7.2's `Boundary subdivision` (15 mm), add structural and shear
   distance constraints, and lift every particle through `place`'s `lift` so placement and the
   particle grid cannot disagree about where a piece is.
2. **Collision**, which is what makes §7's criterion measurable. It needs a spatial hash over
   the body's 37k triangles: a brute-force nearest-triangle search per particle per substep is
   15 × N × 37k, which is not a thing.
3. **Bending**, the dihedral constraint §7.1 lists second and §7.2 calls the strongest control
   over fold count.

§7's completion criterion is three things — total seam closure residue under 1 mm, no particle
more than 2 mm inside the body mesh, and bit-identical positions across two runs — and **only
the third is measurable today**. Read §7 in full and the note at the end of §11's M3 before
starting.

Two pieces of M3 itself are also still missing, and both are small: **`seams/aaron.json`**, the
hand-authored `SeamMap` that M3 is defined as being driven by — §11 asks for how long it took
to author, because that number is M6's justification — and **a command-line harness** tying
draft → seamgraph → avatar → place together, which is how M3 is meant to be exercised.

`fit` (M4) and the editor (M5–M7) come after. Read `docs/editor-spec.md` §8.4 before touching
the 2D surface, and §4.1.1 before touching anything under `src/doc/` — the comment-ownership
rule there was measured, and getting it wrong corrupts a file in a way that still parses.

Milestones are built in verifiable slices, one commit per subsystem, rather than in one pass.
Nothing lands that cannot be checked, and a commit message says plainly what it does *not* do —
see `5ee0f2b` for the shape.

Two things a fresh agent should not have to rediscover, both recorded in full where they
belong: **the widest cross-section at chest height is not the chest** (§11 M3 — the arms merge
into the torso and inflate the girth by a third), and **the draft is in millimetres while the
scene is in metres** (`place` — `lift` is the single place they meet).
