# bodies

Two CC0 reference bodies, and the manifest that records where they came from.

## What is here

| File | What |
|---|---|
| `manifest.json` | Licence, upstream commit, input digests, units, coordinate system, variant scales |
| `male-young.json` | A male reference body, 1.786 m |
| `female-young.json` | A female reference body, 1.637 m |

Each body is one JSON document:

- `units: "metres"`, `up: "+y"`, right-handed, `x` right / `y` up / `z` front —
  three.js's convention, so nothing is rotated at load.
- `positions` is a flat `[x, y, z, …]` and `indices` a flat triangle list, at four
  decimals. 0.1 mm at this scale, which is inside the tolerances the project works
  at, and it keeps the file to about a megabyte.
- `scales: [0.95, 1.0, 1.05]` — the three variants §7.4 asks for. They are a
  uniform scale, so they are a scalar rather than three copies of the geometry.
  See "Why the variants are a scalar" below.
- `bounds` and `height` are the mesh's own, so a consumer can check its load.
- `joints` maps ten rig joint names to positions, and `bodyRange` is the span of
  vertices that is the body itself. `avatar` anchors on both; see below.

19,158 vertices and 36,972 triangles each — upstream's full base mesh. Fingers,
toes, and face are present and are *not* decimated, because decimation would
change the surface the cloth collides with.

The pose is MakeHuman's default rest pose, exactly as upstream ships it. It is
not a T-pose: the arm span is 1.14 m against a 1.79 m height, so the arms hang
close to the body. That is convenient for a dress form and it is not a decision
this repo made.

## Where it came from

Both bodies are the MakeHuman base mesh with one macrodetails target applied.

| | |
|---|---|
| Repository | `makehumancommunity/makehuman` |
| Commit | `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` |
| Base mesh | `makehuman/data/3dobjs/base.obj` — sha256 `8e761e66…` |
| Male target | `macrodetails/caucasian-male-young.target` — sha256 `70e228ba…` |
| Female target | `macrodetails/caucasian-female-young.target` — sha256 `118379f6…` |
| Joint table | `makehumancommunity/mpfb2` at `b1a2dc98…`, `basemesh_vertex_groups.json` — sha256 `8cb1417b…` |
| Licence | **CC0 1.0 Universal** — `LICENSE.ASSETS.md` at the root of *both* repositories |

### The joint table, and why a second repository

Each body also carries `joints` — ten rig joint positions — and `bodyRange`, the span of
vertices that is the body itself. Both come from the mesh's named vertex groups, which live in
**MPFB2** rather than MakeHuman. MPFB2 is two things under two licences: GPLv3 source and CC0
data, and this is the data. Neither its source nor its plugin is used or shipped.

They matter because `avatar` anchors on them. Its first version found the chest, waist, and
hips by looking for the widest and narrowest cross-sections in windows of height, and that is
wrong in a way worth recording: **the widest loop at chest height is not the chest.** With the
arms at the sides a horizontal slice merges them into the torso, which is how a body with a
1.0 m chest reports a 1.36 m girth. `joint-spine-1` is the chest, `joint-spine-3` the waist,
`joint-pelvis` the seat, and the shoulder joints give the width beyond which a segment belongs
to an arm. `bodyRange` excludes the helper geometry — eyes, teeth, hair — which had been
slicing the head into two dozen tiny loops.

A vertex count, a file size, and "it loads fine" would none of them have caught either
failure. The tests do, and one of them asserts the arm inflation still happens without the
lateral cut, so the reason for the cut cannot quietly stop applying.

Every input carries its own CC0 statement in its header:

> This asset was explicitly released as CC0 in september 2020. The license text
> for CC0 can be found in the root of this repository.

No attribution is required. It is given anyway.

### Why MPFB2 is not a dependency

§7.4 asks for bodies "generated with MPFB2". MPFB2 is two things under two
licences: its source is **GPLv3**, and its bundled assets are **CC0** (its own
`LICENSE.ASSETS.md`). Vendoring GPLv3 code into an Unlicense project is not on,
and requiring Blender to regenerate a mesh is a poor trade for a repository that
has no other GUI dependency.

`scripts/build-bodies.py` applies the same CC0 targets to the same CC0 base mesh
in plain Python — which is the whole of the operation MPFB2 performs here, since
a target is a list of per-vertex offsets. The result is the same MakeHuman lineage
that Vina and opensew-2 use, with no GPL code anywhere in the path and no Blender
needed to reproduce it.

One decoy is worth recording, because it silently produced the wrong answer
first. `macrodetails/universal-<gender>-<age>-<muscle>-<weight>.target` looks
like the obvious input and is not: upstream those files are 604-byte stubs
holding nothing but a licence header, because MakeHuman composes the real
macrodetails at build time by summing component targets. Applying a stub returns
the unmodified base mesh — twice, under two names. The script now refuses a
target carrying no offsets, and refuses a body outside 1.2–2.2 m.

### Why the variants are a scalar

§7.4 says "three scaled variants each". They are a uniform scale of one mesh, so
three copies of the geometry would encode one number three times at three times
the size. The factors live in the manifest and in each body, and a consumer
multiplies.

This is a deliberate departure from the letter of §7.4, recorded rather than made
quietly. If those variants were ever meant to be *different morphs* instead of
scales, this is the wrong shape, and the manifest is where to fix it.

## Regenerating

```bash
python3 scripts/build-bodies.py           # uses .cache/bodies for downloads
python3 scripts/build-bodies.py --force   # re-download and rebuild
```

Downloads are cached in `.cache/bodies/` (gitignored). The script checks the
inputs against the digests in the manifest and fails loudly on a stub target or
an implausible height. Run it, then commit what it writes.
