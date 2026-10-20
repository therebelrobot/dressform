# 0005. v1 authors, v2 reads back

**Status:** Accepted
**Date:** 2026-10-19

## Context

Modelling a foreign FreeSewing design means attributing semantics to arbitrary JavaScript: loops that generate points, conditionals that change topology, `macro()` calls whose output is only knowable at runtime, and `store.get()` from another part. That is the long tail, and it is not the same problem as authoring a design the editor already fully understands.

## Decision

v1 authors new designs and round-trips them losslessly. v2 adds read-back of designs the editor did not author. The AST layer, the fencing, and the recording trace are all v1 work, because the round-trip mechanism is v1 even though its coverage is v2.

## Consequences

A working, useful editor arrives sooner. The import path is genuinely additive rather than a rework, which is what makes the split safe. The cost is that the stock FreeSewing library is not editable until v2.
