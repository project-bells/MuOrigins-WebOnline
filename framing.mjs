// Offline diagnostic parser ONLY; do not attach this to encrypted wire streams.
export class MuFrames {
  pending=Buffer.alloc(0);
  push(chunk){
    this.pending=Buffer.concat([this.pending,chunk]);const frames=[];
    while(this.pending.length){
      const tag=this.pending[0],wide=tag===0xc2||tag===0xc4;
      if(![0xc1,0xc2,0xc3,0xc4].includes(tag))throw Error('Invalid MU tag (outer encryption still active?)');
      const header=wide?3:2;
      if(this.pending.length<header)break;
      const size=wide?this.pending.readUInt16BE(1):this.pending[1];
      if(size<header+1||size>8192)throw Error('Invalid MU length');
      if(this.pending.length<size)break;
      frames.push(this.pending.subarray(0,size));this.pending=this.pending.subarray(size);
    }
    return frames;
  }
}
