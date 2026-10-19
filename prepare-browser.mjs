import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(process.argv[2]||'upstream/browser');
const out=path.resolve('client-overlay');
let patch='';
function edit(file, transform){
  const source=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
  const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,transform(source));
  const result=spawnSync('git',['diff','--no-index','--no-ext-diff','--',path.join(root,file),target],{encoding:'utf8',maxBuffer:4e6});
  if(result.status!==1)throw Error(`diff failed: ${file}: ${result.stderr}`);
  const lines=result.stdout.split('\n');
  const start=lines.findIndex(x=>x.startsWith('@@'));
  patch+=`diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`+lines.slice(start).join('\n');
}
function replace(s,old,value){if(!s.includes(old))throw Error('Source mismatch: '+old.slice(0,90));return s.replace(old,value);}
edit('src/client/browser/net_ws.cpp',s=>{
  s=replace(s,'static int g_open = 0;','static int g_open = 0;\nstatic int g_pending = 0;');
  s=replace(s,'g_in_len > 0x4000000 || n > 0x4000000','n > 262144 || g_in_len > 262144 - n');
  s=replace(s,'        append_in(g_push_buf, len);','        if (!append_in(g_push_buf, len)) { mu_net_push_disconnect(); return; }');
  s=replace(s,'        append_in(data, len);','        if (!append_in(data, len)) { mu_net_push_disconnect(); return; }');
  s=replace(s,'static unsigned char g_push_buf[65536];','extern "C" void mu_net_push_disconnect(void);\nstatic unsigned char g_push_buf[65536];');
  const begin=s.indexOf('    MuEmu::SetActive(false);',s.indexOf('extern "C" int mu_net_connect'));
  const end=s.indexOf('\n}\n',begin);
  if(begin<0||end<0)throw Error('connect source mismatch');
  s=s.slice(0,begin)+`    if (!addr || len < (int)sizeof(sockaddr_in)) return -1;
    const sockaddr_in* endpoint = (const sockaddr_in*)addr;
    unsigned short port = htons(endpoint->sin_port); // byte swap; compat header exposes htons only
    g_pending = 1;
    MuEmu::SetActive(!gNetwork.IsConnectServerMode());
    int started = EM_ASM_INT({
        Module['HEAPU8'] = HEAPU8;
        try {
            if (!window.muRemote) return 0;
            window.muRemote.connect(UTF8ToString($0), $1);
            return 1;
        } catch (e) { return 0; }
    }, g_host, port);
    if (!started) { g_pending = 0; g_err = 10061; return -1; }
    g_err = WSAEWOULDBLOCK;
    return -1;`+s.slice(end);
  s=replace(s,'    if (g_open) {\n        EM_ASM({','    if (g_open || g_pending) {\n        EM_ASM({');
  s=replace(s,"if (typeof window !== 'undefined' && window.soloBridge && window.soloBridge.disconnect) {\n                window.soloBridge.disconnect();\n            }","if (window.muRemote) window.muRemote.disconnect();");
  s=replace(s,'    g_open = 0;\n    g_in_len = 0;\n    g_err = 0;\n    return 0;','    g_open = g_pending = 0;\n    g_in_len = 0;\n    g_err = 0;\n    return 0;');
  s=replace(s,'extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_disconnect(void) {','extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_open(void) {\n    if (!g_pending) return;\n    g_pending = 0; g_open = 1; g_err = 0;\n    post_event(FD_WRITE);\n}\n\nextern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_disconnect(void) {');
  s=replace(s,'    if (g_open) {\n        g_open = 0;','    if (g_open || g_pending) {\n        g_open = g_pending = 0;');
  const b=s.indexOf('    EM_ASM({',s.indexOf('extern "C" int mu_net_send'));
  const e=s.indexOf('\n}\n',b);
  s=s.slice(0,b)+`    int result = EM_ASM_INT({
        try {
            return window.muRemote.send(new Uint8Array(HEAPU8.subarray($0, $0 + $1)));
        } catch (e) { return -1; }
    }, buf, len);
    g_err = result < 0 ? 10054 : 0;
    return result;`+s.slice(e);
  return s;
});
edit('src/client/browser/shell_login.cpp',s=>{
  s=replace(s,'    read_login_query();','    // Online build: credentials must never come from URL parameters.');
  s=replace(s,'        lstrcpynA(g_ServerIPBuf, "127.0.0.1", 128);','        // Config_ReadServerAddr supplies the staging ConnectServer identity.');
  s=replace(s,'        g_ServerPort = 55901;','        g_ServerPort = port;');
  s=replace(s,'        gNetwork.SetConnectServer(false); // Solo offline mode: direct to in-memory GameServer','        // Keep ConnectServer enabled by Config_ReadServerAddr.');
  const b=s.indexOf('    // 🟢 Realm 0:');const e=s.indexOf('    // WinMain fills RandomTable',b);
  if(b<0||e<0)throw Error('realm source mismatch');
  return s.slice(0,b)+'    // Online server names and occupancy come from F4/04 and F4/02.\n\n'+s.slice(e);
});
edit('src/client/src/Net/Recv/Recv_Account.cpp',s=>{
  const b=s.indexOf('        // SOLO MODE:');const e=s.indexOf('        gReconnect.OnJoinServer();',b);
  if(b<0||e<0)throw Error('login source mismatch');
  s=s.slice(0,b)+`        DAT_083a7c14 = 2; // CredentialInput
        DAT_05826cb0 = 2;
        InputNumber = 2;
        PlayBuffer(27, 0, 0);
        HWID_Send();
`+s.slice(e);
  // Remove speculative automatic password retries in online builds.
  const auto=s.indexOf('    // DESVIACIÓN: auto-reintento');
  const next=s.indexOf('// F1/02',auto);
  if(auto<0||next<0)throw Error('retry source mismatch');
  const tail=s.lastIndexOf('// ---------------------------------------------------------------------------',next);
  s=s.slice(0,auto)+'}\n\n'+s.slice(tail);
  return s;
});
// The inherited receive loop can inspect stale bytes when TCP delivers only
// part of a header; check remaining bytes before reading each header field.
edit('src/client/src/Scene/Scene_CharSelect_Nav.cpp',s=>{
  s=replace(s,'        BYTE  hdr   = pBase[iOff];',`        int available = *(int *)((int)param_1 + 0x4010);
        if (available < 2) break;
        BYTE  hdr   = pBase[iOff];`);
  s=replace(s,'            uLen = (uint)pBase[iOff + 1] * 0x100 + pBase[iOff + 2];','            if (available < 3) break;\n            uLen = (uint)pBase[iOff + 1] * 0x100 + pBase[iOff + 2];');
  s=replace(s,'        if (uLen == 0) return 0;','        if (uLen < ((hdr == 0xc2 || hdr == 0xc4) ? 4u : 3u) || uLen > 0x2000) {\n            Net_Disconnect((int)param_1);\n            return 0;\n        }');
  return s;
});
fs.writeFileSync('browser-online.patch',patch);
const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8').replaceAll('\r\n','\n');
const begin=app.indexOf('  preRun: [function () {');
const end=app.indexOf('\n};\nwindow.Module = Module;',begin);
if(begin<0||end<0)throw Error('FS compatibility hook source mismatch');
fs.writeFileSync('remote-fs.js','// FS compatibility from upstream web/app.js; see THIRD-PARTY-NOTICES.md.\nModule.preRun = '+app.slice(begin,end).replace('  preRun: ','')+';\n');
console.log('Created client-overlay and browser-online.patch; WASM compilation still required.');
