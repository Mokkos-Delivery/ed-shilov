import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import deploy from '../tools/deploy-firestore-rules.cjs';

test('Rules deployment uses only the selected project-owner CLI session and never returns refresh credentials',async()=>{
  let requested=0;
  const Client=class {setCredentials(value){this.credentials=value;}};
  const auth={getProjectDefaultAccount:()=>({user:{email:'wefewfwewfewef853@gmail.com'},tokens:{refresh_token:'fixture-refresh-private'}}),getAccessToken:async(refresh,scopes)=>{requested++;assert.equal(refresh,'fixture-refresh-private');assert.deepEqual(scopes,['https://www.googleapis.com/auth/cloud-platform']);return {access_token:'fixture-access-private'};}};
  const client=await deploy.firebaseCLIClient({auth,Client,version:'15.33.0'});
  assert.deepEqual(client.credentials,{access_token:'fixture-access-private'});assert.equal(requested,1);
  assert.equal(JSON.stringify(client).includes('fixture-refresh-private'),false);
  const wrong={...auth,getProjectDefaultAccount:()=>({user:{email:'other@example.com'},tokens:{refresh_token:'other-private'}})};
  await assert.rejects(deploy.firebaseCLIClient({auth:wrong,Client,version:'15.33.0'}),{code:'FIREBASE_CLI_ACCOUNT_MISMATCH'});
  await assert.rejects(deploy.firebaseCLIClient({auth,Client,version:'99.0.0'}),{code:'FIREBASE_CLI_VERSION_MISMATCH'});
  assert.equal(requested,1);
});

test('Rules preflight refuses unknown rules; apply preserves old source and verifies the live release before proof',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eduard-rules-'));
  const project='eduard-shilov-site',owner='owner_36405b57fb7c4ae58d8e2e817ec67ead',oldSource='known previous rules';
  const content="rules_version = '2'; // '"+owner+"'\nservice cloud.firestore { match /databases/{db}/documents { match /{doc=**} { allow read, write: if false; } } }";
  const sha=text=>createHash('sha256').update(text).digest('hex');
  let active='projects/'+project+'/rulesets/previous',source=oldSource,mutations=0;
  const client={async request({url,method='GET',data}){
    if(method==='POST'){mutations++;assert.equal(data.source.files[0].content,content);return {data:{name:'projects/'+project+'/rulesets/current'}};}
    if(method==='PATCH'){mutations++;active=data.release.rulesetName;source=content;return {data:{}};}
    if(url.endsWith('/releases/cloud.firestore'))return {data:{rulesetName:active}};
    return {data:{source:{files:[{content:source}]}}};
  }};
  try{
    fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({firebase:{projectId:project},adminUid:owner}));
    fs.writeFileSync(path.join(root,'firestore.generated.rules'),content);
    fs.writeFileSync(path.join(root,'firestore-deployment.json'),JSON.stringify({project,ownerUid:owner,rulesetName:active,sha256:sha(oldSource)}));
    const options={root,client,print:()=>{}};
    await deploy.main({...options,args:['--firebase-cli']});assert.equal(mutations,0);
    source='unknown changed rules';await assert.rejects(deploy.main({...options,args:['--firebase-cli','--apply']}),/custom rules require review/);assert.equal(mutations,0);
    source=oldSource;await deploy.main({...options,args:['--firebase-cli','--apply']});assert.equal(mutations,2);
    assert.equal(fs.readFileSync(path.join(root,'firestore.previous.rules'),'utf8'),oldSource);
    const proof=JSON.parse(fs.readFileSync(path.join(root,'firestore-deployment.json'),'utf8'));
    assert.equal(proof.sha256,sha(content));assert.equal(proof.deployedSourceMatches,true);assert.equal(proof.rulesetName,active);
    await deploy.main({...options,args:['--firebase-cli','--apply']});assert.equal(mutations,2);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
