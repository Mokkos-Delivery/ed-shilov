import {fileIdPattern,allowedMime,origins,docFields,validMedia,rangeValid,contentDisposition,validateApplication,base64url,jsonBytes,unbase64url} from './core.mjs';
import {driveToken,clearToken,verifyFirebaseIdToken} from './google.mjs';
import {publicationReference,referencedMediaIds} from '../../web/publication-media.mjs';
import {handleSocial} from './social.mjs';
import {socialMultipart} from './social-media.mjs';
import {fetchHeaders,readJSON} from './http.mjs';
import {RELEASE} from '../../web/release.mjs';

const catalogueCache=new Map();
function reply(data,status=200,extra={}) {return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
async function boundedJSON(request,limit=12000) {
  const invalid=()=>Object.assign(Error('bad request'),{status:400});
  if(!/application\/json/i.test(request.headers.get('Content-Type')||'')) throw invalid();
  if(Number(request.headers.get('Content-Length'))>limit) throw invalid();
  const reader=request.body?.getReader(); if(!reader) throw invalid();
  const parts=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw invalid();}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const value of parts){bytes.set(value,offset);offset+=value.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw invalid();}
}
async function publicDoc(collection,id,env,net) {
  if(!env.PROJECT_ID || !/^[a-z][a-z0-9-]{4,62}$/.test(env.PROJECT_ID)) throw Error('not configured');
  const key=env.PROJECT_ID+'/'+collection+'/'+id, cached=catalogueCache.get(key);
  if(cached && cached.expires>Date.now()) return cached.value;
  const url=`https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  const response=await fetchHeaders(net,url);
  if(response.status===403||response.status===404)return null;
  if(!response.ok)throw Error('catalogue unavailable');
  const value=docFields(await readJSON(response,512*1024));
  // Only a short positive cache. Unlisted/private IDs never use a static fallback.
  if(value.published===true){if(catalogueCache.size>=1500)catalogueCache.clear();catalogueCache.set(key,{value,expires:Date.now()+15000});}
  return value;
}
async function driveRequest(id,env,net,options={}) {
  let token=await driveToken(env,net);
  const url=`https://www.googleapis.com/drive/v3/files/${id}${options.metadata?'?fields=id,name,mimeType,size,parents,trashed':'?alt=media'}`;
  const send=()=>fetchHeaders(net,url,{method:'GET',headers:{Authorization:'Bearer '+token,...(options.range?{Range:options.range}:{})}});
  let response=await send();
  if(response.status===401){clearToken();token=await driveToken(env,net);response=await send();}
  return response;
}
async function media(request,id,env,net,ownerPreview=false) {
  if(!['GET','HEAD'].includes(request.method)) return reply({error:'Method not allowed'},405,{Allow:'GET, HEAD'});
  if(!fileIdPattern.test(id))return reply({error:'Not found'},404);
  let record;
  if(ownerPreview){
    const response=await fetchHeaders(net,`https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents/media/${id}`,{headers:{Authorization:request.headers.get('Authorization')}});
    if(!response.ok){await response.body?.cancel();return reply({error:'Файл не найден в каталоге.'},404);}
    record=docFields(await readJSON(response));
  }else record=await publicDoc('media',id,env,net);
  if(!validMedia(record,id)) return reply({error:'Not found'},404);
  let publication;
  try{publication=publicationReference(record);}catch{return reply({error:'Not found'},404);}
  if(publication&&!ownerPreview){
    const item=await publicDoc(publication.kind,publication.id,env,net);
    if(item?.published!==true||!referencedMediaIds(item).has(id))return reply({error:'Not found'},404);
  }
  const range=request.headers.get('Range'); if(!rangeValid(range)) return reply({error:'Invalid range'},416);
  const response=await driveRequest(id,env,net,{range:request.method==='HEAD'?'bytes=0-0':range});
  if(response.status===416){await response.body?.cancel();return reply({error:'Invalid range'},416,{'Content-Range':'bytes */'+record.size});}
  if(![200,206].includes(response.status)) {
    await response.body?.cancel();
    return reply({error:response.status===404?'File unavailable':'Media temporarily unavailable'},response.status===404?404:503,{'Retry-After':'30'});
  }
  if(/(?:text\/html|application\/json)/i.test(response.headers.get('Content-Type')||'')) {await response.body?.cancel();return reply({error:'Invalid media response'},502);}
  if(range&&response.status===206&&!/^bytes \d+-\d+\/\d+$/.test(response.headers.get('Content-Range')||'')){await response.body?.cancel();return reply({error:'Invalid media response'},502);}
  const headers=new Headers({'Content-Type':record.mime,'Accept-Ranges':'bytes','Cache-Control':'public, max-age=15','X-Content-Type-Options':'nosniff','Content-Disposition':contentDisposition(record.name,record.mime.startsWith('application/')||new URL(request.url).searchParams.get('download')==='1'),'Cross-Origin-Resource-Policy':'cross-origin'});
  if(ownerPreview)headers.set('Cache-Control','private, no-store');
  for(const key of ['Content-Length','Content-Range','ETag','Last-Modified']) if(response.headers.has(key))headers.set(key,response.headers.get(key));
  if(request.method==='HEAD'){await response.body?.cancel();headers.set('Content-Length',String(record.size));headers.delete('Content-Range');return new Response(null,{status:200,headers});}
  // A stream goes directly from Drive to the visitor; never buffer a whole video.
  return new Response(response.body,{status:response.status,headers});
}
async function hmac(secret,input) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,input));
}
function equalBytes(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
async function token(env,origin) {
  const body=base64url(jsonBytes({origin,expires:Date.now()+30*60000,nonce:crypto.randomUUID()}));
  return body+'.'+base64url(await hmac(env.FORM_SECRET,new TextEncoder().encode(body)));
}
async function tokenValid(value,env,origin) {
  try {const parts=value.split('.');if(parts.length!==2||value.length>1500)return false;
    if(!equalBytes(unbase64url(parts[1]),await hmac(env.FORM_SECRET,new TextEncoder().encode(parts[0]))))return false;
    const data=JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
    return data.origin===origin&&data.expires>Date.now()&&data.expires<Date.now()+31*60000;
  }catch{return false;}
}
async function application(request,env,net,origin) {
  if(!env.FORM_SECRET||!env.MAIL_RELAY_URL||!env.MAIL_RELAY_SECRET||!env.TURNSTILE_SECRET) return reply({error:'Отправка на почту пока не настроена. Используйте ссылку e-mail.'},503);
  if(!origin)return reply({error:'Origin required'},403);
  if(request.method==='GET')return reply({token:await token(env,origin),policyVersion:env.POLICY_VERSION});
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  const body=await boundedJSON(request,32768),clean=validateApplication(body,env.POLICY_VERSION);
  if(!clean||!(await tokenValid(body.token||'',env,origin)))return reply({error:'Проверьте поля и согласие. Обновите страницу и повторите.'},400);
  if(typeof body.turnstileToken!=='string'||!body.turnstileToken||body.turnstileToken.length>2048)return reply({error:'Подтвердите проверку защиты от спама.'},400);
  const check=await fetchHeaders(net,'https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:body.turnstileToken})});
  if(!check.ok)return reply({error:'Проверка защиты временно недоступна.'},503);
  const verified=await readJSON(check);
  if(verified.success!==true||verified.hostname!==new URL(origin).hostname||verified.action!=='booking')return reply({error:'Повторите проверку защиты от спама.'},400);
  const relay=new URL(env.MAIL_RELAY_URL);
  if(relay.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(relay.pathname))return reply({error:'Mail is not configured'},503);
  const payload=base64url(jsonBytes(clean)),timestamp=Date.now();
  const signature=base64url(await hmac(env.MAIL_RELAY_SECRET,new TextEncoder().encode(timestamp+'.'+payload)));
  const response=await fetchHeaders(net,relay.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,timestamp,signature}),redirect:'follow'});
  if(!response.ok)return reply({error:'Почтовый сервис временно недоступен. Используйте e-mail.'},503);
  const result=await readJSON(response);
  if(result.ok!==true)return reply({error:'Письмо пока не принято почтовым сервисом. Используйте e-mail.'},503);
  return reply({ok:true,reference:result.reference,delivery:'mail-service-accepted'});
}
async function adminVerify(request,env,net) {
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  const auth=request.headers.get('Authorization')||'';
  try{await verifyFirebaseIdToken(auth.startsWith('Bearer ')?auth.slice(7):'',env,net);}catch{return reply({error:'Unauthorized'},401);}
  const body=await boundedJSON(request,2000);
  if(!fileIdPattern.test(body.id||'')||!fileIdPattern.test(env.UPLOAD_FOLDER_ID||''))return reply({error:'Invalid file'},400);
  const response=await driveRequest(body.id,env,net,{metadata:true});
  if(!response.ok)return readerFailure(response,'file');
  const file=await readJSON(response);
  if(file.trashed||!file.parents?.includes(env.UPLOAD_FOLDER_ID)||!allowedMime.test(file.mimeType||'')||!Number.isSafeInteger(Number(file.size))||Number(file.size)<=0)return reply({error:'Файл не находится в папке публикаций или не поддерживается.'},400);
  return reply({ok:true,media:{driveId:file.id,name:file.name,mime:file.mimeType,size:Number(file.size),published:true}});
}
async function readerFailure(response,stage){
  const upstreamStatus=response.status;await response.body?.cancel();
  const pending=upstreamStatus===404;
  return reply({error:pending?'Сервер не видит файл или папку. Проверьте доступ reader к папке публикаций.':upstreamStatus===403?'Google запретил reader доступ к файлу или папке.':'Не удалось проверить файл через Google Drive. Повторите позже.',code:pending?'DRIVE_FILE_PENDING':upstreamStatus===403?'DRIVE_READER_FORBIDDEN':'DRIVE_READER_UNAVAILABLE',stage,upstreamStatus},pending?409:upstreamStatus===403?403:503);
}
async function adminReadiness(request,env,net){
  if(!env.DRIVE_SERVICE_ACCOUNT_JSON||!fileIdPattern.test(env.UPLOAD_FOLDER_ID||''))return reply({error:'На сервере не настроен доступ к папке публикаций.',code:'DRIVE_READER_CONFIG',stage:'folder'},503);
  const r=await driveRequest(env.UPLOAD_FOLDER_ID,env,net,{metadata:true});
  if(!r.ok)return readerFailure(r,'folder');
  const folder=await readJSON(r);
  if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')return reply({error:'Папка публикаций на сервере недоступна.',code:'DRIVE_FOLDER_INVALID',stage:'folder'},400);
  return reply({ok:true,release:RELEASE,folderId:env.UPLOAD_FOLDER_ID,readerReady:true});
}
export function createWorker(net=fetch) {
  return {async fetch(request,env) {
    const origin=request.headers.get('Origin'), allowed=origins(env);
    if(origin&&!allowed.includes(origin))return reply({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS') {
      if(!origin)return reply({error:'Origin required'},403);
      return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, Range','Access-Control-Max-Age':'600',Vary:'Origin'}});
    }
    let result; const url=new URL(request.url);
    try {
      const match=/^\/media\/([A-Za-z0-9_-]+)(?:\/[^/]+)?$/.exec(url.pathname);
      if(match)result=await media(request,match[1],env,net);
      else if(url.pathname==='/health'&&request.method==='GET')result=reply({ok:true,release:RELEASE,configured:!!(env.PROJECT_ID&&env.DRIVE_SERVICE_ACCOUNT_JSON),billingRequired:false});
      else if(url.pathname==='/api/applications')result=await application(request,env,net,origin);
      else if(url.pathname==='/api/admin/verify')result=await adminVerify(request,env,net);
      else if(url.pathname==='/api/admin/readiness'||/^\/api\/admin\/media\/[A-Za-z0-9_-]+(?:\/[^/]+)?$/.test(url.pathname)){
        const bearer=request.headers.get('Authorization')||'';
        try{await verifyFirebaseIdToken(bearer.startsWith('Bearer ')?bearer.slice(7):'',env,net);}catch{return reply({error:'Unauthorized'},401,origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{});}
        if(!['GET','HEAD'].includes(request.method))result=reply({error:'Method not allowed'},405);
        else result=url.pathname==='/api/admin/readiness'?await adminReadiness(request,env,net):await media(request,url.pathname.split('/')[4],env,net,true);
      }
      else if(['/api/admin/social','/api/admin/social/history'].includes(url.pathname)){
        const bearer=request.headers.get('Authorization')||'';
        try{await verifyFirebaseIdToken(bearer.startsWith('Bearer ')?bearer.slice(7):'',env,net);}catch{return reply({error:'Unauthorized'},401,origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{});}
        if(url.pathname.endsWith('/history')&&request.method!=='GET')result=reply({error:'Method not allowed'},405);
        else if(request.method==='POST'&&/^multipart\/form-data;/i.test(request.headers.get('Content-Type')||'')){const {body,file}=await socialMultipart(request);result=await handleSocial(request,env,net,body,file);}
        else result=await handleSocial(request,env,net,request.method==='POST'?await boundedJSON(request,20000):undefined);
      }
      else if(url.pathname==='/api/media-source'&&request.method==='GET') {
        const kind=url.searchParams.get('kind'),id=url.searchParams.get('id');
        if(!['audio','video'].includes(kind)||!id||! /^[A-Za-z0-9_-]{1,160}$/.test(id))result=reply({error:'Invalid item'},400);
        else {const item=await publicDoc(kind==='audio'?'tracks':'videos',id,env,net);
          const fields=kind==='audio'?['audio_mp3','audio_wav']:['video720pUrl','video1080pUrl','videoUrl','url'];
          result=item?.published===true?reply({sources:fields.filter(k=>typeof item[k]==='string'&& /^\/media\/[A-Za-z0-9_-]+\//.test(item[k])).map(k=>({url:item[k]}))}):reply({error:'Not found'},404);
        }
      } else result=reply({error:'Not found'},404);
    }catch(error){return reply({error:error.status===400?(error.publicMessage||'Некорректный запрос.'):'Сервис временно недоступен. Попробуйте позже.'},error.status===400?400:503,origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{});}
    if(origin){result.headers.set('Access-Control-Allow-Origin',origin);result.headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');result.headers.append('Vary','Origin');}
    return result;
  }};
}
export default createWorker();
