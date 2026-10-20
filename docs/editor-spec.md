# dressform — Editor Specification

**Document version:** 1.0 · **Last updated:** 2026-10-18
**Companion:** `dressform-product-brief.md`, `dressform-technical-design.md`

This document owns the editor's document model, its parse/print pair, its opacity rules, and
its interaction model. The technical design document names the `doc` module's interface and
does not restate anything here.

---

## 1. What the editor is

A browser-native 2D drafting surface that produces FreeSewing source. You draw points and
paths, edit the formula behind any point, bind measurements, and define seams by tapping the
two edges that meet.

It is not a code editor with a preview. It is a drafting tool whose output happens to be
source code, and it is held to the standard a code editor would be held to: **opening a
file, changing one thing, and saving it must not alter anything else.**

That standard is the whole specification. Everything below exists to meet it.

---

## 2. The model is a construction history, not a constraint solver

Shapr3D's feel comes from two things that are easy to conflate: its **model** — an ordered
feature history — and its **solver** — a constraint solver that resolves underdetermined
sketches so that anything can be dragged.

The editor takes the first and skips the second, and the reason is not effort. It is that
FreeSewing source is an **imperative construction sequence**: a point is computed by a
formula from measurements and from earlier points. A solved constraint system has no unique
construction order, so recovering one from a solved sketch is a research problem rather than
a feature. An editor built on a solver could not emit FreeSewing code without solving that
problem first.

So: every point is derived, and dragging recomputes downstream. What you can drag freely is
the free inputs — measurements, options, and control-point offsets. Everything else follows.

This is the same model Seamly2D and Valentina use, thirty years old and well proven. What is
missing from the world is not the model. It is the interaction layer.

**Which half of Shapr3D this takes.** The editor keeps Shapr3D's *model* — an ordered history
that recomputes — and skips its *solver*, for the reason above. What it therefore has to match
is the *interaction*: the sketching gestures that make Shapr3D feel like drawing rather than
like filling in a form. **§8.4 is that standard, gesture by gesture**, and it is the reference
for how the surface behaves. `dressform-product-brief.md` §4 states the same thing as a scope
commitment.

### 2.1 What this costs

- No underdetermined dragging. A point whose formula you have not edited stays where its
  formula puts it. This is correct behaviour for a pattern, and it will still feel
  constrained the first time you try to nudge something. §8.4 exists to make that difference
  invisible rather than merely defensible: the drag, the live dimension, and the named free
  parameter are one gesture, not three.
- Every draggable handle needs a named free parameter behind it. "Drag this point" is really
  "edit this offset." The editor's job is to make that invisible — create the parameter on
  first drag, name it, and let you find it again later.

### 2.2 What this buys

- Emit is a printer, not a translator.
- Recompute is fast enough to run on every drag.
- The 3D drape can re-run on every commit, because the draft is cheap.
- FreeSewing's entire plugin and design ecosystem stays reachable, because the output is
  ordinary FreeSewing source rather than a subset dialect.

---

## 3. The document model

The **Document** is the project's canonical state: a syntax tree, a seam map, and settings.
It is what a `.dressform` file serializes.

```ts
interface Document {
  schemaVersion: 1
  design: string                       // a single word, [a-z] only
  units: 'mm'
  tree: SourceFile                     // the parsed root, Recast-compatible
  nodes: Map<NodeId, Node>             // derived index over tree; not serialized
  seams: SeamMap
  settings: { measurements: Record<string, number>; options: Record<string, unknown> }
}
```

`tree` is canonical. `nodes` is a derived index rebuilt on parse and updated on apply — it is
never the source of truth, and a disagreement between `nodes` and `tree` is a bug in `nodes`.

```ts
type NodeId = string                   // "n:front.shoulder"

type Node =
  | PointNode
  | PathNode
  | OpaqueNode

interface PointNode {
  kind: 'point'
  id: NodeId
  binding: Binding                  // where it lives: points.shoulder
  via: PointCtor                    // how it was made
  args: Formula[]
  value: [number, number]           // evaluated at current settings
  span: Span                        // source range, for fencing and diagnostics
}

interface PathNode {
  kind: 'path'
  id: NodeId
  binding: Binding
  ops: PathOp[]                     // move | line | curve | close
  value: Segment[]                  // evaluated polylines, for rendering + lengths
  span: Span
}

interface OpaqueNode {
  kind: 'opaque'
  id: NodeId
  span: Span
  bytes: string                     // the original source, verbatim
  reason: RefusalReason
}

interface Formula {
  expr: ExpressionNode              // the source expression, as AST
  source: string                    // as written, for round-trip fidelity
  evaluated: number | number[]
}
```

