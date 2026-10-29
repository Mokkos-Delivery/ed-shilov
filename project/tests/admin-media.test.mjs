import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveSession,mediaURL,titleFromFile,formatSize} from '../web/admin-media.mjs';

test('Cover and audio paths use the Worker, reject external credential-bearing URLs and preserve encoded names',()=>{
  const worker='https://media.example',site='https://site.example',path='/media/drive_file_12345/%D0%9F%D0%B5%D1%81%D0%BD%D1%8F.mp3';
  assert.equal(mediaURL(path,worker,site),worker+path);
  assert.equal(mediaURL(site+path,worker,site),worker+path);
  for(const value of ['javascript:alert(1)','https://foreign.example'+path,'/api/admin/social','https://private:token@media.example'+path])assert.equal(mediaURL(value,worker,site),'');
});
test('Drive authorization survives same-owner auth events but expires on signout or account switch; stale folder checks cannot reconnect',()=>{
  const session=new DriveSession();session.setOwner('owner');const generation=session.begin('owner','access-token');
  session.setOwner('owner');assert.equal(session.finish(generation),true);assert.equal(session.token(),'access-token');
  session.clear();assert.throws(()=>session.token());const stale=session.begin('owner','second-token');session.setOwner('other');
  assert.equal(session.finish(stale),false);assert.throws(()=>session.begin('owner','wrong-token'));assert.equal(session.accessToken,'');
  session.setOwner('');assert.equal(session.ready,false);
});
test('File names become editable titles without losing Unicode; large titles stay within publication limits',()=>{
  assert.equal(titleFromFile('Дорогой_длинною.wav'),'Дорогой длинною');assert.equal(titleFromFile('Релиз.v2.MP3'),'Релиз.v2');assert.equal(titleFromFile('a'.repeat(400)+'.wav').length,300);
  assert.equal(formatSize(1048576),'1.0 МБ');assert.equal(formatSize(NaN),'');
});


test('Stored Drive grants expire and are removed on explicit signout or owner changes',()=>{
  let now=1000;const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const first=new DriveSession({storage,now:()=>now});first.setOwner('owner');first.finish(first.begin('owner','token'));
  const second=new DriveSession({storage,now:()=>now});second.setOwner('owner');const saved=second.saved('owner');assert.equal(saved.accessToken,'token');
  second.finish(second.begin('owner',saved.accessToken,saved.expiresAt));now=saved.expiresAt+1;assert.throws(()=>second.token(),{code:'DRIVE_AUTH_REQUIRED'});assert.equal(map.size,0);
  second.finish(second.begin('owner','new-token'));second.setOwner('another');assert.equal(map.size,0);
});
