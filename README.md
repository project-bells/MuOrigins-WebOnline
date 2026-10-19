# MuOrigins WebOnline — staging prototype

ต้นแบบ WebSocket-to-TCP gateway และ browser network adapter สำหรับ MU 0.97K

**ติดตั้ง Google Cloud:** [คู่มือภาษาไทยแบบแยก VM/VPC/ฐานข้อมูลจากเซิร์ฟเวอร์เดิม](deploy/gcp/INSTALL.th.md)

**VM เดิมที่ตรวจแล้ว:** [เพิ่มหน้าทดสอบ WSS ที่มีรหัสผ่านโดยคงหน้า Solo เดิม](deploy/same-vm/README.th.md)

เริ่มจาก `compose.smoke.yml` เพื่อทดสอบ WSS กับ backend จำลองก่อน แล้วจึงใช้ `compose.game.yml` สร้าง GameServer/DB staging ใหม่ Browser C++ ยังต้อง build และทดสอบเข้าเกมจริงก่อนเปิดให้ผู้เล่นใช้งาน

อ่าน `REPORT.th.md` สำหรับผลตรวจ source, paths/functions จริง, protocol และรายการที่ยังไม่พิสูจน์

## Reproduce the completed tests

Requires Node.js 24 and Git. Run inside this directory:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
node audit-source.mjs upstream/browser upstream/server
```

Current local package verification: **17 passing tests** (the original 16 plus the Google Cloud staging TCP fixture). Docker/Compose/Nginx/GCP runtime validation and native browser compilation remain pending.

All integration tests create only loopback mock TCP/WebSocket servers on ephemeral ports. No production endpoints or account credentials are configured in the tests. Source audit reads the two pinned local checkouts and emits hashes/algebra/policy comparisons; it does not execute their C++ code.

## Build the browser staging candidate (not yet executed)

Browser base commit: `fb5d6aed769e6384a2f25164e75eded456307be7`.

1. Use a separate checkout at that commit. Run `git apply --check /absolute/path/to/browser-online.patch`, then `git apply /absolute/path/to/browser-online.patch` there. `client-overlay/` contains the same replacement files for inspection; don't apply both methods.
2. In `src/client/src/Config/ServerConfig.h`, set CustomerName, ServerSerial and ClientVersion to the isolated staging server identity. Keep ConnectServerPort nonzero. The default CS logical identity `127.0.0.1:44405` maps to the gateway; it does not mean the browser opens a raw TCP socket.
3. Update the two endpoint mappings in `remote.html` to match the configured ConnectServer identity and the **advertised** address/port in its F4/03 response. Configure gateway routes separately to private staging daemon addresses. Unknown redirects fail closed.
4. Activate Emscripten and run `src/client/compile-objects.bat`, then `src/client/link-login.bat` from a clean candidate checkout. The linker script alone recompiles only the shell/transport/mesh; it is insufficient for the changed `Recv_Account.cpp` and `Scene_CharSelect_Nav.cpp`. Check all compile/link results; no Emscripten build was performed in this session.
5. The upstream linker copies output into its checkout's web directory and patches the solo page. Do not deploy that page. Place the rebuilt `shell_login.js`, matching `.wasm` and `.data` artifacts together with `remote.html`, `remote-fs.js`, and `browser-adapter.mjs` in an isolated static document root. Preserve any other files the build references. Use `remote.html` as the entry point and do not load `app.js` or `server_worker.js`.
6. Confirm the rebuilt Module exports `_mu_net_push_open`, `_mu_net_get_push_buffer`, `_mu_net_push_packet`, `_mu_net_push_disconnect` and exposes `HEAPU8`. New callback uses EMSCRIPTEN_KEEPALIVE, but this has not been proven through linking in this environment.
7. Run the staging acceptance sequence from the report. Desktop mouse/keyboard are the initial target; mobile controls and visual QA are pending.

To regenerate overlay/patch/filesystem hook from the unmodified pinned browser source:

```powershell
node prepare-browser.mjs upstream/browser
```

The generator fails on missing expected source fragments. `browser-online.patch` was checked for clean application to the pinned base, not compiled.

## Gateway configuration

```powershell
$env:MU_ROUTES = '{"/mu/connect":{"host":"127.0.0.1","port":44405},"/mu/game/staging":{"host":"127.0.0.1","port":55901}}'
$env:MU_ORIGINS = 'http://127.0.0.1:8080'
npm start
```

Run this only when those ports belong to your isolated staging stack. Nothing starts automatically from this delivery. No default upstream exists: gateway refuses startup without explicit MU_ROUTES. Default listen address is 127.0.0.1:8081. Health endpoint `/healthz` confirms only gateway HTTP liveness, not MU daemon health. TCP ready control frame is transport metadata and is never passed into the MU parser.

Limits: max 64 active sessions, 8 per source IP, 64 KiB per WS message, 256 KiB queue, 256 KiB/s and 512 messages/s client input, 5s TCP connect timeout, 120s TCP inactivity, 30s ping/pong. Exceeding a queue/rate/timeout closes the connection. No seamless resume, web SSO, ticket service or distributed admission system is implemented.

## Container example (not built or deployed)

`compose.staging.yml` expects an existing **isolated** network `mu-network-lab-staging` with a staging MU service reachable as `mu-staging`. It does not create a GameServer, database or certificates. Do not attach it to production's network. Run with a distinct project name only after creating that isolated stack:

```powershell
docker compose -p mu-ws-lab -f compose.staging.yml config
docker compose -p mu-ws-lab -f compose.staging.yml build
docker compose -p mu-ws-lab -f compose.staging.yml up -d
```

Adapt `nginx.staging.conf` paths and certificate paths, validate with `nginx -t`, then activate on the staging host. It assumes host Nginx. A containerized Nginx needs service DNS/network configuration instead of 127.0.0.1:18081. Set `.wasm` MIME type and restrict staging access by private network/VPN or your existing access system. Origin checks alone are not user authentication.

Gateway receives Nginx's source IP, so compose raises its per-IP cap to the global cap; Nginx enforces the per-real-IP cap. Server-side MU per-IP limits also see the gateway IP. Address those policies explicitly in staging; PROXY headers are not supported by this MU TCP protocol.

Dependencies are locked in package-lock.json. Image/dependency security review, immutable image digest, Docker/Nginx/TLS validation and load testing remain pending.

## Files and status

- `gateway.mjs`, `browser-adapter.mjs`, `framing.mjs`, `test/`: 16 passing JS tests.
- `source-evidence.json`: original source functions/lines/hashes, key compatibility and 272 policy rows.
- `client-overlay/`, `browser-online.patch`: candidate C++ changes, application check passed; native build/runtime unverified.
- `remote.html`, `remote-fs.js`: staging browser entry and upstream filesystem compatibility hook; visual/runtime testing unverified.
- `Dockerfile`, `compose.staging.yml`, `nginx.staging.conf`: deployment examples, not validated by their runtimes.
- `REPORT.th.md`: detailed analysis and next acceptance gates.

The original analysis run made no production connections or deployments. This repository packages that prototype and a separate Google Cloud installation guide; publishing source does not deploy it.
