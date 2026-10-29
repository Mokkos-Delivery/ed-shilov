import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

let processHandle;
const base='http://127.0.0.1:8791';
before(async()=>{
  processHandle=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--ip','127.0.0.1','--port','8791','--inspector-port','0','--config','worker/wrangler.example.jsonc'],{stdio:'ignore',detached:process.platform!=='win32',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  const end=Date.now()+30000;
  while(Date.now()<end){
    if(processHandle.exitCode!==null)throw Error('Local Worker exited before startup.');
    try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(500)});if(r.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('Local Worker startup timed out.');
});
after(()=>{if(processHandle?.pid)try{process.kill(process.platform==='win32'?processHandle.pid:-processHandle.pid,'SIGTERM');}catch{}});
test('The built Worker runs in workerd with working health and CORS responses',async()=>{
  const r=await fetch(base+'/health',{headers:{Origin:'https://eduard-shilov-site.web.app'}});
  assert.equal(r.status,200);assert.equal((await r.json()).billingRequired,false);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://eduard-shilov-site.web.app');
  const preflight=await fetch(base+'/api/admin/social',{method:'OPTIONS',headers:{Origin:'https://eduard-shilov-site.web.app','Access-Control-Request-Method':'POST'}});
  assert.equal(preflight.status,204);assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
});
test('Real Worker runtime rejects unauthenticated publishing and unapproved origins',async()=>{
  const denied=await fetch(base+'/api/admin/social',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,401);
  const origin=await fetch(base+'/health',{headers:{Origin:'https://attacker.example'}});assert.equal(origin.status,403);
  const mail=await fetch(base+'/api/applications',{headers:{Origin:'https://eduard-shilov-site.web.app'}});assert.equal(mail.status,503);
});
test('Real runtime reads linked media, signs Drive auth, streams Range and handles HEAD without following redirects',async()=>{
  const {build}=await import('esbuild'),{Miniflare,convertV4MiniflareOptions}=await import('miniflare');
  const bundle=await build({entryPoints:['tests/fixtures/runtime-media.mjs'],bundle:true,format:'esm',platform:'browser',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({name:'media-regression',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13'}));
  try{
    const get=await runtime.dispatchFetch('https://test.example/media');assert.equal(get.status,206);assert.equal(get.headers.get('Content-Range'),'bytes 0-0/4');assert.equal(await get.text(),'s');
    const head=await runtime.dispatchFetch('https://test.example/media',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'4');assert.equal(await head.text(),'');
    const redirect=await runtime.dispatchFetch('https://test.example/redirect');assert.equal(redirect.status,503);await redirect.body?.cancel();
    const form=new FormData();form.set('post',JSON.stringify({text:'Фото'}));form.set('media',new File(['image'],'cover.png',{type:'image/png'}));
    const encoded=new Request('https://test.example/multipart',{method:'POST',body:form});const media=await runtime.dispatchFetch('https://test.example/multipart',{method:'POST',headers:Object.fromEntries(encoded.headers),body:await encoded.arrayBuffer()});const mediaText=await media.text();assert.equal(media.status,200,mediaText);assert.deepEqual(JSON.parse(mediaText),{kind:'photo',name:'cover.png',size:5,caption:'Фото'});
  }finally{await runtime.dispose();}
});