**The formula-plus-value duality is the non-obvious requirement.** FreeSewing's `draft()`
returns computed coordinates, not the expressions that produced them. The construction
recipe exists only because the document kept it. A node that stores a value without its
formula cannot be emitted, and a node that stores a formula without its value cannot be
drawn.

### 3.1 Node identity

Two things identify a node, and they do different jobs:

| Identity | Source | Job |
|---|---|---|
| **binding** — `points.shoulder` | The variable name in the source | Human-facing identity, and the primary key |
| **id** — `n:front.shoulder` | Fence marker in the emitted source | Guards against renames; lets the editor detect that a binding moved |

The id is derived from the binding when a node is created, and thereafter carried in the
fence. If an id and its binding disagree on the next parse, the node was renamed by hand:
the editor re-keys the id and follows any seam references. If it cannot, it refuses the
rename — see §6.

An index is never an identity. Indices shift across edits and silently corrupt a seam map.

---

## 4. Parse and print

`doc` delegates both directions to **Recast** (`recast` 0.24.0, MIT) over `@babel/parser`
(8.0.7, MIT).

Recast's guarantee is that it reprints only the parts of the tree that changed, preserving
the original formatting and comments everywhere else. That property is not a convenience
here — it is the entire round-trip mechanism. A printer that reflows the whole file would
make "change one thing, alter nothing else" impossible regardless of how good the tree is.

Why not the alternatives, all MIT and all rejected in the technical design §10:

| Candidate | Why not |
|---|---|
| `ts-morph` | Wraps the TypeScript compiler, whose printer drops comments unless they are hand-attached. Comment loss is the failure this document exists to prevent. |
| `astring`, `@babel/generator` | Both reprint the whole tree. Neither preserves the original formatting of untouched nodes. |

### 4.1 The fence format

Emitted source marks every region the editor owns:

```js
export const front = {
  name: 'aaron.front',
  draft: ({ part, points, paths, Path, Point, measurements, options }) => {
    // <dressform:region id="n:front.armholeC">
    points.armholeC = new Point(0, 0)
    // </dressform:region>
    // <dressform:region id="n:front.shoulder">
    points.shoulder = points.armholeC.shift(-90, measurements.shoulderToShoulder / 2)
    // </dressform:region>

    // hand-written region — the editor never writes here
    const ease = options.ease ?? 0

    // <dressform:region id="n:front.armhole">
    paths.armhole = new Path()
      .move(points.armholeC)
      .curve(points.shoulder, points.shoulder, points.armholeC.shift(90, 12))
    // </dressform:region>

    return part
  },
}
```

Rules the emitter follows:

1. Every modelled node is wrapped in exactly one region.
2. A region's `id` matches the node id in §3.1.
3. Regions are emitted in dependency order — a node's inputs appear before it.
4. Source outside any region is **free**: the editor never writes there, and never has.
5. A blank line separates regions, so hand edits land in a stable place.

The fence is an ordinary line comment. It is valid JavaScript, it survives formatting, it is
invisible in a diff that does not touch it, and it costs one line per node. The alternative
— a separate mapping file — would drift the moment someone edited the source in another
editor, which is precisely the situation the fencing exists to survive.

### 4.2 What commit means

`apply(doc, op)` is the only mutation path. It:

1. Applies the operation to `tree`.
2. Rebuilds the affected `nodes` entries.
3. Marks exactly those regions dirty.
4. Returns a new `Document`.

`emit(doc)` prints the tree. Recast reprints the dirty regions and copies the rest of the
file through unchanged. No diffing, no reformatting, no whitespace normalisation.

### 4.3 ProjectFile and Refusal

```ts
interface ProjectFile {
  schemaVersion: 1
  document: Document                    // tree serialized as source text, plus nodes
  exportedSource: string | null         // the .mjs last emitted, for diffing
}
```

