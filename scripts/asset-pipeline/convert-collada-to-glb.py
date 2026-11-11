"""Fail-closed COLLADA -> canonical GLB operator step for new demo projects.

Run with Blender 4.5 LTS (which includes native COLLADA import):
  blender -b -t 4 --python scripts/asset-pipeline/convert-collada-to-glb.py \
    -- DHOLERA.dae DHOLERA-converted.glb --expected-xyz 444.83 685.77 34.69

The referenced texture directory must sit beside the original .dae.
This does not mutate a source file, an Engine project, R2, or production.
"""
import argparse
import json
import math
import sys
import urllib.parse
from pathlib import Path
from xml.etree import ElementTree as ET

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser(description="Preserve DAE texture/scale/origin during GLB conversion")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--expected-xyz", type=float, nargs=3,
                        metavar=("WIDTH_M", "LENGTH_M", "HEIGHT_M"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    source = args.source.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if source.suffix.lower() != ".dae" or output.suffix.lower() != ".glb":
        parser.error("Expected a .dae source and .glb output.")
    if not source.is_file() or source == output or output.exists():
        parser.error("Source must exist, and output must not overwrite any existing file.")
    if bpy.app.version[:2] != (4, 5) or not hasattr(bpy.ops.wm, "collada_import"):
        parser.error("Blender 4.5 LTS with built-in COLLADA importer is required.")

    # Check source file dependencies BEFORE importing any meshes. A DAE file
    # alone is not a self-contained model, unlike the production GLB.
    tree = ET.parse(source)
    root = tree.getroot()
    referenced = []
    for image in root.findall(".//{*}library_images/{*}image"):
        init = image.find("{*}init_from")
        if init is None or not (init.text or "").strip():
            continue
        reference = urllib.parse.unquote(init.text.strip())
        if reference.startswith("file://"):
            candidate = Path(urllib.parse.urlparse(reference).path)
        else:
            candidate = source.parent / reference
        referenced.append(candidate.resolve())
    missing = sorted({str(item) for item in referenced if not item.is_file()})
    if missing:
        raise RuntimeError(
            f"DAE requires {len(missing)} missing texture image(s). "
            "Request the original textures folder; do not export a degraded preview.\n" +
            "\n".join(missing[:60])
        )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    result = bpy.ops.wm.collada_import(
        filepath=str(source),
        import_units=True,
        fix_orientation=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError("Native COLLADA import failed.")
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("COLLADA import produced no mesh objects.")

    mins = [math.inf] * 3
    maxs = [-math.inf] * 3
    for obj in meshes:
        for corner in obj.bound_box:
            pos = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                mins[axis] = min(mins[axis], pos[axis])
                maxs[axis] = max(maxs[axis], pos[axis])
    dims = [maxs[i] - mins[i] for i in range(3)]
    if any(not math.isfinite(value) or value <= 0 for value in dims):
        raise RuntimeError("COLLADA import has invalid metric bounds.")

    if args.expected_xyz:
        # CAD imports sometimes ignore inch-vs-metre units. Check independent
        # measured dimensions rather than silently applying guessed scale.
        expected = args.expected_xyz
        if (any(value <= 0 for value in expected) or
                any(abs(dims[i] - expected[i]) > max(0.5, expected[i] * 0.02)
                    for i in range(3))):
            raise RuntimeError(
                f"Imported dimensions {dims} differ from surveyed metres {expected}. "
                "Review COLLADA import units and axis handling before exporting."
            )

    unavailable = []
    for image in bpy.data.images:
        if image.source == "FILE" and not image.packed_file and image.filepath:
            candidate = Path(bpy.path.abspath(image.filepath))
            if not candidate.is_file():
                unavailable.append(str(candidate))
    if unavailable:
        raise RuntimeError(
            "Blender could not resolve imported image(s): " + ", ".join(unavailable[:30])
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", export_yup=True,
        export_normals=True, export_draco_mesh_compression_enable=False,
        export_apply=False, export_animations=False,
    )
    if "FINISHED" not in result or not output.is_file():
        raise RuntimeError("glTF binary export failed.")
    if output.stat().st_size > 512 * 1024 * 1024:
        raise RuntimeError("GLB exceeds the Engine's 512 MiB canonical source limit.")

    report = {
        "original": str(source),
        "output": str(output),
        "texturesReferenced": len(referenced),
        "missingTextures": 0,
        "meshObjects": len(meshes),
        "boundsMinM": mins,
        "boundsMaxM": maxs,
        "dimensionsM": dims,
        "outputBytes": output.stat().st_size,
        "note": "Operator must review visual materials, source orientation, and scale before publication.",
    }
    report_path = output.with_suffix(".conversion-report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("REKIXO_DAE_CONVERSION_REPORT " + json.dumps(report))


if __name__ == "__main__":
    main()
