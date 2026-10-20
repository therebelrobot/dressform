# 0001. Geometry leaves the drafter as JSON, not DXF

**Status:** Accepted
**Date:** 2026-10-19

## Context

FreeSewing can emit DXF-ASTM, and the industrial world expects DXF-AAMA/ASTM for pattern handoff. But FreeSewing retired its DXF export plugin at v3, so the path is unmaintained; and DXF carries layer numbers rather than meaning, with no concept of one edge sewing to another.

## Decision

The drafter emits `DraftResult` JSON. DXF is not an interchange path in this project.

## Consequences

Pattern handoff to an external cutting room needs a new exporter later. Nothing in the pipeline depends on DXF, so adding one is additive rather than a rewrite.
