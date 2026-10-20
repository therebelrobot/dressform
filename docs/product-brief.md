# dressform — Product Brief

**Document version:** 2.0 · **Last updated:** 2026-10-18
**Supersedes:** v1.0 (2026-10-17)
**Tier:** Lightweight (`rrf-00-triage`)
**Companion:** `dressform-technical-design.md`, `dressform-editor-spec.md`

**What changed in 2.0:** the 2D editor is now in scope, which promotes seam definition
from a hand-authored sidecar file to an in-editor gesture. The work is split into two
versions — **v1 Author** and **v2 Read-back** — so the editor can be working and useful
before the read-back problem is solved.

---

## 1. The problem

A drafted sewing pattern and a worn garment are two different objects. Nothing in the
current toolchain connects them.

FreeSewing generates a pattern from body measurements. It is a drafting engine:
measurements in, flat geometry out. It carries no 3D, no collision, and no feedback
signal. The only way to learn whether a draft fits is to cut fabric, sew it, and put it
on a body — which is what a toile is for, and costs an evening plus the fabric each time.

The gap is a **feedback loop**. Today: draft → sew → find the armhole too deep → guess at
a measurement → draft → sew. Every iteration costs a physical garment.

There is a second gap underneath it. FreeSewing designs are **code**, and the only way to
author one is to write it. The upstream studio gives a live preview, which is the right
tool for writing code, but it is not a drafting surface: you cannot draw a neckline and
see the code appear. Anyone who thinks in shapes rather than in formulas is locked out of
FreeSewing, and anyone who thinks in formulas still cannot see which edges sew to which.

### 5 Whys

| # | Question | Answer |
|---|---|---|
| 1 | Why does pattern iteration cost a physical garment? | Fit is only observable on a real body in real fabric. |
| 2 | Why only physically? | Nothing in the toolchain simulates fabric against a body. |
| 3 | Why not? | FreeSewing is a 2D drafting library. 3D sits outside its scope by design. |
| 4 | Why not reach for commercial 3D? | CLO3D, Marvelous Designer, and Browzwear are subscription desktop apps: no self-host path, no FreeSewing integration, no LAN story. |
| 5 | Why does that matter? | The value is a *tight* loop. A per-seat cloud tool cannot be scripted into an agentic workflow. |

**Root cause:** the drafting engine, the authoring surface, and the fit oracle are three
separate concerns, and no free, self-hostable, scriptable tool covers more than one.

---

## 2. Who this is for

**Primary and only user: Aster.** Single user, LAN-only.

This is a personal tool specified well enough to be published. A public launch would be a
separate initiative with its own triage; the open questions in §8 then become blockers
rather than notes.

---

## 3. The journey

**Before**

1. Enter measurements into FreeSewing.
2. Print, tile, tape, cut, sew.
3. Try on. Notice the shoulder is wrong.
4. Guess an adjustment. Return to 1.

Cost per iteration: one evening, some fabric, low confidence the guess was right.

**After**

1. Draw the pattern in the editor. Define the seams by clicking the two edges that meet.
2. Watch it draft, sew, and drape on a body — seconds.
3. Read where the strain concentrates.
4. Adjust a measurement, an option, or a control point. Return to 1.

Cost per iteration: seconds. The physical toile is still sewn — once, on the version that
already looks right.

The drafting loop and the fit loop run in the same window, because they are the same
question asked at two different sizes.

---

## 4. Scope

### In, v1 — Author

- A 2D drafting surface: draw points and paths, drag them, edit the formula behind any
  point, bind measurements. Held to the sketching standard in `dressform-editor-spec.md`
  §8.4 — the gestures match Shapr3D's sketch mode; the model stays a construction history.
- Seam definition by clicking two edges. Direction, fraction, and mirroring as properties.
  Live length validation.
- Emit FreeSewing source from the editor.
- **Lossless round-trip of source the editor authored.** Hand-edit the emitted `.mjs`,
  re-import it, lose nothing. Anything the editor does not model is preserved verbatim.
- Resolve a seam map and place pieces around a reference body.
- Simulate seam closure and drape.
- Report a per-region fit readout: strain, penetration, slack.
- Re-run draft → drape on a change with no page reload.

### In, v2 — Read-back

- Model foreign FreeSewing designs: loops, conditionals, macros, cross-part `store`,
  `utils.*` calls, computed names.
- The stock library (Aaron, Brian, Simon, Bent, Bella, Breanna, Titan) becomes editable.
- A recording trace that captures what a design actually built at runtime, paired with
  source spans so every node has provenance.

### Out

| Not doing | Reason |
|---|---|
| Replacing a sewn toile | The readout tells you *where to look*. Strain is not fit. See §6. |
| Ingesting geometry back into FreeSewing | FreeSewing patterns are code. Measurements are its only input. |
| DXF-AAMA/ASTM as the interchange path | FreeSewing retired its DXF plugin at v3, and DXF carries no seam semantics. |
| Grading, marker export, tech packs | Commercial CAD territory. |
| A general 3D modeller | This is a pattern tool. |
| Accounts, sync, sharing, multi-user | One user, one LAN. |
| A native app | Browser only. Safari on the iPad with Apple Pencil is the target. |
| Photorealistic rendering, fabric textures, an AI copilot | Not the problem being solved. |
| A constraint solver | The editor's model is a construction history, not a solved sketch. See §5. |

---

