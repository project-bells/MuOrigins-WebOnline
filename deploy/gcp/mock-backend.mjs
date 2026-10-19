// Transport fixture only. This is not an authenticating MU game server.
import net from 'node:net';
import {pathToFileURL} from 'node:url';
export function createMock(port){
  return net.createServer(socket=>{
    socket.on('error',()=>{});
    socket.setTimeout(120000,()=>socket.destroy());
    if(port===55901){socket.on('data',data=>socket.write(data));return;}
    socket.write(Buffer.from([0xc1,4,0,1]));
    let pending=Buffer.alloc(0);
    socket.on('data',data=>{
      pending=Buffer.concat([pending,data]);
      if(pending.length>4096)return socket.destroy();
      while(pending.length>=2){
        const size=pending[1];
        if(pending[0]!==0xc1||size<3)return socket.destroy();
        if(pending.length<size)return;
        const packet=pending.subarray(0,size);pending=pending.subarray(size);
        if(packet.equals(Buffer.from([0xc1,4,0xf4,2])))
          socket.write(Buffer.from([0xc2,0,7,0xf4,4,0,0,0xc2,0,6,0xf4,2,0]));
      }
    });
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const port of [44405,55901])createMock(port).listen(port,'0.0.0.0');
}
