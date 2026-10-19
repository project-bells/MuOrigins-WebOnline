#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
if [[ "$(hostname -s)" != instance-20261019-125137 ]]; then
  echo "STOP: this launcher targets only the new inspected WebOnline VM" >&2
  exit 1
fi
if [[ "$(sudo docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' muweb-client-build)" != 'exited 0 false' ]]; then
  echo "STOP: compile container did not complete successfully" >&2
  exit 1
fi
if sudo docker container inspect muweb-client-link >/dev/null 2>&1; then
  echo "STOP: muweb-client-link exists; inspect its status/logs first" >&2
  exit 1
fi
if [[ "$(git -C upstream/browser rev-parse HEAD)" != fb5d6aed769e6384a2f25164e75eded456307be7 ]]; then
  echo "STOP: unexpected source commit" >&2
  exit 1
fi
if (( $(awk '/^MemAvailable:/ {print $2}' /proc/meminfo) < 3145728 )); then
  echo "STOP: need at least 3 GiB available RAM before this bounded link attempt" >&2
  exit 1
fi
if (( $(df -Pk "$repo_root" | awk 'END {print $4}') < 5242880 )); then
  echo "STOP: need at least 5 GiB free disk" >&2
  exit 1
fi
test -s work/client-build/objects.json
sudo docker run -d --name muweb-client-link \
  --label org.muweb.role=client-link \
  --cpus=1 --memory=2560m --memory-swap=2560m --pids-limit=256 \
  --user "$(id -u):$(id -g)" \
  --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  -e EM_CACHE=/cache -e EMCC_CORES=1 -e LLVM_PARALLEL_LINK_JOBS=1 \
  -v "$repo_root/upstream/browser:/src:ro" \
  -v "$repo_root/work/client-build:/build" \
  -v "$repo_root/work/client-probe/cache:/cache" \
  -v "$repo_root/deploy/build-client:/tools:ro" \
  -w /build \
  emscripten/emsdk:6.0.12 python3 /tools/link.py
echo "Started. Follow with: sudo docker logs -f muweb-client-link"