The project file stores the tree as source text, not as a normalized JSON tree. Source text
is what Recast round-trips faithfully, and it stays readable in a diff. A `.mjs` file is
also a valid input: opening one parses it into a Document.

```ts
interface Refusal {
  kind: RefusalReason
  message: string
  spans: Span[]
  suggestion?: string
}

type RefusalReason =
  | 'loop'                              // for / while / do
  | 'conditional-topology'              // if / switch / ternary that changes what is built
  | 'unknown-call'                      // a call outside the primitive set in §7
  | 'computed-name'                     // points['cp' + i]
  | 'template-literal'
  | 'cross-part-store'                  // store.get(...) from another part
  | 'dynamic-macro'                     // a macro() whose output the model cannot see
  | 'unrepresentable-syntax'
```

A Refusal always names the reason and carries source spans. It is a value, not an exception:
callers decide whether a refusal degrades to inspector mode or blocks the operation.

---

## 5. Opaque regions

A region is **opaque** when its source span intersects a construct the model does not
represent. The detection rules, all of which produce a `RefusalReason`:

| Construct | Reason |
|---|---|
| `for`, `while`, `do` | `loop` |
| `if`, `switch`, or a ternary that changes what gets built | `conditional-topology` |
| A call to anything outside §7's primitive set | `unknown-call` |
| A member access with a non-literal key — `points['cp' + i]` | `computed-name` |
| A template literal | `template-literal` |
| `store.get(...)`, `store.set(...)` | `cross-part-store` |
| `macro(...)` where the emitted points cannot be attributed | `dynamic-macro` |
| An arrow function, function expression, spread, or rest pattern inside `draft()` | `unrepresentable-syntax` |

An opaque region is **preserved and never rewritten.** Its bytes are carried in the
`OpaqueNode` and printed back exactly as they arrived.

The detection is deliberately conservative. A conditional that only chooses a number — an
ease value, say — is representable as a formula and stays editable; a conditional that
chooses between two different path constructions is not, and goes opaque. Getting this
boundary wrong in the permissive direction is how a tool silently destroys someone's work.

---

## 6. The invariant: lossless or refuse

**Never emit a Document the model cannot faithfully represent.** This is the governing rule
of the whole project, and the failure it prevents is specific: a user opens a design, the
editor cannot represent their loop, they change a dart, it re-emits, and the loop is gone.
Users abandon a tool the first time that happens.

There are three states and no fourth:

| State | Behaviour |
|---|---|
| **Fully modelled** | Edit and emit freely. |
| **Partially opaque** | Edit the modelled regions. Opaque regions pass through byte-for-byte. Emit is allowed. |
| **Unmodelled** | Read-only inspector. Editing and emit are both disabled. |

### 6.1 The door rule

A design whose top-level structure the editor cannot model — a part whose `draft()` is
itself a loop, or a design assembled from parts the editor cannot see — opens in **inspector
mode** rather than refusing outright:

- The 2D and 3D views render normally.
- Every node is labelled modelled or opaque.
- Editing and emit are disabled, with the reason named and the source span highlighted.

Inspecting is useful. Editing something the editor will later mangle is not. The door rule
gives the first without the second, and it is why the refusal is a value rather than an
error: "cannot model this" is a mode, not a failure.

### 6.2 Renaming, and why it is a `doc` invariant

`SeamSpec.a.piece` and `.path` reference nodes by binding name. Renaming a node therefore
has a blast radius beyond the source, and the editor handles it in `doc` rather than in the
UI layer:

1. Rewrite every reference to the renamed binding in `tree`.
2. Re-key every `NodeId` derived from it.
3. Re-key every `SeamSpec` reference to it.
4. If any reference sits inside an opaque region, **refuse the rename** and name the span.

Step 4 is the one that matters. Renaming through a region the editor cannot rewrite would
orphan a seam silently, which is exactly the class of bug the seam map exists to make
visible. Refusing is the honest outcome.

---

## 7. The primitive vocabulary

The editor models a fixed set of construction primitives, chosen to mirror FreeSewing's API
one-for-one. **Every primitive the editor adds is one FreeSewing can already express**, so
the editor can never draw something the target cannot compile.

