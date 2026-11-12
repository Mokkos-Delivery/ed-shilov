// Small shared, dependency-free analytics helpers. No browser state on import.
export const ANALYTICS_SESSION_KEY='edAnalyticsSessionV1';
export const SESSION_IDLE_MS=30*60*1000;
export const TRACK_ID=/^[A-Za-z0-9_-]{1,160}$/;
export const EVENT_TYPES=new Set(['page_view','track_play','track_complete','track_download','offer_click']);
export const OFFER_IDS=new Set(['booking','concert','private','festival']);
export const PUBLIC_PATHS=new Set(['/','/index.html','/music.html','/video.html','/bio.html','/news.html','/contacts.html','/press-kit.html','/privacy.html','/cookies.html','/data-consent.html']);
export function analyticsConsent({stored,cookie='',now=Date.now(),doNotTrack,globalPrivacyControl=false}={}){
  if(globalPrivacyControl||doNotTrack==='1'||doNotTrack==='yes')return false;
  let value;try{value=typeof stored==='string'?JSON.parse(stored):stored;}catch{}
  if(value?.version===2&&Number.isFinite(value.expires)&&value.expires>now)return value.analytics===true;
  try{const raw=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('es_privacy='));value=raw?JSON.parse(decodeURIComponent(raw.slice(11))):null;}catch{value=null;}
  return value?.v===2&&value.expires>now&&value.a===true;
}
export function validSession(value,now){return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id||'')&&Number.isFinite(value.last)&&value.last<=now&&now-value.last<SESSION_IDLE_MS;}
export function count(value){return Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;}
export function mergedTracks(catalogue,metrics){
  const rows=new Map((catalogue||[]).filter(x=>TRACK_ID.test(x.id||'')).map(x=>[x.id,{id:x.id,title:String(x.title||x.id),published:x.published===true,removed:false,plays:0,completions:0,downloads:0}]));
  for(const m of metrics||[]){if(!TRACK_ID.test(m.id||''))continue;const row=rows.get(m.id)||{id:m.id,title:String(m.title||m.id),published:false,removed:true};Object.assign(row,{plays:count(m.plays),completions:count(m.completions),downloads:count(m.downloads)});rows.set(m.id,row);}
  return [...rows.values()].sort((a,b)=>b.plays-a.plays||b.downloads-a.downloads||a.title.localeCompare(b.title,'ru'));
}
export function csvCell(value){const text=String(value??'');return '"'+(/^[\s]*[=+\-@]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}
export function tracksCSV(rows){return '\uFEFF'+[['Трек','ID','Статус','Прослушивания','Дослушивания','Скачивания'],...rows.map(r=>[r.title,r.id,r.removed?'Удалён':r.published?'На сайте':'Скрыт',r.plays,r.completions,r.downloads])].map(row=>row.map(csvCell).join(';')).join('\r\n');}

// Measures actual media progress AND elapsed wall time. Seeking, buffering, pauses,
// quality switches and background throttling cannot manufacture listening time.
export class ListeningMeter{
  constructor(){this.reset();}
  reset(){this.seconds=0;this.position=null;this.clock=null;this.active=false;this.played=false;this.completed=false;}
  start(position,now){this.position=position;this.clock=now;this.active=true;}
  suspend(){this.active=false;this.position=null;this.clock=null;}
  tick(position,now,rate=1){
    if(!this.active)return;
    const wall=(now-this.clock)/1000,delta=position-this.position;
    if(Number.isFinite(wall)&&Number.isFinite(delta)&&wall>=0&&wall<=15&&delta>=0&&delta<=wall*Math.max(.25,Math.min(4,rate))+1)this.seconds+=Math.min(wall,delta/Math.max(.25,Math.min(4,rate)));
    this.position=position;this.clock=now;
  }
  events(duration,ended=false){
    const events=[];const known=Number.isFinite(duration)&&duration>0;
    // Short tracks count only after >=90% is actually heard; long tracks need 30s.
    const threshold=known?Math.min(30,duration*.9):30;
    if(!this.played&&this.seconds>=threshold){this.played=true;events.push('track_play');}
    if(ended&&!this.completed&&this.played&&known&&this.seconds>=duration*.9){this.completed=true;events.push('track_complete');}
    return events;
  }
}
