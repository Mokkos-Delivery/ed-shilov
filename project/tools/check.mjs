import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validMedia} from '../worker/src/core.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),publicDir=root+'/public',source=path.resolve(root,'../source');
const data=JSON.parse(fs.readFileSync(publicDir+'/catalogue-bootstrap.json','utf8'));
const media=new Map(data.media.map(x=>[x.driveId,x]));
let pages=0,refs=0,totalBytes=0;
const failures=[];
function localRef(value,file){
  if(!value.startsWith('/'))return;const url=new URL(value,'https://eduardshilov.com');
  if(url.pathname.startsWith('/media/')){const id=url.pathname.split('/')[2];if(!media.has(id))failures.push(file+': unknown media '+id);}
  else if(url.pathname!=='/'&&!fs.existsSync(publicDir+decodeURIComponent(url.pathname)))failures.push(file+': missing '+url.pathname);
  refs++;
}
const stripHead=s=>(s.match(/<head[^>]*>([\s\S]*?)<\/head>/)?.[1]||'').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
for(const name of fs.readdirSync(publicDir).filter(n=>n.endsWith('.html'))){
  pages++;const html=fs.readFileSync(publicDir+'/'+name,'utf8');
  for(const match of html.matchAll(/\b(?:src|poster|href|data-photo)="([^"]+)"/g))localRef(match[1],name);
  for(const match of html.matchAll(/srcset="([^"]+)"/g))for(const part of match[1].split(', '))localRef(part.replace(/\s+\d+(?:w|x)$/,''),name);
  const original=source+'/'+name;if(fs.existsSync(original))assert.equal(stripHead(html),stripHead(fs.readFileSync(original,'utf8')),'Metadata changed: '+name);
}
for(const record of data.media)assert.equal(validMedia(record,record.driveId),true,'Invalid public media '+record.driveId);
for(const t of data.tracks){assert.ok(t.audio_mp3||t.audio_wav,'Track without source');localRef(t.cover,t.id);localRef(t.audio_mp3,t.id);localRef(t.audio_wav,t.id);}
for(const v of data.videos){assert.ok(v.video1080pUrl||v.video720pUrl||v.videoUrl||v.url,'Video without source');localRef(v.coverUrl,v.id);for(const key of ['video1080pUrl','video720pUrl','videoUrl','url'])if(v[key])localRef(v[key],v.id);}
for(const n of data.news)localRef(n.cover,n.id);
function inspect(dir){for(const name of fs.readdirSync(dir)){const file=dir+'/'+name;if(fs.statSync(file).isDirectory())inspect(file);else{totalBytes+=fs.statSync(file).size;if(/\.(?:mjs|js)$/.test(name))execFileSync(process.execPath,['--check',file],{stdio:'pipe'});assert.ok(!/\.(?:mp3|wav|mp4|webm|mov|php|bat|py)$/i.test(name),'Unexpected server/private/media file in Hosting: '+file);}}}
inspect(publicDir);
const options=fs.readFileSync(publicDir+'/js/site-options-v7.js','utf8');assert.match(options,/enabled: false/);
const script=fs.readFileSync(publicDir+'/js/site-v10.js','utf8');assert.equal(script.includes('.php'),false);assert.match(script,/async function openRingtone|function openRingtone/);assert.match(script,/setPointerCapture/);assert.match(script,/downloadOriginal/);
assert.match(fs.readFileSync(publicDir+'/assets/css/site-v10.css','utf8'),/@keyframes/);
assert.deepEqual(JSON.parse(fs.readFileSync(root+'/firebase.json','utf8')).hosting.rewrites,undefined,'Paid backend must not be added');
if(failures.length)throw Error(failures.join('\n'));
const report={checkedAt:new Date().toISOString(),pages,checkedReferences:refs,metadataPreserved:true,tracks:data.tracks.length,videos:data.videos.length,publishedMedia:data.media.length,hostingBytes:totalBytes,phpRemoved:true,adsEnabled:false,browserVisualVerified:false,livePlaybackVerified:false,emailDeliveryVerified:false,firebaseDeployed:false,cloudflareDeployed:false,dnsChanged:false};
fs.writeFileSync(root+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