| Primitive | FreeSewing | Node |
|---|---|---|
| `Point(x, y)` | `new Point(x, y)` | point, `via: 'ctor'` |
| Shift by angle and distance | `point.shift(angle, distance)` | point, `via: 'shift'` |
| Rotate about an origin | `point.rotate(angle, origin)` | point, `via: 'rotate'` |
| Translate | `point.translate(dx, dy)` | point, `via: 'translate'` |
| Distance between two points | `point.distance(other)` | formula |
| Angle between two points | `point.angle(other)` | formula |
| Path start | `new Path().move(p)` | path op |
| Straight segment | `.line(p)` | path op |
| Cubic curve | `.curve(cp1, cp2, p)` | path op |
| Close | `.close()` | path op |
| Offset a path | `.offset(distance)` | path op |
| Notch on a path | `snippets` | snippet |

Anything outside this table is `unknown-call` and goes opaque. Adding a primitive is a
deliberate act with a test, not an emergent consequence of supporting one more FreeSewing
method.

---

## 8. Interaction model

**Surface: SVG.** A pattern is 20–200 points — a few thousand nodes at most. SVG gives
hit-testing, focus, and accessibility for free, and the render cost is irrelevant at this
scale. Canvas would be justified by node counts this project will never see.

**This is an interaction-design problem, not a performance one.** Nothing here is
compute-bound; the only latency that matters is in the evaluate loop (§10).

### 8.1 Pointer, Pencil, and touch

| Concern | Handling |
|---|---|
| Input | Pointer Events throughout. `pointerType` distinguishes pen, touch, and mouse. |
| Smooth strokes | `getCoalescedEvents()` inside `pointermove` — Safari coalesces Pencil samples otherwise. |
| Safari scrolling | `touch-action: none` on the surface, or a drag scrolls the page. |
| Palm rejection | Ignore `pointerType === 'touch'` while a pen pointer is active, and release on `pointerup`. |
| Pencil hover | `pointermove` with `pointerType: 'pen'` and zero pressure, on iPadOS 16+. Optional; use it for handle highlighting. |
| Pressure | Not used for geometry. Available if a future brush-style tool needs it. |

### 8.2 Snapping

Candidates, in priority order: existing points, a point's horizontal or vertical projection,
path endpoints, then the grid. Snapping is a modifier, never a mode — holding a key or long-
pressing disables it for one gesture.

### 8.3 Drag and free parameters

Dragging a derived point creates or edits the free parameter behind it, per §2.1: a named
offset, angle, or distance with a stable name, visible in the properties panel and
addressable from a formula. Creating three parameters by accident, one per drag, is the
failure mode to design against — a drag either finds an existing parameter or creates one
deliberately, and the properties panel always shows which.

### 8.4 Sketching parity with Shapr3D

**The standard.** The target is the feel of Shapr3D's sketch mode: you draw by dragging,
the geometry goes where you meant because it snaps, the dimension you care about is already
on screen and is tappable, and every edit recomputes immediately. §2 says *which half* of
Shapr3D the editor takes — the model, not the solver. This section says what that half has
to feel like, and it is the reference an implementer works against.

The table is the core loop. A gesture in it that has to be looked up has not been built.

| Gesture | In Shapr3D | In the editor |
|---|---|---|
| Draw a segment | Drag from A to B; the segment appears and snaps to the geometry it nearly touches | Drag on the surface; the path op is committed at pointer-up, snapped per §8.2's candidate order |
| Draw a point | Place it directly, or place it on something that already exists | Drag to place it, or type its formula without drawing at all (§14.4) |
| Read a dimension | Every sketch element carries a dimension label showing its live value | Every node carries its live dimensions: a path's length, a shift's angle and distance, a translate's dx and dy, a distance-between's result |
| Set an exact value | Tap the dimension label and type a number — or a simple expression, `50/2` — or open a numpad | Tap the dimension label and type a **formula**: `measurements.chest / 4`, `shoulderToShoulder * 0.5`. Strictly a superset of Shapr3D's arithmetic, and the reason this editor exists rather than a sketcher |
| Drag an entity | Drag it and the sketch re-solves under the constraints it carries | Drag a handle and the construction recomputes. What the drag changes is the *free parameter* behind the handle, not a solved position (§2.1) |
| Snapping | Automatic and inferred, with on-canvas badges naming each constraint it just added | Automatic, but for **one gesture only** (§8.2): a snap positions this input and leaves nothing behind |
| Selection | Tap to select; the properties for that selection appear | Tap to select; the properties panel shows the node's formula, its evaluated value, and the free parameter that owns it |
| Definition state | The sketch recolours when it is fully defined versus still under-defined | Not shown, because there is nothing to show: every node is either derived from a formula or *is* a free parameter, so the question "is this defined?" never has a second answer |
| Pencil | Draw with the Apple Pencil, type with the keypad | The same split. §8.1 covers coalesced events, palm rejection, and `touch-action` |

