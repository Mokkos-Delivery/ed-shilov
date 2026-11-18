// Only explicit player requests use bounded chunks. Downloads keep their original semantics.
export const chunkBytes=4*1024*1024;
export function playbackRange(request,record){
 const url=new URL(request.url),range=request.headers.get('Range');
 if(request.method!=='GET'||url.searchParams.get('stream')!=='1'||url.searchParams.has('download')||! /^(audio|video)\//.test(record.mime)||!range)return null;
 const m=/^bytes=(\d*)-(\d*)$/.exec(range),size=Number(record.size);
 if(!m||(!m[1]&&!m[2]))return null;
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 const end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
 const stop=Math.min(end,start+chunkBytes-1);
 return {range:`bytes=${start}-${stop}`,contentRange:`bytes ${start}-${stop}/${size}`,length:stop-start+1};
}
export function chunkKey(request,record,project,plan){
 const key=new URL(request.url);key.pathname='/__media_cache/v1/'+encodeURIComponent(project)+'/'+record.driveId+'/'+record.size+'/'+plan.range.slice(6);key.search='';return new Request(key.href);
}
export async function cachedChunk(cache,key,plan){
 if(!cache)return null;
 try{
  const cached=await cache.match(key);
  if(!cached||cached.headers.get('X-Stored-Range')!==plan.contentRange||Number(cached.headers.get('Content-Length'))!==plan.length)return null;
  const headers=new Headers(cached.headers);headers.set('Content-Range',headers.get('X-Stored-Range'));headers.delete('X-Stored-Range');headers.set('Cache-Control','public, max-age=15');headers.set('X-Media-Cache','HIT');
  return new Response(cached.body,{status:206,headers});
 }catch{return null;}
}
let cacheWrites=0;
export async function storeChunk(cache,key,response,plan){
 if(cacheWrites>=2){response.body?.cancel().catch(()=>{});return;}
 const reader=response.body?.getReader();if(!reader)return;cacheWrites++;
 let size=0;const parts=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>plan.length||size>chunkBytes){await reader.cancel();return;}parts.push(value);}
  if(size!==plan.length)return;
  const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
  const headers=new Headers(response.headers);headers.set('X-Stored-Range',plan.contentRange);headers.delete('Content-Range');headers.delete('X-Media-Cache');headers.set('Content-Length',String(size));headers.set('Cache-Control','public, max-age=3600');
  // Cache API cannot store 206. This private key is never a public endpoint.
  await cache.put(key,new Response(body,{status:200,headers}));
 }catch{/* Cache availability never prevents playback. */}finally{reader.releaseLock();cacheWrites--;}
}
