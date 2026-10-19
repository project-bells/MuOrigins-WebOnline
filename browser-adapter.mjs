// Install as window.muRemote BEFORE loading the rebuilt Emscripten client.
// routes keys match the address and port supplied by CreateSocket/Recv_Redirect.
export function createAdapter({module, baseUrl, routes, WebSocketClass=globalThis.WebSocket, maxQueue=262144}) {
  let current=null, generation=0;
  return {
    connect(host,port) {
      this.disconnect();
      const route=routes[`${host}:${port}`];
      if(!Object.hasOwn(routes,`${host}:${port}`) || !route)throw Error('Unmapped MU endpoint');
      const url=new URL(route,baseUrl);
      if(url.origin!==new URL(baseUrl).origin || !['ws:','wss:'].includes(url.protocol))throw Error('Invalid gateway URL');
      const ws=new WebSocketClass(url);current=ws;const mine=++generation;let ready=false;
      ws.binaryType='arraybuffer';
      const fail=()=>{if(mine!==generation)return;current=null;generation++;ws.close();module._mu_net_push_disconnect();};
      ws.onmessage=event=>{
        if(mine!==generation)return;
        if(typeof event.data==='string'){
          if(event.data!==JSON.stringify({type:'ready'}) || ready)return fail();
          ready=true;module._mu_net_push_open();return;
        }
        if(!ready || !(event.data instanceof ArrayBuffer))return fail();
        const bytes=new Uint8Array(event.data);
        // Copy fresh HEAPU8 on every callback: WASM memory may have grown.
        for(let pos=0;pos<bytes.length;pos+=65536){
          if(mine!==generation)return;
          const chunk=bytes.subarray(pos,pos+65536);
          module.HEAPU8.set(chunk,module._mu_net_get_push_buffer());
          module._mu_net_push_packet(chunk.length);
        }
      };
      ws.onerror=fail;ws.onclose=fail;
      ws.muReady=()=>ready;
    },
    send(bytes){
      if(!current || current.readyState!==1 || !current.muReady())return -1;
      if(current.bufferedAmount+bytes.length>maxQueue){this.disconnect();module._mu_net_push_disconnect();return -1;}
      current.send(bytes.slice());return bytes.length;
    },
    disconnect(){generation++;if(current){const old=current;current=null;old.close();}}
  };
}
