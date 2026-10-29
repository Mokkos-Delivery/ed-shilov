import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {localConfiguration,readJSON,readiness,projectId,ownerUid} from './project-config.mjs';
import {socialTargets} from '../worker/src/social-targets.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [action='doctor',...args]=process.argv.slice(2),apply=args.includes('--apply');
const save=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.chmodSync(file,0o600);};
function run(bin,args,options={}){
  const result=spawnSync(process.execPath,[path.join(root,bin),...args],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:options.input?'pipe':'inherit',encoding:'utf8',...options});
  // Secret uploads never echo provider output, request bodies or local credentials.
  if(result.error||result.status!==0)throw Error('Command failed ('+(result.status??'start')+'): '+path.basename(bin));
}
try{
  if(action==='configure'){
    const pairs={'--social-targets':'SOCIAL_TARGETS','--worker-origin':'workerOrigin','--picker-api-key':'pickerApiKey','--turnstile-site-key':'turnstileSiteKey','--vk-troika-id':'VK_TROIKA_GROUP_ID','--vk-eduard-id':'VK_EDUARD_GROUP_ID'};
    const config=localConfiguration(root);
    for(let i=0;i<args.length;i++){
      if(args[i]==='--init')continue;
      const key=pairs[args[i]],value=args[++i];if(!key||!value)throw Error('Unknown configuration argument or missing value.');
      if(key==='SOCIAL_TARGETS'){const keys=value.split(',').map(x=>x.trim());if(keys.some(x=>!socialTargets[x])||new Set(keys).size!==keys.length)throw Error('Select known, distinct social targets.');config.worker.vars.SOCIAL_TARGETS=keys.join(',');}
      else if(key.startsWith('VK_')){if(!/^[1-9]\d{0,18}$/.test(value))throw Error('VK ID must be a positive integer.');config.worker.vars[key]=value;}
      else if(key==='workerOrigin'){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Worker origin must be an HTTPS origin.');config.settings[key]=url.origin;}
      else config.settings[key]=value;
    }
    if(config.settings.firebase?.projectId!==projectId||config.settings.adminUid!==ownerUid||config.worker.vars?.PROJECT_ID!==projectId||config.worker.vars?.ADMIN_UID!==ownerUid)throw Error('Unexpected project or owner.');
    if(args.includes('--init'))for(const key of ['FORM_SECRET','MAIL_RELAY_SECRET'])if(!config.secrets[key])config.secrets[key]=randomBytes(32).toString('base64url');
    save(path.join(root,'settings.json'),config.settings);save(path.join(root,'worker/wrangler.jsonc'),config.worker);
    if(args.includes('--init'))save(path.join(root,'credentials/worker-secrets.json'),config.secrets);
    console.log('Local configuration prepared. No deployment or account changes. Secret values are not printed.');
  }else if(action==='doctor'){
    if(args.some(x=>x!=='--strict'))throw Error('Unknown argument.');
    const report=readiness(localConfiguration(root));save(path.join(root,'deployment-readiness.json'),report);
    for(const check of report.checks)console.log((check.ready?'OK      ':'MISSING ')+check.feature+': '+check.key);
    console.log(report.ready?'Local configuration complete; live checks still required.':'Configure missing fields before deployment. No external services were called.');
    if(args.includes('--strict')&&!report.ready)process.exitCode=1;
  }else if(['worker','secrets','hosting'].includes(action)){
    if(args.some(x=>x!=='--apply'))throw Error('Unknown argument.');
    if(!apply){console.log('Plan only: '+action+'. To execute later, add --apply. No external state changed.');}
    else{
      const config=localConfiguration(root),report=readiness(config);
      if(!report.ready)throw Error('Missing configuration: '+report.checks.filter(x=>!x.ready).map(x=>x.key).join(', '));
      if(action==='worker')run('node_modules/wrangler/bin/wrangler.js',['deploy','--config','worker/wrangler.jsonc']);
      if(action==='secrets')run('node_modules/wrangler/bin/wrangler.js',['secret','bulk','--config','worker/wrangler.jsonc'],{input:JSON.stringify(config.secrets)});
      if(action==='hosting'){
        run('tools/build.mjs',[]);run('tools/check.mjs',[]);
        const proof=readJSON(path.join(root,'firestore-deployment.json'),{});
        const hash=createHash('sha256').update(fs.readFileSync(path.join(root,'firestore.generated.rules'))).digest('hex');
        if(proof.project!==projectId||proof.ownerUid!==ownerUid||proof.sha256!==hash||!proof.deployedSourceMatches)throw Error('Publish and verify the current Firestore rules first.');
        run('node_modules/firebase-tools/lib/bin/firebase.js',['deploy','--only','hosting','--project',projectId]);
      }
    }
  }else if(action==='bundle'){
    if(args.length)throw Error('Unknown argument.');
    run('node_modules/wrangler/bin/wrangler.js',['deploy','--dry-run','--config','worker/wrangler.example.jsonc','--outdir','../build/worker']);
  }else if(action==='smoke'){
    if(args.length)throw Error('Unknown argument.');
    const {settings}=localConfiguration(root),base=new URL(settings.workerOrigin);
    if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Configure a valid HTTPS Worker origin.');
    const headers={Origin:'https://'+projectId+'.web.app'},net=(url,options={})=>fetch(url,{headers,...options,redirect:'error',signal:AbortSignal.timeout(15000)});
    const health=await net(base.origin+'/health');if(!health.ok||(await health.json()).configured!==true)throw Error('Worker media configuration is incomplete.');
    if(health.headers.get('Access-Control-Allow-Origin')!==headers.Origin)throw Error('Worker CORS did not match.');
    const protectedRoute=await net(base.origin+'/api/admin/social');if(protectedRoute.status!==401)throw Error('Admin access check failed.');await protectedRoute.body?.cancel();
    const catalogue=readJSON(path.join(root,'public/catalogue-bootstrap.json')),media=catalogue.tracks[0].audio_mp3||catalogue.tracks[0].audio_wav;
    const response=await net(base.origin+media,{method:'HEAD'});if(!response.ok||!response.headers.get('Content-Type')?.startsWith('audio/')||!(Number(response.headers.get('Content-Length'))>0))throw Error('Public media HEAD check failed.');
    console.log('Read-only checks passed: health, CORS, admin denial, audio metadata. No posts or email sent.');
  }else throw Error('Unknown action. Use configure, doctor, bundle, worker, secrets, hosting or smoke.');
}catch(error){console.error(error.message);process.exitCode=1;}
