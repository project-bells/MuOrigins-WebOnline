import http from 'node:http';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

// Opaque transport: MU framing and every encryption layer belong to the client/server.
export function createGateway({routes, origins, maxConnections=64, maxPerIp=8,
  maxQueue=262144, maxMessage=65536, connectTimeout=5000, idleTimeout=120000,
  maxBytesPerSecond=262144, maxMessagesPerSecond=512}) {
  if (!routes || !origins?.length) throw Error('Explicit routes and origins required');
  for (const [path, target] of Object.entries(routes)) {
    if (!/^\/mu\/[a-z0-9/-]+$/.test(path) || !target.host || !Number.isInteger(target.port) || target.port<1 || target.port>65535)
      throw Error('Invalid route');
  }
  const active = new Set();
  const perIp = new Map();
  const server = http.createServer((req,res)=>{res.writeHead(req.url==='/healthz'?200:404);res.end(req.url==='/healthz'?'ok':'');});
  const wss = new WebSocketServer({noServer:true, maxPayload:maxMessage, perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const target=routes[req.url]; // exact route; query strings and arbitrary host/port are rejected
    const ip=req.socket.remoteAddress; // never trust user-supplied forwarding headers
    if (!Object.hasOwn(routes,req.url) || !target || !origins.includes(req.headers.origin) ||
        active.size>=maxConnections || (perIp.get(ip)||0)>=maxPerIp) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    wss.handleUpgrade(req,socket,head,ws=>{
      active.add(ws);perIp.set(ip,(perIp.get(ip)||0)+1);
      const tcp=net.createConnection(target);tcp.setNoDelay(true);tcp.setTimeout(idleTimeout);
      let done=false, connected=false, alive=true, epoch=Date.now(), bytes=0, messages=0;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearInterval(heartbeat);
        tcp.destroy();ws.terminate();active.delete(ws);const n=perIp.get(ip)-1;if(n)perIp.set(ip,n);else perIp.delete(ip);};
      const timer=setTimeout(finish,connectTimeout);
      const heartbeat=setInterval(()=>{if(!alive)return finish();alive=false;ws.ping();},30000);
      ws.on('pong',()=>{alive=true;});
      tcp.on('connect',()=>{connected=true;clearTimeout(timer);ws.send(JSON.stringify({type:'ready'}));});
      ws.on('message',(data,binary)=>{
        if(!binary || !connected)return finish();
        if(Date.now()-epoch>=1000){epoch=Date.now();bytes=0;messages=0;}
        bytes+=data.length;messages++;
        if(bytes>maxBytesPerSecond || messages>maxMessagesPerSecond || tcp.writableLength+data.length>maxQueue)return finish();
        tcp.write(data);
      });
      tcp.on('data',data=>{
        if(ws.readyState!==WebSocket.OPEN || ws.bufferedAmount+data.length>maxQueue)return finish();
        ws.send(data,{binary:true},err=>{if(err)finish();});
      });
      for(const event of ['error','close']){tcp.on(event,finish);ws.on(event,finish);}
      tcp.on('timeout',finish);tcp.on('end',finish);
    });
  });
  return {server,close:async()=>{for(const ws of active)ws.terminate();await new Promise(resolve=>server.close(resolve));wss.close();}};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const routes=JSON.parse(process.env.MU_ROUTES||'{}');
  if(!Object.keys(routes).length)throw Error('Set MU_ROUTES to explicit staging endpoints');
  const app=createGateway({routes,origins:(process.env.MU_ORIGINS||'http://127.0.0.1:8080').split(','),maxPerIp:Number(process.env.MU_MAX_PER_IP||8)});
  app.server.listen(Number(process.env.PORT||8081),process.env.LISTEN_HOST||'127.0.0.1');
  process.on('SIGTERM',()=>app.close());
}
