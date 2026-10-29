import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {publicConfiguration,readSecrets,readiness,projectId,ownerUid} from '../tools/project-config.mjs';

function complete(){
  const settings={firebase:{projectId,apiKey:'public-key',authDomain:projectId+'.firebaseapp.com',appId:'1:563388255415:web:test'},adminUid:ownerUid,workerOrigin:'https://media.example',uploadFolderId:'publication_folder_1',pickerApiKey:'picker-public-key',googleProjectNumber:'563388255415',turnstileSiteKey:'turnstile-public-key',policyVersion:'current'};
  const worker={vars:{PROJECT_ID:projectId,ADMIN_UID:ownerUid,UPLOAD_FOLDER_ID:settings.uploadFolderId,POLICY_VERSION:'current',ALLOWED_ORIGINS:'https://eduardshilov.com,https://'+projectId+'.web.app',MAIL_RELAY_URL:'https://script.google.com/macros/s/deployment-id/exec',TELEGRAM_1_CHANNEL_ID:'-1003968794089',TELEGRAM_2_CHANNEL_ID:'-1004363648477',VK_TROIKA_GROUP_ID:'1234',VK_EDUARD_GROUP_ID:'5678'}};
  const secrets={FORM_SECRET:'f'.repeat(32),MAIL_RELAY_SECRET:'m'.repeat(32),TURNSTILE_SECRET:'test-turnstile-secret',TELEGRAM_BOT_TOKEN:'test-bot-secret',VK_ACCESS_TOKEN:'test-vk-secret',DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:projectId,client_email:'media-reader@'+projectId+'.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\nfixture-only'})};
  return {settings,worker,secrets};
}
test('A release fails closed on missing services, wrong identity and broad Admin SDK credentials',()=>{
  assert.equal(readiness(complete()).ready,true);
  for(const mutate of [x=>x.settings.adminUid='another-owner',x=>x.worker.vars.PROJECT_ID='other-project',x=>x.settings.pickerApiKey='',x=>x.settings.turnstileSiteKey='',x=>x.secrets.MAIL_RELAY_SECRET='',x=>x.worker.vars.TELEGRAM_2_CHANNEL_ID=x.worker.vars.TELEGRAM_1_CHANNEL_ID,x=>x.secrets.DRIVE_SERVICE_ACCOUNT_JSON=x.secrets.DRIVE_SERVICE_ACCOUNT_JSON.replace('media-reader@','firebase-adminsdk-test@')]){
    const config=complete();mutate(config);assert.equal(readiness(config).ready,false);
  }
});
test('Publishing configuration removes unknown private fields even when nested in Firebase settings',()=>{
  const {settings}=complete();settings.TELEGRAM_BOT_TOKEN='never-in-hosting';settings.adminEmail='owner@example.com';settings.firebase.private_key='private-sentinel';
  const output=JSON.stringify(publicConfiguration(settings));
  for(const value of ['never-in-hosting','owner@example.com','private-sentinel'])assert.equal(output.includes(value),false);
  assert.equal(publicConfiguration(settings).firebase.projectId,projectId);
});
test('Telegram-only releases require both Telegram channels but no VK configuration',()=>{
  const config=complete();config.worker.vars.SOCIAL_TARGETS='telegram_1,telegram_2';
  delete config.worker.vars.VK_TROIKA_GROUP_ID;delete config.worker.vars.VK_EDUARD_GROUP_ID;delete config.secrets.VK_ACCESS_TOKEN;
  const report=readiness(config);assert.equal(report.ready,true);assert.equal(report.checks.some(x=>x.feature==='vk'),false);
  delete config.secrets.TELEGRAM_BOT_TOKEN;assert.equal(readiness(config).ready,false);
  config.worker.vars.SOCIAL_TARGETS='telegram_typo';assert.equal(readiness(config).ready,false);
});
test('Local credentials support escaped reader keys and never expose malformed input in errors',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eduard-secrets-'));
  try{
    fs.mkdirSync(path.join(dir,'worker'));fs.mkdirSync(path.join(dir,'credentials'));
    fs.writeFileSync(path.join(dir,'worker/.dev.vars'),'TELEGRAM_BOT_TOKEN=test-only\n');
    fs.writeFileSync(path.join(dir,'credentials/worker-secrets.json'),JSON.stringify({MAIL_RELAY_SECRET:'m'.repeat(32)}));
    assert.equal(readSecrets(dir).TELEGRAM_BOT_TOKEN,'test-only');assert.equal(readSecrets(dir).MAIL_RELAY_SECRET.length,32);
    fs.writeFileSync(path.join(dir,'credentials/worker-secrets.json'),'private-sentinel-invalid-json');
    assert.throws(()=>readSecrets(dir),error=>!error.message.includes('private-sentinel')&&error.message.includes('Invalid JSON'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Deployment and secret-upload commands only produce plans without an explicit apply flag',()=>{
  for(const action of ['worker','hosting','secrets']){
    const result=spawnSync(process.execPath,['tools/rollout.mjs',action],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Plan only/);assert.match(result.stdout,/No external state changed/);
  }
  const unknown=spawnSync(process.execPath,['tools/rollout.mjs','worker','--unexpected'],{encoding:'utf8'});assert.equal(unknown.status,1);
});
