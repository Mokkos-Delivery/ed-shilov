// Bound control-plane requests without imposing a deadline on streamed media.
export async function fetchHeaders(net,url,options={},timeout=15000){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);
  // workerd supports manual/follow only; callers reject non-success statuses.
  try{return await net(url,{...options,signal:abort.signal,redirect:options.redirect||'manual'});}finally{clearTimeout(timer);}
}
export async function readJSON(response,limit=65536,timeout=12000){
  const reader=response.body?.getReader();if(!reader)throw Error('Empty upstream response');
  let size=0,text='',expired=false;const decoder=new TextDecoder();
  const timer=setTimeout(()=>{expired=true;reader.cancel().catch(()=>{});},timeout);
  try{
    while(true){const {value,done}=await reader.read();if(expired)throw Error('Upstream timeout');if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Upstream response too large');}text+=decoder.decode(value,{stream:true});}
    return JSON.parse(text+decoder.decode());
  }finally{clearTimeout(timer);reader.releaseLock();}
}