## 5. Technical context

Detail and rationale live in the companion documents.

- **Three surfaces, one origin.** A drafting service (Node + `@freesewing/core`), a static
  editor build, and a 3D viewport — the same shape as the existing samplevault deployment.
- **The editor's model is a construction history, not a constraint solver.** Shapr3D's
  *feel* comes from a solver that resolves underdetermined sketches; its *model* is an
  ordered feature history. FreeSewing source is an imperative construction sequence, and a
  solved constraint system has no unique construction order — recovering one is a research
  problem, not a feature. So the editor keeps the history and skips the solver. Drag an
  input; everything downstream recomputes. Most of the sketching gestures survive the split,
  and `dressform-editor-spec.md` §8.4 is the list of which, and what each one does.
- **FreeSewing source is parsed, not generated-and-reparsed.** The syntax tree is the
  canonical document. Emit is a printer; import is a parser. Neither direction loses
  anything, because the tree is never thrown away. This is the decision that makes
  lossless round-trip tractable — see `dressform-editor-spec.md`.
- **Simulation runs in the browser.** The Docker host serves files and drafts patterns;
  the Mac and iPad run the physics. This is what makes the tool viable on an aarch64
  homelab host.
- **Prior art for study:** `sssamuelll/vina` (MIT), a browser-native pattern editor with
  XPBD cloth, auto-sew, and avatars. Also Seamly2D and Valentina, whose construction-history
  plus formula model is the same shape this editor uses. Read them. Do not depend on them
  in v1.
- **Licences:** MIT (FreeSewing, Recast, the XPBD tutorial structure, PositionBasedDynamics,
  Vina), Apache-2.0 (Tissu bending formulation), CC0 (MakeHuman/MPFB2 bodies). Unlicense
  for this project.

---

## 6. What "fit" means here

Stated plainly, because this is the most likely source of disappointment.

The simulation reports three signals:

| Signal | Measures | Means |
|---|---|---|
| Seam strain | Deviation of a seam's current length from its drafted length | The pattern wants this seam longer or shorter than the body allows |
| Collision pressure | Penetration depth against the body mesh | The garment is too tight, or the drape pulled it inward |
| Displacement | How far a piece slid from its placed position | Slack fabric — a symptom of a too-loose or mis-shaped piece |

**What it does not measure:** whether the garment looks right, whether the armscye sits
where a tailor wants it, or how a different fabric changes the answer. Real fabric has
weight, stretch, and recovery that a preset approximates. A garment can show low strain on
a form and still be uncomfortable on a body that moves.

**The honest framing:** dressform models the dress form. It narrows the search. It does not
close it.

---

## 7. Success criteria

Given/When/Then. UAT judges against these.

### Handoff

- **Given** the three documents in this set, **when** an implementing agent reads them
  start to finish, **then** it can name every module, state each interface, say which
  seams are real and which are hypothetical, and identify which version each milestone
  belongs to — without asking a follow-up question.

### v1 — the editor

- **Given** a saved `.dressform` project, **when** it is reopened, **then** every node,
  formula, seam, and setting is identical to the state at save.
- **Given** a design authored in the editor, **when** its emitted `.mjs` is hand-edited by
  adding a statement the editor does not model, **then** re-importing preserves that
  statement byte-for-byte and marks the surrounding region opaque.
- **Given** a design containing an opaque region, **when** the editor emits, **then** the
  opaque bytes are unchanged and editing is disabled inside them.
- **Given** a design the editor cannot model, **when** it is opened, **then** it opens in
  read-only inspector mode, names the reason, and disables emit.
- **Given** a node rename in the editor, **when** the seam map references that node,
  **then** either the references are re-keyed or the rename is refused, and never silently
  orphaned.
- **Given** someone who sketches in Shapr3D, **when** they draw a pattern here for the first
  time, **then** they can draw a segment, drag a handle, read the live dimension on it, and
  type an exact value into that dimension without asking how. Judged by that person against
  `dressform-editor-spec.md` §8.4. Not machine-testable, and deliberately so — see that
  document §13.

### v1 — the seam map

- **Given** a seam whose two edges differ in length by more than the configured tolerance,
  **when** it is defined, **then** the editor names both edges and both lengths before any
  simulation runs.
- **Given** a seam referencing a path absent from the draft, **when** it resolves, **then**
  resolution fails naming the offending `piece.path`.

### v1 — drafting and simulation

- **Given** a valid measurement set and a design, **when** `POST /draft` is called, **then**
  the response carries an SVG and a `DraftResult` whose every `pathLengths` value sits
  within 0.1 mm of the length measured on the rendered SVG.
- **Given** a resolved scene, **when** the solver converges, **then** total seam closure
  residue is under 1 mm and no particle sits more than 2 mm inside the body mesh.
- **Given** the same scene run twice with the same seed and substep count, **then** final
  particle positions are bit-identical.

### v1 — the loop

- **Given** a completed drape, **when** one measurement changes and the loop re-runs,
  **then** the new drape and readout appear without a reload, within 10 seconds at default
  resolution.

### v2 — read-back

- **Given** the stock `aaron` design, **when** it is opened, **then** every point and path
  is editable and the round-trip through emit is lossless.
- **Given** a design whose `draft()` contains a loop generating points, **when** it is
  opened, **then** the generated nodes appear with provenance pointing at the loop, and
  editing them is refused rather than silently flattening the loop.
