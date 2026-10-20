# 0007. No Rust in v1 or v2

**Status:** Accepted
**Date:** 2026-10-19

## Context

The XPBD solver has a natural Rust/WASM tier and the ecosystem has mature options. But the local toolchain predates 1.85, so a manifest requiring `edition = "2024"` fails to build, and a stale toolchain produces failures that look like project bugs.

## Decision

v1 and v2 are TypeScript only, including the reference solver. The `sim` seam is defined so a WASM tier can drop in later without touching its callers.

## Consequences

One language, one toolchain, no cross-compilation in CI. The TypeScript solver is slower than a WASM tier would be, and if it becomes the measured bottleneck that is the trigger to revisit this, not a reason to pre-empt it.
