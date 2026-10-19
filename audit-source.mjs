import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const browser=path.resolve(process.argv[2]||'upstream/browser');
const server=path.resolve(process.argv[3]||'upstream/server');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function keys(file){const b=fs.readFileSync(file);if(b.length!==54||b.readUInt16LE(0)!==4370||b.readUInt32LE(2)!==54)throw Error('Unexpected key file format');
  const mask=[0x3f08a79b,0xe25cc287,0x93d27ab9,0x20dea7bf];
  const words=Array.from({length:12},(_,i)=>(b.readUInt32LE(6+4*i)^mask[i%4])>>>0);
  return {hash:hash(b),mod:words.slice(0,4),key:words.slice(4,8),xor:words.slice(8)};
}
function pair(a,b){const enc=keys(a),dec=keys(b);return {encryptionFile:path.relative(browser,a).replaceAll('\\','/'),decryptionFile:path.relative(server,b).replaceAll('\\','/'),encryptionSha256:enc.hash,decryptionSha256:dec.hash,
  modulusMatches:JSON.stringify(enc.mod)===JSON.stringify(dec.mod),xorMatches:JSON.stringify(enc.xor)===JSON.stringify(dec.xor),inverseKeys:enc.key.map((k,i)=>BigInt(k)*BigInt(dec.key[i])%BigInt(enc.mod[i])===1n)};}
const c2s=pair(path.join(browser,'src/client/Client/Data/Enc1.dat'),path.join(server,'MuServer/Data/Hack/Dec1.dat'));
const s2c=pair(path.join(server,'MuServer/Data/Hack/Enc2.dat'),path.join(browser,'src/client/Client/Data/Dec2.dat'));
s2c.encryptionFile='MuServer/Data/Hack/Enc2.dat';s2c.decryptionFile='src/client/Client/Data/Dec2.dat';
const frameSource=fs.readFileSync(path.join(browser,'src/client/src/Net/PacketFrame.cpp'),'utf8');
const table=frameSource.match(/s_FrameByOpcode\[256\]\s*=\s*\{([\s\S]*?)\}/)[1].replace(/\/\/[^\n]*/g,'').match(/-?\d+/g).map(Number);
const overrides=[...frameSource.matchAll(/\{\s*(0x[0-9A-Fa-f]+),\s*(\d+),\s*(-?\d+)\s*\}/g)].map(x=>[Number(x[1]),Number(x[2]),Number(x[3])]);
const policy=fs.readFileSync(path.join(server,'MuServer/Data/Hack/HackPacketCheck.txt'),'utf8');
const mismatches=[];let rows=0;
for(const line of policy.split(/\r?\n/)){const f=line.trim().split(/\s+/);if(!/^\d+$/.test(f[0])||f.length<6)continue;rows++;
  const [op,sub,enc]=f;const override=overrides.find(x=>x[0]===Number(op)&&x[1]===Number(sub));
  const actual=sub==='*'?table[Number(op)]:override?.[2]??table[Number(op)];const expected=enc==='*'?-1:Number(enc);
  if(actual!==expected)mismatches.push({op,sub,expected,actual});
}
const refs=[
 ['browser','src/client/browser/net_ws.cpp',['mu_net_connect','mu_net_send','mu_net_push_packet']],
 ['browser','src/client/browser/shell_login.cpp',['int main','read_login_query']],
 ['browser','web/app.js',['function initServerWorker','window.soloBridge =']],
 ['browser','src/client/src/Config/Config_Load.cpp',['int Config_ReadServerAddr']],
 ['browser','src/client/src/Net/Network.cpp',['void CNetwork::SendLogin','void CNetwork::BeginConnectServerSession','void CNetwork::SendFrameC1','void CNetwork::SendFrameC3','int CNetwork::SendRaw']],
 ['browser','src/client/src/Net/Recv/Recv_Account.cpp',['void Recv_JoinServer','void Recv_CustomServerList','void Recv_ServerList','void Recv_Redirect']],
 ['browser','src/client/src/Scene/Scene_CharSelect_Nav.cpp',['int __fastcall CWsctlc_nRecv']],
 ['browser','src/client/src/Render/SMD_Parser.cpp',['int __cdecl Net_Connect']],
 ['server','Source/MuServer/ConnectServer/ConnectServerProtocol.cpp',['void ConnectServerProtocolCore','void CCServerListRecv','void CCServerInfoRecv']],
 ['server','Source/MuServer/GameServer/SocketManagerLinux.cpp',['bool CSocketManager::DataRecv','bool CSocketManager::DataSend','void CSocketManager::OnRecv']],
 ['server','Source/MuServer/GameServer/Protocol.cpp',['void CGConnectAccountRecv','void CGSetHwidRecv','void GCConnectClientSend']],
 ['server','Source/MuServer/GameServer/PacketManager.cpp',['int CPacketManager::Encrypt(','int CPacketManager::Decrypt(','void CPacketManager::XorData']],
 ['server','Source/MuServer/GameServer/HackCheck.cpp',['void DecryptData','void EncryptData','void InitHackCheck']],
 ['server','Source/MuServer/GameServer/JSProtocol.cpp',['void GJConnectAccountSend','void JGConnectAccountRecv']],
 ['server','Source/MuServer/JoinServer/JoinServerProtocol.cpp',['void GJConnectAccountRecv']],
 ['server','Source/MuServer/GameServer/IpManager.cpp',['bool CIpManager::CheckIpAddress']],
];
const commits={browser:fs.readFileSync(path.join(browser,'.git/refs/heads/main'),'utf8').trim(),server:fs.readFileSync(path.join(server,'.git/refs/heads/main'),'utf8').trim()};
const evidence=refs.map(([repo,file,functions])=>{const bytes=fs.readFileSync(path.join(repo==='browser'?browser:server,file));const lines=bytes.toString().split(/\r?\n/);return {repo,file,sha256:hash(bytes),functions:functions.map(name=>({name,line:lines.findIndex(x=>x.includes(name))+1}))};});
const result={commits,keyCompatibility:{clientToServer:c2s,serverToClient:s2c,note:'Static key algebra only; not native cipher execution or live authentication'},packetFramePolicy:{rows,tableEntries:table.length,mismatches},evidence};
fs.writeFileSync('source-evidence.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({commits,keyCompatibility:result.keyCompatibility,packetFramePolicy:result.packetFramePolicy},null,2));
