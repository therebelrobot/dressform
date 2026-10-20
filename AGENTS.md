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

## Where the work is

`docs/technical-design.md` §11. M0 is this scaffold. M1 is the drafting service behind
`POST /draft`.
