import test from 'node:test';
import assert from 'node:assert/strict';
import {main} from '../tools/domain-status.cjs';
test('Domain diagnostics perform only GET and separate Firebase DNS check time from current observation',async()=>{
 let count=0,printed;
 const report=await main({now:()=> '2026-10-29T17:00:00Z',print:s=>printed=s,client:{async request(options){count++;assert.equal(options.method,'GET');assert.equal(options.retry,false);assert.ok(options.url.endsWith('/customDomains/eduardshilov.com'));return {data:{hostState:'HOST_CONFLICT',ownershipState:'OWNERSHIP_ACTIVE',requiredDnsUpdates:{checkTime:'2026-10-29T16:00:00Z',discovered:[{domainName:'eduardshilov.com',records:[{type:'A',rdata:'37.140.192.91',requiredAction:'REMOVE'}]}]},cert:{state:'CERT_PREPARING'}}};}}});
 assert.equal(count,1);assert.equal(report.dnsLastCheckTime,'2026-10-29T16:00:00Z');assert.equal(report.observedAt,'2026-10-29T17:00:00Z');assert.equal(report.readOnly,true);assert.equal(JSON.parse(printed).dnsDiscovered[0].records[0].value,'37.140.192.91');
});
test('Domain diagnostics omit credential-like unknown fields and challenge contents',async()=>{
 const secret='fixture-credential-sentinel';let printed;
 await main({print:s=>printed=s,client:{async request(){return {data:{access_token:secret,cert:{private_key:secret,verification:{http:{desired:secret,discovered:secret,path:'/.well-known/acme-challenge/public-path',lastCheckTime:'2026-10-29T16:00:00Z'}}}}};}}});
 assert.equal(printed.includes(secret),false);assert.equal(JSON.parse(printed).certificateHTTPCheck.path,'/.well-known/acme-challenge/public-path');
});
