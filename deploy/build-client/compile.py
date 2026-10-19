#!/usr/bin/env python3
"""Sequential compile checkpoint. Does not link, publish, or connect to MU."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

FLAGS = ["-c", "-O2", "-ferror-limit=5", "-Wno-macro-redefined",
         "-Wno-ignored-attributes", "-Wno-deprecated-non-prototype", "-Wno-c++11-narrowing"]
EXTRA = ["browser/shell_login.cpp", "browser/net_ws.cpp", "browser/mu_mesh_draw.cpp",
         "src/Net/Protocol/Protocol_Check.cpp"]


def source_plan(root):
    entries = (root / "m2-sources.txt").read_text(encoding="utf-8-sig").splitlines() + EXTRA
    result = []
    seen = set()
    for entry in entries:
        entry = entry.strip().replace("\\", "/")
        if not entry:
            continue
        rel = PurePosixPath(entry)
        if rel.is_absolute() or ".." in rel.parts or rel.suffix not in (".cpp", ".c"):
            raise ValueError("Unexpected source path: " + entry)
        if entry in seen:
            continue
        source = root.joinpath(*rel.parts)
        if not source.is_file():
            raise ValueError("Missing source (check Linux filename case): " + entry)
        # Object names preserve directories and extension, avoiding flat-name collisions.
        result.append((entry, str(rel) + ".o"))
        seen.add(entry)
    return result


def create_gl_shims(directory):
    for name, target in [("gl.h", "GL/gl.h"), ("GL.h", "GL/gl.h"),
                         ("glu.h", "GL/glu.h"), ("GLU.h", "GL/glu.h")]:
        file = directory / "gl" / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("#pragma once\n#include <" + target + ">\n", encoding="utf-8")


def main():
    root = Path("/src/src/client")
    out = Path("/build")
    plan = source_plan(root)
    version = subprocess.check_output(["emcc", "--version"], text=True).splitlines()[0]
    if " 6.0.12 " not in version:
        raise RuntimeError("Unexpected compiler: " + version)
    print(version, flush=True)
    shims = out / "include"
    create_gl_shims(shims)
    includes = [shims, root / "browser", root / "browser/compat", root / "src",
                root / "lib/libjpeg/jpeg-6b", root / "lib/miniaudio"]
    include_flags = [arg for directory in includes for arg in ("-I", str(directory))]
    digest = hashlib.sha256((version + repr(FLAGS) + repr(plan)).encode())
    digest.update(Path(__file__).read_bytes())
    # Invalidate ALL object reuse when any source/header changes.
    for directory in [root / "src", root / "browser", root / "lib"]:
        for file in sorted(directory.rglob("*")):
            if file.is_file() and file.suffix.lower() in (".h", ".hpp", ".inl", ".inc", ".cpp", ".c"):
                digest.update(str(file.relative_to(root)).encode())
                digest.update(file.read_bytes())
    build_id = digest.hexdigest()
    state_path = out / "compile-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    completed = set(state.get("completed", [])) if state.get("build_id") == build_id else set()
    (out / "logs").mkdir(parents=True, exist_ok=True)
    objects = []
    for index, (entry, object_name) in enumerate(plan, 1):
        obj = out / "objects" / object_name
        objects.append(str(obj))
        if entry in completed and obj.is_file() and obj.stat().st_size:
            print(f"[{index}/{len(plan)}] cached {entry}", flush=True)
            continue
        obj.parent.mkdir(parents=True, exist_ok=True)
        log = out / "logs" / (entry.replace("/", "_") + ".log")
        compiler = "emcc" if entry.endswith(".c") else "em++"
        standard = "-std=c11" if compiler == "emcc" else "-std=c++17"
        print(f"[{index}/{len(plan)}] compile {entry}", flush=True)
        with log.open("w") as handle:
            process = subprocess.run([compiler, standard, *FLAGS, *include_flags,
                                      str(root / entry), "-o", str(obj)], stdout=handle, stderr=subprocess.STDOUT)
        if process.returncode:
            print(log.read_text(errors="replace")[-16000:], flush=True)
            raise RuntimeError(f"Compile stopped at {entry}; log: {log}")
        completed.add(entry)
        state_path.write_text(json.dumps({"build_id": build_id, "completed": sorted(completed)}, indent=2))
    (out / "objects.json").write_text(json.dumps(objects, indent=2))
    print(f"CLIENT_COMPILE_PASS: {len(objects)} objects; linking/browser test still pending", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("CLIENT_COMPILE_STOP:", error, file=sys.stderr, flush=True)
        sys.exit(1)
