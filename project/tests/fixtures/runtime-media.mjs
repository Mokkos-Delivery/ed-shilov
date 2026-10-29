import {createWorker} from '../../worker/src/index.mjs';
import {socialMultipart,attachmentMetadata} from '../../worker/src/social-media.mjs';

const id='runtime_audio_file_1';
const fields=value=>({fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:{integerValue:String(v)}]))});
export default {async fetch(request){
  if(new URL(request.url).pathname==='/multipart'){
    const {body,file}=await socialMultipart(request),attachment=await attachmentMetadata(file);
    const form=new FormData();form.set('chat_id','-1000000000');form.set('caption',body.text);form.set(attachment.kind,file,file.name);
    const outbound=new Request('https://api.telegram.org/botfixture/sendPhoto',{method:'POST',body:form,redirect:'manual'});
    const decoded=await outbound.formData();
    return Response.json({kind:attachment.kind,name:decoded.get(attachment.kind).name,size:decoded.get(attachment.kind).size,caption:decoded.get('caption')});
  }
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const raw=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  const private_key='-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...raw))+'\n-----END PRIVATE KEY-----';
  const env={PROJECT_ID:'runtime-test',ALLOWED_ORIGINS:'https://eduardshilov.com',DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.invalid',private_key})};
  const redirected=new URL(request.url).pathname==='/redirect';
  const net=async(url,options)=>{
    // Exercise workerd's native RequestInit validation; no external provider calls.
    const upstream=new Request(url,options);
    if(url.includes('/documents/media/')){
      if(redirected)return new Response(null,{status:302,headers:{Location:'https://other.example/never-requested'}});
      return Response.json(fields({driveId:id,name:'song.mp3',mime:'audio/mpeg',size:4,published:true,ownerKind:'tracks',ownerId:'runtime_track'}));
    }
    if(url.includes('/documents/tracks/'))return Response.json(fields({published:true,audio_mp3:'/media/'+id+'/song.mp3'}));
    if(url==='https://oauth2.googleapis.com/token'){
      if(upstream.method!=='POST'||!(await upstream.text()).includes('assertion='))throw Error('Missing signed assertion');
      return Response.json({access_token:'runtime-fixture-token',expires_in:3600});
    }
    if(url.startsWith('https://www.googleapis.com/drive/v3/files/')){
      if(upstream.headers.get('Authorization')!=='Bearer runtime-fixture-token'||upstream.headers.get('Range')!=='bytes=0-0')throw Error('Invalid Drive request');
      return new Response('s',{status:206,headers:{'Content-Type':'audio/mpeg','Content-Length':'1','Content-Range':'bytes 0-0/4'}});
    }
    throw Error('Unexpected provider');
  };
  return createWorker(net).fetch(new Request('https://media.example/media/'+(redirected?'runtime_redirect_file_1':id)+'/song.mp3',{method:request.method,headers:{Origin:'https://eduardshilov.com',Range:'bytes=0-0'}}),env);
}};
