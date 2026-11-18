export function playbackSource(item,mode='auto',connection={},forceEconomy=false){
 const original=item?.audio_mp3||item?.audio_wav||item?.audio||item?.url||'';
 const slow=forceEconomy||connection?.saveData||/2g|3g/.test(connection?.effectiveType||'')||(connection?.downlink>0&&connection.downlink<1.5);
 const order=mode==='original'?[]:mode==='128'?['128']:mode==='192'?['192']:slow?['128','192']:['192','128'];
 for(const quality of order){const url=item?.qualities?.[quality];if(typeof url==='string'&&/^\/media\/[A-Za-z0-9_-]{10,160}(?:\/[^?#]*)?$/.test(url))return {url,quality};}
 return {url:original,quality:'original'};
}
export function streamURL(value,workerOrigin,siteOrigin){
 try{
  const base=new URL(workerOrigin),url=new URL(value,siteOrigin);
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||url.username||url.password||![siteOrigin,base.origin].includes(url.origin)||!/^\/media\/[A-Za-z0-9_-]{10,160}(?:\/[^/]+)?$/.test(url.pathname))return '';
  const result=new URL(url.pathname,base.origin);result.searchParams.set('stream','1');return result.href;
 }catch{return '';}
}