**The one difference, and how to hide it.** In Shapr3D a drag moves a point and a solver
decides what that implies. Here a drag edits a named input, because there is no solver to
consult (§2). Every other gesture is identical, so the work is to make that difference
invisible:

- One drag creates or finds **exactly one** free parameter.
- The parameter is named and shown in the properties panel the moment it exists.
- The dimension displayed live during the drag **is** that parameter, so reading it and
  editing it are the same object.
- A handle never exists without a parameter behind it, and no handle ever collects two.

**What is deliberately not copied: constraints that persist.** In Shapr3D an auto-added
horizontal constraint stays in the sketch and resists the next edit. That is the right trade
for a mechanical part, whose geometry is the point. It is the wrong one for a pattern, where
the point of a node is that a formula explains it and a measurement can move it. So a snap
here is an aid to one gesture, and the value it produced is written into the formula, where
it stays visible and editable. The editor never leaves an inference in the document that the
user did not type.

**Deliberately not tested.** Whether this feels right is a judgement call, made by the
person who uses it. §13 says so, and a test that tries to assert it will be noise.

---

## 9. Defining seams

Seam definition is a two-tap gesture and it is the reason this editor exists rather than a
hand-authored sidecar file.

1. Tap edge A. The editor highlights every candidate edge whose length is within tolerance.
2. Tap edge B. The seam is created.
3. Adjust: `direction` (auto-set to the shorter reversal), `fraction` (defaults to the full
   path, draggable), and `mirroring` (auto-detected from a mirrored piece).

Live feedback while both edges are selected:

- **Length delta** in millimetres, with a pass/fail against `SeamMap.lengthTolerance`.
- Which portion of A pairs with which portion of B, drawn as a linked highlight.
- The draft edge lengths, so a mismatch is visible before any simulation runs.

Three details that make the gesture work:

- **Direction is shown, not hidden.** Seams run head-to-tail in opposite directions, and
  reversing this is the most common bug in garment simulation. The editor draws an arrow
  along each edge so the pairing is legible without reading the JSON.
- **Fraction is draggable.** Splitting a side seam around a dart is a drag on the seam, not
  a numeric edit.
- **Mirroring is a property of the piece**, set once, so `SeamMap.sides.mirror` stays the
  only place a piece is duplicated.

The seam map is always exported alongside the source as `seams/<design>.json`. That is what
lets the 3D path run without the editor, and it is why the drape milestone is reachable
before the editor exists.

---

## 10. The evaluation loop

**One evaluator, and it is the emitted code.**

```
commit → emit(doc) → source
       → Blob(source, 'text/javascript') → URL.createObjectURL → import()
       → FreeSewing draft → paths, lengths, SVG
       → render 2D + rebuild SceneBundle → 3D
```

The preview *is* the code path. What you see cannot diverge from what you ship, because
there is only one of them.

### 10.1 Two things that bite

**The module registry grows with every emit.** Each `import()` of a fresh blob URL adds a
module to the registry for the lifetime of the document. Importing per drag frame leaks
steadily. So: import on **commit only**, never per frame, and `URL.revokeObjectURL()` the
previous URL after the new module has resolved.

**The eval allowance is real.** Importing a runtime-built module needs an eval-equivalent
CSP allowance, and `blob:` is equivalent to `'unsafe-eval'` rather than narrower than it. See
the technical design §9.1 for why that is acceptable here and where the boundary sits.

### 10.2 The latency budget, and the escape hatch

Emit plus import plus draft should land under roughly 8 ms for a pattern at this scale, which
leaves room in a 16 ms frame.

