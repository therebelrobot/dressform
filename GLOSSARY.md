# Glossary

The domain vocabulary. A glossary and nothing else — no implementation detail, no decisions.

## Garment

| Term | Definition | Do not confuse with |
|---|---|---|
| **Piece** | One flat shape cut from fabric. FreeSewing calls it a `part`. | Panel, block |
| **Path** | A named line or curve within a piece: `armhole`, `neck`, `shoulder`, `hem`. | Edge, segment |
| **Seam** | A join between two paths on two pieces. The domain's primary relation. | Stitch |
| **Seam map** | The record of which paths sew to which, for one design. | Seam allowance |
| **Seam allowance** | Extra fabric beyond the sewing line. Zero here — simulation models net shapes. | Seam |
| **Notch** | An alignment mark on a path, used to match two edges during sewing. | Dart |
| **Dart** | A shaped fold removing fabric to fit a curve. | Pleat |
| **Grainline** | The fabric's warp direction. Sets the anisotropy axes of the simulated material. | Fold line |
| **Net** | A pattern drawn to the sewing line with no allowance. What simulation consumes. | Trimmed |
| **Toile** | The test garment sewn to check fit. The thing this project models. | Muslin (US synonym) |

## Physics

| Term | Definition | Do not confuse with |
|---|---|---|
| **Rest length** | The length an edge has in the flat pattern. The simulation's zero-strain reference. | Planned length |
| **Strain** | `(current − rest) / rest` for an edge. The fit signal. | Stress |
| **Particle** | One simulated point of the cloth mesh. | Vertex |
| **Substep** | One constraint-projection iteration within a frame. | Frame |
| **Convergence** | Seam closure residue and velocity both under threshold. | Settled |
| **Reference body** | The CC0 mesh the garment drapes on, scaled from the same measurements the pattern was drafted from. | Avatar, mannequin |

## Editor

| Term | Definition | Do not confuse with |
|---|---|---|
| **Construction node** | One step of the drafting recipe: a point or a path, with the formula that produced it. | Point (FreeSewing's runtime value) |
| **Formula** | The expression that computes a node. | Value |
| **Evaluated value** | The number a formula produced at the current measurements. | Formula |
| **Document** | The syntax tree, the seam map, and the settings. The project's canonical state. | Project file (its serialization) |
| **Fenced region** | A span of emitted source the editor owns and may rewrite. | Opaque region |
| **Opaque region** | A span of source the editor cannot model. Preserved verbatim; never rewritten. | Unparseable |
| **Provenance** | Where a node came from: which source span, or which runtime operation. | Source map |
| **Read-back** | Modelling a foreign design: source in, editable nodes out. | Import |
| **Author** | Creating a design in the editor. | Drafting |
| **Refusal** | A named, sourced reason the editor declines to model or emit. | Error |
| **Lossless or refuse** | The governing invariant. | Best-effort |

**Identification rule:** `piece.path` names an edge, and `node.id` names a construction step.
An index never does — indices shift across edits and silently corrupt a seam map.
