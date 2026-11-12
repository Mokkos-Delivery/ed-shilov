const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TRACK=/^[A-Za-z0-9_-]{1,160}$/;
const TYPES=new Set(['page_view','track_play','track_complete','track_download','offer_click']);
const OFFERS=new Set(['booking','concert','private','festival']);
const PAGES=new Set(['/','/music.html','/video.html','/bio.html','/news.html','/contacts.html','/press-kit.html','/privacy.html','/cookies.html','/data-consent.html']);
const DAY=86400000;
const zero=()=>({visits:0,pageViews:0,plays:0,completions:0,downloads:0,offerClicks:0});
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const missing=()=>json({ok:false,configured:false,code:'ANALYTICS_NOT_CONFIGURED',error:'Статистика ещё не подключена. Выполните настройку базы аналитики и обновите Worker.'},503);
function limits(env){return {dailyEvents:Math.min(20000,Math.max(100,Number.parseInt(env.ANALYTICS_DAILY_LIMIT,10)||5000)),sessionEvents:200};}
const dayOf=value=>new Date(value).toISOString().slice(0,10);
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}

export function validateAnalyticsEvent(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.consent!==true||!TYPES.has(value.type)||typeof value.eventId!=='string'||typeof value.sessionId!=='string'||!UUID.test(value.eventId)||!UUID.test(value.sessionId))return null;
  if(Object.keys(value).some(key=>!['type','eventId','sessionId','path','trackId','offerId','consent'].includes(key)))return null;
  const path=value.path==='/index.html'?'/':value.path;
  if(!PAGES.has(path))return null;
  const track=value.type.startsWith('track_'),offer=value.type==='offer_click';
  if(track?typeof value.trackId!=='string'||!TRACK.test(value.trackId):value.trackId!==undefined)return null;
  if(offer?!OFFERS.has(value.offerId):value.offerId!==undefined)return null;
  return {type:value.type,eventId:value.eventId.toLowerCase(),sessionId:value.sessionId.toLowerCase(),path,target:track?value.trackId:offer?value.offerId:''};
}

const INSERT_EVENT=`INSERT OR IGNORE INTO analytics_events(event_key,dedupe_key,session_key,day,type,path,target)
  SELECT ?,?,?,?,?,?,?
  WHERE (SELECT COUNT(*) FROM analytics_events WHERE session_key=?) < ?
    AND COALESCE((SELECT page_views+plays+completions+downloads+offer_clicks FROM analytics_daily WHERE day=?),0) < ?
    AND (? != 'track_complete' OR EXISTS(SELECT 1 FROM analytics_events WHERE session_key=? AND type='track_play' AND target=?))`;

export async function recordAnalytics(request,env,body,readTrack,now=Date.now()){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405,{Allow:'POST'});
  // Unlike media GETs, telemetry always requires an explicit approved Origin.
  if(!request.headers.get('Origin'))return json({ok:false,error:'Origin required'},403);
  if(request.headers.get('DNT')==='1'||request.headers.get('Sec-GPC')==='1')return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  const event=validateAnalyticsEvent(body);
  if(!event)return json({ok:false,error:'Некорректное событие статистики.'},400);
  if(!env.ANALYTICS_DB)return missing();
  const day=dayOf(now),sessionKey=await digest((env.PROJECT_ID||'site')+':session:'+event.sessionId);
  if(env.ANALYTICS_RATE_LIMITER){
    // Rate-limit state expires inside Cloudflare. Neither IP nor this daily hash
    // is written to D1 or returned to the browser.
    const ip=request.headers.get('CF-Connecting-IP');
    const key=ip?await digest((env.FORM_SECRET||env.PROJECT_ID||'site')+':rate:'+day+':'+ip):sessionKey;
    const result=await env.ANALYTICS_RATE_LIMITER.limit({key});
    if(!result.success)return json({ok:false,error:'Слишком много событий. Повторите позже.'},429,{'Retry-After':'60'});
  }
  if(event.type.startsWith('track_')){
    const track=await readTrack(event.target);
    if(track?.published!==true)return json({ok:false,error:'Трек недоступен.'},404);
  }
  const eventKey=await digest((env.PROJECT_ID||'site')+':event:'+event.eventId);
  const dedupeKey=event.type==='page_view'?eventKey:await digest(sessionKey+':'+event.type+':'+event.target);
  const cap=limits(env);
  const result=await env.ANALYTICS_DB.prepare(INSERT_EVENT).bind(eventKey,dedupeKey,sessionKey,day,event.type,event.path,event.target,sessionKey,cap.sessionEvents,day,cap.dailyEvents,event.type,sessionKey,event.target).run();
  return json({ok:true,accepted:Number(result.meta?.changes)>0},202);
}

