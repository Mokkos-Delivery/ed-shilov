/* Public visual enhancements; no automatic media playback or tracking. */
(() => {
  if(!document.body.classList.contains('rock-site'))return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const moving=()=>!reduced.matches&&!document.body.classList.contains('motion-off')&&!document.hidden;
  const targets=[...document.querySelectorAll('.rock-hero, .rock-booking, .home-listening, .editorial-feature, .rock-about')];
  const seen=new WeakSet(),animations=new Set();
  function cancelMotion(){if(moving())return;for(const animation of animations)animation.cancel();animations.clear();}
  document.addEventListener('visibilitychange',cancelMotion);reduced.addEventListener('change',cancelMotion);
  new MutationObserver(cancelMotion).observe(document.body,{attributes:true,attributeFilter:['class']});
  if('IntersectionObserver'in window){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){entry.target.classList.toggle('rock-in-view',entry.isIntersecting);if(entry.isIntersecting&&!seen.has(entry.target)){seen.add(entry.target);if(moving()){const animation=entry.target.animate([{transform:'translateY(16px)'},{transform:'translateY(0)'}],{duration:550,easing:'cubic-bezier(.16,1,.3,1)'});animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));}}}},{threshold:.08});
    targets.forEach(t=>observer.observe(t));
  }
  // Animate a real player's controls only while audio is actually playing.
  let playerAudio;
  function bindPlayer(){
    const audio=window.ED_ANALYTICS_PLAYER?.audio;if(!audio||audio===playerAudio)return;playerAudio=audio;
    const update=()=>document.body.classList.toggle('rock-audio-playing',!audio.paused&&!audio.ended&&audio.readyState>=3);
    for(const type of ['playing','pause','ended','waiting','emptied'])audio.addEventListener(type,()=>{update();markTrack();});
    update();
  }
  window.addEventListener('ed:analytics-player',bindPlayer);bindPlayer();
  const select=document.getElementById('booking-format'),form=document.getElementById('booking-form');
  const formats={concert:['Концерт','Concert'],festival:['Фестиваль','Festival'],private:['Частное событие','Private event']};
  let insertedPrefix='';
  function chooseFormat(value,focus=false){
    if(!select||!form||value&& !Object.hasOwn(formats,value))return;
    select.value=value;const message=form.elements.namedItem('message');
    const english=document.documentElement.lang==='en';
    const prefix=value?(english?'Format: ':'Формат: ')+formats[value][english?1:0]+'.\n':'';
    if(message){const current=message.value,body=insertedPrefix&&current.startsWith(insertedPrefix)?current.slice(insertedPrefix.length):current;message.value=prefix+body;insertedPrefix=prefix;message.setCustomValidity(message.value.length>message.maxLength?(english?'Please shorten the message so the event format also fits.':'Сократите сообщение, чтобы в него поместился формат выступления.'):'');message.dispatchEvent(new Event('input',{bubbles:true}));}
    if(focus){document.getElementById('booking')?.scrollIntoView({behavior:moving()?'smooth':'instant',block:'start'});select.focus({preventScroll:true});}
  }
  if(select){
    const requested=new URLSearchParams(location.search).get('format');if(requested&&Object.hasOwn(formats,requested))chooseFormat(requested);
    const message=form.elements.namedItem('message');message?.addEventListener('input',()=>{if(message.value.length<=message.maxLength)message.setCustomValidity('');});
    new MutationObserver(()=>{if(select.value)chooseFormat(select.value);}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    select.addEventListener('change',()=>chooseFormat(select.value));
    form.addEventListener('submit',()=>chooseFormat(select.value),{capture:true});
    document.querySelectorAll('[data-booking-choice]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();chooseFormat(link.dataset.bookingChoice,true);}));
  }
  // Current item is represented by an unobtrusive accent, including live catalogue updates.
  function markTrack(){const track=window.ED_ANALYTICS_PLAYER?.getTrack?.();document.querySelectorAll('[data-track-id]').forEach(card=>card.classList.toggle('rock-current-track',card.dataset.trackId===track?.id));}
  document.addEventListener('click',event=>{if(event.target.closest('[data-play],#next,#previous'))setTimeout(markTrack,0);});
  window.addEventListener('ed:catalogue',markTrack);
})();
