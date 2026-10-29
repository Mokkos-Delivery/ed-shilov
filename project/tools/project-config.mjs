import fs from 'node:fs';
import path from 'node:path';
import {resolveSocialTarget,socialTargets,enabledSocialTargets} from '../worker/src/social-targets.mjs';

export const projectId='eduard-shilov-site';
export const ownerUid='owner_36405b57fb7c4ae58d8e2e817ec67ead';
export const secretNames=['DRIVE_SERVICE_ACCOUNT_JSON','FORM_SECRET','TURNSTILE_SECRET','MAIL_RELAY_SECRET','TELEGRAM_BOT_TOKEN','TELEGRAM_1_BOT_TOKEN','TELEGRAM_2_BOT_TOKEN','VK_ACCESS_TOKEN','VK_TROIKA_ACCESS_TOKEN','VK_EDUARD_ACCESS_TOKEN'];
export function publicConfiguration(settings){
  const output={firebase:{}};
  for(const key of ['apiKey','authDomain','projectId','appId'])output.firebase[key]=settings.firebase?.[key]||'';
  for(const key of ['adminUid','googleProjectNumber','pickerApiKey','workerOrigin','uploadFolderId','turnstileSiteKey','policyVersion'])output[key]=settings[key]||'';
  return output;
}
export function readJSON(file,fallback){if(!fs.existsSync(file))return fallback;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Invalid JSON file: '+path.basename(file));}}
export function readSecrets(root){
  const secrets={},file=path.join(root,'worker/.dev.vars');
  if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw Error('Invalid local secret file; use one NAME=value per line or credentials/worker-secrets.json.');
    if(!secretNames.includes(match[1]))continue;
    const value=match[2].trim();try{secrets[match[1]]=value.startsWith('"')?JSON.parse(value):value.startsWith("'")&&value.endsWith("'")?value.slice(1,-1):value;}catch{throw Error('Invalid local secret value.');}
  }
  const stored=readJSON(path.join(root,'credentials/worker-secrets.json'),{});
  for(const [key,value] of Object.entries(stored)){
    if(!secretNames.includes(key)||typeof value!=='string')throw Error('Invalid server-secret name or value.');
    secrets[key]=value;
  }
  const reader=path.join(root,'credentials/drive-reader.json');
  if(fs.existsSync(reader))secrets.DRIVE_SERVICE_ACCOUNT_JSON=JSON.stringify(readJSON(reader));
  return secrets;
}
export function localConfiguration(root){return {
  settings:readJSON(path.join(root,'settings.json'),readJSON(path.join(root,'settings.example.json'))),
  worker:readJSON(path.join(root,'worker/wrangler.jsonc'),readJSON(path.join(root,'worker/wrangler.example.jsonc'))),
  secrets:readSecrets(root)
};}
export function readiness({settings,worker,secrets}){
  const checks=[],add=(key,ready,feature)=>checks.push({key,ready:!!ready,feature});
  const origin=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash?url.origin:null;}catch{return null;}};
  const vars=worker.vars||{},origins=String(vars.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
  add('firebaseProject',settings.firebase?.projectId===projectId&&vars.PROJECT_ID===projectId,'site');
  add('ownerUid',settings.adminUid===ownerUid&&vars.ADMIN_UID===ownerUid,'admin');
  add('firebaseWebApp',settings.firebase?.apiKey&&settings.firebase?.appId?.startsWith('1:563388255415:web:')&&settings.firebase?.authDomain===projectId+'.firebaseapp.com','admin');
  add('workerOrigin',origin(settings.workerOrigin),'site');
  add('uploadFolder',/^[A-Za-z0-9_-]{10,160}$/.test(settings.uploadFolderId||'')&&settings.uploadFolderId===vars.UPLOAD_FOLDER_ID,'media');
  add('siteOrigins',origins.includes('https://eduardshilov.com')&&origins.includes('https://'+projectId+'.web.app')&&origins.every(x=>origin(x)===x),'site');
  add('policyVersion',settings.policyVersion&&settings.policyVersion===vars.POLICY_VERSION,'mail');
  add('pickerApiKey',settings.pickerApiKey&&settings.googleProjectNumber==='563388255415','uploads');
  add('turnstileSiteKey',settings.turnstileSiteKey,'mail');
  add('FORM_SECRET',secrets.FORM_SECRET?.length>=24,'mail');
  add('MAIL_RELAY_SECRET',secrets.MAIL_RELAY_SECRET?.length>=24,'mail');
  add('TURNSTILE_SECRET',secrets.TURNSTILE_SECRET,'mail');
  let relay=false;try{const url=new URL(vars.MAIL_RELAY_URL);relay=url.origin==='https://script.google.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);}catch{}
  add('mailRelayUrl',relay,'mail');
  let reader=false;try{const sa=JSON.parse(secrets.DRIVE_SERVICE_ACCOUNT_JSON||'{}');reader=sa.type==='service_account'&&sa.project_id===projectId&&/^[^@]+@eduard-shilov-site\.iam\.gserviceaccount\.com$/.test(sa.client_email)&&!sa.client_email.startsWith('firebase-adminsdk-')&&/^-----BEGIN PRIVATE KEY-----/.test(sa.private_key||'');}catch{}
  add('restrictedDriveReader',reader,'media');
  const targets=Object.keys(socialTargets).map(key=>[key,resolveSocialTarget(key,{...vars,...secrets})]);
  add('enabledSocialTargets',enabledSocialTargets(vars).length>0,'social');
  for(const [key,target] of targets.filter(([,target])=>target.enabled)){add(key+'Id',target.id,key.startsWith('telegram')?'telegram':'vk');add(key+'Credential',target.token,key.startsWith('telegram')?'telegram':'vk');}
  add('distinctSocialDestinations',new Set(targets.filter(([,t])=>t.id).map(([,t])=>t.platform+':'+t.id)).size===targets.filter(([,t])=>t.id).length,'social');
  return {checkedAt:new Date().toISOString(),ready:checks.every(x=>x.ready),enabledSocialTargets:enabledSocialTargets(vars),checks,externalServicesChecked:false,deployed:false};
}
