#!/usr/bin/env python3
"""Link compiled objects and apply strict renderer fixes into a new release dir."""
import datetime
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import sys

from renderer_patch import rules_from_source, apply_rules


BROWSER_RUNTIME_SOURCES = ["browser/shell_login.cpp", "browser/net_ws.cpp",
                           "browser/mu_mesh_draw.cpp", "browser/mu_gdi.cpp", "browser/mu_profile.cpp"]
LINK_SUPPLEMENTS = ["browser/mu_gdi.cpp", "browser/mu_profile.cpp"]


def extract_tick_check(source):
    # Copy the pinned upstream definition, rather than inventing a replacement.
    matches = re.findall(r"^void GameGuard_TickCheck\(void\)\s*\n\{\n(.*?)^\}", source,
                         flags=re.MULTILINE | re.DOTALL)
    if len(matches) != 1:
        raise RuntimeError("Expected one upstream GameGuard_TickCheck definition")
    body = matches[0]
    # This upstream revision contains comments only. Stop for review if that changes:
    # active native GameGuard code cannot silently be discarded or ported this way.
    if any(line.strip() and not line.lstrip().startswith("//") for line in body.splitlines()):
        raise RuntimeError("Upstream GameGuard watchdog changed; browser port requires review")
    return "void GameGuard_TickCheck(void)\n{\n" + body + "}\n"


def compile_tick_check(root, release, compiler):
    source = release / "upstream_gameguard_tick.cpp"
    upstream = (root / "src/WinMain.cpp").read_text(encoding="utf-8-sig")
    source.write_text('#include "stdafx.h"\n' + extract_tick_check(upstream) + extract_opengl_release(upstream))
    obj = release / "upstream_gameguard_tick.cpp.o"
    log = release / "upstream_gameguard_tick.compile.log"
    with log.open("w") as handle:
        includes = [Path("/build/include"), root / "browser", root / "browser/compat", root / "src",
                    root / "lib/libjpeg/jpeg-6b", root / "lib/miniaudio"]
        include_flags = [arg for directory in includes for arg in ("-I", str(directory))]
        subprocess.run(["em++", "-std=c++17", *compiler.FLAGS, *include_flags, str(source), "-o", str(obj)],
                       stdout=handle, stderr=subprocess.STDOUT, check=True)
    if not obj.is_file() or not obj.stat().st_size:
        raise RuntimeError("Missing upstream watchdog object; log: " + str(log))
    return str(obj)


def extract_opengl_release(source):
    matches = re.findall(r"^void OpenGL_Release\(void\)\s*\n\{\n(.*?)^\}", source,
                         flags=re.MULTILINE | re.DOTALL)
    if len(matches) != 1:
        raise RuntimeError("Expected one upstream OpenGL_Release definition")
    body = matches[0]
    active = "".join(re.sub(r"//[^\n]*", "", body).split())
    if active != "FreeDirectSound();gWindow.ReleaseOpenGL();ShowCursor(1);":
        raise RuntimeError("Upstream OpenGL cleanup changed; browser port requires review")
    return "void OpenGL_Release(void)\n{\n" + body + "}\n"


def compile_supplements(root, release, compiler, plan, run=subprocess.run):
    existing = {entry for entry, _ in plan}
    objects = []
    for entry in LINK_SUPPLEMENTS:
        if entry in existing:
            continue
        source = root / entry
        if not source.is_file():
            raise RuntimeError("Missing browser runtime implementation: " + str(source))
        obj = release / (Path(entry).name + ".o")
        log = release / (Path(entry).name + ".compile.log")
        print("Compile link supplement:", entry, flush=True)
        with log.open("w") as handle:
            process = run(["em++", "-std=c++17", *compiler.FLAGS, str(source), "-o", str(obj)],
                          stdout=handle, stderr=subprocess.STDOUT)
        if process.returncode or not obj.is_file() or not obj.stat().st_size:
            print(log.read_text(errors="replace")[-16000:], flush=True)
            raise RuntimeError("Browser runtime supplement compilation failed; log: " + str(log))
        objects.append(str(obj))
    return objects


