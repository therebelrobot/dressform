# 0002. Seam topology is authored in the editor

**Status:** Accepted
**Date:** 2026-10-19

## Context

Nothing in the source formats encodes which edge sews to which. FreeSewing names paths but records no seam relation, and DXF has no seam concept at all. Inferring the relation across arbitrary designs is a research problem, and a wrong inference is silent.

## Decision

Seams are defined by hand — two taps on the two edges that meet, with direction, fraction, and mirroring as properties. The v1 surface is the editor; a hand-authored JSON sidecar stays supported so the drape path works without the editor.

## Consequences

Authoring cost per design is real and must be measured before any inference work is justified. In exchange, a wrong seam is a visible mistake rather than a plausible-looking drape.
