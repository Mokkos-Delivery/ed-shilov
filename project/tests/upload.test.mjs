import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveUpload as NativeUpload,receivedOffset} from '../web/drive-upload.mjs';

class DriveUpload extends NativeUpload {
 constructor(file,folder,token,{net,...options}){
  const id=net.name==='nativeLikeFetch'?'receiver_file_1':'uploaded_file_id';
  super(file,folder,token,{...options,net:function(url,init){if(url.includes('/generateIds?'))return Promise.resolve(Response.json({ids:[id]}));return Reflect.apply(net,globalThis,[url,init]);}});
 }
}

test('A browser fetch implementation receives its global receiver rather than the upload object',async()=>{
  const file=new File(['abc'],'song.mp3',{type:'audio/mpeg'});
  function nativeLikeFetch(url,options){assert.equal(this,globalThis,'Window.fetch rejects a DriveUpload receiver');return Promise.resolve(options.method==='POST'?new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=receiver-test'}}):Response.json({id:'receiver_file_1',size:'3'}));}
  const upload=new DriveUpload(file,'publication_folder_1',()=> 'test-token',{net:nativeLikeFetch});
  assert.equal((await upload.run()).id,'receiver_file_1');
});

test('Interrupted chunks resume from the acknowledged byte, preserving the original size',async()=>{
  const file=new File([new Uint8Array(9*1024*1024)],'song.wav',{type:'audio/wav'}),requests=[];
  let chunks=0;
  const net=async(url,options)=>{
    requests.push({url,method:options.method,range:options.headers['Content-Range']});
    if(options.method==='POST')return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test'}});
    if(++chunks===1)return new Response(null,{status:308,headers:{Range:'bytes=0-4194303'}});
    return Response.json({id:'uploaded_file_id',size:String(file.size)});
  };
  const upload=new DriveUpload(file,'publication_folder_1',()=> 'test-token',{net});
  const result=await upload.run();assert.equal(result.id,'uploaded_file_id');
  assert.equal(requests[1].range,'bytes 0-8388607/9437184');assert.equal(requests[2].range,'bytes 4194304-9437183/9437184');
});
test('A retry in the same tab checks server progress and does not create a second Drive file',async()=>{
  const file=new File(['abcde'],'clip.mp4',{type:'video/mp4'});let starts=0,calls=0;
  const net=async(url,options)=>{
    if(options.method==='POST'){starts++;return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});}
    if(++calls===1)return new Response(null,{status:401});
    if(options.headers['Content-Range']==='bytes */5')return new Response(null,{status:308,headers:{Range:'bytes=0-2'}});
    assert.equal(options.headers['Content-Range'],'bytes 3-4/5');return Response.json({id:'uploaded_file_id',size:'5'});
  };
  const upload=new DriveUpload(file,'publication_folder_1',()=> 'test-token',{net});
  await assert.rejects(upload.run(),/подключение/);const result=await upload.run();assert.equal(starts,1);assert.equal(result.size,'5');
});
test('A wrong upload size or an off-provider session URL never reports success',async()=>{
  const file=new File(['abc'],'photo.png',{type:'image/png'});
  const malicious=new DriveUpload(file,'publication_folder_1',()=> 'token',{net:async()=>new Response(null,{headers:{Location:'https://evil.example/upload'}})});
  await assert.rejects(malicious.run(),/адрес/);
  let first=true;const incorrect=new DriveUpload(file,'publication_folder_1',()=> 'token',{net:async()=>{if(first){first=false;return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});}return Response.json({id:'file_123456',size:'2'});}});
  await assert.rejects(incorrect.run(),/Размер/);
  await assert.rejects(incorrect.run(),/Размер/);
  assert.throws(()=>receivedOffset('bytes=0-100',30));
});

test('A lost create response retries the same preallocated ID, never a second Drive identity',async()=>{
  const ids=[],file=new File(['abc'],'song.mp3',{type:'audio/mpeg'});let checkpoint;
  const net=async(url,options)=>{
    if(url.includes('/generateIds?'))return Response.json({ids:['durable_file_id_1']});
    if(url.includes('/drive/v3/files/durable_file_id_1'))return new Response(null,{status:404});
    if(options.method==='POST'){ids.push(JSON.parse(options.body).id);if(ids.length===1)throw TypeError('POST response lost');return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture'}});}
    return Response.json({id:'durable_file_id_1',size:'3'});
  };
  const first=new NativeUpload(file,'publication_folder_1',()=> 'fixture',{net,checkpoint:s=>checkpoint=s});
  await assert.rejects(first.run(),/response lost/);
  // Reload: no resumable URL or OAuth token is persisted in the checkpoint.
  assert.deepEqual(checkpoint,{fileId:'durable_file_id_1',completed:null});
  const restored=new NativeUpload(file,'publication_folder_1',()=> 'fixture',{net,saved:checkpoint});
  assert.equal((await restored.run()).id,'durable_file_id_1');assert.deepEqual(ids,['durable_file_id_1','durable_file_id_1']);
});
test('A completed upload with a lost final acknowledgement is recovered by ID without any POST',async()=>{
  let creates=0;
  const uploader=new NativeUpload(new File(['abc'],'song.mp3',{type:'audio/mpeg'}),'publication_folder_1',()=> 'fixture',{
    saved:{fileId:'durable_file_id_1'},net:async(url,init)=>{if(init.method==='POST')creates++;return Response.json({id:'durable_file_id_1',size:'3'});}
  });
  assert.equal((await uploader.run()).id,'durable_file_id_1');assert.equal(creates,0);
});
test('Storage failure stops the upload before a Drive create request',async()=>{
  let creates=0;
  const uploader=new NativeUpload(new File(['abc'],'song.mp3',{type:'audio/mpeg'}),'publication_folder_1',()=> 'fixture',{
    checkpoint:()=>{throw Error('storage disabled');},net:async(url,init)=>{if(init.method==='POST')creates++;return Response.json({ids:['durable_file_id_1']});}
  });
  await assert.rejects(uploader.run(),/storage disabled/);assert.equal(creates,0);
});
