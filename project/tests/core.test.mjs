import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeValid,contentDisposition,validMedia,validateApplication} from '../worker/src/core.mjs';

test('Single-byte ranges allow seeking; malformed/multiple ranges are rejected',()=>{
  for(const range of [null,'bytes=0-1023','bytes=2000-','bytes=-1024'])assert.equal(rangeValid(range),true);
  for(const range of ['bytes=50-20','bytes=-0','bytes=-','bytes=0-1,3-4','bytes=9007199254740992-','items=0-2'])assert.equal(rangeValid(range),false);
});
test('Download headers safely preserve Cyrillic names and cannot inject headers',()=>{
  const header=contentDisposition('Песня\r\nX-Test: yes.mp3',true);
  assert.match(header,/^attachment;/);assert.equal(header.includes('\r'),false);assert.equal(header.includes('\n'),false);assert.match(header,/filename\*=UTF-8''%D0/);
});
test('Only explicitly published supported media can pass the gateway',()=>{
  const record={driveId:'published_file_1',name:'song.mp3',mime:'audio/mpeg',size:1024,published:true};
  assert.equal(validMedia(record,record.driveId),true);
  for(const invalid of [{...record,published:false},{...record,mime:'text/html'},{...record,mime:'image/svg+xml'},{...record,size:0},{...record,driveId:'another_file_1'}])assert.equal(validMedia(invalid,record.driveId),false);
});
test('Enquiries require separate consent/current policy and reject oversized or injected fields',()=>{
  const valid={requestId:'request_123456',policyVersion:'current',consent:true,website:'',name:'Посетитель',email:'visitor@example.com',phone:'',city:'',date:'',message:'Выступление'};
  assert.ok(validateApplication(valid,'current'));
  for(const invalid of [{...valid,consent:false},{...valid,policyVersion:'old'},{...valid,email:'x@example.com\nBcc: another@example.com'},{...valid,message:'x'.repeat(4001)},{...valid,website:'spam'}])assert.equal(validateApplication(invalid,'current'),null);
});
