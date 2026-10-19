import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createGateway} from '../gateway.mjs';
import {createAdapter} from '../browser-adapter.mjs';
import {MuFrames} from '../framing.mjs';
const origin='http://127.0.0.1:8080';
async function lab(t,handler=socket=>socket.on('data',x=>socket.write(x)),extra={}){
  const sockets=new Set();const tcp=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));handler(socket);});
  tcp.listen(0,'127.0.0.1');await once(tcp,'listening');
  const app=createGateway({routes:{'/mu/connect':{host:'127.0.0.1',port:tcp.address().port}},origins:[origin],...extra});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{for(const socket of sockets)socket.destroy();await app.close();await new Promise(r=>tcp.close(r));});
  return `ws://127.0.0.1:${app.server.address().port}`;
}
async function connect(base,route='/mu/connect',customOrigin=origin){
  const ws=new WebSocket(base+route,{origin:customOrigin});
  const ready=once(ws,'message');await once(ws,'open');
  const [data,binary]=await ready;assert.equal(binary,false);assert.equal(data.toString(),'{"type":"ready"}');return ws;
}
async function rejected(base,route,customOrigin){
  const ws=new WebSocket(base+route,{origin:customOrigin});
  ws.on('error',()=>{});const [,response]=await once(ws,'unexpected-response');assert.equal(response.statusCode,403);response.resume();ws.terminate();
}
test('opaque bytes survive binary WS -> TCP -> WS, including non-MU headers',async t=>{
  const base=await lab(t);const ws=await connect(base);
  const expected=Buffer.from(Array.from({length:256},(_,i)=>i));
  const message=once(ws,'message');ws.send(expected);const [actual,binary]=await message;
  assert.equal(binary,true);assert.deepEqual(actual,expected);ws.close();
});
test('TCP split/coalesced chunks preserve the complete byte stream',async t=>{
  const expected=Buffer.from([0xc1,4,0,1,0xc2,0,6,0xf4,2,0]);
  const base=await lab(t,s=>s.once('data',()=>{s.write(expected.subarray(0,1));setTimeout(()=>s.write(expected.subarray(1,3)),5);setTimeout(()=>s.write(expected.subarray(3)),10);}));
  const ws=await connect(base);const chunks=[];let length=0;
  await new Promise((resolve,reject)=>{ws.on('error',reject);ws.on('message',(data,binary)=>{assert.equal(binary,true);chunks.push(data);length+=data.length;if(length===expected.length)resolve();});ws.send(Buffer.from([1]));});
  assert.deepEqual(Buffer.concat(chunks),expected);ws.close();
});
test('origin, unknown route and arbitrary destination queries rejected',async t=>{
  const base=await lab(t);
  await rejected(base,'/mu/connect','https://evil.invalid');
  await rejected(base,'/mu/missing',origin);
  await rejected(base,'/mu/connect?host=example.com&port=22',origin);
  await rejected(base,'/mu/connect',undefined);
});
test('text data cannot reach TCP',async t=>{let received=0;const base=await lab(t,s=>s.on('data',b=>received+=b.length));const ws=await connect(base);const closed=once(ws,'close');ws.send('credentials');await closed;assert.equal(received,0);});
test('message size limit closes oversized message',async t=>{const base=await lab(t,undefined,{maxMessage:32});const ws=await connect(base);const closed=once(ws,'close');ws.send(Buffer.alloc(33));const [code]=await closed;assert.equal(code,1009);});
test('rate budget closes flooding session',async t=>{const base=await lab(t,undefined,{maxMessagesPerSecond:1});const ws=await connect(base);const closed=once(ws,'close');ws.send(Buffer.from([1]));ws.send(Buffer.from([2]));await closed;});
test('connection cap rejects second session',async t=>{const base=await lab(t,undefined,{maxConnections:1});const ws=await connect(base);await rejected(base,'/mu/connect',origin);ws.close();});
test('upstream disconnect propagates to WS',async t=>{let upstream;const base=await lab(t,s=>{upstream=s;});const ws=await connect(base);const closed=once(ws,'close');upstream.destroy();await closed;});
test('WS disconnect releases TCP connection',async t=>{let upstream;const base=await lab(t,s=>{upstream=s;});const ws=await connect(base);const closed=once(upstream,'close');ws.close();await closed;});
test('upstream refusal closes session without ready',async t=>{
  const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const base=await lab(t,undefined,{routes:{'/mu/connect':{host:'127.0.0.1',port}}});
  const ws=new WebSocket(base+'/mu/connect',{origin});let messages=0;ws.on('message',()=>messages++);await once(ws,'close');assert.equal(messages,0);
});
test('C1/C2/C3/C4 diagnostic framing handles every two-way split and coalescing',()=>{
  const expected=[Buffer.from([0xc1,4,0,1]),Buffer.from([0xc2,0,6,0xf4,2,0]),Buffer.from([0xc3,5,1,2,3]),Buffer.from([0xc4,0,6,1,2,3])];
  const all=Buffer.concat(expected);
  for(let i=0;i<=all.length;i++){const parser=new MuFrames();assert.deepEqual([...parser.push(all.subarray(0,i)),...parser.push(all.subarray(i))],expected);assert.equal(parser.pending.length,0);}
  const parser=new MuFrames();assert.deepEqual(Array.from(all).flatMap(b=>parser.push(Buffer.from([b]))),expected);
});
test('diagnostic framing rejects impossible lengths and unknown tags',()=>{
  for(const bytes of [[0xc1,0],[0xc2,0,3],[0xc4,0xff,0xff],[0x41]])assert.throws(()=>new MuFrames().push(Buffer.from(bytes)));
});
class FakeSocket {
  static all=[];readyState=1;bufferedAmount=0;sent=[];
  constructor(url){this.url=String(url);FakeSocket.all.push(this);}
  close(){this.closed=true;}
  send(x){this.sent.push(x);}
}
function adapter(){
  const events=[];const module={HEAPU8:new Uint8Array(65536),_mu_net_push_open:()=>events.push('open'),_mu_net_push_disconnect:()=>events.push('close'),_mu_net_get_push_buffer:()=>0,_mu_net_push_packet:n=>events.push(module.HEAPU8.slice(0,n))};
  const api=createAdapter({module,baseUrl:'wss://staging.invalid',routes:{'cs:44405':'/mu/connect','gs:55901':'/mu/game/staging'},WebSocketClass:FakeSocket});
  return {api,module,events};
}
test('adapter waits for upstream ready and discards stale socket callbacks',()=>{
  const {api,events}=adapter();api.connect('cs',44405);const old=FakeSocket.all.at(-1);assert.deepEqual(events,[]);assert.equal(api.send(new Uint8Array([1])),-1);
  old.onmessage({data:'{"type":"ready"}'});assert.deepEqual(events,['open']);
  api.connect('gs',55901);const current=FakeSocket.all.at(-1);old.onclose();old.onmessage({data:new Uint8Array([9]).buffer});assert.deepEqual(events,['open']);
  current.onmessage({data:'{"type":"ready"}'});current.onmessage({data:new Uint8Array([7,8]).buffer});assert.deepEqual(events,['open','open',new Uint8Array([7,8])]);
});
test('adapter copies sends, refreshes heap and splits large receives',()=>{
  const {api,module,events}=adapter();api.connect('gs',55901);const ws=FakeSocket.all.at(-1);ws.onmessage({data:'{"type":"ready"}'});
  const bytes=new Uint8Array([3,4]);assert.equal(api.send(bytes),2);bytes[0]=99;assert.equal(ws.sent[0][0],3);
  module.HEAPU8=new Uint8Array(65536);const incoming=new Uint8Array(70000).fill(42);ws.onmessage({data:incoming.buffer});
  assert.equal(events[1].length,65536);assert.equal(events[2].length,4464);assert.equal(events[2][0],42);
});
test('adapter fails closed on unmapped redirect, text, early bytes and overflow',()=>{
  const {api,events}=adapter();assert.throws(()=>api.connect('evil',22));
  api.connect('gs',55901);let ws=FakeSocket.all.at(-1);ws.onmessage({data:new Uint8Array([1]).buffer});assert.equal(events.at(-1),'close');
  api.connect('gs',55901);ws=FakeSocket.all.at(-1);ws.onmessage({data:'garbage'});assert.equal(events.at(-1),'close');
  api.connect('gs',55901);ws=FakeSocket.all.at(-1);ws.onmessage({data:'{"type":"ready"}'});ws.bufferedAmount=262144;assert.equal(api.send(new Uint8Array([1])),-1);assert.equal(events.at(-1),'close');
});
test('real JS adapter and gateway deliver copied bytes end to end',async t=>{
  const base=await lab(t);const expected=new Uint8Array([0x41,0x9f,0,255,0x47]);
  class OriginSocket extends WebSocket{constructor(url){super(url,{origin});}}
  let api;const actual=[];
  const done=new Promise(resolve=>{
    const module={HEAPU8:new Uint8Array(65536),_mu_net_get_push_buffer:()=>0,
      _mu_net_push_open:()=>api.send(expected),_mu_net_push_disconnect:()=>{},
      _mu_net_push_packet:n=>{actual.push(...module.HEAPU8.subarray(0,n));if(actual.length===expected.length)resolve();}};
    api=createAdapter({module,baseUrl:base,routes:{'cs:44405':'/mu/connect'},WebSocketClass:OriginSocket});
  });
  api.connect('cs',44405);await done;assert.deepEqual(actual,Array.from(expected));api.disconnect();
});