function metrics(row={}){return {visits:Number(row.visits)||0,pageViews:Number(row.page_views)||0,plays:Number(row.plays)||0,completions:Number(row.completions)||0,downloads:Number(row.downloads)||0,offerClicks:Number(row.offer_clicks)||0};}
export async function analyticsReport(request,env,now=Date.now()){
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,{Allow:'GET'});
  const raw=new URL(request.url).searchParams.get('days')||'30';
  if(!['7','30','90'].includes(raw))return json({ok:false,error:'Выберите период 7, 30 или 90 дней.'},400);
  if(!env.ANALYTICS_DB)return missing();
  const days=Number(raw),to=dayOf(now),from=dayOf(Date.parse(to+'T00:00:00Z')-(days-1)*DAY),db=env.ANALYTICS_DB;
  await cleanupAnalytics(env,now);
  // D1 batch gives one transactionally consistent snapshot for the whole report.
  const results=await db.batch([
    db.prepare('SELECT * FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day').bind(from,to),
    db.prepare('SELECT track_id AS id,SUM(plays) AS plays,SUM(completions) AS completions,SUM(downloads) AS downloads FROM analytics_tracks WHERE day >= ? AND day <= ? GROUP BY track_id ORDER BY plays DESC,downloads DESC,track_id').bind(from,to),
    db.prepare('SELECT path,SUM(views) AS views FROM analytics_pages WHERE day >= ? AND day <= ? GROUP BY path ORDER BY views DESC,path').bind(from,to),
    db.prepare('SELECT offer_id AS id,SUM(clicks) AS clicks FROM analytics_offers WHERE day >= ? AND day <= ? GROUP BY offer_id ORDER BY clicks DESC,offer_id').bind(from,to),
    db.prepare("SELECT value FROM analytics_meta WHERE name='startedAt'")
  ]);
  const byDay=new Map((results[0].results||[]).map(row=>[row.day,metrics(row)])),totals=zero(),daily=[];
  for(let index=0;index<days;index++){
    const date=dayOf(Date.parse(from+'T00:00:00Z')+index*DAY),value=byDay.get(date)||zero();
    daily.push({date,...value});for(const key of Object.keys(totals))totals[key]+=value[key];
  }
  const cap=limits(env),limited=daily.some(row=>row.pageViews+row.plays+row.completions+row.downloads+row.offerClicks>=cap.dailyEvents);
  return json({ok:true,configured:true,days,from,to,timezone:'UTC',startedAt:results[4].results?.[0]?.value||null,empty:!Object.values(totals).some(Boolean),limited,limits:cap,totals,daily,tracks:results[1].results||[],pages:results[2].results||[],offers:results[3].results||[]});
}

export async function cleanupAnalytics(env,now=Date.now()){
  if(!env.ANALYTICS_DB)return;
  // Keep today and the previous UTC date; aggregate reports retain 366 dates.
  const ledgerCutoff=dayOf(now-DAY),aggregateCutoff=dayOf(now-365*DAY),db=env.ANALYTICS_DB;
  await db.batch([
    db.prepare('DELETE FROM analytics_events WHERE day < ?').bind(ledgerCutoff),
    db.prepare('DELETE FROM analytics_sessions WHERE day < ?').bind(ledgerCutoff),
    ...['analytics_daily','analytics_pages','analytics_tracks','analytics_offers'].map(table=>db.prepare('DELETE FROM '+table+' WHERE day < ?').bind(aggregateCutoff))
  ]);
}
