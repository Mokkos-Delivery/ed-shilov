/* Encoding runs off the UI thread. The original audio is never replaced. */
importScripts('/assets/vendor/lame.min.js');
self.onmessage=event=>{
  const {channels,sampleRate,qualities}=event.data;
  try {
    const result=[];
    for(const quality of qualities) {
      const encoder=new lamejs.Mp3Encoder(channels.length,sampleRate,quality),parts=[];
      for(let i=0;i<channels[0].length;i+=1152) {
        const data=channels.length>1?encoder.encodeBuffer(channels[0].subarray(i,i+1152),channels[1].subarray(i,i+1152)):encoder.encodeBuffer(channels[0].subarray(i,i+1152));
        if(data.length)parts.push(new Uint8Array(data));
        if(i%(1152*160)===0)self.postMessage({progress:i/channels[0].length,quality});
      }
      const tail=encoder.flush();if(tail.length)parts.push(new Uint8Array(tail));
      result.push({quality,blob:new Blob(parts,{type:'audio/mpeg'})});
    }
    self.postMessage({result});
  }catch(error){self.postMessage({error:'Не удалось создать MP3. Оригинал сохранён.'});}
};
