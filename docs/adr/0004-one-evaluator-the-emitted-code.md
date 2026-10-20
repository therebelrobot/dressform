# 0004. One evaluator, and it is the emitted code

**Status:** Accepted
**Date:** 2026-10-19

## Context

The editor could evaluate its own in-memory model for speed, with the emitted module evaluated separately for export. That is two evaluators, and two evaluators drift — the preview would eventually disagree with the shipped output, and a conformance test would be the only thing holding them together.

## Decision

The preview is produced by emitting the FreeSewing module and importing it. There is exactly one code path from document to visible geometry.

## Consequences

The preview cannot diverge from what ships. Each commit pays an emit-plus-import cost, which is well under a frame at this geometry scale. If measurement ever shows otherwise, an in-memory transform may be added for the transient preview only, and that addition makes the seam real and carries a test asserting the two agree.
