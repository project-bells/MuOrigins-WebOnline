import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {createMock} from '../deploy/gcp/mock-backend.mjs';
test('staging CS fixture handles fragmented request and returns empty list',async()=>{
 const server=createMock(44405);server.listen(0,'127.0.0.1');await once(server,'listening');
 const socket=net.createConnection(server.address().port,'127.0.0.1');let all=Buffer.alloc(0);
 try{
  await new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('data',b=>{all=Buffer.concat([all,b]);if(all.length>=17)resolve();});
   socket.on('connect',()=>{socket.write(Buffer.from([0xc1]));setImmediate(()=>socket.write(Buffer.from([4,0xf4,2])));});});
  assert.deepEqual(all,Buffer.from([0xc1,4,0,1,0xc2,0,7,0xf4,4,0,0,0xc2,0,6,0xf4,2,0]));
 }finally{socket.destroy();await new Promise(r=>server.close(r));}
});
