const cacheName='edshilov-site-firebase-1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(cacheName).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^edshilov-site-/.test(key)&&key!==cacheName).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  // Never cache tokens, administrator pages, forms or multi-gigabyte media.
  if(event.request.method!=='GET'||event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
