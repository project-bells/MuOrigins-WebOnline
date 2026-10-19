#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
if [[ "$(hostname -s)" != instance-20261019-125137 ]]; then
  echo "STOP: this launcher targets only the new inspected WebOnline VM" >&2
  exit 1
fi
browser_root="$repo_root/upstream/browser"
base_sha=fb5d6aed769e6384a2f25164e75eded456307be7
if [[ "$(git -C "$browser_root" rev-parse HEAD)" != "$base_sha" ]]; then
  echo "STOP: browser source differs from the inspected base commit" >&2
  exit 1
fi
if sudo docker container inspect muweb-client-build >/dev/null 2>&1; then
  echo "STOP: muweb-client-build already exists; inspect its status/logs first" >&2
  exit 1
fi
available_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
available_disk_kb=$(df -Pk "$repo_root" | awk 'END {print $4}')
if (( available_kb < 2621440 || available_disk_kb < 8388608 )); then
  echo "STOP: need at least 2.5 GiB available RAM and 8 GiB free disk to start this bounded compile attempt" >&2
  exit 1
fi
if git -C "$browser_root" apply --check "$repo_root/browser-online.patch"; then
  git -C "$browser_root" apply "$repo_root/browser-online.patch"
elif git -C "$browser_root" apply --reverse --check "$repo_root/browser-online.patch"; then
  echo "Online candidate patch is already applied"
else
  echo "STOP: patch does not match the candidate checkout" >&2
  exit 1
fi
mkdir -p work/client-build work/client-probe/cache
sudo docker image inspect emscripten/emsdk:6.0.12 >/dev/null
sudo docker run -d --name muweb-client-build \
  --label org.muweb.role=client-build \
  --cpus=1 --memory=2g --memory-swap=2g --pids-limit=256 \
  --user "$(id -u):$(id -g)" \
  --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  -e EM_CACHE=/cache -e EMCC_CORES=1 -e CMAKE_BUILD_PARALLEL_LEVEL=1 \
  -v "$browser_root:/src:ro" \
  -v "$repo_root/work/client-build:/build" \
  -v "$repo_root/work/client-probe/cache:/cache" \
  -v "$repo_root/deploy/build-client:/tools:ro" \
  -w /build \
  emscripten/emsdk:6.0.12 python3 /tools/compile.py
echo "Started. Follow with: sudo docker logs -f muweb-client-build"
