// Local fixture server: real Worker code, fake Google boundaries, generated media only.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {Readable} from 'node:stream';
import {createWorker} from '../../worker/src/index.mjs';
const root=path.resolve('public'),directory=process.argv[2],port=Number(process.argv[3]||8798);
const audio=fs.readFileSync(directory+'/audio.mp3'),video=fs.readFileSync(directory+'/video.mp4');
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const raw=Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
const env={PROJECT_ID:'playback-fixture',ALLOWED_ORIGINS:'http://127.0.0.1:'+port,DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.invalid',private_key:'-----BEGIN PRIVATE KEY-----\n'+raw+'\n-----END PRIVATE KEY-----'})};
const fields=data=>({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]))});
const requests=[],upstream=[],cacheMap=new Map();
const cache={match:async key=>cacheMap.get(key.url)?.clone(),put:async(key,r)=>{cacheMap.set(key.url,r);}};
const worker=createWorker(async(url,options)=>{
 if(url.includes('/documents/media/')){const id=url.split('/').pop(),isVideo=id.startsWith('video');return Response.json(fields({driveId:id,name:isVideo?'video.mp4':'audio.mp3',mime:isVideo?'video/mp4':'audio/mpeg',size:(isVideo?video:audio).length,published:true}));}
 if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'local-test-token'});
 if(url.includes('www.googleapis.com/drive/')){
  const id=new URL(url).pathname.split('/').pop(),data=id.startsWith('video')?video:audio,range=options.headers.Range;upstream.push({id,range});
  if(!range)return new Response(data,{headers:{'Content-Type':id.startsWith('video')?'video/mp4':'audio/mpeg','Content-Length':String(data.length)}});
  const [,a,b]=/^bytes=(\d+)-(\d*)$/.exec(range),start=Number(a),end=Math.min(Number(b||data.length-1),data.length-1);
  return new Response(data.subarray(start,end+1),{status:206,headers:{'Content-Type':id.startsWith('video')?'video/mp4':'audio/mpeg','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${data.length}`}});
 }
 throw Error('Unexpected fixture network: '+url);
},{cache});
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/__stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({requests,upstream,cacheEntries:cacheMap.size,videoBytes:video.length}));return;}
  if(url.pathname.startsWith('/media/')){
   const response=await worker.fetch(new Request('https://stream.fixture.test'+req.url,{method:req.method,headers:req.headers}),env,{waitUntil:p=>p.catch(()=>{})});requests.push({path:req.url,range:req.headers.range,status:response.status,cache:response.headers.get('X-Media-Cache')});res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
  }
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',mime);fs.createReadStream(file).pipe(res);
 }catch(error){res.writeHead(500);res.end(error.message);}
});server.listen(port,'127.0.0.1',()=>console.log('READY'));
