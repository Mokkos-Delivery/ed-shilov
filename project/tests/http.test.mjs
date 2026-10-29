import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchHeaders,readJSON} from '../worker/src/http.mjs';

test('A stalled control-plane fetch aborts while a returned media stream remains readable',async()=>{
  await assert.rejects(fetchHeaders((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))), 'https://api.example',{},10),/aborted/);
  let signal;
  const response=await fetchHeaders(async(url,options)=>{signal=options.signal;return new Response('streamed-media');},'https://media.example',{},10);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);assert.equal(await response.text(),'streamed-media');
});
test('Oversized and stalled JSON bodies are cancelled before they can consume unbounded resources',async()=>{
  let cancelled=false;
  const oversized=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(20)));},cancel(){cancelled=true;}}));
  await assert.rejects(readJSON(oversized,10),/too large/);assert.equal(cancelled,true);
  const stalled=new Response(new ReadableStream({cancel(){cancelled=true;}}));cancelled=false;
  await assert.rejects(readJSON(stalled,100,10),/timeout/);assert.equal(cancelled,true);
});
test('Control-plane redirects stay manual while explicit relay redirects remain supported',async()=>{
  const redirect=new Response(null,{status:302,headers:{Location:'https://other.example'}});
  assert.equal((await fetchHeaders(async(url,options)=>{assert.equal(options.redirect,'manual');return redirect;},'https://api.example')).status,302);
  await fetchHeaders(async(url,options)=>{assert.equal(options.redirect,'follow');return Response.json({ok:true});},'https://script.google.com',{redirect:'follow'});
});
