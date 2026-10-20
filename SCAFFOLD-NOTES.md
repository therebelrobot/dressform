# Scaffold notes

This archive is the M0 scaffold. Two things are deliberately absent.

## package-lock.json

Run `npm install` once in the repo root to generate it, then commit it. Both Dockerfiles
use `npm ci`, which requires a lockfile, so the first `docker build` fails without it.

Regenerate it on your own machine if you prefer; the lockfile is platform-independent but
was generated on Node 24.

## The three design documents

`docs/product-brief.md`, `docs/technical-design.md`, and `docs/editor-spec.md` are not in
this archive — roughly 78 KB, kept out so the delivery page stays small enough to render.

The repo expects them: `AGENTS.md` and `README.md` both point at them, and
`.dockerignore` excludes `docs` from the images, so nothing breaks at build time, but the
repository is incomplete without them.

## Before the first push

- `nginx:alpine` in `Dockerfile.web` is a floating tag. Dependabot pins it on the first
  run, or set a minor now.
- Ports 8090 (editor) and 8091 (drafter) are arbitrary. Change them in `package.json`,
  `compose.yaml`, and `nginx.conf` if they collide.
- `erasableSyntaxOnly` in `tsconfig.json` needs TypeScript 5.8+. The scaffold resolves
  7.0.2, so it is satisfied; remove the flag if a future typecheck complains.
