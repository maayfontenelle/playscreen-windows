// Stereo PCM16 at 48 kHz. Bounded ring buffer drops old data instead of accumulating delay.
class PlayScreenPCM extends AudioWorkletProcessor {
  constructor(){super();this.size=9600;this.left=new Float32Array(this.size);this.right=new Float32Array(this.size);this.read=0;this.write=0;this.count=0;
    this.port.onmessage=({data})=>{
      if(data.clear){this.read=this.write=this.count=0;return;}
      if(!data.pcm)return;
      const view=new DataView(data.pcm);const frames=Math.floor(view.byteLength/4);
      // If the UI was stalled, keep only the newest ~40 ms on the next packet.
      if(this.count>4800){this.read=(this.write-1920+this.size)%this.size;this.count=1920;}
      for(let f=0;f<frames;f++){
        if(this.count===this.size){this.read=(this.read+1)%this.size;this.count--;}
        this.left[this.write]=view.getInt16(f*4,true)/32768;this.right[this.write]=view.getInt16(f*4+2,true)/32768;
        this.write=(this.write+1)%this.size;this.count++;
      }
    };
  }
  process(inputs,outputs){const out=outputs[0];if(!out?.length)return true;
    for(let i=0;i<out[0].length;i++){
      const available=this.count>0;
      out[0][i]=available?this.left[this.read]:0;if(out[1])out[1][i]=available?this.right[this.read]:0;
      if(available){this.read=(this.read+1)%this.size;this.count--;}
    }return true;
  }
}
registerProcessor('playscreen-pcm',PlayScreenPCM);
