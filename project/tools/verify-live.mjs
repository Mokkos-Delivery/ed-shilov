import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {localConfiguration} from './project-config.mjs';
import {RELEASE} from '../web/release.mjs';

export async function verifyLive({settings,manifest,net=fetch,workerOnly=false}){
 const worker=new URL(settings.workerOrigin);
 if(worker.protocol!=='https:'||worker.username||worker.password||worker.pathname!=='/'||worker.search||worker.hash)throw Error('Configure an HTTPS Worker origin.');
 async function get(url){
  const r=await net(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok){await r.body?.cancel();throw Error('Read-only live check: HTTP '+r.status+' at '+new URL(url).pathname);}
  const reader=r.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('Unexpectedly large live asset.');}parts.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return Buffer.concat(parts);
 }
 const health=JSON.parse(await get(worker.origin+'/health'));
 if(health.release!==RELEASE||health.configured!==true)throw Error('Worker release/configuration does not match '+RELEASE+'.');
 if(workerOnly)return {release:RELEASE,workerVerified:true,hostingVerified:false,readOnly:true};
 if(!manifest||manifest.draft||!manifest.deployable||manifest.release!==RELEASE)throw Error('Build with your real settings before comparing Hosting. A draft cannot be published.');
 const site='https://eduard-shilov-site.web.app';
 const remote=JSON.parse(await get(site+'/build-manifest.json?verify='+manifest.assetVersion));
 if(remote.assetVersion!==manifest.assetVersion||remote.release!==RELEASE||remote.draft)throw Error('Hosting build differs from the local release.');
 for(const [name,hash] of Object.entries(manifest.files)){
  if(!/^(admin\.html|assets\/css\/admin\.css|js\/[a-z-]+\.(?:mjs|js))$/.test(name))throw Error('Unexpected manifest path.');
  const actual=createHash('sha256').update(await get(site+'/'+name+'?v='+manifest.assetVersion)).digest('hex');
  if(actual!==hash)throw Error('Published asset differs: '+name);
 }
 return {release:RELEASE,assetVersion:manifest.assetVersion,workerVerified:true,hostingVerified:true,hashedAssets:Object.keys(manifest.files).length,readOnly:true,liveOwnerUploadVerified:false,telegramDeliveryVerified:false};
}
const main=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--worker-only'))throw Error('Use --worker-only or no arguments.');
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),file=root+'/public/build-manifest.json';
 try{const result=await verifyLive({settings:localConfiguration(root).settings,manifest:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null,workerOnly:args.includes('--worker-only')});console.log(JSON.stringify(result,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
