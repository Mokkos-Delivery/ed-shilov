import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,GoogleAuthProvider,signInWithPopup,reauthenticateWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,onSnapshot,writeBatch,updateDoc,setDoc} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import {DriveUpload} from './drive-upload.mjs?v=studio-4';
import {qualityFiles} from './quality.mjs?v=studio-4';
import {bindPublication} from './publication-media.mjs?v=studio-4';
import {initSocialComposer} from './social-composer.mjs?v=studio-4';
import {DriveSession,titleFromFile,formatSize,mediaURL,localDate} from './admin-media.mjs?v=studio-4';
import {UploadJournal,fileIdentity} from './upload-journal.mjs?v=studio-4';
import {RELEASE} from './release.mjs?v=studio-4';

const $=selector=>document.querySelector(selector),config=window.ED_CLOUD_CONFIG||{};
let sessionStore=null;try{sessionStore=window.localStorage||window.sessionStorage;}catch{try{sessionStore=window.sessionStorage;}catch{}}
const drive=new DriveSession({storage:sessionStore,key:'edStudioDrive:'+config.firebase?.projectId+':'+config.adminUid});
let authenticating=false,journal=null,driveExpiryTimer=null;
let auth,db,user=null,items=[],unsubscribe=null,editing=null,job=null,busy=false,controller=null;
const status=message=>$('#status').textContent=message;
const uploadStatus=message=>{$('#upload-status').textContent=message;if(message)$('#upload-panel').hidden=false;};
let libraryFilter='all',autoTitle='',activePanel='materials';
const previewURLs=new Map();
let audioMetadata=null;
function ownUser(value){return !!value&&!!config.adminUid&&value.uid===config.adminUid&&value.emailVerified===true;}
function mediaPath(record){return '/media/'+record.driveId+'/'+encodeURIComponent(record.name);}
function fixedURL(value){return mediaURL(value,config.workerOrigin,location.origin);}
function escapeHTML(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function busyUI(value){busy=value;$('#editor-fields').disabled=value;$('#save').disabled=value;$('#cancel-upload').hidden=!value;for(const id of ['kind','seed','prepare-all','new-item','connect','logout','open-social','open-editor','open-library'])$('#'+id).disabled=value;for(const button of document.querySelectorAll('[data-kind]'))button.disabled=value;renderItems();}
function token(){return drive.token();}
function driveUI(state,message){$('#drive-card').dataset.state=state;$('#connection').textContent=message;$('#connect').hidden=state==='ready';$('#connect').disabled=state==='connecting'||busy;$('#save').disabled=state==='connecting'||busy;$('#drive-heading').textContent=state==='ready'?'Диск подключён':'Google Диск';}
function phase(step,title){$('#upload-panel').hidden=false;$('#upload-phase').textContent=title;$('#upload-percent').textContent='';for(const node of document.querySelectorAll('[data-step]'))node.classList.toggle('active',node.dataset.step===step);}
function previewURL(slot,file){const old=previewURLs.get(slot);if(old?.file===file)return old?.url||'';if(old)URL.revokeObjectURL(old.url);if(!file){previewURLs.delete(slot);return '';}const url=URL.createObjectURL(file);previewURLs.set(slot,{file,url});return url;}
function resetPreview(){for(const value of previewURLs.values())URL.revokeObjectURL(value.url);previewURLs.clear();autoTitle='';audioMetadata=null;}
function renderPreview(){
  const kind=$('#kind').value,file=$('#file').files[0],cover=$('#cover').files[0];
  const coverFile=kind==='photos'?file:cover;
  const artwork=previewURL('cover',coverFile)||fixedURL(editing?.cover||editing?.coverUrl||window.SITE_IMAGE_MAP?.['/assets/img/branding/RUS.webp']);
  const image=$('#preview-cover');$('#preview-placeholder').hidden=!!artwork;image.hidden=!artwork;
  image.onerror=()=>{image.hidden=true;$('#preview-placeholder').hidden=false;};if(artwork&&image.getAttribute('src')!==artwork)image.src=artwork;
  if(!artwork)image.removeAttribute('src');
  $('#preview-title').textContent=$('#title').value.trim()||({tracks:'Название песни',videos:'Название видео',photos:'Название фотографии',news:'Заголовок новости'})[kind];
  $('#preview-date').textContent=$('#date').value?new Date($('#date').value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'';
  $('#preview-kind').textContent=({tracks:'ПЕСНЯ',videos:'ВИДЕО',photos:'ФОТОГРАФИЯ',news:'НОВОСТЬ'})[kind];
  $('#preview-badge').textContent=editing?($('#published').checked?'На сайте':'Скрытый материал'):($('#published').checked?'Будет опубликован':'Будет скрытым');$('#preview-badge').classList.toggle('draft',!$('#published').checked);
  $('#preview-summary').hidden=kind!=='news'||!$('#excerpt').value;$('#preview-summary').textContent=$('#excerpt').value;
  const source=kind==='tracks'||kind==='videos'?(previewURL('file',file)||fixedURL(kind==='tracks'?(editing?.audio_mp3||editing?.audio_wav):(editing?.videoUrl||editing?.url))):'';
  for(const type of ['audio','video']){const player=$('#preview-'+type),active=type==='audio'?kind==='tracks':kind==='videos';player.hidden=!active||!source;if(active&&source){if(player.getAttribute('src')!==source){player.src=source;player.load();}}else if(player.hasAttribute('src')){player.pause();player.removeAttribute('src');player.load();}}
  $('#preview-file').textContent=file?file.name+' · '+formatSize(file.size):(editing?'Текущий файл сохранён на Диске':kind==='news'?'Текстовая публикация':'Файл ещё не выбран');
  $('#file-prompt').textContent=file?file.name:({tracks:'Перетащите песню сюда',videos:'Перетащите видео сюда',photos:'Перетащите фотографию сюда',news:''})[kind];
  $('#file-details').textContent=file?formatSize(file.size)+' · можно выбрать другой файл':({tracks:'или нажмите, чтобы выбрать MP3 / WAV',videos:'или выберите MP4 / WEBM',photos:'или выберите JPG / PNG / WEBP / AVIF',news:''})[kind];
  $('#remove-file').hidden=!file;$('#remove-cover').hidden=!cover;$('#cover-filename').textContent=cover?cover.name+' · '+formatSize(cover.size):'JPG, PNG, WEBP или AVIF. Без файла — фирменная обложка.';
  const large=kind==='tracks'&&file?.size>100*1024*1024,long=kind==='tracks'&&!!file&&audioMetadata?.file===file&&audioMetadata.duration>900,limited=large||long,wasLimited=$('#auto-quality').disabled;if(wasLimited&&!limited)$('#auto-quality').checked=true;$('#auto-quality').disabled=limited;
  $('#quality-limit').hidden=!limited;if(limited){$('#auto-quality').checked=false;$('#quality-limit').textContent=large?'Файл больше 100 МБ: загрузим оригинал без обработки в браузере.':'Дорожка длиннее 15 минут: загрузим оригинал без обработки в браузере.';}
  $('#new-item').hidden=!editing&&!job;
  if(!job)$('#save').textContent=editing?'Сохранить изменения':$('#published').checked?'Опубликовать на сайте':'Сохранить скрытым';
  $('#save-hint').textContent=$('#published').checked?'Материал появится на сайте после загрузки и проверки.':'Материал будет сохранён. Слушатели пока его не увидят.';
}
function showPanel(panel){activePanel=panel;$('#materials-panel').hidden=panel==='social';$('#social-panel').hidden=panel!=='social';$('#editor-layout').hidden=panel==='catalogue';$('#catalogue-panel').hidden=panel!=='catalogue';$('#page-title').textContent=panel==='catalogue'?'Мои материалы':editing?'Редактировать материал':({tracks:'Добавить песню',videos:'Добавить видео',photos:'Добавить фотографию',news:'Добавить новость'})[$('#kind').value];for(const [id,value] of [['open-editor','materials'],['open-library','catalogue'],['open-social','social']]){const active=panel===value;$('#'+id).classList.toggle('active',active);$('#'+id).setAttribute('aria-pressed',String(active));}for(const node of document.querySelectorAll('[data-kind]')){const active=node.dataset.kind===$('#kind').value;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));}}
let pickerReady;
async function selectUploadFolder(accessToken){
  if(!pickerReady)pickerReady=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';script.onload=()=>window.gapi.load('picker',{callback:resolve,onerror:reject});script.onerror=reject;document.head.append(script);});
  try{await pickerReady;}catch{pickerReady=null;throw Error('Окно выбора папки не загрузилось. Проверьте соединение и повторите подключение.');}
  const projectNumber=config.googleProjectNumber||String(config.firebase.appId||'').split(':')[1],apiKey=config.pickerApiKey||config.firebase.apiKey;
  if(!projectNumber||!apiKey)throw Error('Google Picker ещё не настроен.');
  return new Promise((resolve,reject)=>{
    const view=new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(google.picker.DocsViewMode.LIST);
    const picker=new google.picker.PickerBuilder().addView(view).setOAuthToken(accessToken).setDeveloperKey(apiKey).setAppId(projectNumber).setOrigin(location.origin).setTitle('Выберите папку «Публикации сайта»').setCallback(data=>{
      if(data.action===google.picker.Action.PICKED){picker.setVisible(false);if(data.docs?.[0]?.id===config.uploadFolderId)resolve();else reject(Error('Выбрана другая папка. Выберите папку «Публикации сайта».'));}
      else if(data.action===google.picker.Action.CANCEL){reject(Error('Папка публикаций не выбрана.'));}
    }).build();picker.setVisible(true);
  });
}
async function api(path,body,method='POST',signal=controller?.signal){
  if(!ownUser(auth.currentUser))throw Error('Редактирование доступно только владельцу.');
  const base=new URL(config.workerOrigin);
  if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash)throw Error('Сервис сайта ещё не настроен.');
  const multipart=body instanceof FormData;const response=await fetch(base.origin+path,{method,headers:{...(multipart?{}:{'Content-Type':'application/json'}),Authorization:'Bearer '+await auth.currentUser.getIdToken()},body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal});
  let result;try{result=await response.json();}catch{throw Error('Сервер вернул ошибку HTTP '+response.status+'.');}if(!response.ok||!result.ok)throw Object.assign(Error((result.error||'Сервис не подтвердил действие.')+' [HTTP '+response.status+(result.upstreamStatus?'; Drive HTTP '+result.upstreamStatus:'')+(result.code?'; '+result.code:'')+']'),{code:result.code,status:response.status});return result;
}
function driveProvider(selectAccount=false){const provider=new GoogleAuthProvider();provider.addScope('https://www.googleapis.com/auth/drive.file');provider.setCustomParameters(selectAccount?{prompt:'select_account'}:{login_hint:auth.currentUser.email});return provider;}
async function activateDrive(accessToken,expiresAt){
  if(!ownUser(auth.currentUser))throw Error('Войдите как владелец.');
  drive.setOwner(auth.currentUser.uid);const generation=drive.begin(auth.currentUser.uid,accessToken,expiresAt);driveUI('connecting','Проверяем папку публикаций…');
  const metadata=async()=>fetch('https://www.googleapis.com/drive/v3/files/'+config.uploadFolderId+'?fields=id,mimeType,trashed,capabilities(canAddChildren)',{headers:{Authorization:'Bearer '+accessToken}});
  try{
    let response=await metadata();
    if(response.status===404){if(generation!==drive.generation)return;driveUI('connecting','Один раз выберите папку «Публикации сайта»');await selectUploadFolder(accessToken);if(generation!==drive.generation)return;response=await metadata();}
    if(!response.ok)throw Error(response.status===401?'Срок доступа истёк. Подключите Диск ещё раз.':'Не удалось проверить папку Диска ('+response.status+').');
    const folder=await response.json();if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')throw Error('Папка публикаций недоступна.');if(folder.capabilities?.canAddChildren===false)throw Error('У выбранного аккаунта нет права загружать файлы в папку публикаций.');
    if(!drive.finish(generation))return;driveUI('ready','Папка сохранена. Доступ действует до '+new Date(drive.expiresAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'.');
    clearTimeout(driveExpiryTimer);driveExpiryTimer=setTimeout(checkDriveExpiry,Math.max(0,drive.expiresAt-Date.now()));
  }catch(error){if(generation===drive.generation){drive.clear();driveUI('error',error.message);}throw error;}
}
function checkDriveExpiry(){if(drive.ready&&drive.expiresAt<=Date.now()){drive.clear();driveUI('waiting','Google-доступ истёк. Обновите разрешение одной кнопкой; вход на сайт сохранён.');}}
async function connectDrive(){
  if(!ownUser(auth.currentUser))throw Error('Войдите как владелец.');
  const result=await reauthenticateWithPopup(auth.currentUser,driveProvider());
  const credential=GoogleAuthProvider.credentialFromResult(result);if(!credential?.accessToken)throw Error('Google не подтвердил подключение Диска.');
  await activateDrive(credential.accessToken);
}
function changeKind(){
  const kind=$('#kind').value;$('#editor-title').textContent=editing?'Редактировать материал':({tracks:'Добавить песню',videos:'Добавить видео',photos:'Добавить фотографию',news:'Добавить новость'})[kind];
  $('#file-label').hidden=kind==='news';$('#cover-label').hidden=kind==='photos';$('#video-type-label').hidden=kind!=='videos';$('#quality-label').hidden=kind!=='tracks';$('#featured-label').hidden=kind!=='tracks';$('#excerpt-label').hidden=kind!=='news';$('#content-label').hidden=kind!=='news';
  $('#file').accept=kind==='tracks'?'audio/mpeg,audio/wav,.mp3,.wav':kind==='videos'?'video/mp4,video/webm,.mp4,.webm':'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif';
  $('#file').required=!editing&&kind!=='news';$('#editor-mode').textContent=editing?'Редактирование':'Новый';$('#kind-caption').textContent=({tracks:'ПЕСНИ',videos:'ВИДЕО',photos:'ФОТОГРАФИИ',news:'НОВОСТИ'})[kind];$('#page-title').textContent=({tracks:'Песни',videos:'Видео',photos:'Фотографии',news:'Новости'})[kind];renderPreview();showPanel('materials');watchItems();
}
function newItem(){resetPreview();editing=null;job=null;$('#editor').reset();$('#date').value=localDate();$('#existing-file').hidden=true;$('#progress').hidden=true;$('#upload-panel').hidden=true;uploadStatus('');changeKind();}
function edit(item){
  if(busy)return;newItem();editing=item;$('#title').value=item.title;$('#date').value=item.date||String(item.createdAt||'').slice(0,10);$('#published').checked=item.published===true;$('#featured').checked=item.featured===true;$('#video-type').value=item.type||'clip';$('#excerpt').value=item.excerpt||'';
  const parser=new DOMParser(),parsed=parser.parseFromString(item.content||'','text/html');$('#content').value=[...parsed.body.children].map(x=>x.textContent).join('\n\n')||parsed.body.textContent;
  $('#existing-file').textContent='Текущий файл сохранится, если не выбирать новый.';$('#existing-file').hidden=false;changeKind();$('#editor').scrollIntoView({behavior:'smooth',block:'start'});$('#title').focus({preventScroll:true});
}
function renderItems(){
  const kind=$('#kind').value,query=$('#search').value.trim().toLocaleLowerCase();
  const list=items.filter(x=>String(x.title||'').toLocaleLowerCase().includes(query)&&(libraryFilter==='all'||(libraryFilter==='published'?x.published===true:x.published!==true)));
  $('#items').replaceChildren();$('#empty').hidden=list.length>0;$('#items-count').textContent=String(items.length);$('#library-summary').textContent='На сайте: '+items.filter(x=>x.published).length+' · Скрыто: '+items.filter(x=>!x.published).length;
  for(const item of list){
    const row=document.createElement('article');row.className='item';const art=document.createElement('div');art.className='item-art';art.textContent=kind==='tracks'?'♫':kind==='videos'?'▷':kind==='photos'?'▧':'≡';
    const cover=fixedURL(item.cover||item.coverUrl);if(cover){const image=new Image();image.src=cover;image.alt='';image.loading='lazy';art.textContent='';image.onerror=()=>{image.remove();art.textContent=kind==='tracks'?'♫':'▧';};art.append(image);}row.append(art);
    const text=document.createElement('div');text.className='item-text';const title=document.createElement('strong');title.textContent=item.title;const label=document.createElement('span');label.className='badge'+(item.published?'':' draft');label.textContent=item.published?'● На сайте':'○ Скрыт';const date=document.createElement('small');date.textContent=item.date||String(item.createdAt||'').slice(0,10);text.append(title,label,date);
    if(kind==='tracks'){const badges=document.createElement('div');badges.className='quality-badges';for(const value of [item.audio_wav?'WAV':item.audio_mp3?'MP3':'',item.qualities?.['128']?'128 kbps':'',item.qualities?.['192']?'192 kbps':''])if(value){const badge=document.createElement('span');badge.textContent=value;badges.append(badge);}text.append(badges);}
    row.append(text);const actions=document.createElement('div');actions.className='item-actions';
    const editButton=document.createElement('button');editButton.textContent='Редактировать';editButton.disabled=busy;editButton.onclick=()=>edit(item);
    const visibility=document.createElement('button');visibility.textContent=item.published?'Скрыть':'Опубликовать';visibility.disabled=busy;visibility.onclick=async()=>{visibility.disabled=true;try{await updateDoc(doc(db,kind,item.id),{published:!item.published});status(item.published?'Материал скрыт с сайта.':'Материал опубликован.');}catch{status('Не удалось изменить публикацию.');visibility.disabled=false;}};
    actions.append(editButton,visibility);
    if(kind==='tracks'){
      const source=fixedURL(item.audio_mp3||item.audio_wav);
      if(source){const player=document.createElement('audio');player.controls=true;player.preload='none';player.setAttribute('aria-label','Прослушать: '+item.title);
        if(item.published)player.src=source;
        else {const play=document.createElement('button');play.textContent='Прослушать скрытую песню';play.disabled=busy;play.onclick=async()=>{play.disabled=true;try{const r=await fetch(new URL(source).origin+'/api/admin'+new URL(source).pathname,{headers:{Authorization:'Bearer '+await auth.currentUser.getIdToken()}});if(!r.ok)throw Error('Прослушивание: HTTP '+r.status);if(Number(r.headers.get('Content-Length'))>100*1024*1024){await r.body?.cancel();throw Error('Для прослушивания в студии выберите файл до 100 МБ.');}const blob=await r.blob();player.src=previewURL('library:'+item.id,blob);await player.play();play.hidden=true;}catch(error){status(error.message);play.disabled=false;}};text.append(play);}
        text.append(player);
      }
      if(!item.qualities?.['128']||!item.qualities?.['192']){const quality=document.createElement('button');quality.textContent='Подготовить MP3';quality.className='text-button';quality.disabled=busy;quality.onclick=()=>prepareExisting([item]);actions.append(quality);}
    }
    row.append(actions);$('#items').append(row);
  }
}
function watchItems(){
  unsubscribe?.();unsubscribe=null;items=[];renderItems();if(!ownUser(user))return;
  unsubscribe=onSnapshot(collection(db,$('#kind').value),snapshot=>{items=snapshot.docs.map(x=>({...x.data(),id:x.id})).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));renderItems();},()=>status('Каталог недоступен. Проверьте подключение и права владельца.'));
}
function typedFile(file,kind){
  const extensions={mp3:'audio/mpeg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'},expected=extensions[file.name.split('.').pop().toLowerCase()];
  if(!expected||!(kind==='tracks'?expected.startsWith('audio/'):kind==='videos'?expected.startsWith('video/'):expected.startsWith('image/')))throw Error('Формат файла не подходит для этого раздела.');
  if(file.type&&file.type!==expected&&!(expected==='audio/wav'&&['audio/x-wav','audio/wave','audio/vnd.wave'].includes(file.type)))throw Error('Тип файла не совпадает с его расширением.');
  return new File([file],file.name,{type:expected,lastModified:file.lastModified});
}
async function uploadOne(file,slot,plan){
  const identity=await fileIdentity(file);
  if(plan.slots[slot]?.identity!==identity){delete plan.slots[slot];plan.records.delete(slot);plan.uploads.delete(slot);}
  if(plan.records.has(slot))return plan.records.get(slot);
  plan.slots[slot]||={identity};
  let uploader=plan.uploads.get(slot);
    if(!uploader){uploader=new DriveUpload(file,config.uploadFolderId,token,{signal:controller.signal,saved:plan.slots[slot],checkpoint:value=>{Object.assign(plan.slots[slot],value);persistPlan(plan);},onProgress:(loaded,total)=>{$('#progress').hidden=false;$('#progress').max=total;$('#progress').value=loaded;$('#upload-percent').textContent=Math.round(loaded/total*100)+'%';uploadStatus('Загрузка '+file.name+' · '+formatSize(loaded)+' / '+formatSize(total));}});plan.uploads.set(slot,uploader);}else uploader.signal=controller.signal;
  const uploaded=await uploader.run();phase(slot==='cover'?'cover':slot.startsWith('quality')?'quality':'file','Проверяем загруженный файл');uploadStatus('Проверка '+file.name+'…');
  let result;for(let attempt=0;attempt<3;attempt++){try{result=await api('/api/admin/verify',{id:uploaded.id});break;}catch(error){if(error.code!=='DRIVE_FILE_PENDING'||attempt===2)throw error;uploadStatus('Файл загружен. Ждём доступ сервера для проверки…');await new Promise(resolve=>setTimeout(resolve,1000));}}
  if(result.media.size!==file.size||result.media.mime!==file.type)throw Error('Проверка размера или формата не пройдена. Материал не опубликован.');
  plan.records.set(slot,result.media);plan.slots[slot].record=result.media;persistPlan(plan);return result.media;
}
function persistPlan(plan){journal?.write({id:plan.id,kind:plan.kind,slots:plan.slots});}
function makePlan(id){const saved=journal?.read(),restore=saved?.id===id&&saved.kind===$('#kind').value;return {id,kind:$('#kind').value,slots:restore?saved.slots:{},records:new Map(),uploads:new Map(),variants:null};}
async function save(event){
  event.preventDefault();if(busy||!$('#editor').reportValidity())return;
  if(!ownUser(auth.currentUser)){status('Войдите как владелец.');return;}
  const kind=$('#kind').value,file=$('#file').files[0],cover=$('#cover').files[0];
  checkDriveExpiry();
  if((file||cover)&&!drive.ready){status('Обновите доступ к Диску. Уже выбранные файлы сохранятся.');$('#connect').focus();return;}
  const unfinished=journal?.read();
  if(!job)job=makePlan(editing?.id||(unfinished?.kind===kind?unfinished.id:(kind[0]+'_'+crypto.randomUUID())));
  controller=new AbortController();busyUI(true);status('');phase('file','Подготовка материала');let pendingQuality=null,qualityWarning='';
  try {
    persistPlan(job);
    if(file||cover){phase('file','Проверяем доступ сервера к папке');const readiness=await api('/api/admin/readiness',undefined,'GET');if(readiness.release!==RELEASE)throw Error('Версии студии и сервиса отличаются. Обновите Worker перед загрузкой.');}
    const item={...(editing||{}),id:job.id,title:$('#title').value.trim(),date:$('#date').value,published:$('#published').checked,createdAt:editing?.createdAt||new Date().toISOString(),order:editing?.order??-Date.now()};
    if(!item.title)throw Error('Введите название.');
    if(file){phase('file','Загружаем оригинал');if(kind==='tracks'&&$('#auto-quality').checked&&file.size>100*1024*1024)throw Error('Для файла больше 100 МБ отключите автоматическую подготовку качества. Оригинал можно загрузить отдельно.');const original=typedFile(file,kind),record=await uploadOne(original,'original',job),url=mediaPath(record);
      if(kind==='tracks'){item.audio_mp3=record.mime==='audio/mpeg'?url:'';item.audio_wav=record.mime==='audio/wav'?url:'';item.qualities={};
        if($('#auto-quality').checked)pendingQuality=original;
      }else if(kind==='videos'){item.url=url;item.videoUrl=url;item.video1080pUrl='';item.video720pUrl='';}else if(kind==='photos')item.cover=url;
    }
    if(cover&&kind!=='photos'){phase('cover','Загружаем обложку');const record=await uploadOne(typedFile(cover,'photos'),'cover',job);item[kind==='videos'?'coverUrl':'cover']=mediaPath(record);}
    if(kind!=='photos'&&!item[kind==='videos'?'coverUrl':'cover'])item[kind==='videos'?'coverUrl':'cover']=window.SITE_IMAGE_MAP?.['/assets/img/branding/RUS.webp']||'';
    if(kind==='tracks')item.featured=$('#featured').checked;
    if(kind==='videos')item.type=$('#video-type').value;
    if(kind==='news'){item.excerpt=$('#excerpt').value;item.content=$('#content').value.split(/\n\s*\n/).filter(Boolean).map(p=>'<p>'+escapeHTML(p)+'</p>').join('');}
    phase('publish','Сохраняем материал на сайте');const batch=writeBatch(db);for(const record of job.records.values())batch.set(doc(db,'media',record.driveId),bindPublication(record,kind,item.id));batch.set(doc(db,kind,item.id),item);
    await batch.commit();job.committed=true;editing=item;renderPreview();status(item.published?'Оригинал опубликован на сайте.':'Оригинал сохранён скрытым.');
    // Publish the playable original first: an encoder failure must not hide a song.
    if(pendingQuality){
      try{phase('quality','Песня сохранена. Готовим дополнительные MP3');if(!job.variants)job.variants=await qualityFiles(pendingQuality,[128,192],(q,progress)=>uploadStatus('Песня уже сохранена · MP3 '+q+' kbps · '+Math.round(progress*100)+'%'),controller.signal);
        if(job.variants.length){const qualities={},qualityBatch=writeBatch(db);for(const variant of job.variants){const record=await uploadOne(variant.file,'quality'+variant.quality,job);qualities[String(variant.quality)]=mediaPath(record);qualityBatch.set(doc(db,'media',record.driveId),bindPublication(record,kind,item.id));}qualityBatch.update(doc(db,kind,item.id),{qualities});await qualityBatch.commit();item.qualities=qualities;}
      }catch(error){qualityWarning=' Оригинал сохранён и доступен. Дополнительные MP3 пока не готовы; их можно создать из списка материалов.';existingJobs.set(item.id,job);if(error.code==='DRIVE_AUTH_REQUIRED'){drive.clear();driveUI('error','Срок доступа Google истёк.');}}
    }
    status((item.published?'Материал опубликован. Открытый сайт получит обновление автоматически.':'Материал сохранён и скрыт с сайта.')+qualityWarning);journal?.clear();job=null;editing=item;$('#file').value='';$('#cover').value='';resetPreview();$('#existing-file').hidden=false;$('#existing-file').textContent='Файл сохранён. Для следующего релиза нажмите «Новый материал».';phase('publish',item.published?'Опубликовано':'Сохранено скрытым');$('#upload-percent').textContent='Готово';uploadStatus(qualityWarning||'Оригинал и обложка сохранены.');renderPreview();
  }catch(error){const failedPhase=$('#upload-phase').textContent;if(error.code==='DRIVE_AUTH_REQUIRED'){drive.clear();driveUI('error','Срок доступа истёк. Подключите Диск и продолжите загрузку.');}phase('file',error.name==='AbortError'?'Загрузка остановлена':'Нужно продолжить загрузку');uploadStatus(error.name==='AbortError'?'Загрузка остановлена. Нажмите «Продолжить загрузку», чтобы продолжить в этой вкладке.':failedPhase+': '+error.message+(error.code?' ['+error.code+']':''));status('Изменения не опубликованы. Уже загруженные файлы сохранены на Диске.');$('#save').textContent='Продолжить загрузку';}
  finally{busyUI(false);$('#progress').hidden=true;renderItems();if(!job){$('#editor-mode').textContent='Сохранено';renderPreview();}}
}
async function seed(){
  if(busy)return;busyUI(true);
  try {
    const flag=await getDoc(doc(db,'settings','public'));if(flag.exists()&&flag.data().catalogueSeeded===true){status('Начальный каталог уже подключён.');return;}
    const response=await fetch('/catalogue-bootstrap.json');if(!response.ok)throw Error('Начальный каталог недоступен.');const data=await response.json();
    const entries=[];for(const kind of ['media','tracks','videos','news','photos'])for(const value of data[kind])entries.push({kind,value,id:kind==='media'?value.driveId:value.id});
    let batch=writeBatch(db),count=0,processed=0;
    for(const entry of entries){const target=doc(db,entry.kind,entry.id);if(!(await getDoc(target)).exists()){batch.set(target,entry.value);count++;}processed++;uploadStatus('Подключение каталога · '+processed+' / '+entries.length);if(count===400){await batch.commit();batch=writeBatch(db);count=0;}}
    if(count)await batch.commit();await setDoc(doc(db,'settings','public'),{catalogueSeeded:true,policyVersion:config.policyVersion},{merge:true});status('Начальный каталог подключён. Существующие материалы сохранены.');
  }catch(error){status('Каталог не подключён полностью. Повторная попытка продолжит работу без перезаписи материалов.');}
  finally{busyUI(false);uploadStatus('');renderItems();}
}
const existingJobs=new Map();
async function prepareExisting(selected){
  if(busy)return;if(!drive.ready){status('Подтвердите доступ к Диску слева.');$('#connect').focus();return;}
  const targets=selected.filter(t=>!t.qualities?.['128']||!t.qualities?.['192']);if(!targets.length){status('Все качества уже готовы.');return;}
  busyUI(true);controller=new AbortController();let complete=0,failed=0;
  for(const t of targets){if(controller.signal.aborted)break;
    try {
      let plan=existingJobs.get(t.id);if(!plan){plan=makePlan(t.id);existingJobs.set(t.id,plan);}
      if(!plan.variants){const url=fixedURL(t.audio_mp3||t.audio_wav);if(!url)throw Error('Нет оригинала.');uploadStatus('Загрузка оригинала: '+t.title);const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('Оригинал недоступен.');if(Number(response.headers.get('Content-Length'))>100*1024*1024)throw Error('Файл больше 100 МБ.');
        const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>100*1024*1024){await reader.cancel();throw Error('Файл больше 100 МБ.');}parts.push(value);}}finally{reader.releaseLock();}
        const original=new File(parts,t.title+(t.audio_mp3?'.mp3':'.wav'),{type:t.audio_mp3?'audio/mpeg':'audio/wav'});plan.variants=await qualityFiles(original,[128,192],(q,p)=>uploadStatus(t.title+' · '+q+' kbps · '+Math.round(p*100)+'%'),controller.signal);
      }
      const qualities={...(t.qualities||{})};for(const variant of plan.variants){if(qualities[variant.quality])continue;const record=await uploadOne(variant.file,'quality'+variant.quality,plan);qualities[String(variant.quality)]=mediaPath(record);}
      const batch=writeBatch(db);for(const record of plan.records.values())batch.set(doc(db,'media',record.driveId),bindPublication(record,'tracks',t.id));batch.update(doc(db,'tracks',t.id),{qualities});await batch.commit();existingJobs.delete(t.id);complete++;
    }catch(error){if(error.name==='AbortError')break;if(error.code==='DRIVE_AUTH_REQUIRED'){drive.clear();driveUI('error','Срок доступа истёк. Подключите Диск ещё раз.');break;}failed++;uploadStatus(t.title+': '+error.message);}
  }
  busyUI(false);$('#progress').hidden=true;status('Качество подготовлено: '+complete+'. Не завершено: '+(targets.length-complete)+'. Оригиналы сохранены.');renderItems();
}
async function main(){
  const social=initSocialComposer((path,body,method)=>api(path,body,method,null));
  $('#folder-link').href='https://drive.google.com/drive/folders/'+config.uploadFolderId;
  const brand=document.querySelector('.brand img');if(brand){const url=fixedURL(window.SITE_IMAGE_MAP?.['/assets/img/branding/RUS.webp']);if(url)brand.src=url;brand.onerror=()=>{brand.hidden=true;};}
  if(!config.firebase?.apiKey||!config.firebase?.projectId){$('#login').disabled=true;status('Админка подготовлена, но Firebase-проект ещё не подключён. Сначала нужно завершить настройку проекта.');return;}
  $('#release').textContent=RELEASE;
  const app=initializeApp(config.firebase);auth=getAuth(app);db=getFirestore(app);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,value=>{
    const previousUid=user?.uid;user=value;drive.setOwner(ownUser(value)?value.uid:'');if(!ownUser(value))drive.clear();
    $('#studio').hidden=!ownUser(value);$('#login-screen').hidden=ownUser(value);
    if(value&&!ownUser(value)){unsubscribe?.();social.disconnect();status('У этого аккаунта нет доступа к студии. Войдите через аккаунт владельца.');return;}
    if(ownUser(value)){ $('#account').textContent=value.email;if(previousUid!==value.uid){journal=new UploadJournal(sessionStore,'edStudioUpload:'+config.firebase.projectId+':'+value.uid);driveUI('waiting','Проверяем сохранённый доступ…');newItem();status(journal.read()?'Есть незавершённая загрузка. Выберите те же файлы — повтор использует сохранённые номера.':'');social.connect();if(!authenticating){const saved=drive.saved(value.uid);if(saved)activateDrive(saved.accessToken,saved.expiresAt).catch(error=>status(error.message));else driveUI('waiting','Вход сохранён. Для загрузки разрешите доступ к файлам Диска.');}}}else{unsubscribe?.();social.disconnect();}
  });
  $('#login').onclick=async()=>{
    $('#login').disabled=true;authenticating=true;
    try{const result=await signInWithPopup(auth,driveProvider(true));if(!ownUser(auth.currentUser))return;const credential=GoogleAuthProvider.credentialFromResult(result);if(credential?.accessToken)await activateDrive(credential.accessToken);else driveUI('waiting','Нажмите «Подключить Диск», чтобы разрешить загрузку.');}
    catch(error){status(error.code==='auth/popup-closed-by-user'?'Вход отменён.':error.code==='auth/popup-blocked'?'Разрешите всплывающее окно Google и повторите вход.':error.message||'Вход не завершён.');if(ownUser(auth.currentUser))driveUI('error','Подключите Диск, чтобы загружать файлы.');}
    finally{$('#login').disabled=false;authenticating=false;}
  };
  $('#connect').onclick=()=>connectDrive().catch(error=>{driveUI('error','Подключение не завершено. Можно попробовать ещё раз.');status(error.message);});
  $('#logout').onclick=async()=>{controller?.abort();clearTimeout(driveExpiryTimer);drive.clear();resetPreview();job=null;existingJobs.clear();await signOut(auth);status('Вы вышли.');};
  $('#kind').onchange=()=>{libraryFilter='all';updateFilters();newItem();};$('#new-item').onclick=()=>{journal?.clear();newItem();};$('#editor').onsubmit=save;
  $('#editor').addEventListener('input',()=>renderPreview());$('#search').oninput=renderItems;$('#seed').onclick=seed;
  const updateFilters=()=>{for(const node of document.querySelectorAll('[data-filter]')){const active=node.dataset.filter===libraryFilter;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));}};
  for(const node of document.querySelectorAll('[data-filter]'))node.onclick=()=>{libraryFilter=node.dataset.filter;updateFilters();renderItems();};
  for(const node of document.querySelectorAll('[data-kind]'))node.onclick=()=>{if(busy)return;const panel=activePanel==='catalogue'?'catalogue':'materials';if($('#kind').value!==node.dataset.kind){$('#kind').value=node.dataset.kind;$('#kind').onchange();}showPanel(panel);};
  $('#open-social').onclick=()=>showPanel('social');$('#open-editor').onclick=()=>showPanel('materials');$('#open-library').onclick=()=>showPanel('catalogue');
  const chosen=()=>{if(busy)return;const file=$('#file').files[0];if(file){try{typedFile(file,$('#kind').value);}catch(error){$('#file').value='';status(error.message);renderPreview();return;}if(!$('#title').value.trim()||$('#title').value===autoTitle){autoTitle=titleFromFile(file.name);$('#title').value=autoTitle;}}renderPreview();};
  $('#preview-audio').addEventListener('loadedmetadata',()=>{const file=$('#file').files[0];if(file&&previewURLs.get('file')?.file===file){audioMetadata={file,duration:$('#preview-audio').duration};renderPreview();}});
  $('#file').addEventListener('change',chosen);$('#cover').addEventListener('change',()=>{const file=$('#cover').files[0];if(file)try{typedFile(file,'photos');}catch(error){$('#cover').value='';status(error.message);}renderPreview();});
  for(const slot of ['file','cover'])$('#remove-'+slot).onclick=()=>{$('#'+slot).value='';if(job){delete job.slots[slot==='file'?'original':'cover'];job.records.delete(slot==='file'?'original':'cover');job.uploads.delete(slot==='file'?'original':'cover');persistPlan(job);}renderPreview();};
  const drop=$('#file-label');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();if(!busy)drop.classList.add('dragover');});
  for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragover');});
  drop.addEventListener('drop',event=>{if(busy||!event.dataTransfer?.files?.length)return;const transfer=new DataTransfer();transfer.items.add(event.dataTransfer.files[0]);$('#file').files=transfer.files;chosen();});
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{controller?.abort();resetPreview();});
  window.addEventListener('focus',checkDriveExpiry);
  // On smaller screens review the artwork/audio before reaching Publish.
  if(typeof window.matchMedia==='function'){
    const narrow=window.matchMedia('(max-width:950px)'),preview=$('.preview-column'),desktopParent=preview.parentNode,saveBar=$('.save-bar');
    const placePreview=()=>{if(narrow.matches)saveBar.before(preview);else desktopParent.append(preview);};
    narrow.addEventListener('change',placePreview);placePreview();
  }
  $('#cancel-upload').onclick=()=>controller?.abort();$('#prepare-all').onclick=async()=>{try{if($('#kind').value!=='tracks'){$('#kind').value='tracks';newItem();}const {getDocs}=await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js');const list=await getDocs(collection(db,'tracks'));await prepareExisting(list.docs.map(x=>x.data()));}catch{status('Не удалось получить каталог.');}};
}
main().catch(error=>status('Студия не подключена. '+(error.code||error.message||'Проверьте настройки Firebase.')));
