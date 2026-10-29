import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/src/index.mjs';
import {base64url,jsonBytes} from '../worker/src/core.mjs';
import {verifyFirebaseIdToken,clearToken} from '../worker/src/google.mjs';

const env={PROJECT_ID:'project-test-1',ADMIN_UID:'owner_uid',ALLOWED_ORIGINS:'https://eduardshilov.com',UPLOAD_FOLDER_ID:'publication_folder_1',POLICY_VERSION:'current'};
function fields(record){return {fields:Object.fromEntries(Object.entries(record).map(([k,v])=>[k,typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:{integerValue:String(v)}]))};}
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey=await crypto.subtle.exportKey('pkcs8',pair.privateKey),raw=Buffer.from(privateKey).toString('base64');
const serviceAccount=JSON.stringify({client_email:'media-reader@example.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+raw+'\n-----END PRIVATE KEY-----'});
const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-key';
async function jwt(changes={}){const now=Math.floor(Date.now()/1000),payload={sub:env.ADMIN_UID,aud:env.PROJECT_ID,iss:'https://securetoken.google.com/'+env.PROJECT_ID,email_verified:true,exp:now+3600,iat:now,auth_time:now,...changes},body=base64url(jsonBytes({alg:'RS256',kid:'test-key'}))+'.'+base64url(jsonBytes(payload));return body+'.'+base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(body)));}

