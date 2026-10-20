# Third-party notices

dressform is released under the Unlicense (`LICENSE`). Work by others that this project
adapts or includes is listed here with its licence.

Nothing below is vendored yet — the scaffold has no runtime dependencies. This file records
what enters, and when.

## Code and formulations

### Ten Minute Physics — Matthias Müller
XPBD cloth, spatial hashing, and self-collision. To be adapted in `src/sim/`.
Source: Copyright 2022 Matthias Müller. MIT.

### PositionBasedDynamics
Dihedral bending gradients. To be adapted in `src/sim/`.
Source: Copyright 2015-present, PositionBasedDynamics contributors. MIT.

### Tissu
The `atan2(sin θ, cos θ)` bending-angle formulation. To be adapted in `src/sim/`.
Apache License 2.0.

### Recast
The parse/print layer for the AST document model (`src/doc/`).
Copyright Ben Newman. MIT.

### FreeSewing
The drafting engine (`src/draft/`). Copyright Joost De Cock. MIT.

## Data and assets

### Reference bodies — `assets/bodies/`
To be generated with MPFB2 for Blender from the MakeHuman base mesh and targets, which the
MakeHuman project releases under CC0 1.0. Body measurements from ANSUR II and NHANES.

## Not included

The following are copyleft and must not be vendored, copied, or adapted into this project:
Seamly2D, Valentina, Cloth Lab, opensew-2, and any Seamly2D-derived fixtures or sample
patterns (all GPL-3.0).

## Trademarks

Product names in the code and docs belong to their owners and appear only to describe
compatibility or compare behaviour. dressform is not affiliated with or endorsed by any of
them.
