import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bindPublication,referencedMediaIds} from '../web/publication-media.mjs';
import {buildAdminPreview} from './build-admin-preview.mjs';
import {publicConfiguration} from './project-config.mjs';
import {createHash} from 'node:crypto';
import {RELEASE} from '../web/release.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=path.resolve(root,'../source'),draft=process.argv.includes('--draft');
const settingsPath=path.join(root,fs.existsSync(path.join(root,'settings.json'))?'settings.json':'settings.example.json');
const settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
if(settings.workerOrigin){const url=new URL(settings.workerOrigin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Invalid Worker origin');settings.workerOrigin=url.origin;}
if(!draft) {
  for(const [key,value] of Object.entries({projectId:settings.firebase.projectId,apiKey:settings.firebase.apiKey,appId:settings.firebase.appId,authDomain:settings.firebase.authDomain,adminUid:settings.adminUid,workerOrigin:settings.workerOrigin,uploadFolderId:settings.uploadFolderId,pickerApiKey:settings.pickerApiKey,turnstileSiteKey:settings.turnstileSiteKey}))if(!value)throw Error('Deployment blocked: configure '+key);
  const worker=new URL(settings.workerOrigin);if(worker.protocol!=='https:'||worker.pathname!=='/'||worker.search||worker.hash)throw Error('Invalid Worker origin');
  if(! /^[a-z][a-z0-9-]{4,62}$/.test(settings.firebase.projectId)||! /^[A-Za-z0-9_-]{1,128}$/.test(settings.adminUid))throw Error('Invalid project or administrator');
}
const audit=JSON.parse(fs.readFileSync(path.resolve(root,'../audit.json'),'utf8'));
const inventory=JSON.parse(fs.readFileSync(path.resolve(root,'../media-inventory.json'),'utf8'));
const byId=new Map(inventory.map(f=>[f.id,f])),exact=new Map(inventory.map(f=>['/'+f.path,f]));
const normal=s=>decodeURIComponent(s).normalize('NFC').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const normalized=new Map();for(const file of inventory){const key=normal('/'+file.path);if(!normalized.has(key))normalized.set(key,[]);normalized.get(key).push(file);}
function fileAt(value){if(!value)return null;const key=decodeURIComponent(new URL(value,'https://eduardshilov.com').pathname),direct=exact.get(key);if(direct)return direct;const list=normalized.get(normal(key))||[];return list.length===1?list[0]:null;}
const oldMapSource=fs.readFileSync(source+'/js/image-map-v6.js','utf8');
const oldMap=JSON.parse(oldMapSource.slice(oldMapSource.indexOf('{'),oldMapSource.lastIndexOf('}')+1));
const published=new Map(),mediaMap={};
function publish(file){if(!file||file.size<=0)throw Error('Invalid media record');const url='/media/'+file.id+'/'+encodeURIComponent(file.name);published.set(file.id,{driveId:file.id,name:file.name,mime:file.mime,size:file.size,published:true});mediaMap['/'+file.path]=url;return url;}
function resolve(value){if(!value)return value;const key=decodeURIComponent(new URL(value,'https://eduardshilov.com').pathname);if(mediaMap[key])return mediaMap[key];const file=fileAt(oldMap[key])||fileAt(key);if(!file)return value;const url=publish(file);mediaMap[key]=url;return url;}
for(const image of audit.images){const file=byId.get(image.driveId);if(file)mediaMap[image.original]=publish(file);}
for(const [key,value] of Object.entries(oldMap)){const file=fileAt(value)||fileAt(key);if(file)mediaMap[key]=publish(file);}
for(const name of ['RUS.webp','ENG.webp'])resolve('/assets/img/branding/'+name);
resolve('/assets/video/intro-fast.mp4');
const indexHTML=fs.readFileSync(source+'/index.html','utf8');
const featured=new Set([...indexHTML.matchAll(/data-track-id="([^"]+)"/g)].map(x=>x[1]));
const tracks=JSON.parse(fs.readFileSync(source+'/assets/tracks.json','utf8')).map((t,order)=>{
  const checks=audit.tracks.find(x=>x.id===t.id),result={...t,order,published:true,featured:featured.has(t.id),qualities:{}};
  for(const key of ['audio_mp3','audio_wav']){const id=checks.sources.find(x=>x.field===key)?.driveId;result[key]=id?publish(byId.get(id)):'';}
  result.cover=resolve(t.cover);return result;
});
const videos=JSON.parse(fs.readFileSync(source+'/videos.json','utf8')).filter(v=>audit.videos.find(x=>x.id===v.id)?.sources.some(x=>x.driveId)).map((v,order)=>{
  const checks=audit.videos.find(x=>x.id===v.id),result={...v,order,published:true};
  for(const key of ['video1080pUrl','video720pUrl','videoUrl','url'])if(v[key]){const id=checks.sources.find(x=>x.field===key)?.driveId;result[key]=id?publish(byId.get(id)):'';}
  result.coverUrl=resolve(v.coverUrl);return result;
});
const news=JSON.parse(fs.readFileSync(source+'/news.json','utf8')).map((n,order)=>({...n,order,published:true,cover:resolve(n.cover)}));
// Bind audio and video originals when a single publication owns the file.
// Shared branding and images stay in the separately curated public asset list.
const owners=new Map();
for(const [kind,list] of [['tracks',tracks],['videos',videos]])for(const item of list)for(const id of referencedMediaIds(item)){
  const record=published.get(id);if(!record||! /^(audio|video)\//.test(record.mime))continue;
  if(!owners.has(id))owners.set(id,[]);owners.get(id).push({kind,id:item.id});
}
for(const [id,list] of owners)if(list.length===1)published.set(id,bindPublication(published.get(id),list[0].kind,list[0].id));
const publicDir=path.join(root,'public');fs.rmSync(publicDir,{recursive:true,force:true});fs.mkdirSync(publicDir,{recursive:true});
fs.cpSync(source,publicDir,{recursive:true});
// Source contains only audited code/catalogue files; media bytes are deliberately absent.
function patch(text,from,to,count=1){const matches=text.split(from).length-1;if(matches!==count)throw Error('Source changed: expected '+count+' matches for '+from.slice(0,90));return text.split(from).join(to);}
for(const name of fs.readdirSync(publicDir).filter(n=>n.endsWith('.html'))) {
  let html=fs.readFileSync(publicDir+'/'+name,'utf8');
  html=html.replace(/\b(src|poster|href|data-photo)="([^"]+)"/g,(all,attribute,value)=>{
    if(!value.startsWith('/')||value.startsWith('//'))return all;const target=resolve(value);return `${attribute}="${target}${attribute==='href'&&/\.(?:mp3|wav)$/i.test(decodeURIComponent(value))?'?download=1':''}"`;
  });
  html=html.replace(/srcset="([^"]+)"/g,(_,value)=>'srcset="'+[...value.matchAll(/([\s\S]+?)\s+(\d+(?:\.\d+)?)(w|x)\s*(?:,\s*|$)/g)].map(x=>resolve(x[1].trim())+' '+x[2]+x[3]).join(', ')+'"');
  const cloud='<script defer src="/js/cloud-config.js?v=migration1"></script><script defer src="/js/cloud-image-map.js?v=migration1"></script><script defer src="/js/cloud-bridge.js?v=migration1"></script>';
  if(html.includes('<script defer src="/js/site-v10.js?v=10"></script>'))html=html.replace('<script defer src="/js/site-v10.js?v=10"></script>',cloud+'<script defer src="/js/site-v10.js?v=migration1"></script>'+(['index.html','music.html','video.html','bio.html','news.html'].includes(name)?'<script type="module" src="/js/live-catalog.mjs?v=migration1"></script>':''));
  if(name==='cookies.html') {
    html=html.replace(/<tr><td>es_form[\s\S]*?<\/tr>/,'<tr><td>Защита формы</td><td>Подписанный токен хранится в памяти вкладки; проверка Cloudflare Turnstile используется только для отправки заявки.</td><td>Токен формы — до 30 минут; результат проверки Turnstile кратковременный.</td></tr>');
    html=html.replace('Она не удаляет уже отправленные письма и сессионный HttpOnly-cookie формы. Сессия истекает отдельно.','Она не удаляет уже отправленные письма. Токен формы пропадает при закрытии вкладки или истекает через 30 минут.');
    html=html.replace('Содержание заявки не сохраняется в localStorage.','Содержание заявки не сохраняется в localStorage. Вход администратора не используется для посетителей. Для входа администратора могут использоваться механизмы Google; разрешение доступа к файлам Диска запрашивается отдельно.');
  }
  if(name==='privacy.html') {
    html=html.replace('Редакция 7, сентябрь 2026 года.','Редакция переноса, октябрь 2026 года.');
    html=html.replace('В письме и временной серверной сессии','В письме; номер обращения временно сохраняется для защиты от повторной отправки');
    html=html.replace('Инфраструктура хостинга; обработчик формы хранит только хеш IP для ограничения частоты','Инфраструктура Firebase/Google и Cloudflare; защита формы Cloudflare Turnstile. Собственный обработчик не сохраняет IP посетителя');
    html=html.replace('письмо принято почтовой службой хостинга для доставки','письмо принято почтовым сервисом Google для доставки на troikaband@mail.ru');
    html=html.replace('Для доставки сайта и обращения используются хостинг и почтовая инфраструктура.','Для доставки сайта используются Firebase Hosting и Cloud Firestore (Google), для хранения опубликованных фото, аудио и видео — Google Диск, для передачи медиа и обработки формы — Cloudflare Workers. Проверку формы от спама выполняет Cloudflare Turnstile; отправку письма — Google Apps Script и почтовый сервис Google. Данные заявки не записываются в публичный каталог Firestore или в папку с медиа.');
    html=html.replace('Политика относится к этому сайту.','Токен формы действует до 30 минут. Чтобы повторная попытка отправки не создавала дубликат письма, номер заявки и время хранятся до 48 часов без сохранения текста обращения в этом временном реестре. Политика относится к этому сайту.');
    html=html.replace('<p>Сессионные данные формы действуют до двух часов. Обработчик проверяет срок при обращении и не принимает просроченный токен. Счётчики ограничения отправок учитывают последние 10 минут; файлы старше часа удаляются при следующем обращении к обработчику. Содержание заявки в эти счётчики не записывается.</p>','<p>Токен формы действует до 30 минут; обработчик не принимает просроченный токен. Проверка защиты от спама кратковременная. Номер заявки и время хранятся до 48 часов для защиты от повторной отправки; текст обращения в этот временный реестр не записывается.</p>');
    html=html.replace('<p>Обработчик проверяет источник запроса, защитный токен, согласие и формат данных, ограничивает размер и частоту отправок. Для формы используется сессионный cookie с ограничениями HttpOnly и SameSite; при работе на публичном HTTPS-сайте — также Secure. Эти меры не являются обещанием отсутствия всех возможных рисков.</p>','<p>Обработчик проверяет источник запроса, подпись и срок защитного токена, отдельное согласие, версию документа и формат данных, ограничивает размер обращения. Для защиты формы используется Cloudflare Turnstile; результат проверки контролируется сервером. Передача выполняется по HTTPS. Токен формы хранится в памяти вкладки. Эти меры не являются обещанием отсутствия всех возможных рисков.</p>');
  }
  if(name==='data-consent.html') {
    html=html.replace('2026-09-v7',settings.policyVersion);
    html=html.replace('Для доставки заявки используются сервер сайта и почтовая инфраструктура.','Для доставки заявки используются Cloudflare Workers и проверка Cloudflare Turnstile, Google Apps Script и почтовая инфраструктура Google с направлением письма на troikaband@mail.ru. Заявка не публикуется в каталоге сайта.');
  }
  fs.writeFileSync(publicDir+'/'+name,html);
}
let script=fs.readFileSync(source+'/js/site-v10.js','utf8');
const start=script.indexOf('  async function scheduleQuality('),end=script.indexOf('  async function swapQuality(',start);
if(start<0||end<0)throw Error('Quality code changed');
script=script.slice(0,start)+fs.readFileSync(root+'/web/cloud-quality.js','utf8')+'\n'+script.slice(end);
script=patch(script,"fetch('/media-source.php?kind=","fetch(window.ED_CLOUD.endpoint('/api/media-source')+'?kind=",2);
script=patch(script,"fetch('/application.php',","fetch(window.ED_CLOUD.endpoint('/api/applications'),",2);
script=patch(script,'const payload={token:session.token,policyVersion:session.policyVersion,consent:true,requestId:formRequestId};','const payload={token:session.token,policyVersion:session.policyVersion,consent:true,requestId:formRequestId,turnstileToken:window.ED_CLOUD.turnstileToken()};');
script=patch(script,"finally{clearTimeout(timer);button.disabled=false;}","finally{clearTimeout(timer);button.disabled=false;window.ED_CLOUD.resetTurnstile();}");
script=patch(script,"$('#copy-booking')?","$('#booking-copy')?");
script=patch(script,"introVideo.src='/assets/video/intro-fast.mp4'","introVideo.src=resolveImage('/assets/video/intro-fast.mp4')");
script=patch(script,"    tracks=Array.isArray(data)?data:[];","    tracks=window.ED_CLOUD?.catalogue('tracks')||(Array.isArray(data)?data:[]);");
script=patch(script,"videos=Array.isArray(data)?data.filter(v=>!pausedVideoIds.has(v.id)):[];","videos=window.ED_CLOUD?.catalogue('videos')||(Array.isArray(data)?data.filter(v=>!pausedVideoIds.has(v.id)):[]);");
// Direct downloads use the gateway's attachment response for large originals.
script=patch(script,'direct.href=safeURL(path);','direct.href=safeURL(path)+(String(path).includes(\'?\')?\'&\':\'?\')+\'download=1\';');
script=patch(script,"image.alt=target.alt||'';$('#photo-caption').textContent=target.alt||'';","image.alt=target.alt||target.dataset.caption||'';$('#photo-caption').textContent=target.alt||target.dataset.caption||'';");
const insertion=script.lastIndexOf('})();');if(insertion<0)throw Error('Main script closing changed');
script=script.slice(0,insertion)+fs.readFileSync(root+'/web/catalogue-ui.js','utf8')+'\n'+script.slice(insertion);
fs.writeFileSync(publicDir+'/js/site-v10.js',script);
fs.writeFileSync(publicDir+'/js/site-options-v7.js',fs.readFileSync(source+'/js/site-options-v7.js','utf8').replace("'2026-09-v7'",JSON.stringify(settings.policyVersion)));
const adminFiles=['admin.mjs','admin-media.mjs','social-composer.mjs','drive-upload.mjs','quality-worker.js','quality.mjs','publication-media.mjs','upload-journal.mjs','release.mjs'];
const assetVersion=createHash('sha256').update(adminFiles.map(name=>fs.readFileSync(root+'/web/'+name,'utf8')).join('\n')+fs.readFileSync(root+'/web/admin.css','utf8')+fs.readFileSync(root+'/web/admin.html','utf8')+JSON.stringify(publicConfiguration(settings))+JSON.stringify(mediaMap)).digest('hex').slice(0,16);
for(const name of ['cloud-bridge.js','live-catalog.mjs',...adminFiles])fs.writeFileSync(publicDir+'/js/'+name,fs.readFileSync(root+'/web/'+name,'utf8').replaceAll('v=studio-4','v='+assetVersion));
const publicSettings=publicConfiguration(settings);
fs.writeFileSync(publicDir+'/js/cloud-config.js','window.ED_CLOUD_CONFIG = Object.freeze('+JSON.stringify(publicSettings)+');\n');
fs.writeFileSync(publicDir+'/js/cloud-image-map.js','window.SITE_IMAGE_MAP = '+JSON.stringify(mediaMap)+';\n');
fs.writeFileSync(publicDir+'/assets/tracks.json',JSON.stringify(tracks));fs.writeFileSync(publicDir+'/videos.json',JSON.stringify(videos));fs.writeFileSync(publicDir+'/news.json',JSON.stringify(news));
fs.writeFileSync(publicDir+'/catalogue-bootstrap.json',JSON.stringify({tracks,videos,news,photos:[],media:[...published.values()]}));
fs.writeFileSync(publicDir+'/admin.html',fs.readFileSync(root+'/web/admin.html','utf8').replaceAll('v=studio-4','v='+assetVersion));fs.copyFileSync(root+'/web/admin.css',publicDir+'/assets/css/admin.css');fs.copyFileSync(root+'/web/sw.js',publicDir+'/sw.js');
fs.writeFileSync(publicDir+'/build-manifest.json',JSON.stringify({release:RELEASE,assetVersion,draft,deployable:!draft,files:Object.fromEntries(['admin.html','assets/css/admin.css','js/cloud-config.js','js/cloud-image-map.js',...adminFiles.map(n=>'js/'+n)].map(n=>[n,createHash('sha256').update(fs.readFileSync(publicDir+'/'+n)).digest('hex')]))},null,2)+'\n');
fs.copyFileSync(publicDir+'/assets/vendor/lamejs-1.2.0-source.tgz.gz',publicDir+'/assets/vendor/lamejs-1.2.0-source.tgz');fs.unlinkSync(publicDir+'/assets/vendor/lamejs-1.2.0-source.tgz.gz');
const rules=fs.readFileSync(root+'/firestore.rules','utf8').replace('__ADMIN_UID__',settings.adminUid||'__UNCONFIGURED_DENY_ALL__');fs.writeFileSync(root+'/firestore.generated.rules',rules);
const hosting={public:'public',ignore:['firebase.json','**/.*','**/node_modules/**'],cleanUrls:false,trailingSlash:false,
  redirects:[{source:'/privacy',destination:'/privacy.html',type:302},{source:'/cookies',destination:'/cookies.html',type:302},{source:'/admin',destination:'/admin.html',type:302}],
  headers:[{source:'**',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'SAMEORIGIN'}]},{source:'**/*.html',headers:[{key:'Cache-Control',value:'no-cache'}]},{source:'/js/**',headers:[{key:'Cache-Control',value:'public, max-age=300'}]},{source:'/assets/css/**',headers:[{key:'Cache-Control',value:'public, max-age=300'}]},{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache'}]},{source:'/catalogue-bootstrap.json',headers:[{key:'Cache-Control',value:'no-cache'}]}]};
if(settings.workerOrigin)hosting.redirects.unshift({source:'/media/:id/:name',destination:settings.workerOrigin+'/media/:id/:name',type:302});
fs.writeFileSync(root+'/firebase.json',JSON.stringify({hosting,firestore:{rules:'firestore.generated.rules',indexes:'firestore.indexes.json'}},null,2));
if(settings.firebase.projectId)fs.writeFileSync(root+'/.firebaserc',JSON.stringify({projects:{default:settings.firebase.projectId}},null,2));
fs.writeFileSync(root+'/build-report.json',JSON.stringify({draft,deployable:!draft,tracks:tracks.length,videos:videos.length,news:news.length,allowlistedMedia:published.size,mediaBytesIncluded:0,sourceDesign:'v10',disabledVideos:audit.videos.filter(v=>!v.sources.some(s=>s.driveId)).map(v=>v.id),deployed:false},null,2));
fs.writeFileSync(root+'/reader-access-plan.json',JSON.stringify({permissionsApplied:false,role:'reader',folders:[{id:'1ULDCIutvN87ZI0xSkuA94-ZFuy0x2ySw',name:'assets/audio'},{id:'1KjwGsYLA05Z0iqpmUPLlD21qy5mu7RRF',name:'assets/video'},{id:'116o66OzUC_2joYs4vjgt2fdb9oGHuVue',name:'assets/img'},{id:'1_WQt0gN0yWN1JODvJS4zZa-ioHjPlN8M',name:'assets/responsive'},{id:'1xTYbJL_GpmW5DLX120yej9fb_hYZrzmz',name:'assets/images'},{id:settings.uploadFolderId,name:'Публикации сайта'}],individualFiles:[...published.values()].filter(x=>!byId.get(x.driveId).path.includes('/')).map(x=>({id:x.driveId,name:x.name})),doNotShare:['site root with PHP/source files','assets/analytics','account-wide Drive access']},null,2));
buildAdminPreview(root);
console.log(JSON.stringify({draft,tracks:tracks.length,videos:videos.length,media:published.size,deployable:!draft}));
