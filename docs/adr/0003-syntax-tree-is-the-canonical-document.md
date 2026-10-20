# 0003. The syntax tree is the canonical document

**Status:** Accepted
**Date:** 2026-10-19

## Context

Round-tripping through generated text means recovering design intent from a program: loops, conditionals, macros, cross-part store access, and computed names. The 15-30% of a real design that does not fit a tidy idiom is exactly the part most worth editing, and that tail never closes.

## Decision

FreeSewing source is parsed into a syntax tree that is kept as the document. Emit is a printer; import is a parser. The editor manipulates the idioms it understands and prints every unrecognised subtree back verbatim.

## Consequences

Round-trip is lossless by construction rather than by analysis. The editor never has to understand a loop, only to preserve it. This is the decision that makes the whole project tractable, and it is expensive to reverse because every module above it assumes it.
