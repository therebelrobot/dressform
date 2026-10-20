# dressform — Technical Design Document

**Document version:** 2.0 · **Last updated:** 2026-10-18
**Supersedes:** v1.0 (2026-10-17)
**Companion:** `dressform-product-brief.md`, `dressform-editor-spec.md`

**What changed in 2.0:** §4 gains a `doc` module (the AST document model — now the deepest
module in the project) and a `trace` module (v2). §4.2's seam table changes: `draft` stays
un-abstracted, `seamgraph` gains a second real producer, and a new seam is named for the
evaluator. §6 gains three contracts. §9 corrects a CSP claim made in 1.0 — see §13. §11 is
split into v1 and v2.

---

## 1. Context and constraints

Binding. Treat each row as a hard constraint rather than a preference.

| Constraint | Value | Source |
|---|---|---|
| Language | TypeScript, strict | Aster's standard |
| Import paths | Carry no extension. `module`/`moduleResolution` = `ESNext`/`bundler` | Aster's standard |
| Package manager | npm | Aster's standard |
| Node | Latest LTS or newer | Aster's standard |
| Dev runtime | `tsx` | Aster's standard |
| Build | `esbuild`, bundled to a single output file | Aster's standard |
| Licence | Unlicense | Aster's standard |
| Deploy target | aarch64 Docker host behind a reverse proxy | Homelab |
| Images | `ghcr.io/therebelrobot/dressform` and `ghcr.io/therebelrobot/dressform-web` | Aster's standard |
| Architectures | `linux/amd64,linux/arm64`. Both required; arm64 is the deploy target | Deploy target is a Pi |
| Rust | Absent from v1 and v2. When it arrives: detect `rustc` and pick `edition = "2021"` or a matching `rust-version` | Local toolchain predates 1.85 |
| Model providers | Any provider the dependency graph adds comes from the approved set: Anthropic, local Ollama, or open models via OpenRouter | Aster's hard rule |
| Hostnames | Every hostname in code, config, and docs reads `example.com` or `<docker-host>` | Aster's hard rule |
| GitHub writes | CI reads and publishes images. Nothing pushes commits, tags, or releases | Aster's hard rule |
| GHA cache | Scoped per image; one matrix entry per image | Aster's standard |

---

## 2. Domain glossary

Lands as `GLOSSARY.md` at the repo root during M0. It is a glossary and nothing else — no
implementation detail. Its job is to stop the garment vocabulary, the physics vocabulary,
and the editor vocabulary from stealing each other's words.

### Garment

| Term | Definition | Do not confuse with |
|---|---|---|
| **Piece** | One flat shape cut from fabric. FreeSewing calls it a `part`. | Panel, block |
| **Path** | A named line or curve within a piece: `armhole`, `neck`, `shoulder`, `hem`. | Edge, segment |
| **Seam** | A join between two paths on two pieces. The domain's primary relation. | Stitch (a visual texture) |
| **Seam map** | The record of which paths sew to which, for one design. | Seam allowance |
| **Seam allowance** | Extra fabric beyond the sewing line. **Zero here** — simulation models net shapes. | Seam |
| **Notch** | An alignment mark on a path, used to match two edges during sewing. | Dart |
| **Dart** | A shaped fold removing fabric to fit a curve. | Pleat |
| **Grainline** | The fabric's warp direction. Sets the anisotropy axes of the simulated material. | Fold line |
| **Net** | A pattern drawn to the sewing line with no allowance. What simulation consumes. | Trimmed |
| **Toile** | The test garment sewn to check fit. The thing this project models. | Muslin (US synonym) |

### Physics

| Term | Definition | Do not confuse with |
|---|---|---|
| **Rest length** | The length an edge has in the flat pattern. The simulation's zero-strain reference. | Planned length |
| **Strain** | `(current − rest) / rest` for an edge. The fit signal. | Stress |
| **Particle** | One simulated point of the cloth mesh. | Vertex (the render mesh) |
| **Substep** | One constraint-projection iteration within a frame. | Frame |
| **Convergence** | Seam closure residue and velocity both under threshold. | Settled |
| **Reference body** | The CC0 mesh the garment drapes on, scaled from the same measurements the pattern was drafted from. | Avatar, mannequin |

### Editor

