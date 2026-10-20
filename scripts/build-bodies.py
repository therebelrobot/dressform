#!/usr/bin/env python3
"""Build the CC0 reference bodies in assets/bodies/.

Two bodies — one male, one female — from the MakeHuman base mesh and the
`universal` macrodetails target for each. Both inputs are CC0 1.0: the assets in
`makehumancommunity/makehuman` are covered by `LICENSE.ASSETS.md` at that
repository's root, and each file carries its own CC0 statement in its header.

This is a plain-Python reimplementation of the one operation MPFB2 would perform
in Blender — adding a target's vertex offsets to the base mesh — so the result is
reproducible without Blender, without the GPLv3 plugin, and without a GUI. The
inputs are pinned to a commit and their digests recorded in the manifest.

    python3 scripts/build-bodies.py          # uses .cache/bodies for downloads
    python3 scripts/build-bodies.py --force  # re-download even if cached

The output is not committed by this script; run it, then commit what it writes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import urllib.request

# Pinned so a re-run produces the same bytes.
COMMIT = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482"
RAW = f"https://raw.githubusercontent.com/makehumancommunity/makehuman/{COMMIT}/"
BASE_MESH = "makehuman/data/3dobjs/base.obj"
TARGETS = "makehuman/data/targets/macrodetails"

# The joint table comes from MPFB2 rather than MakeHuman: the mesh's named vertex
# groups, including `joint-pelvis`, `joint-spine-1`…`joint-neck`, and a `body`
# range that excludes the helper geometry (eyes, hair, teeth) the base mesh also
# carries. Those are the anchors `avatar` needs, and deriving them from a table
# beats guessing them from a silhouette. MPFB2's data is CC0 under its own
# `LICENSE.ASSETS.md`; its GPLv3 source is not used.
MPFB_COMMIT = "b1a2dc98776da9d1eea751b159d42cf61778fe2e"
MPFB_RAW = f"https://raw.githubusercontent.com/makehumancommunity/mpfb2/{MPFB_COMMIT}/"
VERTEX_GROUPS = "src/mpfb/data/mesh_metadata/basemesh_vertex_groups.json"

# The joints `avatar` anchors on, in the order they appear down the body.
JOINTS = [
    "joint-neck",
    "joint-l-shoulder",
    "joint-r-shoulder",
    "joint-spine-1",
    "joint-spine-2",
    "joint-spine-3",
    "joint-spine-4",
    "joint-pelvis",
    "joint-l-upper-leg",
    "joint-r-upper-leg",
]

# The mesh's own trunk, so a cross-section is not polluted by eyes or teeth.
BODY_GROUP = "body"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = REPO_ROOT / ".cache" / "bodies"
OUT = REPO_ROOT / "assets" / "bodies"

# A note on which targets these are, because the obvious choice is a decoy.
#
# `macrodetails/universal-<gender>-<age>-<muscle>-<weight>.target` looks like the
# right input and is not: upstream those files are 604-byte stubs containing
# nothing but a licence header, because MakeHuman composes the real macrodetails
# at build time by summing component targets. Applying a stub yields the
# unmodified base mesh — twice — which is exactly the mistake the offset guard in
# `main` now refuses to ship.
#
# The targets with real data are the ethnicity + gender + age ones. Muscle and
# weight are left at the base mesh's rest values, which is what "average" means
# here; `avatar` re-scales per region from the draft's measurements anyway.
BODIES = [
    {
        "id": "male-young",
        "gender": "male",
        "ethnicity": "caucasian",
        "age": "young",
        "target": f"{TARGETS}/caucasian-male-young.target",
    },
    {
        "id": "female-young",
        "gender": "female",
        "ethnicity": "caucasian",
        "age": "young",
        "target": f"{TARGETS}/caucasian-female-young.target",
    },
]

# A body outside this range means the unit conversion is wrong, not that the
# upstream data is unusual. Refuse rather than ship a 17-metre human.
PLAUSIBLE_HEIGHT_M = (1.2, 2.2)

# Decimetres to metres. The base mesh's height span is 16.95 units, which is a
# 1.695 m human, so the file's unit is the decimetre. The mesh is already Y-up,
# which is what three.js wants, so no axis swap is needed.
UNITS_PER_METRE = 10.0

# The three variants technical design §7.4 asks for. They are a uniform scale,
# so they are recorded as a scalar rather than as three copies of the geometry —
# see assets/bodies/README.md. `avatar` re-scales per body region from the same
# measurement set the pattern was drafted from, so these are a starting point.
SCALES = [0.95, 1.0, 1.05]

# Four decimals is 0.1 mm at metre scale, which is well inside the tolerances
# this project works at, and it keeps the JSON to a size worth committing.
PRECISION = 4


def fetch(relative: str, force: bool, base: str = RAW) -> tuple[bytes, str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / pathlib.Path(relative).name
    if cached.exists() and not force:
        data = cached.read_bytes()
    else:
        url = base + relative
        sys.stderr.write(f"  fetching {url}\n")
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        cached.write_bytes(data)
    return data, hashlib.sha256(data).hexdigest()


def parse_obj(text: str) -> tuple[list[list[float]], list[list[int]]]:
    """Positions and triangles. Quads are fan-triangulated; texture coords are dropped."""
    positions: list[list[float]] = []
    triangles: list[list[int]] = []

    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        head = line.split(" ", 1)[0]
        if head == "v":
            _, x, y, z = line.split()[:4]
            positions.append([float(x), float(y), float(z)])
        elif head == "f":
            corners = []
            for token in line.split()[1:]:
                raw = int(token.split("/")[0])
                # OBJ indices are 1-based, and may be negative to count back
                # from the end of the list.
                corners.append(raw - 1 if raw > 0 else len(positions) + raw)
            for i in range(1, len(corners) - 1):
                triangles.append([corners[0], corners[i], corners[i + 1]])

    return positions, triangles


def parse_target(text: str) -> dict[int, list[float]]:
    """`<vertex index> <dx> <dy> <dz>` offsets, in the base mesh's units."""
    offsets: dict[int, list[float]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line[0] == "#":
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        index = int(parts[0])
        offsets[index] = [float(parts[1]), float(parts[2]), float(parts[3])]
    return offsets


def apply_offsets(
    positions: list[list[float]], offsets: dict[int, list[float]]
) -> list[list[float]]:
    out = [list(p) for p in positions]
    for index, delta in offsets.items():
        if index >= len(out):
            raise SystemExit(f"target refers to vertex {index}, mesh has {len(out)}")
        for axis in range(3):
            out[index][axis] += delta[axis]
    return out


def to_metres(positions: list[list[float]]) -> list[list[float]]:
    return [[round(value / UNITS_PER_METRE, PRECISION) for value in point] for point in positions]


def bounds(positions: list[list[float]]) -> dict[str, list[float]]:
    axes = list(zip(*positions))
    return {
        "min": [round(min(axis), PRECISION) for axis in axes],
        "max": [round(max(axis), PRECISION) for axis in axes],
    }


def groups_to_ranges(groups: object) -> dict[str, list[tuple[int, int]]]:
    """Flatten the vertex-group table. A leaf is a list of `[start, end]` pairs."""
    out: dict[str, list[tuple[int, int]]] = {}
    if not isinstance(groups, dict):
        return out
    for name, value in groups.items():
        if not isinstance(value, list):
            continue
        pairs = []
        for entry in value:
            if (
                isinstance(entry, list)
                and len(entry) == 2
                and all(isinstance(item, int) for item in entry)
            ):
                pairs.append((int(entry[0]), int(entry[1])))
        if pairs:
            out[name] = pairs
    return out


def centroid(positions: list[list[float]], pairs: list[tuple[int, int]]) -> list[float] | None:
    """The mean of a vertex group, in the morphed frame — so it moves with the body."""
    xs = ys = zs = 0.0
    count = 0
    for start, end in pairs:
        for index in range(start, end + 1):
            if index >= len(positions):
                continue
            x, y, z = positions[index]
            xs += x
            ys += y
            zs += z
            count += 1
    if count == 0:
        return None
    return [round(xs / count, PRECISION), round(ys / count, PRECISION), round(zs / count, PRECISION)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-download even if cached")
    args = parser.parse_args()

    sys.stderr.write(f"base mesh: {BASE_MESH}\n")
    base_bytes, base_digest = fetch(BASE_MESH, args.force)
    base_positions, triangles = parse_obj(base_bytes.decode("utf-8"))
    sys.stderr.write(
        f"  {len(base_positions)} vertices, {len(triangles)} triangles, sha256 {base_digest[:16]}\n"
    )

    sys.stderr.write(f"vertex groups: {VERTEX_GROUPS}\n")
    groups_bytes, groups_digest = fetch(VERTEX_GROUPS, args.force, base=MPFB_RAW)
    ranges = groups_to_ranges(json.loads(groups_bytes.decode("utf-8")))
    sys.stderr.write(f"  {len(ranges)} named groups, sha256 {groups_digest[:16]}\n")
    if BODY_GROUP not in ranges:
        raise SystemExit(f"the vertex-group table has no `{BODY_GROUP}` group")
    if len(ranges) < 100:
        raise SystemExit("the vertex-group table parsed to almost nothing — check the format")

    OUT.mkdir(parents=True, exist_ok=True)
    entries = []

    for body in BODIES:
        sys.stderr.write(f"{body['id']}: {body['target']}\n")
        target_bytes, target_digest = fetch(body["target"], args.force)
        offsets = parse_target(target_bytes.decode("utf-8"))
        sys.stderr.write(f"  {len(offsets)} offsets, sha256 {target_digest[:16]}\n")

        # A stub target applies nothing, which would ship the base mesh twice
        # under two names. That is silent, so it is refused here instead.
        if len(offsets) == 0:
            raise SystemExit(
                f"{body['target']} carries no offsets — it is a stub, and applying it "
                f"would emit the unmodified base mesh"
            )

        morphed = to_metres(apply_offsets(base_positions, offsets))
        box = bounds(morphed)
        height = round(box["max"][1] - box["min"][1], PRECISION)
        sys.stderr.write(
            f"  height {height} m, width {round(box['max'][0] - box['min'][0], PRECISION)} m\n"
        )

        low, high = PLAUSIBLE_HEIGHT_M
        if not low <= height <= high:
            raise SystemExit(
                f"{body['id']} came out {height} m tall, outside {low}–{high} m — "
                f"the unit conversion is probably wrong"
            )

        # Joints move with the morph, so they are read off the morphed mesh.
        joints: dict[str, list[float]] = {}
        for name in JOINTS:
            pairs = ranges.get(name)
            if pairs is None:
                continue
            point = centroid(morphed, pairs)
            if point is not None:
                joints[name] = point
        if len(joints) != len(JOINTS):
            sys.stderr.write(f"  WARNING: only {len(joints)}/{len(JOINTS)} joints resolved\n")

        body_pairs = ranges[BODY_GROUP]
        body_range = [min(pair[0] for pair in body_pairs), max(pair[1] for pair in body_pairs)]
        if body_range[1] >= len(morphed):
            raise SystemExit("the body vertex range runs past the end of the mesh")

        document = {
            "schemaVersion": 1,
            "id": body["id"],
            "gender": body["gender"],
            "units": "metres",
            "up": "+y",
            "axes": {"x": "right", "y": "up", "z": "front"},
            "bounds": box,
            "height": height,
            "scales": SCALES,
            "vertexCount": len(morphed),
            "triangleCount": len(triangles),
            "bodyRange": body_range,
            "joints": joints,
            "positions": [value for point in morphed for value in point],
            "indices": [index for triangle in triangles for index in triangle],
        }

        path = OUT / f"{body['id']}.json"
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        sys.stderr.write(f"  wrote {path.relative_to(REPO_ROOT)} ({path.stat().st_size} bytes)\n")

        entries.append(
            {
                "id": body["id"],
                "file": f"{body['id']}.json",
                "gender": body["gender"],
                "ethnicity": body["ethnicity"],
                "age": body["age"],
                "height": height,
                "target": body["target"],
                "targetSha256": target_digest,
                "targetOffsets": len(offsets),
            }
        )

    manifest = {
        "schemaVersion": 1,
        "licence": "CC0-1.0",
        "licenceFiles": [
            f"{RAW}LICENSE.ASSETS.md",
            f"{MPFB_RAW}LICENSE.ASSETS.md",
        ],
        "upstream": {
            "repository": "https://github.com/makehumancommunity/makehuman",
            "commit": COMMIT,
            "baseMesh": BASE_MESH,
            "baseMeshSha256": base_digest,
        },
        "jointsSource": {
            "repository": "https://github.com/makehumancommunity/mpfb2",
            "commit": MPFB_COMMIT,
            "file": VERTEX_GROUPS,
            "sha256": groups_digest,
            "note": (
                "The rig joints and the body vertex range, from the mesh's named vertex groups. "
                "MPFB2's data is CC0 under its own LICENSE.ASSETS.md; its GPLv3 source is not used. "
                "Recovered as `avatar` needs anchors that are facts rather than inferences."
            ),
        },
        "generator": {
            "script": "scripts/build-bodies.py",
            "note": (
                "MPFB2's source is GPLv3 and is not used here; this script applies the same "
                "CC0 targets to the same CC0 base mesh directly, so no GPL code is involved in "
                "the output."
            ),
        },
        "units": {"stored": "metres", "upstream": "decimetres", "conversion": 0.1},
        "coordinateSystem": {"x": "right", "y": "up", "z": "front", "handedness": "right"},
        "scales": SCALES,
        "bodies": entries,
    }

    manifest_path = OUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    sys.stderr.write(f"wrote {manifest_path.relative_to(REPO_ROOT)}\n")


if __name__ == "__main__":
    main()
