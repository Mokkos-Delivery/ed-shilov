// Read-only timing check from the visitor's own network. No credentials are sent.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {playbackSource,streamURL} from '../web/playback-core.mjs';
import {RELEASE} from '../web/release.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),settings=JSON.parse(fs.readFileSync(root+'/settings.json','utf8'));
const origin=new URL(settings.workerOrigin).origin;
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
try{
 const health=await json(origin+'/health');if(health.release!==RELEASE)throw Error('Сначала опубликуйте Worker '+RELEASE+'. Сейчас: '+health.release);
 const results=[];
 for(const kind of ['tracks','videos']){
  const catalogue=await json(origin+'/api/catalogue?kind='+kind);const fallback=JSON.parse(fs.readFileSync(root+'/public/'+(kind==='tracks'?'assets/tracks.json':'videos.json'),'utf8'));
  const item=(catalogue.seeded?catalogue.items:fallback)[0];if(!item)continue;
  const source=kind==='tracks'?playbackSource(item):{url:item.video720pUrl||item.video1080pUrl||item.videoUrl||item.url,quality:item.video720pUrl?'720p':'original'};
  const url=streamURL(source.url,origin,'https://eduardshilov.com');if(!url)throw Error('Invalid playback URL');
  for(const attempt of [1,2]){
   const start=performance.now(),r=await fetch(url,{headers:{Range:'bytes=0-'},signal:AbortSignal.timeout(30000)}),headersMs=Math.round(performance.now()-start);
   if(!r.ok)throw Error(kind+': HTTP '+r.status);
   const reader=r.body.getReader();let bytes=0,firstByteMs=null;
   try{while(true){const {done,value}=await reader.read();if(done)break;if(firstByteMs===null)firstByteMs=Math.round(performance.now()-start);bytes+=value.length;if(bytes>4*1024*1024){await reader.cancel();throw Error('Сервис не ограничил размер фрагмента. Проверьте версию Worker.');}}}finally{reader.releaseLock();}
   const result={kind,title:item.title,quality:source.quality,attempt,headersMs,firstByteMs,fragmentMs:Math.round(performance.now()-start),bytes,cache:r.headers.get('X-Media-Cache'),range:r.headers.get('Content-Range')};results.push(result);console.log(JSON.stringify(result));
  }
 }
 fs.writeFileSync(root+'/playback-diagnostics.json',JSON.stringify({release:RELEASE,checkedAt:new Date().toISOString(),results},null,2));
 console.log('Готово: playback-diagnostics.json. Миллисекунды измерены в вашей сети; это не время до звука/первого кадра.');
}catch(error){console.error(error.message);process.exitCode=1;}
