import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const origin='https://eduardshilov.com';
const event=(extra={})=>({consent:true,type:'page_view',eventId:crypto.randomUUID(),sessionId:crypto.randomUUID(),path:'/',...extra});

test('Actual workerd + D1 executes migration triggers, counts concurrent retries once, and protects production reports',async()=>{
  const bundle=await build({entryPoints:['tests/fixtures/runtime-analytics.mjs'],bundle:true,format:'esm',platform:'browser',write:false});
  const runtime=new Miniflare(convertV4MiniflareOptions({
    name:'analytics-regression',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',
    bindings:{PROJECT_ID:'analytics-test',ADMIN_UID:'runtime-owner',ALLOWED_ORIGINS:origin},
    d1Databases:{ANALYTICS_DB:'analytics-runtime-test'}
  }));
  try{
    const db=await runtime.getD1Database('ANALYTICS_DB');
    const sql=fs.readFileSync(new URL('../worker/migrations/0001_analytics.sql',import.meta.url),'utf8');
    // Keep each CREATE TRIGGER (including its internal semicolons) intact.
    const statements=sql.replace(/^\s*--[^\n]*$/gm,'').split(/(?=CREATE (?:TABLE|INDEX|TRIGGER)\b)/).map(x=>x.trim()).filter(Boolean);
    assert.ok(statements.some(x=>x.startsWith('CREATE TRIGGER')));
    for(const statement of statements)await db.prepare(statement).run();
    const post=value=>runtime.dispatchFetch('https://media.example/api/analytics',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
    const report=async()=>{
      const response=await runtime.dispatchFetch('https://media.example/__test/report?days=7');
      assert.equal(response.status,200);return response.json();
    };
    const health=await runtime.dispatchFetch('https://media.example/health');
    assert.equal((await health.json()).analyticsConfigured,true);
    assert.equal((await report()).empty,true);
    const sessionId=crypto.randomUUID(),first=event({sessionId});
    const concurrent=await Promise.all(Array.from({length:16},()=>post(first)));
    assert.ok(concurrent.every(r=>r.status===202));
    assert.equal((await Promise.all(concurrent.map(r=>r.json()))).filter(r=>r.accepted).length,1);
    await post(event({sessionId,path:'/music.html'}));
    const play=event({sessionId,path:'/music.html',type:'track_play',trackId:'runtime-song'});
    assert.equal((await(await post(play)).json()).accepted,true);
    assert.equal((await(await post({...play,eventId:crypto.randomUUID()})).json()).accepted,false);
    await post(event({sessionId,type:'track_complete',trackId:'runtime-song'}));
    await post(event({sessionId,type:'track_download',trackId:'runtime-song'}));
    await post(event({sessionId,type:'offer_click',offerId:'festival'}));
    const summary=await report();
    assert.deepEqual(summary.totals,{visits:1,pageViews:2,plays:1,completions:1,downloads:1,offerClicks:1});
    assert.deepEqual(summary.tracks,[{id:'runtime-song',plays:1,completions:1,downloads:1}]);
    assert.deepEqual(summary.pages,[{path:'/',views:1},{path:'/music.html',views:1}]);
    assert.deepEqual(summary.offers,[{id:'festival',clicks:1}]);
    assert.equal(summary.daily.length,7);assert.equal(summary.configured,true);
    assert.equal((await post(event({type:'track_play',trackId:'not-public'}))).status,404);
    assert.equal((await post(event({path:'/admin.html'}))).status,400);
    assert.equal((await post(event({consent:false}))).status,400);
    assert.equal((await post(event({sessionId:[crypto.randomUUID()]}))).status,400);
    const denied=await runtime.dispatchFetch('https://media.example/api/admin/analytics',{headers:{Origin:origin}});
    assert.equal(denied.status,401);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),origin);
    const badOrigin=await runtime.dispatchFetch('https://media.example/api/analytics',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(event())});
    assert.equal(badOrigin.status,403);
    const ledger=await db.prepare('SELECT * FROM analytics_events').all();
    assert.equal(JSON.stringify(ledger.results).includes(sessionId),false);
    assert.equal(JSON.stringify(ledger.results).includes(first.eventId),false);
    // Execute DELETE batch in real D1 as well as reads/inserts/triggers.
    const cleanup=await runtime.dispatchFetch('https://media.example/__test/cleanup');
    assert.equal(cleanup.status,200);assert.deepEqual((await report()).totals,summary.totals);
  }finally{await runtime.dispose();}
});