If measuring shows it does not, the escape hatch is an in-memory transform for the
**transient** preview only, with the committed state always re-emitting and re-evaluating.
The moment that hatch is used, there are two evaluators, the seam becomes real, and it
carries a test asserting they agree. Do not add it speculatively; measure first.

---

## 11. Read-back (v2)

Read-back is modelling a **foreign** design — one the editor did not author. It is the long
tail, and it is deferred so that v1 can ship.

Two sources, complementary rather than alternative:

| Source | Sees | Misses |
|---|---|---|
| **Static attribution** over the AST | Where a node came from — the exact source span | What a loop or macro actually produced |
| **Runtime trace** — `Point`, `Path`, and `macro` passed into `draft()` as recording proxies | What was actually built, including everything generated at runtime | Which source expression produced it |

Union them and every node has both an identity and a source span. Nodes the union cannot
attribute are marked opaque with a named reason, and **editing them is refused rather than
flattening whatever produced them.**

From the actual source of `brian`, `aaron`, and `bent`, the constructs that will need this:
point loops, topology-changing conditionals, `macro('neckOpening', …)`, `utils.*` geometry
helpers, and cross-part `store`. Attribute what you can, refuse the rest, and never guess.

One assumption to test before building this: a design that imports `Point` or `Path`
directly, rather than destructuring them from `draft()`'s arguments, escapes proxy
injection and would need module-alias interception. Unverified — see the technical design
§13.

---

## 12. Diagnostics

The refusal surface is a first-class view, not a console log: every refusal, its reason, its
source span, and a link to the code. A design with forty opaque regions should show forty
entries with a summary, not a wall of text.

Local only, never transmitted:

| Signal | Threshold worth surfacing |
|---|---|
| Emit + import + draft latency | p95 above 8 ms — the escape hatch in §10.2 becomes worth measuring properly |
| Opaque region count | Any increase after an edit is a bug, not a statistic |
| Fence integrity | An id whose binding disagreed on reparse — expected after a hand rename, unexpected otherwise |
| Round-trip diff | Emitting an unmodified document must produce byte-identical output. Anything else is a Recast behaviour to investigate. |

---

## 13. Testing the editor

| Test | What it asserts |
|---|---|
| **Round-trip property** | For every corpus design and every generated op sequence, `emit(apply(open(src), ops))` preserves all opaque bytes byte-for-byte and changes only fenced regions. **This is the central test of the project.** |
| Identity stability | A reparse of unmodified output produces the same node ids and bindings |
| Rename propagation | Every reference updates, and a rename through an opaque region is refused with the span named |
| Fence integrity | Every modelled node has exactly one region; no region is nested; regions are in dependency order |
| Opacity boundary | The §5 table, case by case — each construct produces its named reason |
| Refusal shape | Every refusal carries a reason and at least one span |
| Determinism | The same document drafts to the same geometry twice |
| Interop | `import()` of an emitted module resolves, and `revokeObjectURL` is called for every URL created |

**Deliberately not tested:** whether the emitted code reads like hand-written code, and
whether the editor's interaction feels right. Both are judgement calls, and a test that
tries to assert either will be noise.

### 13.1 One thing to test early

Recast's reprint-only-changed guarantee is documented but not universal across syntax. Before
building on it, write the round-trip property test against a corpus that includes template
literals, optional chaining, and nullish coalescing — the constructs most likely to reflow.
If any of them reprint whole-file, that changes the fence strategy and it is much cheaper to
find out at M2 than at M5.

---

## 14. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Does the editor own the `draft()` prologue — the destructuring line — or leave it free? | Leave it free and emit it once. It is boilerplate the user should be able to edit, and it is not a node. |
| 2 | Are measurements edited in the editor or only in the server's `/designs` schema? | In the editor, but validated against the server's schema. The editor is where you are looking at the pattern. |
| 3 | Multi-piece duplication: mirroring only, or a general copy-with-reference? | Mirroring only in v1. A general copy breaks `sides.mirror` as the single place a piece is duplicated. |
| 4 | Does the properties panel edit formulas as text, or as a constructed expression builder? | Text first, with autocomplete for measurements, options, and node bindings. A builder is a later nicety. |
| 5 | Should opaque regions be editable in a plain-text escape hatch inside the editor? | No in v1. Any edit path that mutates opaque bytes weakens §6's invariant, and the plain-text path already exists: a text editor. |
