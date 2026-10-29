/* Static, progressive enhancement. No framework, startup video, third-party font or tracking by default. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const storage = {
    get(k,f=null) { try {const v=localStorage.getItem(k);return v===null?f:JSON.parse(v);} catch{return f;} },
    set(k,v) {try {localStorage.setItem(k,JSON.stringify(v));} catch{}},
    remove(k) {try {localStorage.removeItem(k);} catch{}}
  };
  function legacy(key,fallback){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
  const cfg=window.SITE_CONFIG||{}, reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let motionChoice=storage.get('es7_motion','auto');
  function motionAllowed(){return motionChoice==='on'||(motionChoice!=='off'&&!reduced.matches);}
  function motionUI(){document.documentElement.dataset.motion=motionChoice;document.body.classList.toggle('motion-off',!motionAllowed());$('#motion-toggle')?.setAttribute('aria-pressed',String(motionAllowed()));}
  $('#motion-toggle')?.addEventListener('click',()=>{motionChoice=motionAllowed()?'off':'on';storage.set('es7_motion',motionChoice);motionUI();updateSpin();});motionUI();
  let lang=storage.get('es5_lang',legacy('edshilov_lang','ru'))==='en'?'en':'ru', favourites=new Set((Array.isArray(storage.get('es5_favourites',[]))?storage.get('es5_favourites',[]):[]).filter(x=>typeof x==='string')), favOnly=false;
  const tr=(ru,en)=>lang==='en'?en:ru;
  const safeURL = (v, external=false) => {try {const u=new URL(v,location.href);return (['http:','https:'].includes(u.protocol)&&(!external||u.protocol==='https:'))?u.href:'';} catch{return '';}};
  let toastTimer;
  function toast(message){$('#toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',4500);}
  function resolveImage(value){if(!value)return '';try{const u=new URL(value,location.href),key=decodeURIComponent(u.pathname);return window.SITE_IMAGE_MAP?.[key]||value;}catch{return value;}}
  function fixImages(){document.querySelectorAll('img[src]').forEach(im=>{const src=im.getAttribute('src');if(src)im.setAttribute('src',resolveImage(src));});}
  document.addEventListener('error',ev=>{const im=ev.target;if(im.tagName!=='IMG'||im.dataset.fallback)return;im.dataset.fallback='1';im.removeAttribute('srcset');im.src='/assets/img/branding/RUS.webp';im.classList.add('image-unavailable');im.title=tr('Не удалось загрузить изображение','Image could not be loaded');},true);
  function translate(){
    document.documentElement.lang=lang;
    $$('[data-ru]').forEach(el=>el.textContent=el.dataset[lang]);
    $$('[data-ru-html]').forEach(el=>el.innerHTML=el.dataset[lang+'Html']); // original trusted biography dictionary
    $('#language').textContent=lang==='ru'?'EN':'RU';$('#language').setAttribute('aria-label',tr('Switch to English','Переключить на русский'));
    if($('#music-search')) $('#music-search').placeholder=tr('Название песни','Song title');
    if($('#video-search')) $('#video-search').placeholder=tr('Название видео','Video title');
    $$('.music-card').forEach(el=>{const title=el.querySelector('h3').textContent;el.querySelector('[data-play]').setAttribute('aria-label',tr('Слушать: ','Play: ')+title);el.querySelector('[data-fav]').setAttribute('aria-label',tr('Избранное: ','Favourite: ')+title);});
    if($('#lang-logo'))$('#lang-logo').src=lang==='en'?'/assets/img/branding/ENG.webp':'/assets/img/branding/RUS.webp';fixImages();updateFavouriteButtons();filterMusic();filterVideo();
  }
  $('#language').addEventListener('click',()=>{lang=lang==='ru'?'en':'ru';storage.set('es5_lang',lang);translate();});
  document.documentElement.dataset.theme=storage.get('es5_theme',legacy('edshilov_theme','dark'))==='light'?'light':'dark';
  $('#theme').addEventListener('click',()=>{const value=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=value;storage.set('es5_theme',value);});
  const menu=$('#mobile-nav'),toggle=$('#menu-toggle');
  function closeMenu(focus=false){menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus();}
  toggle.addEventListener('click',()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('click',ev=>{if(!menu.hidden&&!ev.target.closest('.site-header'))closeMenu();});
  menu.addEventListener('click',ev=>{if(ev.target.closest('a'))closeMenu();});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!menu.hidden)closeMenu(true);});
  matchMedia('(min-width:901px)').addEventListener('change',ev=>{if(ev.matches)closeMenu();});
  // Native dialogs provide focus trapping and Escape; return focus to their opener.
  const openers=new WeakMap();
  function openDialog(d){closeMenu();openers.set(d,document.activeElement);d.showModal();}
  $$('dialog').forEach(d=>{d.querySelector('[data-close]').addEventListener('click',()=>d.close());d.addEventListener('click',ev=>{if(ev.target===d){const b=d.getBoundingClientRect();if(ev.clientX<b.left||ev.clientX>b.right||ev.clientY<b.top||ev.clientY>b.bottom)d.close();}});d.addEventListener('close',()=>openers.get(d)?.focus());});
  async function copy(text){try {await navigator.clipboard.writeText(text);toast(tr('Скопировано','Copied'));}catch {toast(tr('Не удалось скопировать. Выделите текст и скопируйте вручную.','Copy failed. Select the text and copy it manually.'));}}
  function shareLink(url){copy(url);}
  $$('[data-share-site]').forEach(b=>b.addEventListener('click',()=>shareLink('https://eduardshilov.com/')));
  async function json(url){const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
  const tracksPromise=$('.music-card')?json('/assets/tracks.json'):Promise.resolve([]);
  const videosPromise=$('.video-card')?json('/videos.json'):Promise.resolve([]);
  let variants={}; if($('.music-card')||$('.video-card'))json('/assets/media-variants.json').then(x=>variants=x||{}).catch(()=>{});
  let tracks=[],videos=[],current=null,audio=new Audio(),saved=storage.get('es5_playback',null),pendingTime=0;
  audio.preload='none';
  function format(n){n=Math.floor(Number.isFinite(n)?n:0);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
  function persistPlayback(){if(current)storage.set('es5_playback',{id:current.id,time:Number.isFinite(audio.currentTime)?audio.currentTime:pendingTime});}
  function selected(t){
    qualityJob++;qualityController?.abort();qualityApplied='original';stallCount=0;current=t;$('#player').hidden=false;document.body.classList.add('has-player');$('#player-title').textContent=t.title;$('#player-cover').src=resolveImage(t.cover)||'';
    $('#player-state').textContent=tr('Нажмите ▶, чтобы слушать','Press ▶ to listen');
  }
  function getAudio(t){const source=t?.audio_mp3||t?.audio_wav||t?.audio||t?.url||'';return variants[source]||source;}
  async function playTrack(t){
    if(!t)return;$('#video-player').pause();
    if(current?.id!==t.id){audio.pause();pendingTime=0;selected(t);audio.removeAttribute('src');}
    if(!audio.getAttribute('src')){const url=safeURL(getAudio(t));if(!url){toast(tr('Аудиофайл не указан','No audio file available'));return;}audio.src=url;}
    try {await audio.play();trackEvent('music_play',{track_id:t.id});scheduleQuality(t);}catch{if(audio.error)toast(tr('Аудиофайл недоступен. Попробуйте позже.','Audio is unavailable. Please try again later.'));else toast(tr('Нажмите ▶ ещё раз для воспроизведения','Press ▶ again to play'));}
  }
  function state(playing){$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?tr('Пауза','Pause'):tr('Воспроизвести','Play'));if(current)$('#player-state').textContent=playing?tr('Сейчас играет','Now playing'):tr('На паузе','Paused');}
  audio.addEventListener('play',()=>state(true));audio.addEventListener('pause',()=>state(false));
  audio.addEventListener('error',()=>{state(false);$('#player-state').textContent=tr('Файл недоступен','File unavailable');toast(tr('Не удалось открыть аудио. Проверьте доступность файла.','Cannot open audio. Check that the file is available.'));});
  audio.addEventListener('loadedmetadata',()=>{if(pendingTime>0&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(pendingTime,audio.duration);pendingTime=0;}});
  audio.addEventListener('timeupdate',()=>{if(Number.isFinite(audio.duration))$('#seek').value=String(audio.currentTime/audio.duration*100);$('#player-time').textContent=format(audio.currentTime)+' / '+format(audio.duration);});
  audio.addEventListener('pause',persistPlayback);window.addEventListener('pagehide',persistPlayback);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)persistPlayback();});
  let persistBucket=-1;audio.addEventListener('timeupdate',()=>{const b=Math.floor(audio.currentTime/10);if(b!==persistBucket){persistBucket=b;persistPlayback();}});
  $('#seek').addEventListener('input',ev=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(ev.target.value)/100*audio.duration;});
  $('#play').addEventListener('click',()=>audio.paused?playTrack(current):audio.pause());
  function next(direction){if(!tracks.length)return;const i=tracks.findIndex(t=>t.id===current?.id);playTrack(tracks[(i+direction+tracks.length)%tracks.length]);}
  $('#next').addEventListener('click',()=>next(1));$('#previous').addEventListener('click',()=>next(-1));audio.addEventListener('ended',()=>next(1));
  $('#player-close').addEventListener('click',()=>{audio.pause();persistPlayback();audio.removeAttribute('src');audio.load();pendingTime=storage.get('es5_playback',{}).time||0;$('#player').hidden=true;document.body.classList.remove('has-player');});
  tracksPromise.then(data=>{
    tracks=Array.isArray(data)?data:[];
    const q=new URLSearchParams(location.search),target=q.get('track')||q.get('q');
    const matching=target?tracks.find(t=>t.id===target||t.slug===target||normalize(t.title)===normalize(target)):null;
    if(matching){selected(matching);toast(tr('Песня найдена. Нажмите ▶ для воспроизведения.','Track found. Press ▶ to play.'));}
    else if(saved?.id){const t=tracks.find(x=>x.id===saved.id);if(t){selected(t);pendingTime=Math.max(0,Number(saved.time)||0);$('#player-time').textContent=format(pendingTime)+' / —';}}
    filterMusic();
  }).catch(()=>toast(tr('Не удалось загрузить каталог. Ссылки на скачивание остаются доступны.','Could not load the catalogue. Download links are still available.')));
  function updateFavouriteButtons(){$$('[data-fav]').forEach(b=>{const yes=favourites.has(b.dataset.fav);b.setAttribute('aria-pressed',String(yes));b.textContent=yes?'♥':'♡';});}
  function normalize(v){return String(v||'').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
  function filterMusic(){if(!$('#music-grid'))return;const query=normalize($('#music-search').value),mode=$('#music-sort').value;let cards=$$('#music-grid .music-card');
    if(tracks.length){const index=new Map(tracks.map((t,i)=>[t.id,{...t,i}]));cards.sort((a,b)=>{const x=index.get(a.dataset.trackId),y=index.get(b.dataset.trackId);if(!x||!y)return 0;return mode==='name'?x.title.localeCompare(y.title,lang):mode==='new'?(Date.parse(y.createdAt)||0)-(Date.parse(x.createdAt)||0):x.i-y.i;});cards.forEach(c=>$('#music-grid').append(c));}
    let count=0;cards.forEach(c=>{c.hidden=!(normalize(c.querySelector('h3').textContent).includes(query)&&(!favOnly||favourites.has(c.dataset.trackId)));if(!c.hidden)count++;});$('#music-count').textContent=tr('Найдено песен: ','Tracks found: ')+count;$('#music-empty').hidden=count>0;
  }
  $('#music-search')?.addEventListener('input',filterMusic);$('#music-sort')?.addEventListener('change',filterMusic);
  $('#favourites-filter')?.addEventListener('click',ev=>{favOnly=!favOnly;ev.currentTarget.setAttribute('aria-pressed',String(favOnly));filterMusic();});
  document.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-play],[data-fav],[data-share-track],[data-ringtone]');if(!b)return;
    if(b.dataset.fav){const id=b.dataset.fav;favourites.has(id)?favourites.delete(id):favourites.add(id);storage.set('es5_favourites',[...favourites]);updateFavouriteButtons();filterMusic();return;}
    if(b.dataset.shareTrack){shareLink('https://eduardshilov.com/music.html?track='+encodeURIComponent(b.dataset.shareTrack));return;}
    try {await tracksPromise;}catch{return;}
    const t=tracks.find(t=>t.id===(b.dataset.play||b.dataset.ringtone));
    if(b.dataset.play)playTrack(t);
    else if(t)openRingtone(t);
  });
  let qualityMode=storage.get('es7_quality','auto'),qualityJob=0,qualityController=null,qualityApplied='original',stallCount=0;
  const qualitySelect=$('#audio-quality'),qualityStatus=$('#audio-quality-status');
  if(!['auto','128','192','original'].includes(qualityMode))qualityMode='auto';qualitySelect.value=qualityMode;
  function desiredQuality(forceEconomy=false){if(qualityMode!=='auto')return qualityMode;const c=navigator.connection;return forceEconomy||c?.saveData||/2g|3g/.test(c?.effectiveType||'')||(c?.downlink&&c.downlink<1.5)?'128':'original';}
  async function scheduleQuality(t,forceEconomy=false){if(!t)return;const desired=desiredQuality(forceEconomy),job=++qualityJob;qualityController?.abort();qualityController=new AbortController();const signal=qualityController.signal;
    if(desired==='original'){if(qualityApplied!=='original')await swapQuality(getAudio(t),t,job,'original');qualityStatus.textContent=tr('Оригинал','Original');return;}
    qualityStatus.textContent=tr('Подготовка ','Preparing ')+desired+' kbps';const timer=setTimeout(()=>qualityController?.abort(),32000);
    try{const response=await fetch('/audio-quality.php?action=prepare&track='+encodeURIComponent(t.id)+'&quality='+desired,{signal,credentials:'same-origin'});if(!response.ok)throw Error('unavailable');const data=await response.json();if(!data.ready||job!==qualityJob||current?.id!==t.id)return;const u=new URL(data.url,location.href);if(u.origin!==location.origin||u.pathname!=='/audio-quality.php')throw Error('invalid');await swapQuality(u.href,t,job,desired);}
    catch(err){if(job===qualityJob&&err.name!=='AbortError'){qualityStatus.textContent=tr('Доступен оригинал','Original available');if(qualityMode!=='auto')toast(tr('Хостинг пока не подготовил это качество. Продолжаем оригинал.','This quality is not ready on the host. Continuing the original.'));}}
    finally{clearTimeout(timer);if(job===qualityJob&&signal.aborted)qualityStatus.textContent=tr('Оригинал','Original');}
  }
  async function swapQuality(url,t,job,label){if(job!==qualityJob||current?.id!==t.id)return;const playing=!audio.paused,time=audio.currentTime||0;audio.pause();pendingTime=time;audio.src=safeURL(url);qualityApplied=label;qualityStatus.textContent=label==='original'?tr('Оригинал','Original'):label+' kbps';audio.load();if(playing)try{await audio.play();}catch{qualityStatus.textContent=tr('Нажмите ▶ для продолжения','Press ▶ to continue');}}
  qualitySelect.addEventListener('change',()=>{qualityMode=qualitySelect.value;storage.set('es7_quality',qualityMode);if(current)scheduleQuality(current);});
  navigator.connection?.addEventListener?.('change',()=>{if(qualityMode==='auto'&&current)scheduleQuality(current);});
  audio.addEventListener('waiting',()=>{if(qualityMode==='auto'&&qualityApplied==='original'&&++stallCount===2)scheduleQuality(current,true);});

  // Videos are fetched only by an explicit Play or quality-selection action.
  const pausedVideoIds=new Set(["v_1761232040", "v_1761232071", "v_1761555594", "v_1761556233", "v_1761556263", "v_1761560251", "v_1761561411", "v_1761563646", "v_1762172639", "v_1762172824", "v_1762172996", "v_1762173119", "v_1763389251"]);
  videosPromise.then(data=>{videos=Array.isArray(data)?data.filter(v=>!pausedVideoIds.has(v.id)):[];const q=new URLSearchParams(location.search).get('q');if(q&&$('#video-search'))$('#video-search').value=q;if(location.hash==='#projects'&&$('#video-filter'))$('#video-filter').value='event';filterVideo();}).catch(()=>toast(tr('Не удалось загрузить видеотеку','Could not load the video catalogue')));
  function filterVideo(){if(!$('#video-grid'))return;const query=normalize($('#video-search').value),type=$('#video-filter').value;let count=0;$$('#video-grid .video-card').forEach(c=>{const v=videos.find(v=>v.id===c.dataset.videoId);c.hidden=!(normalize(c.querySelector('h3').textContent).includes(query)&&(type==='all'||!v||v.type===type));if(!c.hidden)count++;});$('#video-count').textContent=tr('Найдено видео: ','Videos found: ')+count;$('#video-empty').hidden=count>0;}
  $('#video-search')?.addEventListener('input',filterVideo);$('#video-filter')?.addEventListener('change',filterVideo);
  const video=$('#video-player');
  let videoSession=0,videoAttempt=0,videoQueue=[],videoSeen=new Set(),videoItem=null,videoTimer,videoResume=0,videoMetadataHandler=null,videoResolveController=null,videoResolved=false;
  function mediaURL(value){return typeof value==='string'&&value.trim()?safeURL(value):'';}
  function videoChoices(v){return [['720p',v.video720pUrl],['1080p',v.video1080pUrl],['Оригинал',v.url||v.videoUrl]].filter(x=>mediaURL(x[1]));}
  function addVideoCandidates(values){for(const value of values){const url=mediaURL(value);if(url&&!videoSeen.has(url)&&!videoQueue.includes(url))videoQueue.push(url);}}
  function videoCandidates(url){const mapped=variants[url];return [typeof mapped==='string'?mapped:null,url].filter(Boolean);}
  function clearVideoAttempt(){clearTimeout(videoTimer);if(videoMetadataHandler){video.removeEventListener('loadedmetadata',videoMetadataHandler);videoMetadataHandler=null;}}
  async function nextVideoSource(){
    clearVideoAttempt();if(!videoItem||!$('#media-dialog').open)return;
    const session=videoSession,attempt=++videoAttempt;
    if(!videoQueue.length&&!videoResolved){
      videoResolved=true;$('#video-status').textContent=tr('Проверяю расположение видео…','Checking video location…');
      const ctl=new AbortController();videoResolveController=ctl;const timeout=setTimeout(()=>ctl.abort(),8000);
      try{const r=await fetch('/media-source.php?kind=video&id='+encodeURIComponent(videoItem.id),{signal:ctl.signal,credentials:'same-origin',cache:'no-store'});if(r.ok){const data=await r.json();if(session===videoSession&&attempt===videoAttempt)addVideoCandidates((data.sources||[]).map(x=>x.url));}}
      catch{}finally{clearTimeout(timeout);if(videoResolveController===ctl)videoResolveController=null;}
      if(session!==videoSession||attempt!==videoAttempt)return;
      // Older uploads sometimes put the exact catalog filename in the document root.
      for(const [,original] of videoChoices(videoItem)){const u=new URL(mediaURL(original));if(u.origin===location.origin){const file=u.pathname.split('/').pop();if(file)addVideoCandidates(['/'+file,'/assets/video/'+file]);}}
    }
    if(!videoQueue.length){video.removeAttribute('src');video.load();$('#video-status').textContent=tr('Не удалось открыть видео. Файл отсутствует, сервер недоступен или формат не поддерживается.','Could not open the video. The file is missing, the server is unavailable, or the format is unsupported.');$('#video-retry').hidden=false;return;}
    const source=videoQueue.shift();videoSeen.add(source);$('#video-retry').hidden=true;
    $('#video-status').textContent=videoSeen.size>1?tr('Пробую другой источник…','Trying another source…'):tr('Загрузка видео…','Loading video…');
    videoMetadataHandler=()=>{if(session!==videoSession||attempt!==videoAttempt)return;clearTimeout(videoTimer);if(videoResume>0)video.currentTime=Number.isFinite(video.duration)?Math.min(videoResume,Math.max(0,video.duration-.1)):videoResume;};
    video.addEventListener('loadedmetadata',videoMetadataHandler,{once:true});video.src=source;video.load();
    videoTimer=setTimeout(()=>{if(session===videoSession&&attempt===videoAttempt&&video.readyState<1)nextVideoSource();},15000);
    try{await video.play();}catch(e){if(session===videoSession&&attempt===videoAttempt&&e.name==='NotAllowedError')$('#video-status').textContent=tr('Нажмите ▶ в плеере, чтобы начать просмотр.','Press ▶ in the player to start.');}
  }
  function videoSource(url,time=0){videoSession++;videoResolveController?.abort();clearVideoAttempt();videoQueue=[];videoSeen=new Set();videoResolved=false;videoResume=Number.isFinite(time)?time:0;addVideoCandidates(videoCandidates(url));for(const [,other]of videoChoices(videoItem))addVideoCandidates(videoCandidates(other));nextVideoSource();}
  document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-video]');if(!b)return;try{await videosPromise;}catch{toast(tr('Не удалось загрузить видеотеку. Обновите страницу.','Could not load the catalogue. Reload the page.'));return;}const v=videos.find(v=>v.id===b.dataset.video);if(!v)return;
    videoItem=v;audio.pause();$('#media-title').textContent=v.title;video.poster=safeURL(resolveImage(v.coverUrl));$('#video-quality').replaceChildren();openDialog($('#media-dialog'));
    const choices=videoChoices(v);for(const [label,url]of choices){const btn=document.createElement('button');btn.className='button secondary';btn.textContent=label==='Оригинал'?tr('Оригинал','Original'):label;btn.addEventListener('click',()=>videoSource(url,video.currentTime));$('#video-quality').append(btn);}
    const preferSmall=matchMedia('(max-width:760px)').matches||navigator.connection?.saveData;const first=preferSmall?(v.video720pUrl||v.video1080pUrl):(v.video1080pUrl||v.video720pUrl);videoSource(first||v.url||v.videoUrl);trackEvent('video_play',{video_id:v.id});
  });
  video.addEventListener('error',()=>{if(videoItem&&video.getAttribute('src')){if(video.currentTime>0)videoResume=video.currentTime;nextVideoSource();}});
  $('#video-retry').addEventListener('click',()=>{if(videoItem)videoSource(videoChoices(videoItem)[0]?.[1],videoResume);});
  $('#media-dialog').addEventListener('close',()=>{videoSession++;videoAttempt++;videoItem=null;videoResolveController?.abort();clearVideoAttempt();video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.load();$('#video-quality').replaceChildren();$('#video-retry').hidden=true;});
  // Full ringtone editor: real waveform, region audition, quality and local export.
  let ringTrack=null, ringBuffer=null, ringObjectURL=null, ringController=null, ringGeneration=0, encoderPromise;
  const previewAudio=new Audio(); previewAudio.preload='none'; let previewStop=0;
  function parseTime(value){const s=String(value).trim().replace(',','.');if(/^\d+(\.\d+)?$/.test(s))return Number(s);if(/^\d+:\d{1,2}(\.\d+)?$/.test(s)){const [m,sec]=s.split(':').map(Number);return sec<60?m*60+sec:NaN;}return NaN;}
  function preciseTime(n){const ticks=Math.max(0,Math.round(n*10)),seconds=Math.floor(ticks/10);return format(seconds)+(ticks%10?'.'+ticks%10:'');}
  function region(){const start=parseTime($('#ring-start').value),end=parseTime($('#ring-end').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<1||end-start>60.00001)throw Error(tr('Выберите фрагмент от 1 до 60 секунд.','Choose a segment between 1 and 60 seconds.'));if(ringBuffer&&end>ringBuffer.duration)throw Error(tr('Конец фрагмента выходит за пределы песни.','The end exceeds the track duration.'));return {start,end};}
  function syncRegion(){
    const a=parseTime($('#ring-start').value),b=parseTime($('#ring-end').value),duration=ringBuffer?.duration||240;
    if(!Number.isFinite(a)||!Number.isFinite(b))return;
    $('#ring-start-range').value=a;$('#ring-end-range').value=b;
    const left=Math.max(0,Math.min(100,a/duration*100)),right=Math.max(left,Math.min(100,b/duration*100));
    $('#ring-selection').style.left=left+'%';$('#ring-selection').style.width=(right-left)+'%';
    $('#ring-handle-start').style.left=left+'%';$('#ring-handle-end').style.left=right+'%';
    for(const kind of ['start','end']){const el=$('#ring-handle-'+kind),n=kind==='start'?a:b;el.setAttribute('aria-valuenow',n.toFixed(1));el.setAttribute('aria-valuemin',String(kind==='start'?Math.max(0,b-60):a+1));el.setAttribute('aria-valuemax',String(kind==='start'?b-1:Math.min(duration,a+60)));el.setAttribute('aria-valuetext',preciseTime(n));el.title=tr(kind==='start'?'Начало: ':'Конец: ',kind==='start'?'Start: ':'End: ')+preciseTime(n);}
    $('#ring-duration').textContent=preciseTime(a)+' — '+preciseTime(b)+' · '+tr('длина ','length ')+preciseTime(b-a);$('#ring-total').textContent=preciseTime(duration);
  }
  function stopPreview(){previewAudio.pause();previewStop=0;$('#ring-preview').setAttribute('aria-pressed','false');}
  function clearRing(){ringGeneration++;ringController?.abort();ringController=null;ringLoadPromise=null;ringDrag=null;stopPreview();if(ringPreviewURL){URL.revokeObjectURL(ringPreviewURL);ringPreviewURL=null;}previewAudio.removeAttribute('src');previewAudio.load();ringBuffer=null;if(ringObjectURL){URL.revokeObjectURL(ringObjectURL);ringObjectURL=null;}$('#ring-result').hidden=true;}
  function openRingtone(t){clearRing();ringTrack=t;$('#ringtone-title').textContent=t.title;$('#ring-start').value='0:00';$('#ring-end').value='0:30';$('#ring-start-range').max=$('#ring-end-range').max='240';$('#ring-status').textContent='';$('#ringtone-form [type=submit]').disabled=false;$('#ring-load').disabled=false;$('#ring-progress').hidden=true;$('.wave-editor').classList.remove('has-wave');$('#ring-wave').getContext?.('2d')?.clearRect(0,0,1000,160);const quality=legacy('edshilov_ringtone_quality','high');$('#ring-quality').value=quality==='medium'?'192':'320';const output=storage.get('es8_ring_output',$('#ring-quality').value);$('#ring-output').value=['320','192','128','wav'].includes(output)?output:'320';$('#ring-output').dispatchEvent(new Event('change'));syncRegion();openDialog($('#ringtone-dialog'));loadRingAutomatically();loadEncoder().catch(()=>{});}
  $('#ringtone-dialog').addEventListener('close',clearRing);
  ['#ring-start','#ring-end'].forEach(s=>$(s).addEventListener('input',()=>{stopPreview();syncRegion();}));
  ['start','end'].forEach(k=>$('#ring-'+k+'-range').addEventListener('input',e=>{stopPreview();$('#ring-'+k).value=preciseTime(Number(e.target.value));syncRegion();}));
  $('#ring-quality').addEventListener('change',()=>{try{localStorage.setItem('edshilov_ringtone_quality',$('#ring-quality').value==='192'?'medium':'high');}catch{}});
  $('#ring-format').addEventListener('change',()=>$('#ring-quality').disabled=$('#ring-format').value==='wav');
  let ringLoadPromise=null,ringPreviewURL=null,ringDrag=null;
  const waveEditor=$('.wave-editor');
  function setRingReady(ready){
    waveEditor.setAttribute('aria-busy',String(!ready));waveEditor.classList.toggle('is-ready',ready);
    for(const id of ['ring-handle-start','ring-handle-end','ring-selection']){$('#'+id).setAttribute('aria-disabled',String(!ready));$('#'+id).tabIndex=ready?0:-1;}
    $('#ring-preview').disabled=!ready;$('#ringtone-form [type=submit]').disabled=!ready;
  }
  function putRegion(start,end){stopPreview();$('#ring-start').value=preciseTime(start);$('#ring-end').value=preciseTime(end);$('#ring-result').hidden=true;syncRegion();}
  function changeBoundary(which,value){if(!ringBuffer)return;let a=parseTime($('#ring-start').value),b=parseTime($('#ring-end').value),d=Math.floor(ringBuffer.duration*10)/10;
    if(which==='start')a=Math.max(0,b-60,Math.min(value,b-1));else b=Math.min(d,a+60,Math.max(value,a+1));putRegion(a,b);
  }
  function moveRegion(value){if(!ringBuffer)return;const a=parseTime($('#ring-start').value),b=parseTime($('#ring-end').value),len=b-a,d=Math.floor(ringBuffer.duration*10)/10;const start=Math.max(0,Math.min(value,d-len));putRegion(start,start+len);}
  waveEditor.addEventListener('pointerdown',e=>{
    if(!ringBuffer||e.button>0||ringDrag)return;const rect=waveEditor.getBoundingClientRect();if(!rect.width)return;
    const a=parseTime($('#ring-start').value),b=parseTime($('#ring-end').value),time=Math.max(0,Math.min(ringBuffer.duration,(e.clientX-rect.left)/rect.width*ringBuffer.duration));
    let kind=e.target.closest('[data-ring-handle]')?.dataset.ringHandle;
    if(!kind)kind=e.target.closest('#ring-selection')?'move':(Math.abs(time-a)<=Math.abs(time-b)?'start':'end');
    ringDrag={id:e.pointerId,kind,x:e.clientX,a,b,width:rect.width};waveEditor.setPointerCapture?.(e.pointerId);e.preventDefault();
    if(!e.target.closest('#ring-selection,[data-ring-handle]')){changeBoundary(kind,time);ringDrag=null;waveEditor.releasePointerCapture?.(e.pointerId);}
  });
  waveEditor.addEventListener('pointermove',e=>{if(!ringDrag||e.pointerId!==ringDrag.id||!ringBuffer)return;const delta=(e.clientX-ringDrag.x)/ringDrag.width*ringBuffer.duration;
    if(ringDrag.kind==='move'){const len=ringDrag.b-ringDrag.a,d=Math.floor(ringBuffer.duration*10)/10,a=Math.max(0,Math.min(ringDrag.a+delta,d-len));putRegion(a,a+len);}
    else changeBoundary(ringDrag.kind,(ringDrag.kind==='start'?ringDrag.a:ringDrag.b)+delta);e.preventDefault();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])waveEditor.addEventListener(name,e=>{if(ringDrag?.id===e.pointerId)ringDrag=null;});
  for(const kind of ['start','end'])$('#ring-handle-'+kind).addEventListener('keydown',e=>{
    if(!ringBuffer)return;let value=parseTime($('#ring-'+kind).value);const step=e.shiftKey?1:.1;
    if(e.key==='ArrowLeft'||e.key==='ArrowDown')value-=step;else if(e.key==='ArrowRight'||e.key==='ArrowUp')value+=step;else if(e.key==='Home')value=0;else if(e.key==='End')value=ringBuffer.duration;else return;e.preventDefault();changeBoundary(kind,value);
  });
  $('#ring-selection').addEventListener('keydown',e=>{if(e.target!==e.currentTarget||!ringBuffer)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();moveRegion(parseTime($('#ring-start').value)+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1));}});
  $('#ring-output').addEventListener('change',()=>{const value=$('#ring-output').value;$('#ring-format').value=value==='wav'?'wav':'mp3';if(value!=='wav')$('#ring-quality').value=value;$('#ring-quality').disabled=value==='wav';storage.set('es8_ring_output',value);$('#ring-result').hidden=true;});
  async function loadRingAutomatically(){const token=ringGeneration;setRingReady(false);$('#ring-load').hidden=true;$('#ring-load').disabled=true;
    try{await ensureRingBuffer();if(token!==ringGeneration)return;setRingReady(true);}
    catch(err){if(token!==ringGeneration)return;ringError(err);if(err.name!=='AbortError')$('#ring-load').hidden=false;}
    finally{if(token===ringGeneration){$('#ring-load').disabled=false;$('#ring-progress').hidden=true;waveEditor.setAttribute('aria-busy','false');}}
  }
  function audioCandidates(t){return [...new Set([getAudio(t),t?.audio_mp3,t?.audio_wav,t?.audio,t?.url].filter(Boolean).map(x=>safeURL(x)).filter(Boolean))];}
  async function fetchBytes(url,signal,onProgress,limit=100*1024*1024){const response=await fetch(url,{signal,credentials:'same-origin'});if(!response.ok)throw Error('HTTP '+response.status);const type=response.headers.get('content-type')||'';if(/text\/html/i.test(type))throw Error(tr('Сервер вернул страницу вместо аудио.','Server returned a page instead of audio.'));const total=Number(response.headers.get('content-length'))||0;if(total>limit)throw Error('large');if(!response.body?.getReader){const b=await response.arrayBuffer();if(b.byteLength>limit)throw Error('large');onProgress?.(b.byteLength,b.byteLength);return b;}const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('large');}chunks.push(value);onProgress?.(size,total);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes.buffer;}
  function reportProgress(id,size,total){const el=$(id);el.hidden=false;if(total){el.max=total;el.value=size;}else el.removeAttribute('value');}
  function ensureRingBuffer(){
    if(ringBuffer)return Promise.resolve(ringBuffer);if(ringLoadPromise)return ringLoadPromise;
    if(!ringTrack)return Promise.reject(Error('Track unavailable'));
    const token=ringGeneration,track=ringTrack;ringController=new AbortController();const signal=ringController.signal,controller=ringController;let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;controller.abort();},60000);
    const task=(async()=>{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)throw Error(tr('Браузер не поддерживает обработку аудио.','This browser cannot process audio.'));
      const ctx=new AudioCtx(),queue=audioCandidates(track),seen=new Set();let resolved=false,lastError;
      $('#ring-status').textContent=tr('Загружаю дорожку…','Loading the track…');
      try{while(true){
        if(signal.aborted||token!==ringGeneration)throw new DOMException('Cancelled','AbortError');
        if(!queue.length&&!resolved){resolved=true;
          try{const r=await fetch('/media-source.php?kind=audio&id='+encodeURIComponent(track.id),{signal,credentials:'same-origin',cache:'no-store'});if(r.ok){const data=await r.json();for(const x of data.sources||[]){const u=mediaURL(x.url);if(u&&!seen.has(u))queue.push(u);}}}catch(e){if(signal.aborted)throw e;}
          for(const original of audioCandidates(track)){const u=new URL(original);if(u.origin===location.origin){const filename=u.pathname.split('/').pop();for(const candidate of ['/'+filename,'/assets/audio/'+filename]){const full=mediaURL(candidate);if(full&&!seen.has(full))queue.push(full);}}}
        }
        const url=queue.shift();if(!url)throw lastError||Error(tr('Аудиофайл не найден на сервере.','Audio file was not found on the server.'));if(seen.has(url))continue;seen.add(url);
        try{
          const bytes=await fetchBytes(url,signal,(n,total)=>{if(token===ringGeneration)reportProgress('#ring-progress',n,total);});
          if(signal.aborted||token!==ringGeneration)throw new DOMException('Cancelled','AbortError');
          $('#ring-status').textContent=tr('Строю звуковую волну…','Building the waveform…');
          const buffer=await ctx.decodeAudioData(bytes.slice(0));
          if(signal.aborted||token!==ringGeneration)throw new DOMException('Cancelled','AbortError');
          if(!Number.isFinite(buffer.duration)||buffer.duration<1)throw Error(tr('Дорожка короче секунды.','Track is shorter than one second.'));
          ringPreviewURL=URL.createObjectURL(new Blob([bytes]));ringBuffer=buffer;previewAudio.src=ringPreviewURL;
          const duration=Math.floor(buffer.duration*10)/10;$('#ring-start-range').max=$('#ring-end-range').max=String(duration);
          $('#ring-start').value='0:00';$('#ring-end').value=preciseTime(Math.min(30,duration));
          drawWave(buffer);syncRegion();$('#ring-progress').hidden=true;$('#ring-status').textContent=tr('Потяните границы на волне, выберите качество и скачайте.','Drag the waveform handles, choose quality and download.');return buffer;
        }catch(err){lastError=err;if(signal.aborted||token!==ringGeneration)throw new DOMException('Cancelled','AbortError');}
      }}finally{await ctx.close();}
    })();
    ringLoadPromise=task.catch(err=>{if(timedOut&&token===ringGeneration)throw Error(tr('Сервер не ответил вовремя. Повторите загрузку.','The server did not respond in time. Retry loading.'));throw err;}).finally(()=>{clearTimeout(deadline);if(token===ringGeneration)ringLoadPromise=null;});return ringLoadPromise;
  }
  function drawWave(buffer){const canvas=$('#ring-wave'),ctx=canvas.getContext('2d');if(!ctx)return;const data=buffer.getChannelData(0),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#ffcc68';const step=Math.max(1,Math.floor(data.length/w));for(let x=0;x<w;x+=3){let peak=0;const from=x*step,to=Math.min(data.length,(x+3)*step);for(let i=from;i<to;i+=Math.max(1,Math.floor(step/20)))peak=Math.max(peak,Math.abs(data[i]));const height=Math.max(2,peak*(h-12));ctx.fillRect(x,(h-height)/2,2,height);}$('.wave-editor').classList.add('has-wave');}
  function ringError(err){if(err.name==='AbortError')return;$('#ring-status').textContent=err.message==='large'?tr('Файл слишком большой для обработки здесь. Попробуйте MP3-версию.','This file is too large to process here. Try the MP3 version.'):tr('Не удалось подготовить рингтон: ','Could not prepare ringtone: ')+err.message;}
  $('#ring-load').addEventListener('click',loadRingAutomatically);
  $('#ring-preview').addEventListener('click',async()=>{try{if(!ringBuffer||!ringPreviewURL)return;const {start,end}=region();audio.pause();$('#video-player').pause();previewStop=end;previewAudio.currentTime=start;await previewAudio.play();$('#ring-preview').setAttribute('aria-pressed','true');}catch(err){ringError(err);}});
  previewAudio.addEventListener('timeupdate',()=>{if(previewStop&&previewAudio.currentTime>=previewStop){stopPreview();}});previewAudio.addEventListener('ended',stopPreview);previewAudio.addEventListener('error',()=>{stopPreview();$('#ring-status').textContent=tr('Не удалось прослушать файл. Проверьте доступность песни.','Could not preview this file. Check that the track is available.');});$('#ring-stop').addEventListener('click',stopPreview);
  function loadEncoder(){if(window.lamejs?.Mp3Encoder)return Promise.resolve(window.lamejs);if(encoderPromise)return encoderPromise;encoderPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/vendor/lame.min.js';s.onload=()=>{if(window.lamejs?.Mp3Encoder)resolve(window.lamejs);else{encoderPromise=null;reject(Error('MP3 encoder unavailable'));}};s.onerror=()=>{encoderPromise=null;s.remove();reject(Error('MP3 encoder unavailable'));};document.head.append(s);});return encoderPromise;}
  function pcmExcerpt(buffer,start,end,fade){const from=Math.floor(start*buffer.sampleRate),to=Math.floor(end*buffer.sampleRate),length=to-from,count=Math.min(2,buffer.numberOfChannels),ramp=Math.min(Math.floor(buffer.sampleRate*.025),Math.floor(length/2));return Array.from({length:count},(_,c)=>{const source=buffer.getChannelData(c),out=new Int16Array(length);for(let i=0;i<length;i++){let gain=1;if(fade&&ramp)gain=Math.min(1,i/ramp,(length-1-i)/ramp);const n=Math.max(-1,Math.min(1,source[from+i]*gain));out[i]=n<0?n*32768:n*32767;}return out;});}
  function wavPCM(channels,sampleRate){const size=channels[0].length*channels.length*2,out=new ArrayBuffer(44+size),v=new DataView(out);const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+size,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels.length,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels.length*2,true);v.setUint16(32,channels.length*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,size,true);let offset=44;for(let i=0;i<channels[0].length;i++)for(const channel of channels){v.setInt16(offset,channel[i],true);offset+=2;}return new Blob([out],{type:'audio/wav'});}
  function cleanFilename(s){return String(s||'track').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'')||'track';}
  $('#ringtone-form').addEventListener('submit',async ev=>{ev.preventDefault();const button=ev.target.querySelector('[type=submit]');if(button.disabled)return;let selectedRegion;try{selectedRegion=region();}catch(err){ringError(err);return;}const token=ringGeneration,track=ringTrack;button.disabled=true;$('#ring-load').disabled=true;stopPreview();try{const buffer=await ensureRingBuffer();if(token!==ringGeneration)return;const {start,end}=selectedRegion;if(end>buffer.duration)throw Error(tr('Конец фрагмента выходит за пределы песни.','The end exceeds the track duration.'));const pcm=pcmExcerpt(buffer,start,end,$('#ring-fade').checked),fmt=$('#ring-format').value;let blob;$('#ring-status').textContent=tr('Создаю фрагмент…','Creating excerpt…');if(fmt==='wav')blob=wavPCM(pcm,buffer.sampleRate);else{const lame=await loadEncoder();const encoder=new lame.Mp3Encoder(pcm.length,buffer.sampleRate,Number($('#ring-quality').value)),parts=[];for(let i=0;i<pcm[0].length;i+=1152){if(token!==ringGeneration)return;const block=pcm.length>1?encoder.encodeBuffer(pcm[0].subarray(i,i+1152),pcm[1].subarray(i,i+1152)):encoder.encodeBuffer(pcm[0].subarray(i,i+1152));if(block.length)parts.push(new Int8Array(block));if(i%(1152*60)===0){reportProgress('#ring-progress',i,pcm[0].length);await new Promise(r=>setTimeout(r,0));}}const tail=encoder.flush();if(tail.length)parts.push(new Int8Array(tail));blob=new Blob(parts,{type:'audio/mpeg'});}if(token!==ringGeneration)return;if(ringObjectURL)URL.revokeObjectURL(ringObjectURL);ringObjectURL=URL.createObjectURL(blob);const link=$('#ring-result');link.href=ringObjectURL;link.download=cleanFilename(track.title)+'_ringtone.'+fmt;link.hidden=false;link.click();$('#ring-status').textContent=tr('Готово. Если скачивание не началось, нажмите ссылку ниже.','Done. If the download did not start, use the link below.');trackEvent('ringtone_created',{track_id:track.id});}catch(err){ringError(err);}finally{if(token===ringGeneration){button.disabled=false;$('#ring-load').disabled=false;$('#ring-progress').hidden=true;}}});
  // Downloads keep original MP3/WAV files and show real byte progress.
  let downloadController=null,downloadURL=null;
  function openDownload(t){$('#download-title').textContent=t.title;$('#download-status').textContent='';$('#download-progress').hidden=true;$('#download-direct').hidden=true;const options=$('#download-options');options.replaceChildren();for(const [fmt,path]of [['MP3',t.audio_mp3],['WAV',t.audio_wav]]){if(!path)continue;const b=document.createElement('button');b.type='button';b.className='button';b.textContent=tr('Скачать ','Download ')+fmt;b.addEventListener('click',()=>downloadOriginal(t,path,fmt.toLowerCase()));options.append(b);}openDialog($('#download-dialog'));}
  async function downloadOriginal(t,path,fmt){downloadController?.abort();const controller=new AbortController();downloadController=controller;const direct=$('#download-direct');direct.href=safeURL(path);direct.download=cleanFilename(t.title)+'.'+fmt;direct.hidden=false;$('#download-status').textContent=tr('Загрузка файла…','Downloading file…');try{const bytes=await fetchBytes(safeURL(path),controller.signal,(n,total)=>reportProgress('#download-progress',n,total),80*1024*1024);if(controller!==downloadController)return;if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(new Blob([bytes],{type:fmt==='mp3'?'audio/mpeg':'audio/wav'}));const a=document.createElement('a');a.href=downloadURL;a.download=direct.download;document.body.append(a);a.click();a.remove();$('#download-status').textContent=tr('Файл передан браузеру для сохранения.','File passed to the browser to save.');trackEvent('music_download',{track_id:t.id,format:fmt});}catch(err){if(err.name==='AbortError')return;$('#download-status').textContent=err.message==='large'?tr('Для большого файла используйте прямую ссылку ниже.','Use the direct link below for this large file.'):tr('Файл не удалось загрузить. Попробуйте другой формат или прямую ссылку.','Download failed. Try another format or the direct link.');}finally{if(controller===downloadController)$('#download-progress').hidden=true;}}
  $('#download-dialog').addEventListener('close',()=>{downloadController?.abort();downloadController=null;if(downloadURL){URL.revokeObjectURL(downloadURL);downloadURL=null;}});
  document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-download-track]');if(!b)return;ev.preventDefault();try{await tracksPromise;const t=tracks.find(x=>x.id===b.dataset.downloadTrack);if(t)openDownload(t);}catch{location.href=b.href;}});
  $('#player-download').addEventListener('click',()=>{if(current)openDownload(current);});$('#player-ringtone').addEventListener('click',()=>{if(current)openRingtone(current);});

  let formToken=null,formRequestId=null;
  async function getFormToken(){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);try{const r=await fetch('/application.php',{credentials:'same-origin',cache:'no-store',signal:ctl.signal});if(!r.ok)throw Error('form');const data=await r.json();if(!data.token||!data.policyVersion)throw Error('form');return data;}finally{clearTimeout(timer);}}
  function prepareEmail(form){const f=new FormData(form);const text='Здравствуйте, Эдуард!\n\nИмя: '+f.get('name')+'\nE-mail: '+f.get('email')+'\nТелефон: '+f.get('phone')+'\nГород: '+f.get('city')+'\nДата: '+f.get('date')+'\n\n'+f.get('message');$('#booking-preview').value=text;$('#booking-email').href='mailto:troikaband@mail.ru?subject='+encodeURIComponent('Заявка на выступление')+'&body='+encodeURIComponent(text);$('#booking-result').hidden=false;}
  if($('#booking-form')){formToken=getFormToken().catch(()=>null);$('#booking-form').addEventListener('input',()=>{formRequestId=null;});$('#booking-form').addEventListener('submit',async ev=>{ev.preventDefault();const form=ev.target,status=$('#booking-status'),button=$('#booking-submit');if(button.disabled)return;if(!form.reportValidity()||!$('#booking-consent').checked){status.textContent=tr('Заполните поля и подтвердите согласие.','Complete the fields and confirm consent.');return;}button.disabled=true;status.textContent=tr('Отправляем заявку…','Sending enquiry…');const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),25000);try{let session=await formToken;if(!session)session=await getFormToken();const f=new FormData(form);formRequestId=formRequestId||(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2));const payload={token:session.token,policyVersion:session.policyVersion,consent:true,requestId:formRequestId};for(const key of ['name','email','phone','city','date','message','website'])payload[key]=String(f.get(key)||'');const response=await fetch('/application.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctl.signal});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||tr('Не удалось отправить заявку.','Could not send the enquiry.'));status.textContent=tr('Заявка ','Enquiry ')+result.reference+tr(' передана почтовому серверу. Для ответа указан ваш e-mail.',' was accepted by the mail server. Your email is included for a reply.');$('#booking-result').hidden=true;trackEvent('enquiry_mail_accepted');}catch(err){status.textContent=err.name==='AbortError'?tr('Ответ сервера не получен. Повторите отправку или воспользуйтесь почтой ниже.','No server response. Retry or use email below.'):tr('Отправка недоступна. ','Sending unavailable. ')+(err.message==='form'?'':err.message);prepareEmail(form);}finally{clearTimeout(timer);button.disabled=false;}});}
  $('#copy-booking')?.addEventListener('click',()=>copy($('#booking-preview').value));

  function safeContent(content){const template=document.createElement('template');template.innerHTML=String(content||'');const allowed=new Set(['P','BR','H2','H3','H4','UL','OL','LI','STRONG','B','EM','I','BLOCKQUOTE','A']);const frag=document.createDocumentFragment();function walk(from,to){for(const n of from.childNodes){if(n.nodeType===3){to.append(document.createTextNode(n.textContent));continue;}if(n.nodeType!==1)continue;if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','FORM'].includes(n.tagName))continue;if(!allowed.has(n.tagName)){walk(n,to);continue;}const el=document.createElement(n.tagName.toLowerCase());if(n.tagName==='A'){const u=safeURL(n.getAttribute('href'));if(u){el.href=u;el.rel='noopener noreferrer';}}walk(n,el);to.append(el);}}walk(template.content,frag);return frag;}
  if($('#news-detail')){const id=new URLSearchParams(location.search).get('item');if(id)json('/news.json').then(items=>{const n=items.find(n=>n.id===id);if(!n){toast(tr('Новость не найдена','News item not found'));return;}const detail=$('#news-detail');detail.hidden=false;$('#news-list').hidden=true;const back=document.createElement('a');back.href='/news.html';back.className='text-link';back.textContent=tr('← Все новости','← All news');const title=document.createElement('h2');title.textContent=n.title;const date=document.createElement('time');date.textContent=n.date;detail.append(back,title,date);if(safeURL(n.cover)){const im=new Image();im.src=safeURL(resolveImage(n.cover));im.alt=n.title;detail.append(im);}detail.append(safeContent(n.content||n.excerpt));if(n.links)for(const [key,url] of Object.entries(n.links)){const safe=safeURL(url);if(!safe)continue;const a=document.createElement('a');a.href=safe;a.className='button secondary';a.textContent=key==='watch'?tr('Смотреть','Watch'):key==='listen'?tr('Слушать','Listen'):tr('Открыть','Open');detail.append(a);}}).catch(()=>toast(tr('Не удалось открыть новость','Could not open this news item')));}
  // CSS 3D: no additional renderer, model, network request or automatic movement.
  const vinyl=$('#vinyl'),spin=$('#vinyl-toggle');let spinning=true,vinylVisible=true;
  function updateSpin(){if(vinyl)vinyl.classList.toggle('is-spinning',spinning&&vinylVisible&&!document.hidden&&motionAllowed());if(spin){spin.textContent=spinning?tr('Остановить пластинку','Stop the record'):tr('Вращать пластинку','Spin the record');spin.setAttribute('aria-pressed',String(spinning));}}
  spin?.addEventListener('click',()=>{if(!motionAllowed()){motionChoice='on';storage.set('es7_motion',motionChoice);motionUI();}spinning=!spinning;spin.setAttribute('aria-pressed',String(spinning));updateSpin();});
  if(vinyl&&'IntersectionObserver'in window)new IntersectionObserver(([entry])=>{vinylVisible=entry.isIntersecting;updateSpin();}).observe(vinyl);
  document.addEventListener('visibilitychange',updateSpin);reduced.addEventListener('change',updateSpin);
  updateSpin();
  // Optional external integrations are gated by both operator review and explicit visitor choice.
  let consent=storage.get('es5_privacy',{analytics:false,ads:false})||{analytics:false,ads:false},metricsStarted=false,adsStarted=false;
  if(typeof consent!=='object'||consent.version!==2||!Number.isFinite(consent.expires)||consent.expires<Date.now()){
    consent={analytics:false,ads:false};
    try{const value=document.cookie.split('; ').find(v=>v.startsWith('es_privacy='));const cookie=value?JSON.parse(decodeURIComponent(value.slice(11))):null;if(cookie?.v===2&&cookie.expires>Date.now())consent={analytics:!!cookie.a,ads:!!cookie.d,version:2,expires:cookie.expires,date:cookie.date};}catch{}
  }
  function trackEvent(event,params={}){if(cfg.privacyReviewed&&consent.analytics&&metricsStarted&&window.ym)window.ym(Number(cfg.metrikaId),'reachGoal',event,params);}
  function script(src){const s=document.createElement('script');s.src=src;s.async=true;document.head.append(s);return s;}
  function integrations(){
    if(!cfg.privacyReviewed||['privacy.html','cookies.html','data-consent.html'].includes(document.body.dataset.page))return;
    if(consent.analytics&&!metricsStarted&&/^\d+$/.test(String(cfg.metrikaId||''))){metricsStarted=true;window.ym=window.ym||function(){(window.ym.a=window.ym.a||[]).push(arguments);};window.ym.l=Date.now();script('https://mc.yandex.ru/metrika/tag.js');window.ym(Number(cfg.metrikaId),'init',{clickmap:false,trackLinks:false,accurateTrackBounce:true,webvisor:false});}
    if(consent.ads&&cfg.ads?.enabled&&!adsStarted){adsStarted=true;const slots=$$('[data-ad-slot]');const rsya=cfg.ads.rsya||{};const units=slots.filter(s=>/^R-A-\d+-\d+$/.test(rsya[s.dataset.adSlot]||''));
      if(units.length){let loaded=false;const render=s=>{if(!consent.ads)return;if(!loaded){loaded=true;window.yaContextCb=window.yaContextCb||[];script('https://yandex.ru/ads/system/context.js');}window.yaContextCb.push(()=>{if(consent.ads)window.Ya.Context.AdvManager.render({blockId:rsya[s.dataset.adSlot],renderTo:s.id});});};const observer='IntersectionObserver'in window?new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){observer.unobserve(e.target);render(e.target);}}),{rootMargin:'200px'}):null;units.forEach(s=>{s.hidden=false;s.id='ad-'+s.dataset.adSlot;if(observer)observer.observe(s);else window.addEventListener('load',()=>render(s),{once:true});});}
      for(const p of cfg.ads.partners||[]){const s=slots.find(s=>s.dataset.adSlot===p.slot),url=safeURL(p.url,true),now=new Date().toISOString().slice(0,10);if(!s||!p.advertiser||!p.erid||!p.title||!url||(p.from&&now<p.from)||(p.until&&now>p.until)||!s.hidden)continue;const u=new URL(url);u.searchParams.set('erid',p.erid);const label=document.createElement('small');label.textContent=tr('Реклама · ','Advertisement · ')+p.advertiser+' · erid: '+p.erid;const a=document.createElement('a');a.href=u.href;a.rel='sponsored noopener noreferrer';a.textContent=p.title;const imageUrl=safeURL(p.image);if(p.image&&imageUrl&&new URL(imageUrl).origin===location.origin){const im=new Image();im.src=imageUrl;im.alt=p.title;im.loading='lazy';a.prepend(im);}s.append(label,a);s.hidden=false;}
    }
  }
  let googleStarted=false;
  function googleAds(){const options=window.SITE_OPTIONS?.google;if(['privacy.html','cookies.html','data-consent.html'].includes(document.body.dataset.page))return;if(!cfg.privacyReviewed||!consent.ads||!options?.enabled||!options.cmpConfigured||!/^ca-pub-\d{16}$/.test(options.client)||googleStarted)return;const slots=$$('[data-google-slot]').filter(el=>/^\d{5,20}$/.test(options.slots[el.dataset.googleSlot]||''));if(!slots.length)return;googleStarted=true;
    const script=document.createElement('script');script.async=true;script.crossOrigin='anonymous';script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+options.client;document.head.append(script);
    const render=el=>{if(!consent.ads)return;el.hidden=false;const ad=document.createElement('ins');ad.className='adsbygoogle';ad.style.display='block';ad.dataset.adClient=options.client;ad.dataset.adSlot=options.slots[el.dataset.googleSlot];ad.dataset.adFormat='auto';ad.dataset.fullWidthResponsive='true';el.append(ad);(window.adsbygoogle=window.adsbygoogle||[]).push({});};
    if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){observer.unobserve(e.target);render(e.target);}}),{rootMargin:'250px'});slots.forEach(el=>{el.hidden=false;observer.observe(el);});}else slots.forEach(render);
  }

  function privacyDialog(ev){ev?.preventDefault();$('#allow-analytics').checked=!!consent.analytics;$('#allow-ads').checked=!!consent.ads;openDialog($('#privacy-dialog'));}
  $$('.privacy-open').forEach(b=>b.addEventListener('click',privacyDialog));
  function saveConsent(value){const withdraw=(consent.analytics&&!value.analytics)||(consent.ads&&!value.ads);consent={...value,version:2,date:new Date().toISOString(),expires:Date.now()+15552000000};storage.set('es5_privacy',consent);document.cookie='es_privacy='+encodeURIComponent(JSON.stringify({a:!!value.analytics,d:!!value.ads,v:2,expires:consent.expires,date:consent.date}))+'; Max-Age=15552000; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');$('#cookie-banner').hidden=true;$('#privacy-dialog').close();if(withdraw&&(metricsStarted||adsStarted||googleStarted)){location.reload();return;}integrations();googleAds();}
  $('#privacy-save').addEventListener('click',()=>saveConsent({analytics:$('#allow-analytics').checked,ads:$('#allow-ads').checked}));
  $('#privacy-reject').addEventListener('click',()=>saveConsent({analytics:false,ads:false}));$('#cookie-reject').addEventListener('click',()=>saveConsent({analytics:false,ads:false}));
  $('#clear-personal').addEventListener('click',async()=>{document.cookie='es_privacy=; Max-Age=0; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');current=null;audio.pause();['es5_lang','es5_theme','es5_favourites','es5_playback','es5_privacy','ed_uid','edsh_local_events_v2','introAnimationPlayed','edshilov_lang','edshilov_theme','edshilov_ringtone_quality','es7_quality','es7_motion','es8_ring_output'].forEach(k=>storage.remove(k));if('caches'in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('edshilov-site-')).map(k=>caches.delete(k)));}audio.pause();current=null;location.reload();});
  // Remove old local-only tracking identifiers rather than treating them as global analytics.
  storage.remove('ed_uid');storage.remove('edsh_local_events_v2');
  if(!consent.date)$('#cookie-banner').hidden=false;
  const payment=safeURL(cfg.supportUrl,true);if(cfg.privacyReviewed&&cfg.supportUrl&&payment&&$('#support-payment')){$('#support-payment').href=payment;$('#support-payment').rel='noopener noreferrer';$('#support-payment').hidden=false;}
  // The original intro is restored. It never waits indefinitely for media.
  const intro=$('#intro-dialog'),introVideo=$('#intro-video');let introStartup,introDeadline;
  function finishIntro(){clearTimeout(introStartup);clearTimeout(introDeadline);try{localStorage.setItem('introAnimationPlayed','true');}catch{}if(intro?.open)intro.close();if(introVideo){introVideo.pause();introVideo.removeAttribute('src');introVideo.load();}}
  function startIntro(){if(!introVideo)return;audio.pause();openDialog(intro);$('#intro-status').textContent=tr('Загрузка заставки…','Loading intro…');introVideo.muted=true;introVideo.src='/assets/video/intro-fast.mp4';introVideo.load();introStartup=setTimeout(finishIntro,1800);introDeadline=setTimeout(finishIntro,18000);introVideo.play().catch(finishIntro);}
  if(intro){introVideo.addEventListener('playing',()=>{clearTimeout(introStartup);$('#intro-status').textContent='';});introVideo.addEventListener('ended',finishIntro);introVideo.addEventListener('error',finishIntro);intro.addEventListener('close',()=>{clearTimeout(introStartup);clearTimeout(introDeadline);introVideo.pause();introVideo.removeAttribute('src');introVideo.load();try{localStorage.setItem('introAnimationPlayed','true');}catch{}});$('#intro-skip').addEventListener('click',finishIntro);$('#intro-replay').addEventListener('click',startIntro);const connection=navigator.connection;if(legacy('introAnimationPlayed','false')!=='true'&&!reduced.matches&&!connection?.saveData&&!/2g|3g/.test(connection?.effectiveType||''))setTimeout(startIntro,100);}
  // Real buffering feedback, kept separate from the page entrance animation.
  audio.addEventListener('waiting',()=>{$('#player-state').textContent=tr('Буферизация…','Buffering…');});audio.addEventListener('loadstart',()=>{$('#player-state').textContent=tr('Загрузка песни…','Loading track…');});audio.addEventListener('playing',()=>state(true));
  video.addEventListener('waiting',()=>$('#video-status').textContent=tr('Буферизация видео…','Buffering video…'));video.addEventListener('playing',()=>$('#video-status').textContent='');
  function showPhoto(target){const image=$('#photo-full');image.src=target.dataset.photo;image.alt=target.alt||'';$('#photo-caption').textContent=target.alt||'';openDialog($('#photo-dialog'));}
  document.addEventListener('click',ev=>{const target=ev.target.closest('[data-photo]');if(target)showPhoto(target);});document.addEventListener('keydown',ev=>{if((ev.key==='Enter'||ev.key===' ')&&ev.target.matches('[data-photo]')){ev.preventDefault();showPhoto(ev.target);}});$('#photo-dialog').addEventListener('close',()=>$('#photo-full').removeAttribute('src'));
  if(!reduced.matches&&'IntersectionObserver'in window){const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');reveal.unobserve(e.target);}}),{threshold:.08});$$('.section').forEach(el=>reveal.observe(el));const lights=new IntersectionObserver(entries=>entries.forEach(e=>document.body.classList.toggle('stage-paused',!e.isIntersecting)));if($('.stage-hero'))lights.observe($('.stage-hero'));}document.addEventListener('visibilitychange',()=>document.body.classList.toggle('stage-paused',document.hidden));

  integrations();googleAds();translate();updateSpin();
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{}));
})();
