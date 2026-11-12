// Copy only already-public static illustrations into content-addressed Hosting assets.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {optimizeImage,loadImageAssets} from './image-assets.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);if(args.some(x=>x!=='--apply'))throw Error('Use --apply to download public illustrations.');
const settings=JSON.parse(fs.readFileSync(root+'/settings.json','utf8')),base=new URL(settings.workerOrigin);
if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Invalid Worker URL');
const origin=base.origin,bootstrap=JSON.parse(fs.readFileSync(root+'/public/catalogue-bootstrap.json','utf8'));
const records=new Map(bootstrap.media.filter(m=>m.published===true&&!m.ownerKind&&/image\/(?:jpeg|png|webp|avif)$/.test(m.mime)&&m.size<=8*1024*1024).map(m=>[m.driveId,m]));
const wanted=new Set();
for(const name of fs.readdirSync(root+'/public').filter(n=>n.endsWith('.html'))){
 for(const tag of fs.readFileSync(root+'/public/'+name,'utf8').matchAll(/<(?:img|video)\b[^>]+>/g)){
  for(const m of tag[0].matchAll(/(?:src|poster|data-media-source)="\/media\/([^/]+)\//g))wanted.add(m[1]);
 }
}
for(const kind of ['tracks','videos','news'])for(const item of bootstrap[kind])for(const key of ['cover','coverUrl']){const m=/^\/media\/([^/]+)\//.exec(item[key]||'');if(m)wanted.add(m[1]);}
const plan=[...wanted].map(id=>records.get(id)).filter(Boolean);
if(!args.includes('--apply')){console.log(JSON.stringify({images:plan.length,inputBytes:plan.reduce((n,m)=>n+m.size,0),changesMade:false}));process.exit(0);}
const dir=root+'/.image-cache',indexFile=dir+'/index.json';fs.mkdirSync(dir,{recursive:true});
let index=fs.existsSync(indexFile)?JSON.parse(fs.readFileSync(indexFile,'utf8')):{origin,images:{}};
if(index.origin!==origin)index={origin,images:{}};
const existing=loadImageAssets(root,origin);let done=0,failed=0;
async function processImage(record){
 const media='/media/'+record.driveId+'/'+encodeURIComponent(record.name);
 if(existing[media]&&index.images[media]?.sourceSize===record.size){done++;return;}
 try{
  const r=await fetch(origin+media,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok||!/^image\//.test(r.headers.get('Content-Type')||''))throw Error('HTTP '+r.status);
  const reader=r.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw Error('Image too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const variants=await optimizeImage(Buffer.concat(chunks),dir);
  index.images[media]={sourceSize:record.size,variants};
  fs.writeFileSync(indexFile,JSON.stringify(index));done++;
  console.log('Images '+done+'/'+plan.length);
 }catch(error){failed++;console.error('Image '+record.driveId+': '+error.message);}
}
let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<plan.length)await processImage(plan[cursor++]);}));
console.log(JSON.stringify({imagesReady:done,failed,cache:'.image-cache',next:'npm run build'}));if(failed)process.exitCode=1;
