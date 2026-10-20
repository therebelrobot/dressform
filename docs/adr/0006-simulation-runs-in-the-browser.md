# 0006. Simulation runs in the browser

**Status:** Accepted
**Date:** 2026-10-19

## Context

The deploy target is an aarch64 single-board computer. Cloth simulation is the expensive part of the pipeline and parallelises badly on that hardware. A browser on a Mac or an iPad has a GPU and idles.

## Decision

The server drafts patterns and serves files. The browser models, evaluates, and simulates.

## Consequences

The container stays small and the image stays arm64-native with no emulation, and the server has nothing to scale. A headless batch renderer for overnight variance sweeps would need a second simulation path, and that is deliberately left out.
