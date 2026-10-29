import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DriveUpload} from '../web/drive-upload.mjs';
import {DriveSession,titleFromFile,formatSize,mediaURL,localDate} from '../web/admin-media.mjs';
import {UploadJournal,fileIdentity} from '../web/upload-journal.mjs';
import {RELEASE} from '../web/release.mjs';
import {bindPublication} from '../web/publication-media.mjs';

// Exercise the actual admin controller with provider/DOM boundaries replaced.
// This is not a browser rendering or live Google authorization test.
function fixture({storage=null,restore=false,encoderFails=false}={}){
  if(!storage){const data=new Map();storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
  const nodes=new Map(),html=fs.readFileSync('web/admin.html','utf8');
  class Element{
    constructor(id=''){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.files=[];this.children=[];this.dataset={};this.attrs={};this.events={};this.classList={toggle(){},add(){},remove(){}};}
    get value(){return this._value;}set value(v){this._value=v;if(v===''&&this.type==='file')this.files=[];}
    addEventListener(name,handler){this.events[name]=handler;}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}removeAttribute(k){delete this.attrs[k];}
    set src(v){this.attrs.src=v;}get src(){return this.attrs.src;}
    append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}remove(){}focus(){}scrollIntoView(){}load(){}pause(){}reportValidity(){return true;}closest(){return new Element();}
  }
  for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const [,tag,attrs,id]=match,node=new Element(id);node.tagName=tag;node.type=/\btype="([^"]+)"/.exec(attrs)?.[1];node.defaultChecked=/\bchecked\b/.test(attrs);node.checked=node.defaultChecked;node.hidden=/\bhidden\b/.test(attrs);nodes.set(id,node);
  }
  nodes.get('kind').value='tracks';
  nodes.get('editor').reset=()=>{for(const node of nodes.values())if(['input','textarea'].includes(node.tagName)){node.value='';node.checked=node.defaultChecked;}};
  const kinds=['tracks','videos','photos','news'].map(kind=>{const n=new Element();n.dataset.kind=kind;return n;});
  const filters=['all','published','hidden'].map(filter=>{const n=new Element();n.dataset.filter=filter;return n;});
  const steps=['file','quality','cover','publish'].map(step=>{const n=new Element();n.dataset.step=step;return n;});
  const document={querySelector:q=>q==='.brand img'?new Element():nodes.get(q.slice(1)),querySelectorAll:q=>q==='[data-kind]'?kinds:q==='[data-filter]'?filters:q==='[data-step]'?steps:[],createElement:()=>new Element()};
  const user={uid:'owner',email:'owner@example.com',emailVerified:true,getIdToken:async()=> 'fixture-id-token'},auth={currentUser:restore?user:null};
  let observer,starts=0,puts=0,commits=0,authFailure=true;
  const requests=[],operations=[],providerScopes=[];
  const net=async(url,options={})=>{
    requests.push({url,method:options.method});
    if(url.includes('/generateIds?'))return Response.json({ids:['uploaded_file_id']});
    if(url==='https://media.example/api/admin/readiness')return Response.json({ok:true,readerReady:true,release:RELEASE});
    if(url.startsWith('https://www.googleapis.com/drive/v3/files/'))return Response.json({id:'publication_folder_1',mimeType:'application/vnd.google-apps.folder'});
    if(url.includes('/upload/drive/v3/files')){
      if(options.method==='POST'){starts++;return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=flow'}});}
      if(authFailure){authFailure=false;return new Response(null,{status:401});}
      if(options.headers['Content-Range']==='bytes */3')return new Response(null,{status:308});
      puts++;return Response.json({id:'uploaded_file_id',size:'3'});
    }
    if(url==='https://media.example/api/admin/verify')return Response.json({ok:true,media:{driveId:'uploaded_file_id',name:'Новая_песня.mp3',mime:'audio/mpeg',size:3,published:true}});
    throw Error('Unexpected URL: '+url);
  };
  const sandbox={document,URL,File,Blob,FormData,Date,console,crypto,AbortController,DOMException,Response,Map,Set,Image:Element,location:{href:'https://site.example/admin',origin:'https://site.example'},fetch:net,
    window:{sessionStorage:storage,ED_CLOUD_CONFIG:{adminUid:'owner',workerOrigin:'https://media.example',firebase:{apiKey:'public-key',projectId:'fixture-project'},uploadFolderId:'publication_folder_1'},SITE_IMAGE_MAP:{'/assets/img/branding/RUS.webp':'/media/branding_file_12345/RUS.webp'},addEventListener(){}},
    initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),setPersistence:async()=>{},browserLocalPersistence:{},
    onAuthStateChanged:(a,callback)=>{observer=callback;callback(auth.currentUser);},
    GoogleAuthProvider:class {addScope(scope){providerScopes.push(scope);}setCustomParameters(){}static credentialFromResult(){return {accessToken:'fixture-drive-token'};}},
    signInWithPopup:async()=>{auth.currentUser=user;observer(user);return {};},reauthenticateWithPopup:async()=>{observer(user);return {};},signOut:async()=>{auth.currentUser=null;observer(null);},
    collection:(db,kind)=>kind,doc:(db,kind,id)=>({kind,id}),onSnapshot:(ref,callback)=>{callback({docs:[]});return ()=>{};},
    writeBatch:()=>({set:(ref,value)=>operations.push({ref,value}),commit:async()=>{commits++;}}),updateDoc:async()=>{},setDoc:async()=>{},getDoc:async()=>({exists:()=>false}),
    DriveSession,titleFromFile,formatSize,mediaURL,localDate,bindPublication,UploadJournal,fileIdentity,RELEASE,
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,
    DriveUpload:class extends DriveUpload{constructor(file,folder,token,options){super(file,folder,token,{...options,net});}},
    qualityFiles:async()=>{if(encoderFails)throw Error('Fixture encoder failed');return [];},initSocialComposer:()=>({connect(){},disconnect(){}})
  };
  const context=vm.createContext(sandbox);
  let script=fs.readFileSync('web/admin.mjs','utf8').replace(/^import .*;\n/gm,'');
  script=script.replace("main().catch(error=>status('Студия не подключена. '+(error.code||error.message||'Проверьте настройки Firebase.')));",'globalThis.ready=main();');
  vm.runInContext(script,context);
  return {nodes,context,kinds,filters,requests,operations,providerScopes,stats:()=>({starts,puts,commits})};
}