test('Unknown/private files cannot use the Drive gateway, even when their IDs are known',async()=>{
  let calls=0;const worker=createWorker(async url=>{calls++;assert.match(url,/firestore.googleapis.com/);return new Response(null,{status:403});});
  const response=await worker.fetch(new Request('https://media.example/media/private_file_1/song.mp3'),env);
  assert.equal(response.status,404);assert.equal(calls,1);
});
test('Unapproved origins are rejected before any Drive/Firestore access',async()=>{
  const worker=createWorker(()=>{throw Error('Unexpected upstream request');});
  assert.equal((await worker.fetch(new Request('https://media.example/media/public_file_1/a.mp3',{headers:{Origin:'https://evil.example'}}),env)).status,403);
});
test('Hidden publications and replaced files never reach Drive even with a published media record',async()=>{
  for(const [name,item] of [['hidden',{published:false,audio_mp3:'/media/hidden_audio_file/song.mp3'}],['replaced',{published:true,audio_mp3:'/media/another_audio_file/song.mp3'}]]){
    const id=name+'_audio_file',record={driveId:id,name:'song.mp3',mime:'audio/mpeg',size:8,published:true,ownerKind:'tracks',ownerId:name+'_publication'};
    const worker=createWorker(async url=>{assert.match(url,/firestore.googleapis.com/);return Response.json(fields(url.includes('/documents/media/')?record:item));});
    const response=await worker.fetch(new Request('https://media.example/media/'+id+'/song.mp3'),env);
    assert.equal(response.status,404);
  }
});
test('Linked publication media is streamed only while its owner publishes that same file',async()=>{
  clearToken();const id='linked_public_file_1',record={driveId:id,name:'song.mp3',mime:'audio/mpeg',size:4,published:true,ownerKind:'tracks',ownerId:'linked_track_1'};
  const worker=createWorker(async url=>{
    if(url.includes('/documents/media/'))return Response.json(fields(record));
    if(url.includes('/documents/tracks/'))return Response.json(fields({published:true,audio_mp3:'/media/'+id+'/song.mp3'}));
    if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token'});
    return new Response('song',{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}});
  });
  const response=await worker.fetch(new Request('https://media.example/media/'+id+'/song.mp3'),{...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount});
  assert.equal(response.status,200);assert.equal(await response.text(),'song');
});
test('An upstream unsatisfiable range preserves HTTP 416 and the file size',async()=>{
  clearToken();const id='range_overflow_file',record={driveId:id,name:'song.mp3',mime:'audio/mpeg',size:8,published:true};
  const worker=createWorker(async url=>{
    if(url.includes('firestore.googleapis.com'))return Response.json(fields(record));
    if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token'});
    return new Response(null,{status:416});
  });
  const response=await worker.fetch(new Request('https://media.example/media/'+id+'/song.mp3',{headers:{Range:'bytes=99-'}}),{...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount});
  assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */8');
});
test('Published media forwards Range and streams a 206 response with readable CORS headers',async()=>{
  clearToken();const id='range_test_file_1',record={driveId:id,name:'Песня.mp3',mime:'audio/mpeg',size:8,published:true};let driveCalls=0;
  const worker=createWorker(async(url,options)=>{
    if(url.includes('firestore.googleapis.com'))return Response.json(fields(record));
    if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token',expires_in:3600});
    driveCalls++;assert.equal(options.headers.Range,'bytes=2-5');assert.equal(options.headers.Authorization,'Bearer test-token');
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('2345'));c.close();}});
    return new Response(stream,{status:206,headers:{'Content-Type':'audio/mpeg','Content-Length':'4','Content-Range':'bytes 2-5/8'}});
  });
  const response=await worker.fetch(new Request('https://media.example/media/'+id+'/song.mp3?download=1',{headers:{Range:'bytes=2-5',Origin:'https://eduardshilov.com'}}),{...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount});
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 2-5/8');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://eduardshilov.com');assert.match(response.headers.get('Content-Disposition'),/^attachment/);assert.equal(await response.text(),'2345');assert.equal(driveCalls,1);
});
test('Admin verification validates UID, audience, signature and expiry',async()=>{
  const net=async()=>Response.json({keys:[jwk]});
  assert.equal((await verifyFirebaseIdToken(await jwt(),env,net)).sub,env.ADMIN_UID);
  for(const changes of [{sub:'other_uid'},{aud:'other-project'},{email_verified:false},{exp:0},{iss:'https://attacker.example'}])await assert.rejects(verifyFirebaseIdToken(await jwt(changes),env,net));
  const token=await jwt(),pieces=token.split('.');pieces[2]=base64url(new Uint8Array(256));await assert.rejects(verifyFirebaseIdToken(pieces.join('.'),env,net));
});
test('Unconfigured mail never produces a success message',async()=>{
  const response=await createWorker().fetch(new Request('https://media.example/api/applications',{headers:{Origin:'https://eduardshilov.com'}}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).ok,undefined);
});
test('Mail requires a signed form token, current consent and a successful spam check',async()=>{
  const settings={...env,FORM_SECRET:'test-form-secret',MAIL_RELAY_SECRET:'test-mail-secret',MAIL_RELAY_URL:'https://script.google.com/macros/s/test-deployment/exec',TURNSTILE_SECRET:'test-turnstile'};
  let mails=0,verdict={success:true,hostname:'eduardshilov.com',action:'booking'};
  const net=async(url,options)=>{
    if(url.includes('turnstile'))return Response.json(verdict);
    if(url.includes('script.google.com')){mails++;const body=JSON.parse(options.body);assert.ok(body.signature);return Response.json({ok:true,reference:'ES-TEST'});}throw Error('Unexpected upstream');
  };
  const worker=createWorker(net),origin='https://eduardshilov.com';
  const session=await(await worker.fetch(new Request('https://media.example/api/applications',{headers:{Origin:origin}}),settings)).json();
  const payload={token:session.token,policyVersion:'current',consent:true,requestId:'request_123456',turnstileToken:'test-response',website:'',name:'Посетитель',email:'visitor@example.com',phone:'',city:'',date:'',message:'Концерт'};
  const send=data=>worker.fetch(new Request('https://media.example/api/applications',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)}),settings);
  assert.equal((await send({...payload,token:'invalid'})).status,400);assert.equal(mails,0);
  assert.equal((await send({...payload,consent:false})).status,400);assert.equal(mails,0);
  for(const changed of [{success:false},{success:'true'},{hostname:'localhost'},{hostname:'another.example'},{action:'login'}]){
    verdict={success:true,hostname:'eduardshilov.com',action:'booking',...changed};
    assert.equal((await send(payload)).status,400);assert.equal(mails,0);
  }
  verdict={success:true,hostname:'eduardshilov.com',action:'booking'};
  const response=await send(payload);assert.equal(response.status,200);assert.equal((await response.json()).delivery,'mail-service-accepted');assert.equal(mails,1);
  assert.equal((await send({...payload,message:'界'.repeat(4000)})).status,200);assert.equal(mails,2);
  const malformed=await worker.fetch(new Request('https://media.example/api/applications',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{'}),settings);
  assert.equal(malformed.status,400);assert.equal(mails,2);
});

test('Social routes reject visitors, other accounts and unverified owners before provider calls',async()=>{
  let providerCalls=0;const worker=createWorker(async url=>{if(url.includes('www.googleapis.com/service_accounts'))return Response.json({keys:[jwk]});providerCalls++;throw Error('Must not reach providers');});
  for(const credential of ['',await jwt({sub:'another-owner'}),await jwt({email_verified:false}),await jwt({exp:0})]){
    const result=await worker.fetch(new Request('https://media.example/api/admin/social',{method:'POST',headers:{Origin:'https://eduardshilov.com','Content-Type':'application/json',Authorization:'Bearer '+credential},body:'{}'}),env);
    assert.equal(result.status,401);assert.equal(result.headers.get('Access-Control-Allow-Origin'),'https://eduardshilov.com');
  }
  assert.equal(providerCalls,0);
});
test('Only the verified owner sees social connection state; credentials are absent',async()=>{
  const worker=createWorker(async()=>Response.json({keys:[jwk]}));
  const result=await worker.fetch(new Request('https://media.example/api/admin/social',{headers:{Origin:'https://eduardshilov.com',Authorization:'Bearer '+await jwt()}}),{...env,TELEGRAM_BOT_TOKEN:'secret-token',TELEGRAM_1_CHANNEL_ID:'@artist_channel'});
  assert.equal(result.status,200);const body=await result.json();assert.equal(body.channels.telegram_1.configured,true);assert.equal(JSON.stringify(body).includes('secret-token'),false);
});

test('Owner-only social route accepts a bounded multipart file without storing its bytes or exposing provider secrets',async()=>{
  const settings={...env,TELEGRAM_BOT_TOKEN:'fixture-server-secret',TELEGRAM_1_CHANNEL_ID:'-1003968794089',SOCIAL_TARGETS:'telegram_1'};let sends=0,claims=0;
  const worker=createWorker(async(url,options)=>{
    if(url.includes('www.googleapis.com/service_accounts'))return Response.json({keys:[jwk]});
    if(url.includes('firestore.googleapis.com')){
      if(url.includes('?documentId=')){claims++;const data=JSON.parse(options.body);assert.equal(data.fields.attachment.mapValue.fields.kind.stringValue,'photo');assert.equal(JSON.stringify(data).includes('raw-photo-content'),false);}
      return Response.json({});
    }
    assert.ok(url.endsWith('/sendPhoto'));assert.ok(options.body instanceof FormData);assert.equal(options.body.get('photo').size,17);sends++;return Response.json({ok:true,result:{message_id:7}});
  });
  const form=()=>{const f=new FormData();f.set('post',JSON.stringify({requestId:crypto.randomUUID(),text:'Публикация',url:'',channels:['telegram_1'],confirmed:true}));f.set('media',new File(['raw-photo-content'],'cover.png',{type:'image/png'}));return f;};
  const denied=await worker.fetch(new Request('https://media.example/api/admin/social',{method:'POST',headers:{Origin:'https://eduardshilov.com'},body:form()}),settings);assert.equal(denied.status,401);assert.equal(claims,0);
  const response=await worker.fetch(new Request('https://media.example/api/admin/social',{method:'POST',headers:{Origin:'https://eduardshilov.com',Authorization:'Bearer '+await jwt()},body:form()}),settings);
  assert.equal(response.status,200);assert.equal(sends,1);const body=await response.json();assert.equal(body.post.attachment.kind,'photo');assert.equal(JSON.stringify(body).includes('fixture-server-secret'),false);
});

test('Upload readiness is owner-only, reports release, and checks the configured reader folder',async()=>{
 clearToken();let folderReads=0;
 const worker=createWorker(async url=>{
  if(url.includes('www.googleapis.com/service_accounts'))return Response.json({keys:[jwk]});
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token'});
  assert.ok(url.includes('/drive/v3/files/publication_folder_1?'));folderReads++;
  return Response.json({id:'publication_folder_1',mimeType:'application/vnd.google-apps.folder'});
 });
 const path='https://media.example/api/admin/readiness';
 assert.equal((await worker.fetch(new Request(path),env)).status,401);assert.equal(folderReads,0);
 const r=await worker.fetch(new Request(path,{headers:{Authorization:'Bearer '+await jwt()}}),{...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount});
 const value=await r.json();assert.equal(r.status,200);assert.equal(value.readerReady,true);assert.equal(value.release,'2026-10-29-studio-4');assert.equal(folderReads,1);
});
test('Reader denial, missing files and upstream outages have distinct diagnostics rather than false pending',async()=>{
 for(const [status,code,expected] of [[403,'DRIVE_READER_FORBIDDEN',403],[404,'DRIVE_FILE_PENDING',409],[500,'DRIVE_READER_UNAVAILABLE',503]]){
  clearToken();const worker=createWorker(async url=>{
   if(url.includes('www.googleapis.com/service_accounts'))return Response.json({keys:[jwk]});
   if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token'});
   return new Response(null,{status});
  });
  const r=await worker.fetch(new Request('https://media.example/api/admin/verify',{method:'POST',headers:{Authorization:'Bearer '+await jwt(),'Content-Type':'application/json'},body:JSON.stringify({id:'uploaded_file_id'})}),{...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount});
  const v=await r.json();assert.equal(r.status,expected);assert.equal(v.code,code);assert.equal(v.upstreamStatus,status);assert.equal(v.stage,'file');
 }
});
test('Owner preview of a hidden song requires authentication and is never publicly cacheable',async()=>{
 clearToken();let reads=0;
 const worker=createWorker(async(url,init)=>{
  if(url.includes('www.googleapis.com/service_accounts'))return Response.json({keys:[jwk]});
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token'});
  if(url.includes('firestore.googleapis.com')){assert.ok(init.headers.Authorization);return Response.json(fields({driveId:'hidden_song_id_1',name:'song.mp3',mime:'audio/mpeg',size:4,published:true,ownerKind:'tracks',ownerId:'hidden_song'}));}
  reads++;return new Response('song',{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}});
 });
 const path='https://media.example/api/admin/media/hidden_song_id_1/song.mp3',settings={...env,DRIVE_SERVICE_ACCOUNT_JSON:serviceAccount};
 assert.equal((await worker.fetch(new Request(path),settings)).status,401);assert.equal(reads,0);
 const r=await worker.fetch(new Request(path,{headers:{Authorization:'Bearer '+await jwt()}}),settings);
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(await r.text(),'song');
});
