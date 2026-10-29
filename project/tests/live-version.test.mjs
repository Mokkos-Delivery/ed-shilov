import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyLive} from '../tools/verify-live.mjs';
import {RELEASE} from '../web/release.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const settings={workerOrigin:'https://media.example'};
test('Live verifier checks actual asset bytes and rejects stale JS even with a matching manifest',async()=>{
 const manifest={release:RELEASE,draft:false,deployable:true,assetVersion:'version',files:{'admin.html':sha('html'),'js/admin.mjs':sha('actual JS'),'js/cloud-config.js':sha('actual JS')}};
 const net=async url=>url.includes('/health')?Response.json({release:RELEASE,configured:true}):url.includes('build-manifest')?Response.json(manifest):new Response(url.includes('admin.html')?'html':'stale JS');
 await assert.rejects(verifyLive({settings,manifest,net}),/Published asset differs: js\/admin.mjs/);
 const good=async url=>url.includes('/js/')?new Response('actual JS'):net(url);
 assert.equal((await verifyLive({settings,manifest,net:good})).hashedAssets,3);
 await assert.rejects(verifyLive({settings,manifest:{...manifest,draft:true},net:good}),/draft cannot be published/);
});
test('Worker-only verification fails on old or unconfigured Workers and makes no Hosting requests',async()=>{
 for(const health of [{configured:true},{release:RELEASE,configured:false}])await assert.rejects(verifyLive({settings,workerOnly:true,net:async()=>Response.json(health)}),/does not match/);
 const r=await verifyLive({settings,workerOnly:true,net:async url=>{assert.equal(url,'https://media.example/health');return Response.json({release:RELEASE,configured:true});}});
 assert.equal(r.workerVerified,true);assert.equal(r.hostingVerified,false);
});
