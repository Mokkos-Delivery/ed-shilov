import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {analyticsReport,cleanupAnalytics,recordAnalytics,validateAnalyticsEvent} from '../worker/src/analytics.mjs';
import {createWorker} from '../worker/src/index.mjs';
import {base64url,jsonBytes} from '../worker/src/core.mjs';

// D1 speaks SQLite. Execute the real migration, triggers, and bound statements
// instead of teaching a mock to return the expected aggregate.
function database(){
  const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../worker/migrations/0001_analytics.sql',import.meta.url),'utf8'));
  const prepare=query=>({bind(...values){return {run:async()=>({meta:{changes:Number(sql.prepare(query).run(...values).changes)}}),all:async()=>({results:sql.prepare(query).all(...values)})};},all:async()=>({results:sql.prepare(query).all()})});
  return {sql,prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const item of statements)results.push(item.all?await item.all():await item.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
const origin='https://eduardshilov.com',now=Date.parse('2026-11-10T12:00:00Z');
const env={PROJECT_ID:'analytics-test',ADMIN_UID:'owner_uid',ALLOWED_ORIGINS:origin};
const req=(path='/api/analytics',init={})=>new Request('https://media.example'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},...init});
const event=(extra={})=>({type:'page_view',eventId:crypto.randomUUID(),sessionId:crypto.randomUUID(),path:'/',consent:true,...extra});
const publicTrack=async()=>({published:true});
const report=async(db,at=now,days=7)=>await(await analyticsReport(req('/api/admin/analytics?days='+days,{method:'GET'}),{...env,ANALYTICS_DB:db},at)).json();

test('Analytics rejects free-form URLs, unwanted personal fields, unknown offers and invalid identifiers',()=>{
  assert.equal(validateAnalyticsEvent(event({path:'/index.html'})).path,'/');
  for(const change of [{path:'/contacts.html?email=a@example.com'},{path:'https://evil.example/'},{path:'/admin.html'},{type:'arbitrary'},{sessionId:'person@example.com'},{sessionId:[crypto.randomUUID()]},{eventId:'foo'},{eventId:[crypto.randomUUID()]},{email:'visitor@example.com'},{consent:false},{type:'track_play',trackId:'../private'},{type:'track_play',trackId:['track-1']},{type:'track_play',trackId:123},{type:'offer_click',offerId:'merch'},{trackId:'unknown'}])assert.equal(validateAnalyticsEvent(event(change)),null,JSON.stringify(change));
  assert.ok(validateAnalyticsEvent(event({type:'track_play',trackId:'track-1'})));
  assert.ok(validateAnalyticsEvent(event({type:'offer_click',offerId:'concert'})));
});

test('Retries and simultaneous duplicate events increment the real SQLite aggregates only once',async()=>{
  const db=database(),settings={...env,ANALYTICS_DB:db},sessionId=crypto.randomUUID(),view=event({sessionId});
  try{
    const replies=await Promise.all(Array.from({length:12},()=>recordAnalytics(req(),settings,view,publicTrack,now)));
    assert.equal((await Promise.all(replies.map(r=>r.json()))).filter(r=>r.accepted).length,1);
    await recordAnalytics(req(),settings,event({sessionId,path:'/music.html'}),publicTrack,now);
    const play=event({sessionId,type:'track_play',trackId:'track-1',path:'/music.html'});
    await recordAnalytics(req(),settings,play,publicTrack,now);
    // A second event UUID still cannot replay a track's per-session action.
    await recordAnalytics(req(),settings,{...play,eventId:crypto.randomUUID()},publicTrack,now);
    await recordAnalytics(req(),settings,event({sessionId,type:'track_complete',trackId:'track-1'}),publicTrack,now);
    await recordAnalytics(req(),settings,event({sessionId,type:'track_download',trackId:'track-1'}),publicTrack,now);
    await recordAnalytics(req(),settings,event({sessionId,type:'offer_click',offerId:'concert'}),publicTrack,now);
    const summary=await report(db);
    assert.deepEqual(summary.totals,{visits:1,pageViews:2,plays:1,completions:1,downloads:1,offerClicks:1});
    assert.deepEqual(summary.tracks,[{id:'track-1',plays:1,completions:1,downloads:1}]);
    assert.deepEqual(summary.offers,[{id:'concert',clicks:1}]);
    assert.deepEqual(summary.pages,[{path:'/',views:1},{path:'/music.html',views:1}]);
    assert.equal(summary.startedAt,'2026-11-10');assert.equal(summary.daily.length,7);assert.equal(summary.daily[0].visits,0);assert.equal(summary.daily[6].visits,1);
    const stored=JSON.stringify(db.sql.prepare('SELECT * FROM analytics_events').all());assert.equal(stored.includes(sessionId),false);assert.equal(stored.includes(view.eventId),false);
  }finally{db.sql.close();}
});

