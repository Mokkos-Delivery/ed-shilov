import {ANALYTICS_SESSION_KEY,analyticsConsent,validSession,ListeningMeter,TRACK_ID,EVENT_TYPES,OFFER_IDS,PUBLIC_PATHS} from './analytics-core.mjs?v=studio-4';

export function startSiteAnalytics(w=window){
  const d=w.document,n=w.navigator;
  if(!PUBLIC_PATHS.has(w.location.pathname)||!w.crypto?.randomUUID)return null;
  let origin;try{const u=new URL(w.ED_CLOUD_CONFIG?.workerOrigin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null;origin=u.origin;}catch{return null;}
  let allowed=false,session=null,queue=Promise.resolve(),generation=0,player=null,currentId='',meter=new ListeningMeter(),binding=null;
  const controllers=new Set(),sent=new Set();
  const readConsent=()=>{let stored;try{stored=w.localStorage.getItem('es5_privacy');}catch{}return analyticsConsent({stored,cookie:d.cookie,doNotTrack:n.doNotTrack||w.doNotTrack,globalPrivacyControl:n.globalPrivacyControl});};
  function saveSession(){try{w.sessionStorage.setItem(ANALYTICS_SESSION_KEY,JSON.stringify(session));}catch{}}
  function getSession(){
    const now=Date.now();if(!session){try{session=JSON.parse(w.sessionStorage.getItem(ANALYTICS_SESSION_KEY));}catch{}}
    if(!validSession(session,now)){session={id:w.crypto.randomUUID(),last:now,sent:[]};sent.clear();}
    else for(const key of session.sent||[])if(typeof key==='string')sent.add(key);
    session.last=now;session.sent=[...sent].slice(-400);saveSession();return session.id;
  }
  function emit(type,detail={}){
    if(!allowed||!EVENT_TYPES.has(type))return;
    if(!readConsent()){updateConsent();return;}
    if(type.startsWith('track_')&&!TRACK_ID.test(detail.trackId||''))return;
    if(type==='offer_click'&&!OFFER_IDS.has(detail.offerId))return;
    const sessionId=getSession(),key=type+':'+(detail.trackId||detail.offerId||'');
    if(type!=='page_view'&&sent.has(key))return;
    const token=generation,event={consent:true,type,eventId:w.crypto.randomUUID(),sessionId,path:w.location.pathname,...detail};
    if(type!=='page_view'){sent.add(key);session.sent=[...sent].slice(-400);saveSession();}
    // Preserve play → completion order. At most one retry with the SAME id;
    // a late response can never duplicate a server event.
    queue=queue.then(async()=>{
      for(let attempt=0;attempt<2;attempt++){
        if(!allowed||token!==generation)return;
        const c=new AbortController(),timer=w.setTimeout(()=>c.abort(),6000);controllers.add(c);
        try{const r=await w.fetch(origin+'/api/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),credentials:'omit',mode:'cors',keepalive:true,signal:c.signal});
          if(r.ok||r.status<500)return;
        }catch{}finally{w.clearTimeout(timer);controllers.delete(c);}
      }
      // A future user action may retry a failed event; no durable queue of visits.
      if(token===generation&&type!=='page_view'){sent.delete(key);if(session){session.sent=[...sent].slice(-400);saveSession();}}
    }).catch(()=>{});
  }
  function track(){const id=player?.getTrack?.()?.id||'';if(id!==currentId){currentId=id;meter.reset();}return TRACK_ID.test(id)?id:'';}
  function sample(ended=false){
    if(!allowed||!player)return;const id=track(),a=player.audio;if(!id)return;
    if(a.seeking){meter.suspend();return;}
    if(meter.active)meter.tick(a.currentTime,w.performance.now(),a.playbackRate);
    for(const type of meter.events(a.duration,ended))emit(type,{trackId:id});
  }
  function attach(){
    const next=w.ED_ANALYTICS_PLAYER;if(!next?.audio||next===player)return;
    binding?.abort();binding=new AbortController();player=next;meter.reset();currentId='';const a=player.audio,opt={signal:binding.signal};
    const begin=()=>{if(!allowed)return;track();meter.start(a.currentTime,w.performance.now());};
    a.addEventListener('playing',begin,opt);
    a.addEventListener('timeupdate',()=>{sample();if(allowed&&!a.paused&&!a.seeking&&a.readyState>=3&&!meter.active)begin();},opt);
    for(const name of ['pause','waiting','stalled','seeking','emptied'])a.addEventListener(name,()=>{if(name==='pause')sample();meter.suspend();},opt);
    // Capture ensures the old track completes before the legacy autoplay handler
    // selects another song on the same Audio element.
    a.addEventListener('ended',()=>{sample(true);meter.suspend();},{...opt,capture:true});
    a.addEventListener('ratechange',()=>{sample();meter.suspend();},opt);
    if(allowed&&!a.paused&&a.readyState>=3)begin();
  }
  function updateConsent(event){
    // Revocation takes effect synchronously, even when the UI is about to erase
    // stored preferences or reload. A grant always requires persisted consent.
    const next=event?.detail?.analytics===false?false:readConsent();if(next===allowed)return;allowed=next;
    if(!allowed){generation++;for(const c of controllers)c.abort();session=null;sent.clear();meter.reset();try{w.sessionStorage.removeItem(ANALYTICS_SESSION_KEY);}catch{}return;}
    emit('page_view');attach();if(player&&!player.audio.paused)meter.start(player.audio.currentTime,w.performance.now());
  }
  w.addEventListener('ed:consent',updateConsent);
  w.addEventListener('storage',e=>{if(e.key==='es5_privacy')updateConsent();});
  w.addEventListener('ed:analytics-player',attach);
  w.addEventListener('ed:download',e=>emit('track_download',{trackId:e.detail?.trackId}));
  d.addEventListener('click',e=>{const a=e.target.closest?.('[data-analytics-track],[data-analytics-offer]');if(!a)return;if(a.dataset.analyticsTrack)emit('track_download',{trackId:a.dataset.analyticsTrack});if(a.dataset.analyticsOffer)emit('offer_click',{offerId:a.dataset.analyticsOffer});});
  // Respect privacy changes even when a browser restores this document from BFCache.
  w.addEventListener('pageshow',updateConsent);d.addEventListener('visibilitychange',()=>{if(d.visibilityState==='visible')updateConsent();});
  attach();updateConsent();return {emit,updateConsent};
}
if(typeof window!=='undefined')startSiteAnalytics();
