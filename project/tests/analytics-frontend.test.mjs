import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {analyticsConsent,validSession,SESSION_IDLE_MS,ListeningMeter,mergedTracks,tracksCSV,ANALYTICS_SESSION_KEY} from '../web/analytics-core.mjs';
import {startSiteAnalytics} from '../web/site-analytics.mjs';
const now=1790000000000;
test('analytics requires valid explicit consent and respects privacy signals',()=>{
  const allowed={version:2,expires:now+1000,analytics:true};
  assert.equal(analyticsConsent({now,stored:allowed}),true);
  for(const stored of [null,'bad',{}, {...allowed,expires:now-1},{...allowed,version:1},{...allowed,analytics:false}])assert.equal(analyticsConsent({now,stored}),false);
  for(const flags of [{doNotTrack:'1'},{doNotTrack:'yes'},{globalPrivacyControl:true}])assert.equal(analyticsConsent({now,stored:allowed,...flags}),false);
  const cookie='other=yes; es_privacy='+encodeURIComponent(JSON.stringify({a:true,v:2,expires:now+1000}));
  assert.equal(analyticsConsent({now,cookie}),true);
  assert.equal(analyticsConsent({now,cookie,stored:{...allowed,analytics:false}}),false);
});
test('sessions expire after 30 inactive minutes; future-dated invalid sessions reset',()=>{
  assert.equal(validSession({id:randomUUID(),last:now-1},now),true);
  assert.equal(validSession({id:randomUUID(),last:now-SESSION_IDLE_MS},now),false);
  assert.equal(validSession({id:randomUUID(),last:now+1},now),false);
  assert.equal(validSession({id:'-'.repeat(36),last:now-1},now),false);
});
test('play requires actual elapsed playback; seeking, waiting and pause do not inflate it',()=>{
  const meter=new ListeningMeter();meter.start(0,0);
  for(let i=1;i<30;i++)meter.tick(i,i*1000);
  assert.deepEqual(meter.events(180),[]);
  meter.tick(120,30000);assert.equal(meter.seconds,29); // seek jump
  meter.suspend();meter.tick(150,60000);assert.equal(meter.seconds,29);
  meter.start(150,70000);meter.tick(151,71000);
  assert.deepEqual(meter.events(180),['track_play']);
  assert.deepEqual(meter.events(180),[]);assert.deepEqual(meter.events(180,true),[]);
});
test('short songs and completion require 90 percent actually heard; quality restart does not duplicate play',()=>{
  const meter=new ListeningMeter();meter.start(0,0);for(let i=1;i<=9;i++)meter.tick(i,i*1000);
  assert.deepEqual(meter.events(10),['track_play']);meter.suspend();meter.start(9,20000);meter.tick(10,21000);
  assert.deepEqual(meter.events(10,true),['track_complete']);assert.deepEqual(meter.events(10,true),[]);
  meter.reset();meter.start(0,0);meter.tick(9,1000);assert.deepEqual(meter.events(10,true),[]);
});
test('all catalogue songs retained with zero values; removed songs and safe spreadsheet export included',()=>{
  const rows=mergedTracks([{id:'quiet',title:'Новая песня',published:true},{id:'hidden',title:'=HYPERLINK("x")',published:false}], [{id:'old',plays:5,downloads:2},{id:'quiet',plays:0}]);
  assert.equal(rows.length,3);assert.equal(rows[0].removed,true);assert.equal(rows.find(r=>r.id==='hidden').plays,0);
  const csv=tracksCSV(rows);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));assert.ok(csv.includes('Новая песня'));
});
class Storage{constructor(){this.map=new Map();}getItem(k){return this.map.get(k)||null;}setItem(k,v){this.map.set(k,v);}removeItem(k){this.map.delete(k);}}
function browser(){const w=new EventTarget();w.document=new EventTarget();w.document.cookie='';w.navigator={};w.location={pathname:'/music.html'};w.crypto={randomUUID};w.ED_CLOUD_CONFIG={workerOrigin:'https://media.example.test'};w.localStorage=new Storage();w.sessionStorage=new Storage();w.setTimeout=setTimeout;w.clearTimeout=clearTimeout;w.performance=performance;w.calls=[];w.fetch=async(url,options)=>{w.calls.push({url,...options,event:JSON.parse(options.body)});return {ok:true,status:202};};return w;}
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
function optIn(w){w.localStorage.setItem('es5_privacy',JSON.stringify({version:2,analytics:true,expires:Date.now()+100000}));}
test('tracker sends nothing and stores no visitor identifier before opt-in; revocation clears it',async()=>{
  const w=browser(),tracker=startSiteAnalytics(w);tracker.emit('track_download',{trackId:'song_1'});await flush();assert.equal(w.calls.length,0);assert.equal(w.sessionStorage.map.size,0);
  optIn(w);w.dispatchEvent(new Event('ed:consent'));await flush();assert.equal(w.calls.length,1);assert.equal(w.calls[0].event.type,'page_view');assert.equal(w.calls[0].event.consent,true);assert.ok(w.sessionStorage.getItem(ANALYTICS_SESSION_KEY));
  tracker.emit('track_download',{trackId:'song_1'});tracker.emit('track_download',{trackId:'song_1'});await flush();assert.equal(w.calls.length,2);
  w.localStorage.removeItem('es5_privacy');w.dispatchEvent(new Event('ed:consent'));tracker.emit('track_download',{trackId:'song_2'});await flush();assert.equal(w.calls.length,2);assert.equal(w.sessionStorage.getItem(ANALYTICS_SESSION_KEY),null);
});
test('DNT and admin pages are excluded; retry reuses event identity and visits have no query or referer',async()=>{
  const admin=browser();admin.location.pathname='/admin.html';assert.equal(startSiteAnalytics(admin),null);
  const dnt=browser();optIn(dnt);dnt.navigator.doNotTrack='1';startSiteAnalytics(dnt);await flush();assert.equal(dnt.calls.length,0);
  const w=browser();optIn(w);w.fetch=async(url,options)=>{w.calls.push({url,event:JSON.parse(options.body)});if(w.calls.length===1)throw Error('offline');return {ok:true,status:202};};startSiteAnalytics(w);await flush();assert.equal(w.calls.length,2);assert.deepEqual(w.calls[0].event,w.calls[1].event);assert.deepEqual(Object.keys(w.calls[0].event).sort(),['consent','type','eventId','sessionId','path'].sort());
});
test('explicit withdrawal immediately clears the session before preferences are erased; expired grants stop collection',async()=>{
  const w=browser();optIn(w);const tracker=startSiteAnalytics(w);await flush();assert.equal(w.calls.length,1);
  w.dispatchEvent(new CustomEvent('ed:consent',{detail:{analytics:false}}));
  tracker.emit('offer_click',{offerId:'concert'});await flush();assert.equal(w.calls.length,1);assert.equal(w.sessionStorage.getItem(ANALYTICS_SESSION_KEY),null);
  // This simulates the UI finishing its storage update; re-enabling requires
  // a fresh persisted choice, never just an event with analytics:true.
  w.localStorage.removeItem('es5_privacy');w.dispatchEvent(new CustomEvent('ed:consent',{detail:{analytics:true}}));await flush();assert.equal(w.calls.length,1);
  optIn(w);w.dispatchEvent(new Event('ed:consent'));await flush();assert.equal(w.calls.length,2);
  w.localStorage.setItem('es5_privacy',JSON.stringify({version:2,analytics:true,expires:Date.now()-1}));
  tracker.emit('track_download',{trackId:'song_expired'});await flush();assert.equal(w.calls.length,2);assert.equal(w.sessionStorage.getItem(ANALYTICS_SESSION_KEY),null);
});