test('Completion requires a recorded play, hidden tracks never count, and public writes require origin and opt-in',async()=>{
  const db=database(),settings={...env,ANALYTICS_DB:db};
  try{
    const complete=await recordAnalytics(req(),settings,event({type:'track_complete',trackId:'track-1'}),publicTrack,now);
    assert.equal((await complete.json()).accepted,false);
    assert.equal((await recordAnalytics(req(),settings,event({type:'track_play',trackId:'hidden'}),async()=>({published:false}),now)).status,404);
    assert.equal((await recordAnalytics(req(),settings,event({consent:false}),publicTrack,now)).status,400);
    assert.equal((await recordAnalytics(req('/api/analytics',{headers:{'Content-Type':'application/json'}}),settings,event(),publicTrack,now)).status,403);
    for(const header of ['DNT','Sec-GPC'])assert.equal((await recordAnalytics(req('/api/analytics',{headers:{Origin:origin,[header]:'1'}}),settings,event(),publicTrack,now)).status,204);
    assert.equal((await report(db)).empty,true);
  }finally{db.sql.close();}
});

test('Session and site daily limits stop writes without rolling over or inventing counters',async()=>{
  const db=database(),settings={...env,ANALYTICS_DB:db,ANALYTICS_DAILY_LIMIT:'100'},sessionId=crypto.randomUUID();
  try{
    for(let i=0;i<105;i++)await recordAnalytics(req(),settings,event({sessionId}),publicTrack,now);
    assert.equal((await report(db)).totals.pageViews,100);
    assert.equal((await(await analyticsReport(req('/api/admin/analytics',{method:'GET'}),settings,now)).json()).limited,true);
    assert.equal((await recordAnalytics(req(),{...settings,ANALYTICS_RATE_LIMITER:{limit:async()=>({success:false})}},event(),publicTrack,now)).status,429);
    // The per-session ceiling remains even with a larger site cap.
    for(let i=0;i<105;i++)await recordAnalytics(req(),{...settings,ANALYTICS_DAILY_LIMIT:'5000'},event({sessionId}),publicTrack,now);
    assert.equal((await report(db)).totals.pageViews,200);
  }finally{db.sql.close();}
});

test('UTC ranges include today, cleanup deletes short-lived identifiers while preserving recent aggregates',async()=>{
  const db=database(),settings={...env,ANALYTICS_DB:db};
  try{
    for(const age of [0,1,7,370])await recordAnalytics(req(),settings,event(),publicTrack,now-age*86400000);
    assert.equal((await report(db)).totals.visits,2);
    await cleanupAnalytics(settings,now);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count,2);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM analytics_sessions').get().count,2);
    assert.equal((await report(db,now,30)).totals.visits,3);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM analytics_daily').get().count,3);
    assert.equal((await analyticsReport(req('/api/admin/analytics?days=1000000',{method:'GET'}),settings,now)).status,400);
  }finally{db.sql.close();}
});

test('Worker analytics endpoints enforce owner signatures, body limits, and explicit allowed Origin',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='analytics-test-key';
  const jwt=async sub=>{const second=Math.floor(Date.now()/1000),body=base64url(jsonBytes({alg:'RS256',kid:jwk.kid}))+'.'+base64url(jsonBytes({sub,aud:env.PROJECT_ID,iss:'https://securetoken.google.com/'+env.PROJECT_ID,email_verified:true,exp:second+3600,iat:second,auth_time:second}));return body+'.'+base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(body)));};
  let catalogueReads=0;
  const worker=createWorker(async url=>{if(url.includes('service_accounts'))return Response.json({keys:[jwk]});catalogueReads++;throw Error('Unexpected catalogue access');});
  const health=await worker.fetch(req('/health',{method:'GET'}),env);
  assert.equal((await health.json()).analyticsConfigured,false);
  for(const token of ['',await jwt('another-owner')]){
    const response=await worker.fetch(req('/api/admin/analytics',{method:'GET',headers:{Origin:origin,Authorization:'Bearer '+token}}),env);
    assert.equal(response.status,401);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  }
  const owner=await worker.fetch(req('/api/admin/analytics',{method:'GET',headers:{Origin:origin,Authorization:'Bearer '+await jwt(env.ADMIN_UID)}}),env);
  assert.equal(owner.status,503);assert.equal((await owner.json()).code,'ANALYTICS_NOT_CONFIGURED');
  const noOrigin=await worker.fetch(req('/api/analytics',{headers:{'Content-Type':'application/json'},body:JSON.stringify(event())}),env);assert.equal(noOrigin.status,403);
  const evil=await worker.fetch(req('/api/analytics',{headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(event())}),env);assert.equal(evil.status,403);
  const oversized=await worker.fetch(req('/api/analytics',{body:JSON.stringify({...event(),x:'x'.repeat(2100)})}),env);assert.equal(oversized.status,400);
  const missing=await worker.fetch(req('/api/analytics',{body:JSON.stringify(event())}),env);assert.equal(missing.status,503);assert.equal((await missing.json()).ok,false);
  assert.equal(catalogueReads,0);
});