def main():
    root = Path("/src/src/client")
    build = Path("/build")
    spec = importlib.util.spec_from_file_location("compile_checkpoint", "/tools/compile.py")
    compiler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compiler)
    version = subprocess.check_output(["emcc", "--version"], text=True).splitlines()[0]
    if " 6.0.12 " not in version:
        raise RuntimeError("Unexpected compiler: " + version)
    plan = compiler.source_plan(root)
    covered = {entry for entry, _ in plan} | set(LINK_SUPPLEMENTS)
    runtime_sources = set(BROWSER_RUNTIME_SOURCES)
    runtime_sources.update("browser/" + file.name for file in (root / "browser").glob("mu_*.cpp"))
    if runtime_sources - covered:
        raise RuntimeError("Browser runtime files absent from build plan: " + repr(sorted(runtime_sources - covered)))
    state = json.loads((build / "compile-state.json").read_text())
    digest = hashlib.sha256((version + repr(compiler.FLAGS) + repr(plan)).encode())
    digest.update(Path(compiler.__file__).read_bytes())
    for directory in [root / "src", root / "browser", root / "lib"]:
        for file in sorted(directory.rglob("*")):
            if file.is_file() and file.suffix.lower() in (".h", ".hpp", ".inl", ".inc", ".cpp", ".c"):
                digest.update(str(file.relative_to(root)).encode())
                digest.update(file.read_bytes())
    if digest.hexdigest() != state["build_id"] or set(state["completed"]) != {entry for entry, _ in plan}:
        raise RuntimeError("Source/compiler changed or compile incomplete; rerun compile checkpoint first")
    objects = [str(build / "objects" / name) for _, name in plan]
    if json.loads((build / "objects.json").read_text()) != objects:
        raise RuntimeError("Object manifest differs from the completed compile plan")
    if any(not Path(file).is_file() or not Path(file).stat().st_size for file in objects):
        raise RuntimeError("Missing/empty compiled object")
    for asset in (root / "Client/Data", root / "Client/Config.ini"):
        if not asset.exists():
            raise RuntimeError("Missing input asset: " + str(asset))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    release = build / "releases" / (stamp + "-" + state["build_id"][:12])
    release.mkdir(parents=True, exist_ok=False)
    # The upstream source list omits the GDI and profile bridges; the Windows
    # linker picked up objects from out/all. Include both explicitly here,
    # preserving the already verified 332 checkpoint objects.
    supplementary_objects = compile_supplements(root, release, compiler, plan)
    supplementary_objects.append(compile_tick_check(root, release, compiler))
    objects.extend(supplementary_objects)
    command = ["em++", "-std=c++17", "--profiling-funcs", "-sEMULATE_FUNCTION_POINTER_CASTS=1",
               "-ferror-limit=30", "-sDEFAULT_TO_CXX", "-o", str(release / "shell_login.js"),
               "-sLEGACY_GL_EMULATION", "-sGL_FFP_ONLY", "-sMIN_WEBGL_VERSION=2", "-sMAX_WEBGL_VERSION=2",
               "-sINITIAL_MEMORY=536870912", "-sSTACK_SIZE=8388608", "-sFORCE_FILESYSTEM=1",
               "-sALLOW_MEMORY_GROWTH=0", "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
               "--preload-file", str(root / "Client/Data") + "@/Data",
               "--preload-file", str(root / "Client/Config.ini") + "@/config.ini",
               "-Wl,--error-limit=0", *objects]
    log = release / "link.log"
    print("Linking", len(objects), "objects into", release, flush=True)
    with log.open("w") as handle:
        process = subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT)
    if process.returncode:
        print(log.read_text(errors="replace")[-20000:], flush=True)
        raise RuntimeError(f"Link failed with exit {process.returncode}; retained log: {log}")
    js = release / "shell_login.js"
    original = js.read_text(encoding="utf-8")
    patch_source = root / "patch-login-page.ps1"
    rules = rules_from_source(patch_source.read_text(encoding="utf-8-sig"))
    fixed = apply_rules(original, rules)
    # Keep an unpatched copy for diagnostics; only advertise a release on full success.
    (release / "shell_login.unpatched.js").write_text(original, encoding="utf-8")
    js.write_text(fixed, encoding="utf-8")
    subprocess.run(["node", "--check", str(js)], check=True)
    required = ["_mu_net_push_open", "_mu_net_push_disconnect", "_mu_net_push_packet", "_mu_net_get_push_buffer"]
    if any(symbol not in fixed for symbol in required):
        raise RuntimeError("Generated JS lacks one or more required network exports")
    files = {}
    for name in ["shell_login.js", "shell_login.wasm", "shell_login.data"]:
        file = release / name
        if not file.is_file() or not file.stat().st_size:
            raise RuntimeError("Missing release artifact: " + name)
        files[name] = {"bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    manifest = {"compiler": version, "compile_build_id": state["build_id"], "renderer_rules": len(rules),
                "link_supplements": [Path(file).name for file in supplementary_objects],
                "renderer_source_sha256": hashlib.sha256(patch_source.read_bytes()).hexdigest(),
                "files": files, "browser_runtime_verified": False}
    (release / "release.json").write_text(json.dumps(manifest, indent=2))
    (build / "latest-linked-release.txt").write_text(str(release) + "\n")
    print("CLIENT_LINK_PASS:", release, flush=True)
    print("Generated JS syntax and network export names checked; browser rendering/login still pending", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("CLIENT_LINK_STOP:", error, file=sys.stderr, flush=True)
        sys.exit(1)
