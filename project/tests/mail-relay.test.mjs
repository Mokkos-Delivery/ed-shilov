import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';

function relay(){
  const properties={MAIL_RELAY_SECRET:'test-secret'},sent=[];let locked=false;
  const context=vm.createContext({
    LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>locked=false})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key],setProperty:(key,value)=>properties[key]=value,getProperties:()=>({...properties}),deleteProperty:key=>delete properties[key]})},
    Utilities:{base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),computeHmacSha256Signature:(text,secret)=>createHmac('sha256',secret).update(text).digest(),base64DecodeWebSafe:value=>Buffer.from(value,'base64url'),newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8')})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:value=>({setMimeType:()=>JSON.parse(value)})},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:message=>sent.push(message)}
  });vm.runInContext(fs.readFileSync('mail-relay/Code.gs','utf8'),context);
  const data={requestId:'test_request_12345',consent:true,name:'Посетитель',email:'visitor@example.com',phone:'',city:'',date:'',message:'Концерт',policyVersion:'current',to:'attacker@example.com'};
  const payload=Buffer.from(JSON.stringify(data)).toString('base64url'),timestamp=Date.now(),signature=createHmac('sha256','test-secret').update(timestamp+'.'+payload).digest('base64url');
  const envelope={payload,timestamp,signature};
  return {context,sent,properties,envelope,send:body=>context.doPost({postData:{contents:JSON.stringify(body)}})};
}
test('The mail relay fixes the recipient and avoids a duplicate on ordinary retries',()=>{
  const {send,sent,properties,envelope}=relay();assert.equal(send(envelope).ok,true);assert.equal(send(envelope).ok,true);assert.equal(sent.length,1);assert.equal(sent[0].to,'troikaband@mail.ru');assert.equal(sent[0].replyTo,'visitor@example.com');assert.ok(!Object.values(properties).some(v=>String(v).includes('Концерт')));
});
test('Unsigned and stale relay requests cannot send email',()=>{
  const {send,sent,envelope}=relay();assert.equal(send({...envelope,signature:'invalid'}).ok,false);assert.equal(send({...envelope,timestamp:0}).ok,false);assert.equal(sent.length,0);
});

function signed(payload,timestamp=Date.now()){
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {payload:encoded,timestamp,signature:createHmac('sha256','test-secret').update(timestamp+'.'+encoded).digest('base64url')};
}
test('Long multibyte applications reach the mail relay without truncation',()=>{
  const r=relay(),data=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString('utf8'));
  data.message='界'.repeat(4000);const envelope=signed(data);
  assert.ok(envelope.payload.length>16000);assert.equal(r.send(envelope).ok,true);assert.equal(r.sent.length,1);assert.ok(r.sent[0].body.includes(data.message));
});
test('Even correctly signed envelopes require a finite timestamp and bounded field lengths',()=>{
  const r=relay(),data=JSON.parse(Buffer.from(r.envelope.payload,'base64url').toString('utf8'));
  for(const timestamp of [null,'not-a-timestamp',String(Date.now())])assert.equal(r.send(signed(data,timestamp)).ok,false);
  assert.equal(r.send(signed({...data,message:'x'.repeat(4001)})).ok,false);assert.equal(r.sent.length,0);
});