| Term | Definition | Do not confuse with |
|---|---|---|
| **Construction node** | One step of the drafting recipe: a point or path, with the formula that produced it. | Point (FreeSewing's runtime value) |
| **Formula** | The expression that computes a node — `measurements.chest / 4`. | Value |
| **Evaluated value** | The number a formula produced at the current measurements. | Formula |
| **Document** | The syntax tree plus the seam map plus settings. The project's canonical state. | Project file (its serialization) |
| **Fenced region** | A span of emitted source the editor owns and may rewrite on the next emit. | Opaque region |
| **Opaque region** | A span of source the editor cannot model. Preserved verbatim; never rewritten. | Unparseable |
| **Provenance** | Where a node came from: which source span, or which runtime operation. | Source map |
| **Read-back** | Modelling a foreign design: source in, editable nodes out. The v2 capability. | Import (of geometry) |
| **Author** | Creating a design in the editor. The v1 capability. | Drafting |
| **Refusal** | A named, sourced reason the editor declines to model or emit. | Error |
| **Lossless or refuse** | The governing invariant. See `dressform-editor-spec.md` §5. | Best-effort |

**Identification rule, applied everywhere:** `piece.path` names an edge, and a
`node.id` names a construction step. An index never does. Indices shift across edits and
silently corrupt a seam map.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Container: dressform-web     static assets                        │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  Editor  (the app)                                           │ │
│   │                                                              │ │
│   │   ┌────────────┐  ops   ┌──────────────────────────────────┐ │ │
│   │   │ 2D surface │───────▶│ doc — AST document model         │ │ │
│   │   │ canvas +   │◀───────│ parse · edit · emit · fence      │ │ │
│   │   │ Pencil     │  Doc   └───────────────┬──────────────────┘ │ │
│   │   └────────────┘                        │ source             │ │
│   │                                         ▼                    │ │
│   │                          ┌──────────────────────────────┐    │ │
│   │                          │ evaluate: blob-module import │    │ │
│   │                          │ → FreeSewing draft → paths   │    │ │
│   │                          └──────────────┬───────────────┘    │ │
│   │                                         │                    │ │
│   │   ┌──────────────┐   ┌──────────────────▼───────────────┐    │ │
│   │   │ seam editor  │──▶│ seamgraph → place → sim → fit    │    │ │
│   │   │ click 2 edges│   │            (3D, Web Worker)       │    │ │
│   │   └──────────────┘   └──────────────────────────────────┘    │ │
│   └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  Container: dressform         Node, esbuild single bundle          │
│    POST /draft   →  draft()  →  DraftResult                        │
│    GET  /designs →  design + option schemas                        │
│    GET  /healthz                                                   │
└────────────────────────────────────────────────────────────────────┘
```

**One evaluator, and it is the emitted code.** The editor's preview is produced by emitting
a FreeSewing design module and importing it. The preview *is* the code path, so there is no
way for what you see to diverge from what you ship. See §4.2 for the escape hatch and the
test it requires.

**The Docker host drafts and serves; the browser models, evaluates, and simulates.** The
host is an aarch64 single-board computer and the physics is the expensive part. A browser
on the Mac or iPad has a GPU and idles. Moving the editor and the simulation out of the
server keeps the container small, keeps the image arm64-native with no emulation, and
leaves the server with nothing to scale.

**The server still exists** so that measurements stay on the LAN, so an agent can draft a
pattern without a browser, and so the rendered SVG is available for printing without
opening the editor.

---

## 4. Module design

Vocabulary: a **module** has an interface and an implementation. The **interface** is every
fact a caller needs — signature, invariants, ordering, error modes. A **seam** is where an
interface lives. An **adapter** fills a seam.

### 4.1 Module map

| Module | Interface | Depth — what it hides | Version |
|---|---|---|---|
| `doc` | `open(src) → Document \| Refusal` · `emit(doc) → src` · `apply(doc, op) → Document` | Parsing, node identity, fence bookkeeping, opaque-region preservation, reprint-only-what-changed, rename propagation into the seam map | v1 |
| `draft` | `draft(req: DraftRequest) → Promise<DraftResult>` · `listDesigns()` · `describeDesign(name)` | FreeSewing's version drift, the `parts`-vs-`stacks` shape, option interpolation, measurement defaults, Bézier → polyline tessellation, outline-vs-internal classification, the net-shape `sa: 0` assertion, SVG rendering | v1 |
| `seamgraph` | `resolve(map: SeamMap, draft: DraftResult) → ResolvedSeams` | Mirror expansion, path-fraction sub-selection, direction reversal, arc-length reparameterisation, length-tolerance checks | v1 |
| `avatar` | `build(measurements: MeasurementSet) → TriangleMesh` | Reference-body selection, per-region non-uniform scaling, landmark identification | v1 |
| `place` | `place(draft, body, hints) → PlacedPiece[]` | Category classification, tangent-plane mapping, inflation gap, seam-aware orientation | v1 |
| `sim` | `sim.step(dt)` · `sim.bake() → Snapshot` | Constraint projection, collision queries, self-collision, determinism, worker protocol | v1 |
| `fit` | `score(scene, snapshot) → FitReport` | Strain aggregation, penetration depth, displacement, per-region bucketing | v1 |
| `trace` | `trace(design) → TracedNode[]` | Instrumented execution, runtime operation capture, source-span attribution, opaque classification | v2 |

Each is **deep**: a small interface over a large implementation. `doc` is the deepest — its
three-method surface hides the entire round-trip problem. `draft`'s whole job is making
FreeSewing's internals not the caller's problem.

`doc`'s internals belong to `dressform-editor-spec.md`. This document names its interface
and its invariants; it does not restate them.

### 4.2 Seam decisions

The rule: **one adapter means a hypothetical seam; two adapters means a real one.** A seam
earns its place only when something genuinely varies across it.

| Seam | Real or hypothetical? | Decision |
|---|---|---|
| `sim` | **Real** — two adapters required: a TypeScript reference solver (v1) and a Rust/WASM solver (v3) | Define the interface now. Build the TS adapter. |
| `seamgraph` | **Real** — two producers: editor-authored via `doc` (v1) and a hand-authored JSON sidecar (retained for designs the editor did not author) | Define the interface; both adapters ship. |
| `trace` | **Real** — two sources: instrumented runtime capture and static AST attribution (v2) | Define the interface at v2. The two are complementary, not alternatives. |
| **the evaluator** | **Hypothetical in v1, real the moment a second one is added** | One evaluator: emit → import → draft. See below. |
| `draft` | **Hypothetical** — FreeSewing is the only drafting engine and stays that way | Import `@freesewing/core` directly. A `PatternSource` interface with one implementation is a pass-through. |
| `avatar` | **Hypothetical** — one CC0 reference-body source | No interface. Call the function. |
| `place` | **Hypothetical** — one placement algorithm | No interface. Call the function. |

This table is the thing an implementing agent is most likely to get wrong. Declaring
interfaces for `draft`, `avatar`, and `place` produces a shallow codebase that costs more
to change, not less.

**The evaluator seam, spelled out.** The editor has one way to turn a Document into visible
geometry: emit the module, import it, draft it. No second evaluator, so no conformance
test, so no divergence.

That holds until drag latency demands better. If measuring shows the emit-plus-import path
exceeds roughly 8 ms per drag frame, the escape hatch is an in-memory transform for the
**transient** preview only, with the committed state always re-emitting and re-evaluating.
The moment that hatch is used, the seam becomes real and carries a test asserting the
in-memory transform agrees with the emitted result. Do not add the second evaluator
speculatively — measure first, and carry the test if you add it.

### 4.3 Deletion test

Delete each module; where does the complexity go?

- `doc` → parsing, fencing, identity, and opaque preservation spread across the editor,
  the emitter, and the seam editor, and the lossless invariant becomes unenforceable.
  **Keep. The most load-bearing module in the project.**
- `draft` → every caller re-implements the shape conversion. **Keep.**
- `seamgraph` → seam resolution spreads into placement, simulation, and the 2D surface.
  **Keep.**
- `fit` → every readout surface recomputes strain independently. **Keep.**
- `avatar` → the scaling inlines into `place`, but `fit` also needs landmarks. **Keep**, on
  the strength of two callers.
- `trace` → provenance attribution inlines into `doc`, which then has to know about runtime
  execution as well as syntax. **Keep separate at v2**, because the two failures are
  different: `doc` fails to parse, `trace` fails to attribute.

---

## 5. FreeSewing notes

Each of these costs an afternoon to rediscover.

| Fact | Consequence |
|---|---|
| `Pattern.getRenderProps()` returns `{ autoLayout, height, width, settings, stacks, svg }`, and parts live inside `stacks` | The `pattern-via-io` example prints `data.parts`, which is the pre-v3 shape. Read the key list from the installed version before writing the adapter. |
| `Pattern` is constructible directly, and `Pattern.addPart()` exists | The editor can drive the API programmatically instead of generating a whole design module. Both routes work; emit-a-module is the truthful one, because the emitted text is then the single source of truth. |
| The `sa` setting does not apply itself; the design author draws the allowance lines | Draft with `sa: 0` for net shapes. Assert it in the adapter. |
| `@freesewing/plugin-export-dxf` is deprecated and v2-only, and is absent from the v4 plugin set | Geometry leaves the drafter as `DraftResult` JSON. |
| FreeSewing curves are Bézier operations rather than polylines | Compute `pathLengths` from the curve, not from a tessellation, or the seam validator will disagree with the simulator. |
| A symmetric piece appears once in the draft and twice on the body | `SeamMap.sides.mirror` is the only place mirroring is expressed. The resolver expands it once. |
| `draft()` receives `Point`, `Path`, and `macro` as arguments | This is the injection point for `trace` at v2: pass recording subclasses instead of the originals. A design that imports these directly rather than destructuring them escapes injection and needs module-alias interception — **unverified**, see §13. |
| `Pattern` accepts a *multiset* — an array of settings objects | One draft can produce several measurement variants, and `Pattern.sample()`, `sampleOption()`, and `sampleMeasurement()` exist for sweeping ranges. Relevant to the fit loop; not required for v1. |

---

## 6. Contracts

Fixed before implementation begins. Code against these.

Three contracts — `Document`, `Refusal`, and `ProjectFile` — are defined in
`dressform-editor-spec.md` §3 and §4. This document references them and does not restate
them.

### 6.1 `DraftRequest`

```ts
interface DraftRequest {
  design: string                          // "aaron"
  measurements: Record<string, number>    // mm
  options?: Record<string, number | boolean | string>
  sa?: 0                                  // literal 0 in v1
}
```

`measurements` is millimetres, except for the names FreeSewing measures in degrees —
`shoulderSlope`, and whatever else a design declares. `GET /designs/:design` marks those, so
the editor does not have to know the list. Names the design does not use are passed through
untouched. A measurement the design requires and the request omits is a `422` naming it.

`options` values are **resolved, not authored**. A design writes `chestEase: { pct: 8, min: 0,
max: 20 }`; the value this field carries is `0.08`, and `GET /designs/:design` reports the same
resolved form, so a client can echo a schema value straight back and land on the design's
default. `kind: 'pct'` in that schema is a hint that the number is a fraction of a measurement
and wants to be *displayed* as a percentage — it is not a unit. Nothing in the request path
converts units, so nothing in it can be off by a factor of a hundred.

### 6.2 `DraftResult`

```ts
interface DraftResult {
  schemaVersion: 1
  design: string
  units: 'mm'
  boundingBox: { width: number; height: number }
  pieces: DraftPiece[]
  svg: string
  warnings: DraftWarning[]
}

interface DraftPiece {
  id: string                  // stable, from FreeSewing's part name
  name: string
  mirrorOf: string | null     // id of the piece this mirrors
  paths: Array<{
    path: string              // "armhole" — never an index
    role: 'outline' | 'internal'
    points: Array<[number, number]>
  }>
  pathLengths: Record<string, number>          // mm, curve-accurate
  notches: Array<{ path: string; at: number }> // `at` in [0, 1]
  grainline: { from: [number, number]; to: [number, number] } | null
  centroid: [number, number]
}
```

`pathLengths` is the load-bearing field. It lets the seam validator catch a mismatch before
any simulation runs, turning a class of silent physics failures into an immediate named
error.

Three of `DraftPiece`'s fields are **derived**, and each is derived a specific way:

- `points` is a tessellation — curves sampled at roughly 12 mm, for rendering and hit-testing.
  It is deliberately *not* the length reference: an inscribed polyline under-reports a curve
  (§5), so `pathLengths` comes from the curve itself. The two agree to well inside 0.1 mm, and
  M1's acceptance test asserts exactly that against the rendered SVG.
- `notches` is attributed. FreeSewing anchors a notch at a point and records no path; each one
  is nearest-path attributed at the arc-length fraction of its projection.
- `grainline` is constructed. FreeSewing's `cutlist` declares a grain *angle* in degrees, not a
  segment, so the segment is that angle drawn through the piece's centroid and clipped to the
  piece's bounds. It is `null` when no grain is declared.

`mirrorOf` is normally `null`: FreeSewing does not itself duplicate a piece, and mirroring is
expressed exactly once, in `SeamMap.sides.mirror` (§6.3).

### 6.3 `SeamMap`

Authored in the editor (v1) or by hand (retained for designs the editor did not author).
Exported alongside the design so the 3D path can consume it without the editor.

```ts
interface SeamMap {
  schemaVersion: 1
  design: string
  units: 'mm'
  lengthTolerance: number          // mm, default 2.0
  sides: { mirror: string[] }      // piece ids that exist twice on the body
  seams: SeamSpec[]
}

interface SeamSpec {
  id: string                       // "shoulder.left"
  a: { piece: string; path: string; fraction: [number, number]; direction: 'forward' | 'reverse' }
  b: { piece: string; path: string; fraction: [number, number]; direction: 'forward' | 'reverse' }
  notes?: string
}
```

Three fields carry the difficulty, each for a specific reason:

- **`fraction`** — one named path can sew to two partners: a side seam interrupted by a
  dart, an armhole shared between a sleeve and itself. Fraction selects a sub-arc by
  arc-length parameter.
- **`direction`** — seams run head-to-tail in opposite directions. Reversing this is the
  most common bug in garment simulation, and naming it in the schema makes it reviewable.
- **`sides.mirror`** — mirroring is expressed exactly once, here. Nothing else in the
  pipeline duplicates a piece.

`SeamSpec.a.piece` and `.path` are references into the `Document`. Renaming a node without
re-keying the seam map silently orphans a seam, which is why rename propagation is a `doc`
invariant rather than an editor nicety — see `dressform-editor-spec.md` §6.

### 6.4 HTTP

| Method | Route | Body | Response |
|---|---|---|---|
| `GET` | `/healthz` | — | `200 { status: 'ok' }` |
| `GET` | `/designs` | — | `200 DesignSummary[]` |
| `GET` | `/designs/:design` | — | `200 DesignDetail` — option schema, required and optional measurements |
| `POST` | `/draft` | `DraftRequest` | `200 DraftResult` · `422` validation naming fields · `400` malformed |

The reverse proxy already fronts the LAN, so the API carries no auth layer. The editor and
API share one origin, so they need no CORS headers.

`POST /draft`'s two failure codes divide at the transport. A body that cannot be read as a
request at all — not JSON, not a JSON object, or over the 1 MiB cap — is `400`. A body that
*is* a request the design refuses is `422`, carrying `fields` that each name a request path:
`design`, `measurements.chest`, `options.chestEase`. So a well-formed request never answers
`400`, and a refusal never answers `500`. `GET /designs` answers summaries and
`GET /designs/:design` answers detail; an unknown design is a `404`, and a missing or
wrong-typed field is not.

The same split holds inside `draft`: validation belongs to the module, so a caller that is not
HTTP gets the same named fields in a `DraftValidationError` rather than a transport-specific
error.

### 6.5 `SceneBundle`

What the 3D pipeline receives to build a scene. Produced in the browser, not over HTTP.

```ts
interface SceneBundle {
  schemaVersion: 1
  draft: DraftResult
  seams: ResolvedSeams
  body: TriangleMesh
  placement: PlacedPiece[]
  material: MaterialProfile
}
```

---

## 7. Simulation

### 7.1 Model

XPBD, following the structure in Matthias Müller's Ten Minute Physics tutorials 11, 14, and
15 (MIT). Constraints in priority order:

1. **Distance** — warp, weft, and shear compliance as three separate coefficients.
2. **Bending** — dihedral, warp and weft, using the PositionBasedDynamics formulation (MIT)
   with the `atan2(sin θ, cos θ)` bending angle from Tissu (Apache-2.0).
3. **Seam** — a seam constraint starts at its current 3D distance and shrinks its rest
   length to zero across the first N frames. This produces the seams-closing animation and
   lets pieces find each other before anything pulls.
4. **Collision** — point-to-triangle against the body, resolved through a spatial hash.
5. **Self-collision** — off by default. Costly, and a single-layer garment does not need it.

### 7.2 Defaults

| Parameter | Default | Note |
|---|---|---|
| Substeps per frame | 15 | Raise this before touching compliance if the drape is unstable |
| Damping | 0.99 | |
| Gravity | −9.81 m/s² | |
| Stretch compliance (warp, weft) | 0.0 | Zero means stiff |
| Stretch compliance (shear) | 0.001 | |
| Bend compliance (warp, weft) | 1.0 | **The strongest control over fold count.** Raise for fewer, larger folds |
| Cloth thickness | 2 mm | |
| Inflation gap at placement | 30 mm | Keeps pieces clear of the body at frame zero |
| Boundary subdivision | 15 mm | Sets particle density along piece edges |
| Seam shrink frames | 30 | |

### 7.3 Determinism

Required and testable: same scene, same seed, same substep count, bit-identical final
positions. An implementation iterating a `Set` in insertion order, or summing forces in a
non-deterministic order, goes red on this. The fit readout is only comparable across runs
when simulation reproduces.

### 7.4 Reference bodies

Two CC0 meshes from the MakeHuman base mesh — the same lineage Vina and opensew-2 use —
shipped with three scaled variants each. **Built**; provenance and regeneration live in
`assets/bodies/README.md`.

`male-young.json` (1.786 m) and `female-young.json` (1.637 m): the base mesh with one
`macrodetails` target applied, in metres, Y-up, three.js's convention. 19,158 vertices and
36,972 triangles each, undecimated, because decimation would change the surface the cloth
collides with. The manifest carries the upstream commit, the sha256 of both inputs, the CC0
statement, and the coordinate convention, so the meshes are checkable rather than trusted.

Two corrections against this section as first written:

- **MPFB2 is not in the path.** Asking for meshes "generated with MPFB2" overlooks that MPFB2
  is two things under two licences — GPLv3 source and CC0 assets. Vendoring the former into an
  Unlicense project is not available, and requiring Blender to regenerate a mesh is a poor
  trade for a repository with no other GUI dependency. `scripts/build-bodies.py` applies the
  same CC0 targets to the same CC0 base mesh in plain Python, which is the whole of the
  operation: a target is a list of per-vertex offsets. The lineage is unchanged.
- **The three variants are a scalar, not three meshes.** They are a uniform scale of one mesh,
  so three copies would encode one number three times at three times the size. The factors
  (`[0.95, 1.0, 1.05]`) live in the manifest and in each body. If those variants were ever
  meant as different *morphs* rather than scales, this is the wrong shape, and the manifest is
  where to change it.

One decoy is worth carrying forward. `macrodetails/universal-<gender>-<age>-<muscle>-<weight>
.target` looks like the right input and is not: upstream those files are 604-byte stubs holding
nothing but a licence header, because MakeHuman composes real macrodetails at build time. The
first attempt applied a stub and produced the unmodified base mesh twice under two names, which
no vertex count or file size would have revealed. The generator now refuses a target with no
offsets, and a test asserts the two bodies differ.

**Limitation, printed on the readout itself:** the body scales from the same measurement
set the pattern was drafted from, per body region. It is not anatomically morphed.
Consistency between draft and body is what makes the strain number mean anything;
anatomical fidelity is a later concern.

#### Scanned bodies — noted, not scheduled

The real answer to that limitation is to stop approximating a body and use the actual one:
scan the person the garment is for, import the mesh, and drape against that. The intended
route is a structured-light or laser scan of the kind a print-quality 3D scanner produces —
the same class of device that would be used to reproduce a figure in the first place.

**Not now**, and not because it is small. It changes what a reference body *is*, in three
places this section currently depends on:

- **A scan has no rig.** `avatar`'s anchors are rig joints — `joint-spine-1`, `joint-pelvis`,
  the shoulder joints — read from a CC0 joint table. A scan is a surface with no such table,
  so the anchors become an inference from the silhouette again, and the section above is a
  record of how badly that goes: the widest loop at chest height is not the chest.
- **A scan has no agreed frame.** It arrives in whatever scale, orientation, and origin the
  scanner chose, and someone has to say which way is up and where the floor is before a
  measurement means anything.
- **A scan is not necessarily a collision surface.** A print-quality scan is dense, noisy, and
  usually open at the extremities. `sim` wants something closed, reasonably uniform, and
  cheap to query through a spatial hash.

So this is an addition to the `ReferenceBody` contract rather than a third JSON file: a body
either carries a rig or it does not, and the two need different `avatar` paths. Worth doing
when a scanner is in hand and body fidelity — rather than draft/body consistency — is the
binding error in the readout. Recorded in §11's deferred table; the trigger is a scanner, not
a milestone.

---

## 8. Fit report

```ts
interface FitReport {
  schemaVersion: 1
  seams: Array<{
    id: string
    restLength: number
    finalLength: number
    strainP50: number
    strainP95: number
    strainMax: number
    verdict: 'ok' | 'tight' | 'slack'
  }>
  penetration: { maxDepth: number; particleCount: number }
  regions: Array<{ region: string; strainP95: number; verdict: Verdict }>
  warnings: FitWarning[]
}
```

Thresholds: `ok` under 5% p95 strain; `tight` above it with penetration; `slack` above it
without. Every threshold is a named constant in one module, so tuning is a one-place edit.

The readout renders as a heat map on the garment, with the worst seam named in text — and
clicking the name selects that seam in the 2D surface. A number without a location is not
actionable; connecting the 3D symptom back to the 2D edge that caused it is the whole
value.

---

## 9. Security posture

The claim: **no code path runs from a measurement, a pattern, or a drape to the network.**
Mechanically enforced rather than asserted.

| Control | Implementation |
|---|---|
| Egress | The server container runs on an internal-only network. CI scans both built bundles for external origins and goes red on the first hit. |
| Runtime dependencies | Both bundles draw on the repo's own code and the packages in §10. No analytics, error SDK, CDN, or runtime-fetched font. |
| Secrets | Neither container holds any, and neither config accepts any. |
| Telemetry | Diagnostics stay local. The copy-diagnostics action emits counters, timings, and version strings — no measurements, no geometry. |
| Headers (server) | CSP with `connect-src 'none'`, plus `frame-ancestors 'none'`. |
| Providers | Only the approved set appears anywhere in the graph. The CI licence scan enforces it. |
| Licence gate | The build fails on any licence outside MIT, Apache-2.0, BSD-3-Clause, ISC, CC0, Unlicense, zlib. Mechanical, so the rule never becomes a review-time judgement call. |

### 9.1 The editor evaluates generated code, and that has a cost

The editor imports and runs JavaScript it built at runtime. That requires an
eval-equivalent allowance, and **the two available forms are equivalent in effect**:

- `script-src 'unsafe-eval'`, or
- `script-src 'self' blob:` paired with a blob-module import.

Multiple sources state plainly that allowing `blob:` in a script context is equivalent to
`'unsafe-eval'`: it lets the page run code it builds at runtime. There is no narrower
option here — a blob-URL module import is not a way to avoid the allowance, only a way to
spell it differently. This corrects a claim made in document version 1.0, which said the
blob route avoided `unsafe-eval`.

**Why this is acceptable here.** The code being evaluated is authored in the editor, on the
same machine, by the same person, and never arrives over the network. The threat this
allowance normally guards against — evaluating attacker-supplied script — has no entry
point: there is no remote input into the document model, and the egress scan proves the
bundle cannot reach out.

**The boundary that keeps it scoped.**

- The allowance lives on the editor origin only. The exported `.mjs`, the printed SVG, and
  anything else that leaves the app carry no such allowance.
- The egress scan is not weakened: bundle-origin scanning stays on both builds, and a
  document that somehow referenced an external origin goes red in CI.
- If the app is ever served to more than one person, or if the editor ever loads a document
  the user did not create in it, this decision must be revisited before that ships — a
  shared editor that imports a stranger's pattern is a different security posture entirely.

**Out of scope by construction:** multi-tenancy, authz, RBAC, audit logging, rate limiting,
compliance analysis. A hosted deployment voids this section and requires a rewrite rather
than an extension.

---

## 10. Dependency register

Read it, then write it — where the table says so. Licences below were checked against the
registry this session.

| Dependency | Version | Licence | Use | Decision |
|---|---|---|---|---|
| `@freesewing/core` | 4.10.2 | MIT | Drafting engine | **Depend.** Pinned exactly. |
| `@freesewing/aaron` | 4.10.2 | MIT | Design definitions | **Depend.** Pinned exactly. The one design the M1 smoke test drafts. |
| `@freesewing/config` | 4.10.2 | MIT | Measurement units, and `logoPath` | **Depend, forced.** `plugin-annotations` imports it without declaring it, so the graph does not resolve without it. See §13. |
| `@freesewing/plugin-transform` | 4.10.2 | MIT | Transform plugin | **Depend, forced.** `core-plugins` imports it without declaring it either. Same cause, same fix. See §13. |
| `@freesewing/brian` | 4.10.2 | MIT | Peer dependency of `aaron` | **Transitive.** Installed as a peer; not addressable directly. |
| `hooks` | 0.3.2 | MIT | Dependency of `@freesewing/core` | **Transitive.** Declares its licence in the pre-SPDX `licenses: ["MIT"]` form, which the licence gate now reads. See §13. |
| `recast` | 0.24.0 | MIT | Parse, edit, and reprint JavaScript while preserving formatting and comments on untouched nodes | **Depend.** The load-bearing dependency of `doc`; its "reprint only what changed" property is the entire round-trip mechanism. **Its bundled babel parser does not work with Babel 8**, so `doc` passes its own. See §13. |
| `@babel/parser` | 8.0.7 | MIT | The parser Recast drives | **Depend.** Needs no plugin list for FreeSewing's syntax; Babel 8 enables modern syntax by default. Pinned exactly because Recast's defaults are what break against it. |
| `three` | — | MIT | 3D viewport | **Depend.** |
| `esbuild` | — | MIT | Bundling | **Depend** (build only) |
| `tsx` | — | MIT | Dev runtime | **Depend** (dev only) |
| Müller XPBD structure | — | MIT | Solver | **Adapt with attribution** in `THIRD-PARTY-NOTICES.md` |
| PositionBasedDynamics dihedral | — | MIT | Bending constraint | **Adapt with attribution** |
| Tissu bending angle | — | Apache-2.0 | Bending formulation | **Adapt with attribution** |
| MakeHuman base mesh + `macrodetails` targets | `a8bc2d54` | CC0-1.0 | Reference bodies | **Ship.** Committed as derived meshes, with input digests and the upstream commit in `assets/bodies/manifest.json`. No attribution required; given anyway. Applied directly rather than through MPFB2 — see §7.4 |
| Vina | — | MIT | Reference implementation | **Study only.** Not a dependency. |
| `ts-morph` | 28.0.0 | MIT | TypeScript codemod toolkit | **Reject.** Wraps the TS compiler, whose printer drops comments unless hand-attached. Recast solves the actual problem. |
| `astring`, `@babel/generator` | 1.9.0, 8.0.6 | MIT | AST → code printers | **Reject.** Both reprint the whole tree; neither preserves the original formatting of untouched nodes. |
| Jolt (`jolt-physics`) | — | MIT | Alternative solver | **Evaluate only.** No garment or seam layer; would not save work. |
| `oxihuman-physics` | 0.2.1 | Apache-2.0 | Alternative solver | **Evaluate only.** No seam constraints. |
| `ammo.js` / Bullet | — | zlib | Alternative solver | **Reject.** Ancient API, manual memory management, worse than Jolt on every axis. |
| Seamly2D, Valentina, Cloth Lab, opensew-2, and Seamly2D-derived fixtures | — | **GPL-3.0** | — | **Never vendor.** Copyleft. No code, fixtures, or test data. |

CI gate: a dependency scan that fails the build on any licence outside
`MIT / Apache-2.0 / BSD-3-Clause / ISC / CC0 / Unlicense / zlib`, plus an advisory scan. The
gate is mechanical so the licence rule is not a review-time judgement call.

---

## 11. Delivery plan

Each milestone has a completion criterion. Stop at each one and verify before starting the
next. Milestones M0–M7 are **v1 (Author)**. M8–M10 are **v2 (Read-back)**.

The order front-loads the two novel engineering problems — the document model and the
seamable drape — and proves both headlessly before any UI exists. The editor is built only
once the things it depends on are known to work.

### v1 — Author

#### M0 — Skeleton

Repo, Unlicense, `GLOSSARY.md`, CI, both Docker images, both workflows, dependabot. The
deployed app serves `/healthz` and nothing else.

**Done when:** a push produces a green CI run, a multi-arch manifest at
`ghcr.io/therebelrobot/dressform:latest` listing both `linux/amd64` and `linux/arm64`, and a
signed provenance attestation.

**Locally verified.** Typecheck, both bundles, the test suite, the origin scan, and the licence
gate all pass. The criterion itself needs the first push, which has not happened; see M1's
closing note.

#### M1 — Drafting service

`draft` module behind `POST /draft`. `GET /designs`.

**Done when:** a `DraftRequest` for one design returns an SVG and a `DraftResult` passing
the product brief §7 drafting criteria. This milestone stands on its own as a printable
pattern service.

**Built.** `src/draft/`: `designs.ts` (the registry, and the option and measurement schemas
`GET /designs/:design` serves), `freesewing.ts` (the shapes the adapter walks, written by hand
because FreeSewing publishes no types), `geometry.ts` (pure — tessellation, bounds, centroid,
grainline), `errors.ts`, and `index.ts` (validation and the draft). `src/server/index.ts` adds
`GET /designs`, `GET /designs/:design`, and `POST /draft` beside M0's `/healthz`.

**Verified.** `npm test` — 29 tests. The acceptance criterion is asserted directly:
`test/draft.test.js` measures every path in the rendered SVG with an independent polyline
walker (`test/support/svg.js`) and requires agreement with `pathLengths` within 0.1 mm. Also
asserted: `pathLengths` comes from the curve and not from the tessellation; the net-shape
`sa: 0` invariant; determinism; and each refusal shape.

**Two gate findings, both fixed in the gate rather than worked around.** The licence gate read
only the object form of the pre-SPDX `licenses` field, so it reported `hooks` — genuinely MIT —
as unlicensed; it now reads both forms. And two published FreeSewing packages import
`@freesewing/config` and `@freesewing/plugin-transform` without declaring them, so the
dependency graph does not resolve without those two present as direct dependencies. Neither
is a defect in this repo, and both are recorded in §10.

**Outstanding from M0.** The M0 criterion needs its first real CI run: no push has happened
yet, so neither image is published and no provenance attestation exists. Everything M0 claims
that can be checked locally does check locally — typecheck, build, tests, origin scan, and
licence gate are all green.

#### M2 — Document model

`doc`, headless. Parse, edit, emit, fence, preserve opaque regions. No UI. Per the editor
spec's §3 and §4.

**Done when:** the round-trip property test holds — for every design in the test corpus and
every generated edit sequence, `emit(apply(open(src), ops))` preserves all opaque bytes
byte-for-byte and changes only fenced regions. This is the hardest milestone in the project
and it is fully testable without a browser.

**Built.** `src/doc/`: `parser.ts` (the Recast parser adapter), `fence.ts` (the marker format,
read and written in lines), `primitives.ts` (the §7 vocabulary, both directions), `opacity.ts`
(the §5 table, each construct to its named reason), `nodes.ts` (the derived index), `types.ts`,
and `index.ts` (`open`, `emit`, `apply`). `src/seamgraph/types.ts` carries the `SeamMap`
contract, which `Document` references.

**The §13.1 spike came back with a version incompatibility, not a formatting one.** Recast
0.24.0's bundled babel parser asks `@babel/parser` 8 for `pipelineOperator: { proposal:
'minimal' }`, which Babel 8 rejects outright, so the two packages do not work together as
shipped. The fix is Recast's own documented escape — `doc` carries a parser adapter — and Babel
8 enables modern syntax by default, so the adapter's plugin list is empty. With that in place
Recast's property holds exactly: an unmodified document reprints byte-for-byte, and a
one-literal edit changes one line, across template literals, optional chaining, and nullish
coalescing alike. **The fence strategy stands as designed.**

**Verified.** `npm test` — 54 tests. The property test generates 25 seeded edit sequences over
the corpus and asserts that no line outside a fenced region changes, that every opaque region
survives verbatim, that a reparse of unmodified output yields identical ids and bindings, and
that a sequence is byte-deterministic. Unit tests cover the §5 table construct by construct,
every refusal shape, rename propagation, rename refusal through an opaque region, fence
insertion that survives a reparse, and that an emitted module imports.

**Deferred to M5.** `apply` implements the ops this milestone can prove — `setFormula`,
`setPathOp`, `renameNode`, `addNode`, `removeNode`, `setMeasurement`, `setOption`. The editor's
own gesture surface will want more, and it is the right place to add them: the fence rules they
must obey are settled here and tested.

#### M3 — Seam resolution, placement, and drape

`seamgraph`, `avatar`, `place`, and the TypeScript `sim` adapter, driven from the command
line with a hand-authored `SeamMap`. Seams close, cloth settles, no penetration.

**Done when:** the product brief §7 simulation criteria pass, including determinism across
two runs and a drape driven end to end from a `.dressform` document.

Record how long the hand-authored seam map took. That number is the input to M6's
justification.

**`seamgraph` built; `avatar`, `place`, and `sim` still outstanding.** `src/seamgraph/` resolves
a `SeamMap` against a `DraftResult` — fraction sub-selection, direction reversal, mirror
expansion, and the length-tolerance check — with 11 tests against synthetic maps and
hand-computed arc lengths. A seam that cannot resolve is reported with the offending
`piece.path` and skipped, so one pass shows every broken seam rather than the first.

Fractions are measured against `pathLengths`, which is curve-accurate, and the tessellation is
used only to work out *where* a cut lands: a cut at arc length `s` sits at `s · polylineLength
/ curveLength` along the polyline. The two differ by hundredths of a millimetre, which is
inside most tolerances and outside this project's.

One thing mirror expansion deliberately does **not** do: reflect geometry. Arc length,
fraction, and direction are all invariant under reflection, and `§6.3`'s `sides` carries no
mirror axis, so the resolver emits a second seam with the id's side flipped (`shoulder.left` →
`shoulder.right`) and reports which pieces it expanded. Choosing where a mirrored copy sits on
the body is `place`'s job. If a design ever needs a mirror axis in the map, that is an addition
to §6.3 rather than a hidden assumption here.

#### M4 — Fit report

`fit` module, heat map, worst-seam callout, click-through to the 2D edge.

**Done when:** the report carries all three signals, and a deliberately-too-small
measurement set produces a `tight` verdict on the expected seam.

#### M5 — The 2D surface

Draw, drag, snap, dimension. Formula fields with measurement binding. The interaction model
in the editor spec §7 and §8.

**Done when:** a design can be drawn from scratch in the browser and emits source that
round-trips through M2's property test.

#### M6 — The seam editor

Click two edges, set direction, fraction, and mirroring, with live length validation.

**Done when:** the seam maps produced by the editor resolve identically to the hand-authored
ones from M3 for the same design, and the M3 authoring time is no longer on the critical
path.

#### M7 — The loop

Measurement change → re-draft → re-drape without a reload.

**Done when:** the product brief §7 loop criterion passes at under 10 seconds.

### v2 — Read-back

#### M8 — Static attribution

`trace` with the AST path: match recorded node identities against source spans.

**Done when:** for every stock design, nodes that can be attributed are editable, and nodes
that cannot are marked opaque with a named reason. Zero silent flattening.

#### M9 — Runtime trace

Instrumented execution: `Point`, `Path`, and `macro` passed into `draft()` as recording
proxies.

**Done when:** a design whose `draft()` generates points in a loop produces one traced node
per generated point, each attributed to the loop, and editing any of them is refused rather
than silently removing the loop.

#### M10 — Stock library editable

The criterion the read-back work exists for.

**Done when:** `aaron` opens fully editable, and `emit` after an edit round-trips losslessly
through M2's property test.

### Deferred past v2

| Item | Trigger to revisit |
|---|---|
| Rust/WASM solver tier | M7 complete, and the TS solver is the measured bottleneck |
| Inferred seam matching | M6's maps are judged too slow to author by hand per design |
| Anatomically morphed bodies | The readout is trusted enough that body accuracy is the limiting error |
| Scanned reference bodies | A scanner is in hand — see §7.4. Not a milestone trigger, a hardware one |
| DXF-AAMA export | Something outside the LAN needs to consume a pattern |
| Additional FreeSewing designs | M7 passes end to end |

---

## 12. Testing

| Layer | What it covers | Oracle |
|---|---|---|
| **Round-trip property** | Opaque bytes survive; only fenced regions change | Generated edit sequences over a corpus. **This is the project's central test.** |
| Unit — `doc` | Fence bookkeeping, node identity, rename propagation into seams, refusal cases | Synthetic sources with known expected output |
| Unit — `draft` | Shape conversion, `pathLengths` accuracy, `sa: 0` assertion, validation errors | Geometry computed analytically from known curves |
| Unit — `seamgraph` | Mirror expansion, fraction selection, direction reversal, tolerance | Synthetic maps with hand-computed expected arc lengths |
| Unit — `fit` | Strain aggregation, region bucketing, verdict thresholds | Constructed strain arrays with known answers |
| Determinism | Same scene twice ⇒ identical output | Bit comparison |
| Contract | `Document`, `DraftResult`, `SeamMap` validate against their schemas | JSON Schema validated in CI |
| E2E | Draw → seam → emit → draft → place → drape → readout | Playwright, one design, one assertion per stage |
| Bundle scan | No external origin in either built bundle | CI grep, fails the build |

**Three things deliberately not tested:** whether the drape looks realistic, whether the fit
verdict agrees with a tailor, and whether the generated code reads like hand-written code.
All three are judgement calls. None gates a release. Do not build a test that tries to
assert them.

---

## 13. Verification status of this document

**Verified from source, this session or the one before it:**

- FreeSewing's v4 plugin set and the `plugin-export-dxf` retirement notice; the
  `getRenderProps()` return shape; `sa` behaviour; `pattern-via-io`; the `Pattern` attribute
  and method list including `addPart()`, `sample()`, and multisets; the
  `@freesewing/studio` development environment.
- Recast 0.24.0 (MIT), `@babel/parser` 8.0.7 (MIT), `astring` 1.9.0 (MIT),
  `@babel/generator` 8.0.6 (MIT), `ts-morph` 28.0.0 (MIT) — all read from the npm registry
  this session.
- CSP: `blob:` in a script context is equivalent in effect to `'unsafe-eval'`. **This
  corrects document version 1.0**, which claimed the blob-module route avoided the
  allowance.
- Vina's licence, architecture, simulation spec, roadmap, contributing guide, and
  third-party notices; `oxihuman-physics` 0.2.1; JoltPhysics.js licence and feature matrix;
  the three.js `physics_ammo_cloth` example; the MPFB2/MakeHuman CC0 lineage.
- `dressform` free on crates.io, npm, and PyPI.

**Verified by building M1** (this session, against the installed tree):

- FreeSewing 4.10.2 publishes **no type declarations**. The ambient declarations in
  `src/freesewing.d.ts` and the structural shapes in `src/draft/freesewing.ts` exist because of
  that, and they are held to the installed version by hand.
- The `parts`-vs-`stacks` key shape: `pattern.parts[0]` is keyed by part id (`aaron.front`),
  and `pattern.autoLayout.stacks` is keyed by part name. This corrects the assumption carried
  since document version 1.0.
- `Path.prototype.length()`, `.measureAlong(point)`, and `.projectPoint(point)` all exist and
  agree with an independent polyline sample to well inside 0.1 mm on `aaron`'s real curves —
  the basis of the acceptance criterion in product brief §7.
- `part.snippets[*].def` and `.anchor`; `cutlist[partId].grain` in degrees; the `fabric` class
  marker that distinguishes an outline path from an internal one; `__isPartHidden(partId)`.
- `@freesewing/config` exports `measurements` and `degreeMeasurements`; `shoulderSlope` is the
  only degree-valued measurement in the set, and it is the only one `aaron` requires.
- **Two undeclared imports in published FreeSewing packages**: `@freesewing/plugin-annotations`
  imports `@freesewing/config`, and `@freesewing/core-plugins` imports
  `@freesewing/plugin-transform`, neither of which either package declares. The graph does not
  resolve without both, so both are direct dependencies here. See §10.
- **`hooks@0.3.2` declares its licence as `licenses: ["MIT"]`**, the pre-SPDX array form. It is
  MIT; the gate was reading the field wrongly. Fixed in `scripts/licence-gate.js`.
- The only two origins in `dist/server.js` — `freesewing.org` and `www.w3.org` — are XML
  namespace identifiers that FreeSewing writes into every rendered SVG. A namespace is a name,
  not an address. Allowlisted with that reasoning in `scripts/origin-allowlist.txt`.

**Verified by building M2** (this session, against the installed tree):

- **Recast 0.24.0 and `@babel/parser` 8.0.7 do not work together out of the box.** Recast's
  `parsers/babel` passes `pipelineOperator: { proposal: 'minimal' }`, which Babel 8 rejects.
  Supplying a parser object is Recast's documented escape, and it is what `doc` does. This
  corrects the assumption this section carried: the risk was the *combination*, not Recast's
  guarantee.
- **`@babel/parser` 8 needs no plugin list for FreeSewing's idiom.** Template literals, optional
  chaining, nullish coalescing, class properties, and destructuring all parse with `plugins: []`;
  Recast's stale list was the entire incompatibility.
- **Recast's reprint-only-changed property holds for that idiom.** An unmodified document is
  byte-identical after a parse/print round trip, and a one-literal edit changes one line. The
  §13.1 risk is closed, and the fence strategy stands as designed.
- **Recast attaches a region's *closing* marker to the statement that follows it**, not to the
  statement inside the region. Inventing fresh markers for a replaced statement is confirmed to
  shuffle and duplicate regions in a file that still parses. Recorded in editor spec §4.1.1.
- **Recast expands tabs before parsing**, so AST columns — and therefore byte offsets — can
  disagree with the original text while line numbers agree. `doc` works in lines; editor spec
  §4.1.2.
- Recast 0.24.0 (MIT) and `@babel/parser` 8.0.7 (MIT), read from the npm registry this session.

**Assumed, and to be confirmed by the implementer before relying on it:**

- That a design which imports `Point`/`Path` directly, rather than destructuring them from
  `draft()`'s arguments, can still be instrumented for `trace`. Module-alias interception
  would be required and has not been tested.
- The emit-plus-import latency budget for a drag frame, and therefore whether §4.2's escape
  hatch is needed at all.
- The performance budget for a TypeScript XPBD solver at default particle density on an
  Apple Silicon browser.

**Deliberately absent:** OpenAPI, RBAC, audit logging, rate limiting, and compliance
analysis. There is no backend, so their absence is correct rather than an omission.

---

## 14. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Undo/redo model: operation log or document snapshots | Operation log. The editor already produces a typed op stream for `doc`, and snapshots of a tree are cheap until they are not. |
| 2 | Is the seam map stored only inside the project file, or always exported as `seams/<design>.json`? | Always export. The 3D path then works without the editor, which is what makes M3 reachable before M5. |
| 3 | Does v1 need multi-design projects? | No. One document per file. Multi-design is a filing problem, not a modelling one. |
| 4 | Is `@freesewing/studio` still worth containerising for iPad access? | Probably not once M5 ships — the editor supersedes its drafting loop. Revisit at M5, and keep it on the Mac until then. |
| 5 | Does the printed SVG come from the server or the browser? | Server. It already exists at M1, and printing should not require the app to be open. |

---

## 15. Appendix

### File tree

```
dressform/
├── GLOSSARY.md
├── LICENSE                      # Unlicense
├── README.md
├── THIRD-PARTY-NOTICES.md
├── package.json
├── tsconfig.json
├── compose.yaml
├── Dockerfile                   # the drafter
├── Dockerfile.web               # static editor + API proxy
├── .github/
│   ├── workflows/{ci.yml,publish.yml}
│   └── dependabot.yml
├── src/
│   ├── doc/                     # AST document model
│   ├── draft/                   # FreeSewing adapter
│   ├── seamgraph/
│   ├── avatar/
│   ├── place/
│   ├── sim/
│   ├── fit/
│   ├── trace/                   # v2
│   └── server/                  # routes
├── web/                         # editor entry + 2D surface
├── seams/                       # exported SeamMaps, one per design
│   └── <design>.json
└── assets/
    └── bodies/                  # CC0 reference bodies
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "esbuild src/server/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server.js",
    "build:web": "esbuild web/index.ts --bundle --format=esm --target=es2022 --outfile=dist/web/app.js",
    "build:all": "npm run build && npm run build:web",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/*.test.js",
    "scan:origins": "node scripts/origin-scan.js",
    "licence:gate": "node scripts/licence-gate.js",
    "docker:build": "docker build -t ghcr.io/therebelrobot/dressform:local .",
    "docker:run": "docker run --rm -p 8091:8091 -v $(pwd)/seams:/app/seams:ro ghcr.io/therebelrobot/dressform:local",
    "docker:push": "docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/therebelrobot/dressform:latest --push .",
    "release:patch": "npm version patch -m \"chore: release v%s\" && git push && git push --tags",
    "release:minor": "npm version minor -m \"chore: release v%s\" && git push && git push --tags",
    "release:major": "npm version major -m \"chore: release v%s\" && git push && git push --tags",
    "release:tags": "git tag --sort=-v:refname | grep '^v'"
  }
}
```

`test` runs under `tsx` rather than under Node's native type stripping. The repo's convention is
extensionless imports, and native stripping resolves `./geometry` only if it is written
`./geometry.ts`. The loader is what lets unit tests import `src/` directly instead of only the
bundle. The integration test still boots the built `dist/server.js`, so `npm run build` remains
a prerequisite for a whole-suite `npm test` — which is why `ci.yml` builds before it tests.

### Workflow obligations

`publish.yml` carries: buildx multi-arch `linux/amd64,linux/arm64`; push to GHCR authorised
by the built-in `GITHUB_TOKEN` with `packages: write`; `docker/metadata-action` tags
(`latest` on the default branch, semver on `v*` tags, `sha-<short>`); GHA build cache scoped
per image; one matrix entry per image; `provenance: mode=max`; `sbom: true`;
`actions/attest-build-provenance` pushed to the registry.

`ci.yml` typechecks, bundles both targets, runs the round-trip property test, scans both
bundles for external origins, and builds both images.

`README.md` carries one note: GHCR packages start private and get flipped public after the
first run.

### ADR stubs

Write these during M0. Each meets the three tests: hard to reverse, surprising without
context, the result of a real trade-off.

| # | Title | Decision |
|---|---|---|
| 0001 | Geometry leaves the drafter as JSON, not DXF | DXF-ASTM carries layer numbers and no seam semantics; FreeSewing retired its DXF plugin at v3. JSON is the interchange. |
| 0002 | Seam topology is authored in the editor, not inferred | Inferred matching across arbitrary designs is a research problem. The editor makes authoring a two-click gesture. |
| 0003 | The syntax tree is the canonical document | Round-tripping through generated text means recovering intent from a program, and the tail never closes. Parsing into a tree and printing it back is lossless by construction, so the editor only has to understand what it edits and can preserve the rest verbatim. |
| 0004 | One evaluator, and it is the emitted code | Two evaluators means a conformance test that will drift. Emit-plus-import is slower per frame and truthful; speed comes from measuring before optimising, and any second evaluator carries a test. |
| 0005 | v1 authors, v2 reads back | Semantic attribution of arbitrary FreeSewing idiom — loops, macros, cross-part `store` — is the long tail. Everything v1 builds is what v2 needs, so the split costs sequencing and buys a working editor sooner. |
| 0006 | Simulation runs in the browser | The deploy target is a single-board aarch64 host; the browser has an idle GPU. |
| 0007 | No Rust in v1 or v2 | The local toolchain predates 1.85, so `edition = "2024"` fails to build. The `sim` seam admits a WASM tier later. |
