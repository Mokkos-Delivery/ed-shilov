import test from 'node:test';
import assert from 'node:assert/strict';

test('Hosting routes Cyrillic/space filenames by immutable media ID and preserves the attachment query',async()=>{
  const path='/media/public_file_123/'+encodeURIComponent('Ах, какая женщина.mp4')+'?download=1';
  const response=await fetch('http://127.0.0.1:5088'+path,{redirect:'manual'});
  assert.equal(response.status,302);
  const target=new URL(response.headers.get('Location'));assert.equal(target.origin,'https://media.example');assert.equal(target.pathname.split('/')[2],'public_file_123');assert.equal(target.searchParams.get('download'),'1');
  // Hosting may re-encode punctuation in the cosmetic filename; the gateway uses the ID.
  // The real download filename is supplied from verified metadata in Content-Disposition.
});
test('Main CSS and player JavaScript are served as assets instead of an HTML rewrite',async()=>{
  for(const [url,mime] of [['/assets/css/site-v10.css?v=10','text/css'],['/js/site-v10.js?v=migration1','javascript']]){
    const response=await fetch('http://127.0.0.1:5088'+url);assert.equal(response.status,200);assert.ok(response.headers.get('Content-Type').includes(mime));assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  }
});