test('Sign-in connects Drive using the same OAuth result, fills the title, previews the cover and resumes after reauthentication without a duplicate',async()=>{
  const f=fixture();await f.context.ready;await f.nodes.get('login').onclick();
  assert.equal(f.nodes.get('drive-card').dataset.state,'ready');assert.equal(f.nodes.get('connect').hidden,true);
  assert.deepEqual(f.providerScopes,['https://www.googleapis.com/auth/drive.file']);
  const file=new File(['abc'],'Новая_песня.mp3',{type:'audio/mpeg'});f.nodes.get('file').files=[file];f.nodes.get('file').events.change();
  assert.equal(f.nodes.get('title').value,'Новая песня');assert.equal(f.nodes.get('preview-title').textContent,'Новая песня');assert.equal(f.nodes.get('preview-audio').hidden,false);
  const cover=new File(['picture'],'cover.webp',{type:'image/webp'});f.nodes.get('cover').files=[cover];f.nodes.get('cover').events.change();
  assert.ok(f.nodes.get('preview-cover').src.startsWith('blob:'));assert.equal(f.nodes.get('preview-placeholder').hidden,true);
  f.nodes.get('remove-cover').onclick();
  await f.nodes.get('editor').onsubmit({preventDefault(){}});
  assert.equal(f.nodes.get('drive-card').dataset.state,'error');assert.equal(f.nodes.get('save').textContent,'Продолжить загрузку');assert.equal(f.stats().commits,0);
  const id=vm.runInContext('job.id',f.context);await f.nodes.get('connect').onclick();
  // onclick returns a promise; same-owner auth callback must not reset job or input.
  assert.equal(vm.runInContext('job.id',f.context),id);assert.equal(f.nodes.get('file').files[0],file);
  await f.nodes.get('editor').onsubmit({preventDefault(){}});
  assert.deepEqual(f.stats(),{starts:1,puts:1,commits:1});
  const publication=f.operations.find(x=>x.ref.kind==='tracks').value;assert.equal(publication.id,id);assert.equal(publication.title,'Новая песня');assert.equal(publication.audio_mp3,'/media/uploaded_file_id/'+encodeURIComponent('Новая_песня.mp3'));
  assert.equal(f.nodes.get('upload-phase').textContent,'Опубликовано');
});

