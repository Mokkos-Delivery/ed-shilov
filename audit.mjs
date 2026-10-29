import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root='migration/source';
const inventory=JSON.parse(fs.readFileSync('migration/media-inventory.json','utf8'));
const exact=new Map(inventory.map(f=>['/'+f.path,f]));
const normal=s=>decodeURIComponent(s).normalize('NFC').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const normalized=new Map();
for(const f of inventory){const key=normal('/'+f.path);if(!normalized.has(key))normalized.set(key,[]);normalized.get(key).push(f);}
function resolve(value){
  if(!value)return null;
  let key;try{key=decodeURIComponent(new URL(value,'https://eduardshilov.com').pathname);}catch{return null;}
  const direct=exact.get(key);if(direct)return {file:direct,match:'exact'};
  const candidates=normalized.get(normal(key))||[];
  return candidates.length===1?{file:candidates[0],match:'normalized'}:null;
}
const tracks=JSON.parse(fs.readFileSync(root+'/assets/tracks.json','utf8'));
const videos=JSON.parse(fs.readFileSync(root+'/videos.json','utf8'));
const trackResults=tracks.map(t=>({id:t.id,title:t.title,sources:['audio_mp3','audio_wav'].filter(k=>t[k]).map(k=>({field:k,path:t[k],driveId:resolve(t[k])?.file.id||null,match:resolve(t[k])?.match||null}))}));
const videoResults=videos.map(v=>({id:v.id,title:v.title,sources:['video1080pUrl','video720pUrl','videoUrl','url'].filter(k=>v[k]).map(k=>({field:k,path:v[k],driveId:resolve(v[k])?.file.id||null,match:resolve(v[k])?.match||null}))}));
const refs=new Set();
for(const name of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){
  const text=fs.readFileSync(path.join(root,name),'utf8');
  for(const match of text.matchAll(/(?:src|poster)="([^"]+)"/g))if(match[1].startsWith('/assets/')||/\.(webp|png|jpg|jpeg)$/i.test(match[1]))refs.add(match[1]);
  for(const match of text.matchAll(/srcset="([^"]+)"/g))for(const value of match[1].split(/,\s+(?=\/)/))refs.add(value.replace(/\s+\d+w\s*$/,''));
}
const mapText=fs.readFileSync(root+'/js/image-map-v6.js','utf8');
const imageMap=JSON.parse(mapText.slice(mapText.indexOf('{'),mapText.lastIndexOf('}')+1));
for(const t of tracks)if(t.cover)refs.add(t.cover);
for(const v of videos)if(v.coverUrl)refs.add(v.coverUrl);
const imageResults=[...refs].map(original=>{
  const mapped=imageMap[original];const found=resolve(mapped)||resolve(original);
  return {original,mapped:mapped||null,driveId:found?.file.id||null,match:found?.match||null};
});
const audio=inventory.filter(f=>f.path.startsWith('assets/audio/tracks/'));
const movie=inventory.filter(f=>f.path.startsWith('assets/video/videos/'));
const report={
  generatedAt:new Date().toISOString(),
  sourceFolder:'https://drive.google.com/drive/folders/1C_cXy9_4GpYrBEhkm0nD2kwhTWbSPCe6',
  rootFolder:'https://drive.google.com/drive/folders/1d_TRJOTrskJsLcr0SlgmywKCUtJR6pxe',
  hostingPlan:'Firebase Spark; no billing upgrade authorized',
  googleSignInVerified:true,googleProjectCreated:false,cloudflareDeployed:false,dnsChanged:false,adminImplemented:true,adminLiveVerified:false,
  sourcePages:fs.readdirSync(root).filter(x=>x.endsWith('.html')),
  audioFiles:audio.length,audioBytes:audio.reduce((n,f)=>n+f.size,0),
  videoFiles:movie.length,videoBytes:movie.reduce((n,f)=>n+f.size,0),
  inspectedMediaEntries:inventory.length,
  inventoryScope:'Complete audio and video folders and inspected image subfolders; only first 200 root images are included, root listing has further pages.',
  tracks:trackResults,videos:videoResults,images:imageResults,
  tracksWithAtLeastOneSource:trackResults.filter(t=>t.sources.some(s=>s.driveId)).length,
  videosWithAtLeastOneSource:videoResults.filter(t=>t.sources.some(s=>s.driveId)).length,
  missingImages:imageResults.filter(x=>!x.driveId),
  files:fs.readdirSync(root).filter(x=>fs.statSync(path.join(root,x)).isFile()).map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')})),
  publicationFolder:'https://drive.google.com/drive/folders/12XvWmddZKZveffm-mc39DpXJLDeVZ2zH',
  dnsNameservers:['ns1.hosting.reg.ru.','ns2.hosting.reg.ru.'],dnsSnapshot:'project/dns-before-migration.json',
  blockers:['Firebase console shows the account project limit; no new project can currently be created.','Cloudflare signup remains blocked by a bot verification page in this cloud browser.','No deployment project, owner UID, Drive reader credential or mail relay is configured.','DNS control panel access is not configured; current NS point to REG.RU hosting.'],
  playbackVerified:false,
};
fs.writeFileSync('migration/audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({pages:report.sourcePages.length,audioFiles:report.audioFiles,videoFiles:report.videoFiles,tracks:tracks.length,tracksWithSource:report.tracksWithAtLeastOneSource,videos:videos.length,videosWithSource:report.videosWithAtLeastOneSource,missingImages:report.missingImages.length,mediaEntries:inventory.length},null,2));
