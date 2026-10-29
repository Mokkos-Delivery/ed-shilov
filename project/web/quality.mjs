export async function qualityFiles(file,qualities=[128,192],onProgress=()=>{},signal) {
  if(file.size>100*1024*1024)throw Error('Автоматическая подготовка качества в браузере ограничена файлом 100 МБ.');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)throw Error('Этот браузер не поддерживает обработку аудио.');
  // Check duration before allocating a full PCM buffer for a compressed file.
  await new Promise((resolve,reject)=>{
    const audio=new Audio(),url=URL.createObjectURL(file);
    const finish=error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);error?reject(error):resolve();};
    const abort=()=>finish(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(Error('Не удалось проверить длительность дорожки.')),20000);
    audio.onloadedmetadata=()=>{const duration=audio.duration;audio.onloadedmetadata=null;audio.onerror=null;finish(!Number.isFinite(duration)||duration>15*60?Error('Для автоматической обработки выберите дорожку не длиннее 15 минут.'):null);};
    audio.onerror=()=>{audio.onloadedmetadata=null;audio.onerror=null;finish(Error('Браузер не может прочитать эту дорожку.'));};
    signal?.addEventListener('abort',abort,{once:true});audio.preload='metadata';audio.src=url;
  });
  const context=new AudioContext();let audio;
  try{audio=await context.decodeAudioData(await file.arrayBuffer());}finally{await context.close();}
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(audio.duration>15*60)throw Error('Для автоматической обработки выберите дорожку не длиннее 15 минут.');
  const channels=[];
  for(let c=0;c<Math.min(audio.numberOfChannels,2);c++){const floats=audio.getChannelData(c),pcm=new Int16Array(floats.length);for(let i=0;i<floats.length;i++){const x=Math.max(-1,Math.min(1,floats[i]));pcm[i]=x<0?x*32768:x*32767;}channels.push(pcm);}
  const sampleRate=audio.sampleRate;
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./quality-worker.js'+new URL(import.meta.url).search,import.meta.url));
    const abort=()=>{worker.terminate();reject(new DOMException('Cancelled','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    const finish=()=>{worker.terminate();signal?.removeEventListener('abort',abort);};
    worker.onerror=()=>{finish();reject(Error('Не удалось подготовить качество.'));};
    worker.onmessage=event=>{const data=event.data;if(data.error){finish();reject(Error(data.error));}else if(data.result){finish();resolve(data.result.map(x=>({quality:x.quality,file:new File([x.blob],file.name.replace(/\.[^.]+$/,'')+'-'+x.quality+'kbps.mp3',{type:'audio/mpeg'})})));}else onProgress(data.quality,data.progress);};
    worker.postMessage({channels,sampleRate,qualities},channels.map(x=>x.buffer));
  });
}