test('Manual titles stay intact; type navigation and Telegram tab preserve required controls',async()=>{
  const f=fixture();await f.context.ready;await f.nodes.get('login').onclick();
  f.nodes.get('title').value='Моё название';f.nodes.get('file').files=[new File(['abc'],'другое.mp3',{type:'audio/mpeg'})];f.nodes.get('file').events.change();assert.equal(f.nodes.get('title').value,'Моё название');
  f.nodes.get('open-social').onclick();assert.equal(f.nodes.get('social-panel').hidden,false);assert.equal(f.nodes.get('materials-panel').hidden,true);
  f.kinds.find(x=>x.dataset.kind==='videos').onclick();assert.equal(f.nodes.get('kind').value,'videos');assert.equal(f.nodes.get('materials-panel').hidden,false);assert.equal(f.nodes.get('video-type-label').hidden,false);assert.equal(f.nodes.get('quality-label').hidden,true);
});


test('Long audio automatically keeps the original, preserves that setting through text edits and restores quality for a replacement file',async()=>{
  const f=fixture();await f.context.ready;await f.nodes.get('login').onclick();
  const file=new File(['abc'],'long.mp3',{type:'audio/mpeg'});f.nodes.get('file').files=[file];f.nodes.get('file').events.change();
  f.nodes.get('preview-audio').duration=901;f.nodes.get('preview-audio').events.loadedmetadata();
  assert.equal(f.nodes.get('auto-quality').disabled,true);assert.equal(f.nodes.get('auto-quality').checked,false);assert.equal(f.nodes.get('quality-limit').hidden,false);
  f.nodes.get('editor').events.input({target:{id:'title'}});assert.equal(f.nodes.get('auto-quality').disabled,true);
  f.nodes.get('file').files=[new File(['new'],'short.mp3',{type:'audio/mpeg'})];f.nodes.get('file').events.change();assert.equal(f.nodes.get('auto-quality').disabled,false);assert.equal(f.nodes.get('auto-quality').checked,true);
});


test('Reload restores the existing Drive grant without opening Google again or extending its expiry',async()=>{
  const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const first=fixture({storage});await first.context.ready;await first.nodes.get('login').onclick();assert.equal(map.size,1);const saved=[...map.values()][0];
  const reload=fixture({storage,restore:true});await reload.context.ready;await new Promise(setImmediate);assert.equal(reload.nodes.get('drive-card').dataset.state,'ready');assert.equal(reload.providerScopes.length,0);assert.equal([...map.values()][0],saved);
});

test('An encoder failure cannot prevent an uploaded original from being published',async()=>{
  const f=fixture({encoderFails:true});await f.context.ready;await f.nodes.get('login').onclick();f.nodes.get('auto-quality').checked=true;f.nodes.get('file').files=[new File(['abc'],'Новая_песня.mp3',{type:'audio/mpeg'})];f.nodes.get('file').events.change();
  await f.nodes.get('editor').onsubmit({preventDefault(){}});await f.nodes.get('connect').onclick();await f.nodes.get('editor').onsubmit({preventDefault(){}});
  assert.equal(f.stats().commits,1);assert.equal(f.operations.find(x=>x.ref.kind==='tracks').value.published,true);assert.match(f.nodes.get('status').textContent,/Оригинал сохранён/);
});

test('An uncertain Firestore commit reuses the publication ID and already uploaded originals',async()=>{
 const f=fixture();await f.context.ready;await f.nodes.get('login').onclick();
 f.nodes.get('file').files=[new File(['abc'],'song.mp3',{type:'audio/mpeg'})];f.nodes.get('file').events.change();
 await f.nodes.get('editor').onsubmit({preventDefault(){}});await f.nodes.get('connect').onclick();
 const original=f.context.writeBatch;let attempts=0;
 f.context.writeBatch=()=>{const b=original();return {...b,commit:async()=>{attempts++;if(attempts===1)throw Error('Firestore acknowledgement lost');await b.commit();}};};
 await f.nodes.get('editor').onsubmit({preventDefault(){}});const id=vm.runInContext('job.id',f.context);
 assert.equal(f.nodes.get('save').textContent,'Продолжить загрузку');
 await f.nodes.get('editor').onsubmit({preventDefault(){}});
 assert.equal(f.stats().starts,1);assert.equal(f.stats().puts,1);assert.equal(f.stats().commits,1);
 assert.equal(f.operations.filter(x=>x.ref.kind==='tracks').every(x=>x.ref.id===id),true);
});
