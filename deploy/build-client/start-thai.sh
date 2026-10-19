#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
repo_root="$PWD"
[[ "$(hostname -s)" == instance-20261019-125137 ]] || { echo 'STOP: wrong VM'; exit 1; }
phase="${1:-compile}"
case "$phase" in
  compile) name=muweb-client-thai-build; memory=2g; tool=compile.py ;;
  link) name=muweb-client-thai-link; memory=2560m; tool=link.py ;;
  *) echo 'Use compile or link'; exit 1 ;;
esac
available_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
(( available_kb >= 3145728 )) || { echo 'STOP: need 3 GiB available RAM; stop staging backend temporarily'; exit 1; }
disk_kb=$(df -Pk . | awk 'END {print $4}')
(( disk_kb >= 8388608 )) || { echo 'STOP: need 8 GiB free disk'; exit 1; }
if sudo docker inspect "$name" >/dev/null 2>&1; then
  echo "STOP: inspect existing $name before removing/retrying"; exit 1
fi
candidate="$repo_root/work/browser-thai"
if [[ "$phase" == compile && ! -f "$candidate/.thai-ready" ]]; then
  [[ ! -e "$candidate" ]] || { echo 'STOP: incomplete candidate; inspect first'; exit 1; }
  [[ "$(git -C upstream/browser rev-parse HEAD)" == fb5d6aed769e6384a2f25164e75eded456307be7 ]]
  grep -q mu_net_push_open upstream/browser/src/client/browser/net_ws.cpp
  mkdir -p "$candidate/src"
  cp -a upstream/browser/src/client "$candidate/src/client"
  python3 deploy/build-client/apply-thai-chat.py "$candidate"
  touch "$candidate/.thai-ready"
fi
[[ -f "$candidate/.thai-ready" ]] || { echo 'STOP: compile candidate first'; exit 1; }
if [[ "$phase" == link ]]; then
  [[ "$(sudo docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' muweb-client-thai-build)" == 'exited 0 false' ]] || { echo 'STOP: compile not successful'; exit 1; }
fi
mkdir -p work/client-thai work/client-probe/cache
sudo docker run -d --name "$name" \
  --cpus=1 --memory="$memory" --memory-swap="$memory" --pids-limit=256 \
  --user "$(id -u):$(id -g)" --network=none --cap-drop=ALL \
  --security-opt=no-new-privileges -e EM_CACHE=/cache -e EMCC_CORES=1 \
  -e LLVM_PARALLEL_LINK_JOBS=1 \
  -v "$candidate:/src:ro" -v "$repo_root/work/client-thai:/build" \
  -v "$repo_root/work/client-probe/cache:/cache" \
  -v "$repo_root/deploy/build-client:/tools:ro" \
  -w /build emscripten/emsdk:6.0.12 python3 "/tools/$tool"
echo "Started: sudo docker logs -f $name"
