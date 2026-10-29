// Fixed destinations and server-only tokens. Never log provider requests or replies.
import {socialTargets,resolveSocialTarget} from './social-targets.mjs';
import {fetchHeaders,readJSON} from './http.mjs';
import {attachmentMetadata} from './social-media.mjs';
const targets=Object.keys(socialTargets);
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function socialConfiguration(env){
  return Object.fromEntries(targets.map(key=>{const {platform,label,id,token,enabled}=resolveSocialTarget(key,env);return [key,{platform,label,id,enabled,configured:enabled&&!!id&&!!token}];}));
}
export function validateSocialPost(body,attachment=null){
  if(!body||Object.keys(body).some(k=>!['requestId','text','url','channels','confirmed'].includes(k))||body.confirmed!==true
    ||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.requestId||'')
    ||typeof body.text!=='string'||(!body.text.trim()&&!attachment)||typeof body.url!=='string'
    ||!Array.isArray(body.channels)||!body.channels.length||body.channels.length>4
    ||new Set(body.channels).size!==body.channels.length||body.channels.some(x=>!targets.includes(x)))return null;
  let url=body.url.trim();
  if(url){try{const value=new URL(url);if(value.protocol!=='https:'||value.username||value.password||url.length>2048||/[\r\n]/.test(url))return null;url=value.href;}catch{return null;}}
  const text=body.text.trim(),message=text+(url?'\n\n'+url:'');
  if(message.length>(attachment?1024:4096)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message))return null;
  return {requestId:body.requestId,text,url,channels:targets.filter(x=>body.channels.includes(x)),message,...(attachment?{attachment}:{})};
}
function encode(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='number')return {integerValue:String(value)};
  if(typeof value==='string')return {stringValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
}
function decode(value){
  if('stringValue' in value)return value.stringValue;
  if('integerValue' in value)return Number(value.integerValue);
  if('booleanValue' in value)return value.booleanValue;
  if('arrayValue' in value)return (value.arrayValue.values||[]).map(decode);
  if('mapValue' in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));
  return null;
}
const attachmentKey=value=>value?JSON.stringify([value.kind,value.name,value.mime,value.size,value.sha256]):'';
const fields=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
const document=value=>decode({mapValue:{fields:value.fields||{}}});
const call=(net,url,options)=>fetchHeaders(net,url,options,12000);
async function publish(channel,post,env,net,file){
  try{
    const target=resolveSocialTarget(channel,env),telegram=target.platform==='telegram';
    const method=post.attachment?(post.attachment.kind==='photo'?'sendPhoto':'sendVideo'):'sendMessage';
    const url=telegram?'https://api.telegram.org/bot'+target.token+'/'+method:'https://api.vk.com/method/wall.post';
    let body,headers;
    if(telegram&&post.attachment){body=new FormData();body.set('chat_id',target.id);body.set('caption',post.message);body.set(post.attachment.kind,file,post.attachment.name);if(post.attachment.kind==='video')body.set('supports_streaming','true');headers={};}
    else{body=telegram?JSON.stringify({chat_id:target.id,text:post.message}):new URLSearchParams({access_token:target.token,v:'5.199',owner_id:'-'+target.id,from_group:'1',message:post.message,guid:post.requestId+'_'+channel});headers={'Content-Type':telegram?'application/json':'application/x-www-form-urlencoded'};}
    const result=await fetchHeaders(net,url,{method:'POST',headers,body},post.attachment?90000:12000);
    const data=await readJSON(result);
    if(telegram&&result.ok&&data.ok===true&&Number.isSafeInteger(data.result?.message_id)&&data.result.message_id>0){
      const id=data.result.message_id,channelId=target.id;
      return {state:'sent',postId:String(id),url:channelId.startsWith('@')?'https://t.me/'+channelId.slice(1)+'/'+id:'https://t.me/c/'+channelId.slice(4)+'/'+id};
    }
    if(!telegram&&result.ok&&Number.isSafeInteger(data.response?.post_id)&&data.response.post_id>0){const id=data.response.post_id;return {state:'sent',postId:String(id),url:'https://vk.ru/wall-'+target.id+'_'+id};}
    const code=telegram?data.error_code:data.error?.error_code;
    if((telegram?data.ok===false:!!data.error)&&Number.isInteger(code))return {state:'failed',code,message:code===429||code===6?'Сервис ограничил частоту. Повторите позже.':'Площадка отклонила публикацию. Проверьте права и подключение.'};
    return {state:'unknown',message:'Ответ не подтверждён. Проверьте площадку перед повтором.'};
  }catch{return {state:'unknown',message:'Связь прервалась. Пост мог появиться; проверьте площадку перед повтором.'};}
}
export async function handleSocial(request,env,net,body,file){
  const configuration=socialConfiguration(env),headers={Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'};
  if(request.method==='GET'&&!new URL(request.url).pathname.endsWith('/history'))return response({ok:true,channels:configuration});
  const root='https://firestore.googleapis.com/v1/projects/'+env.PROJECT_ID+'/databases/(default)/documents';
  if(request.method==='GET'){
    const result=await call(net,root+':runQuery',{method:'POST',headers,body:JSON.stringify({structuredQuery:{from:[{collectionId:'socialPosts'}],orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],limit:20}})});
    if(!result.ok)return response({error:'История пока недоступна. Завершите настройку прав публикаций.'},503);
    const rows=await readJSON(result,512*1024);if(!Array.isArray(rows))throw Error('invalid history');
    return response({ok:true,posts:rows.filter(x=>x.document).map(x=>document(x.document))});
  }
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  const attachment=await attachmentMetadata(file);
  const post=validateSocialPost(body,attachment);if(!post)return response({error:attachment?'С картинкой или видео подпись со ссылкой — до 1024 символов.':'Проверьте текст, ссылку, площадки и предпросмотр. Общая длина — до 4096 символов.'},400);
  if(attachment&&post.channels.some(key=>socialTargets[key].platform!=='telegram'))return response({error:'Вложения сейчас поддерживаются только для Telegram.'},400);
  if(post.channels.some(x=>!configuration[x].configured))return response({error:'Выбранная площадка ещё не настроена.'},503);
  if(new Set(post.channels.map(x=>configuration[x].platform+':'+configuration[x].id)).size!==post.channels.length)return response({error:'Два выбранных получателя указывают на один чат или группу. Исправьте настройки.'},400);
  const destinations=Object.fromEntries(post.channels.map(x=>{const {platform,label,id}=configuration[x];return [x,{platform,label,id}];}));
  const entry={requestId:post.requestId,text:post.text,url:post.url,channels:post.channels,destinations,...(attachment?{attachment}:{}),createdAt:new Date().toISOString(),results:Object.fromEntries(post.channels.map(x=>[x,{state:'pending'}]))};
  // Create-only claim is shared across isolates. An existing request is NEVER sent again.
  const claim=await call(net,root+'/socialPosts?documentId='+post.requestId,{method:'POST',headers,body:JSON.stringify({fields:fields(entry)})});
  await claim.body?.cancel();
  if(claim.status===409){
    const existing=await call(net,root+'/socialPosts/'+post.requestId,{headers});
    if(!existing.ok)return response({error:'Не удалось проверить предыдущую попытку. Повтор не отправлялся.'},503);
    const previous=document(await readJSON(existing));
    if(previous.text!==post.text||previous.url!==post.url||JSON.stringify(previous.channels)!==JSON.stringify(post.channels)||attachmentKey(previous.attachment)!==attachmentKey(attachment))return response({error:'Этот номер уже принадлежит другому посту или файлу.'},409);
    return response({ok:true,post:previous,reused:true});
  }
  if(!claim.ok)return response({error:'Публикация не начата: история недоступна. Проверьте настройки Firestore.'},503);
  for(const channel of post.channels){
    entry.results[channel]=await publish(channel,post,env,net,file);
    try{
      const saved=await call(net,root+'/socialPosts/'+post.requestId+'?updateMask.fieldPaths=results.'+channel,{method:'PATCH',headers,body:JSON.stringify({fields:{results:encode({[channel]:entry.results[channel]})}})});
      if(!saved.ok)throw Error('journal');
      await saved.body?.cancel();
    }catch{
      // Stop before attempting another destination when the journal cannot be saved.
      return response({ok:true,post:entry,journalWarning:'История не обновилась. Проверьте посты на площадках; автоматического повтора нет.'});
    }
  }
  return response({ok:true,post:entry});
}
