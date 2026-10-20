# Scaffold notes

The M0 scaffold is unpacked and M1 has been built on top of it. Everything the scaffold
marked as deliberately absent is now present: `package-lock.json` is generated and committed,
and all three design documents are in `docs/`. What remains is housekeeping before the first
push.

## Before the first push

- `nginx:alpine` in `Dockerfile.web` is a floating tag. Dependabot pins it on the first
  run, or set a minor now.
- Ports 8090 (editor) and 8091 (drafter) are arbitrary. Change them in `package.json`,
  `compose.yaml`, and `nginx.conf` if they collide.
- `erasableSyntaxOnly` in `tsconfig.json` needs TypeScript 5.8+. The scaffold resolves
  7.0.2, so it is satisfied; remove the flag if a future typecheck complains.

## What M1 added

`src/draft/` and the three routes on `src/server/index.ts`. Two things about that are worth
knowing before you touch it:

- Four `@freesewing/*` packages are pinned exactly. Two of them
  (`@freesewing/config`, `@freesewing/plugin-transform`) are direct dependencies only
  because published FreeSewing packages import them without declaring them, so the graph
  does not otherwise resolve. Do not remove them as "unused".
- `scripts/origin-allowlist.txt` gained two hosts, both XML namespace identifiers that
  FreeSewing writes into every rendered SVG. Read the comment there before adding a third.

Details, and the reasoning, are in `docs/technical-design.md` §10, §11 (M1), and §13.
