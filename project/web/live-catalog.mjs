// Small finite requests: visitors never load the Firebase SDK or Listen channels.
const config=window.ED_CLOUD_CONFIG||{},needed=new Set(),previous=new Map();
if(document.querySelector('.music-card'))needed.add('tracks');
if(document.querySelector('#video-grid'))needed.add('videos');
if(document.querySelector('.news-grid'))needed.add('news');
if(['/bio','/bio.html'].includes(location.pathname))needed.add('photos');
let running=false,lastRun=0;
async function refresh(){
 if(running||document.hidden||Date.now()-lastRun<30000||!config.workerOrigin)return;
 running=true;lastRun=Date.now();
 try{await Promise.all([...needed].map(async kind=>{
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try{
   const r=await fetch(window.ED_CLOUD.endpoint('/api/catalogue?kind='+kind),{signal:abort.signal,credentials:'omit'});
   if(!r.ok)throw Error('Catalogue unavailable');
   const data=await r.json();if(data.ok!==true||data.seeded!==true||!Array.isArray(data.items))return;
   const version=JSON.stringify(data.items);if(previous.get(kind)===version)return;
   previous.set(kind,version);window.ED_CLOUD.publish(kind,data.items);
  }catch{window.dispatchEvent(new CustomEvent('ed:catalogue-error',{detail:{kind}}));}
  finally{clearTimeout(timer);}
 }));}finally{running=false;}
}
refresh();
// Refresh when returning to the tab; no interval or connection held open.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('online',refresh);
window.addEventListener('focus',refresh);
