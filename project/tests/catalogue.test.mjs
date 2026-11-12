import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogueReader} from '../worker/src/catalogue.mjs';
import {createWorker} from '../worker/src/index.mjs';
const env={PROJECT_ID:'catalogue-test',ALLOWED_ORIGINS:'https://site.example'};
const doc=(id,visible=true)=>({name:'projects/catalogue-test/databases/(default)/documents/tracks/'+id,fields:{title:{stringValue:id},published:{booleanValue:visible}}});
test('Public catalogue uses anonymous published-only queries, coalesces reads and observes hiding after cache expiry',async()=>{
 let now=1,calls=0,visible=true;
 const read=createCatalogueReader(async(url,options)=>{
  calls++;assert.equal(options.headers?.Authorization,undefined);
  if(url.endsWith('/settings/public'))return Response.json({fields:{catalogueSeeded:{booleanValue:true}}});
  const q=JSON.parse(options.body).structuredQuery;assert.equal(q.from[0].collectionId,'tracks');assert.deepEqual(q.where.fieldFilter,{field:{fieldPath:'published'},op:'EQUAL',value:{booleanValue:true}});
  return Response.json(visible?[{document:doc('song')},{document:doc('private',false)}]:[]);
 },()=>now);
 const replies=await Promise.all(Array.from({length:6},()=>read('tracks',env)));assert.equal(calls,2);assert.equal(replies[0].items.length,1);
 visible=false;await read('tracks',env);assert.equal(calls,2);now+=15001;assert.deepEqual((await read('tracks',env)).items,[]);assert.equal(calls,4);
});
test('Unavailable or incomplete catalogues are not cached as successful empty catalogues',async()=>{
 let fail=true;
 const read=createCatalogueReader(async url=>url.endsWith('/settings/public')?Response.json({fields:{catalogueSeeded:{booleanValue:true}}}):fail?new Response(null,{status:503}):Response.json([{document:doc('recovered')}]));
 await assert.rejects(read('tracks',env));fail=false;assert.equal((await read('tracks',env)).items[0].id,'recovered');
 const unseeded=createCatalogueReader(async()=>new Response(null,{status:404}));assert.equal((await unseeded('tracks',env)).seeded,false);
});
test('Catalogue API rejects private collections, writes and foreign origins before upstream calls',async()=>{
 const worker=createWorker(()=>{throw Error('No upstream call expected');});
 for(const [path,options,status] of [['?kind=media',{},400],['?kind=tracks',{method:'POST'},405],['?kind=tracks',{headers:{Origin:'https://foreign.example'}},403]])assert.equal((await worker.fetch(new Request('https://worker.example/api/catalogue'+path,options),env)).status,status);
});
