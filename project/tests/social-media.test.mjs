import test from 'node:test';
import assert from 'node:assert/strict';
import {socialMultipart,attachmentMetadata,videoLimit} from '../worker/src/social-media.mjs';

test('Multipart parsing keeps the file out of JSON and rejects extra fields and oversized bodies',async()=>{
  const form=new FormData();form.set('post',JSON.stringify({text:'Публикация'}));form.set('media',new File(['picture'],'cover.png',{type:'image/png'}));
  const parse=()=>socialMultipart(new Request('https://worker.example/api/admin/social',{method:'POST',body:form}));
  const parsed=await parse();assert.equal(parsed.body.text,'Публикация');assert.equal(parsed.file.size,7);assert.equal((await attachmentMetadata(parsed.file)).kind,'photo');
  form.set('chat_id','@attacker');await assert.rejects(parse(),/файл публикации/);
  await assert.rejects(socialMultipart(new Request('https://worker.example',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test','Content-Length':String(videoLimit+65537)},body:'test'})),/слишком большое/);
});
