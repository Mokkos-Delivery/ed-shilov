// Public content/player work immediately. Live updates connect after first paint.
(() => {
 const start=()=>import('./live-catalog.mjs?v=studio-4').catch(()=>{});
 const schedule=()=>{if('requestIdleCallback' in window)requestIdleCallback(start,{timeout:2500});else setTimeout(start,250);};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
