# dressform

**Draft flat. Drape true.**

A browser-based 2D sewing-pattern editor that emits FreeSewing source and drapes the sewn
garment on a body in 3D. Self-hosted, Apple Pencil, no account.

## Status

Scaffold (M0). The deployed app serves `/healthz` and a smoke-test page that proves the
static asset → reverse proxy → API path end to end. See `docs/technical-design.md` §11 for
the milestone plan.

## What it does

You draw pattern pieces the way you would sketch them: drag a point and the construction
recomputes, edit the formula behind any point, bind a measurement. Define a seam by tapping
the two edges that meet — the editor shows both edges' drafted lengths and flags a mismatch
before anything is simulated.

The editor emits ordinary FreeSewing source, so the whole FreeSewing ecosystem stays
reachable. The same document drives a cloth simulation, so you see the garment sewn and
draped before any fabric is cut.

The governing rule is **lossless or refuse**: the editor never emits a document it cannot
faithfully represent, and it never silently discards something it does not understand.

## Documentation

| Document | Owns |
|---|---|
| `docs/product-brief.md` | Why this exists, scope, the v1/v2 split, acceptance criteria |
| `docs/technical-design.md` | Modules, seams, contracts, simulation, delivery plan |
| `docs/editor-spec.md` | The document model, fencing, opacity, the invariant |
| `docs/adr/` | Decisions that are hard to reverse |
| `GLOSSARY.md` | Domain vocabulary — garment, physics, editor |
| `AGENTS.md` | Pointers and invariants for an agent working in this repo |

## Development

Node 22 or newer.

```bash
npm ci
npm run dev          # server on :8091
npm run build:all    # bundle the server and the editor
npm run typecheck
npm test
```

## Deployment

Multi-arch images (`linux/amd64`, `linux/arm64`) publish to GHCR on every `v*` tag and on
pushes to the default branch:

- `ghcr.io/therebelrobot/dressform` — the drafting service
- `ghcr.io/therebelrobot/dressform-web` — the editor

**GHCR packages start private.** After the first successful `publish.yml` run, open each
package's settings and flip its visibility to public. Until that happens, nothing outside an
authenticated `docker login` can pull the image.

`compose.yaml` brings up both containers. The drafting service sits on an `internal` network
with no route out; the editor container holds the only published port and proxies API paths
to the drafting service.

## Licence

Unlicense. See `LICENSE`.
