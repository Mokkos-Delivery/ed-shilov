/* Public configuration only. Drive credentials stay in memory in the admin tab. */
(() => {
  const config=window.ED_CLOUD_CONFIG||{},catalogues=new Map();
  const base=()=>{
    if(!config.workerOrigin)throw Error('Сервис сайта ещё не подключён.');
    const url=new URL(config.workerOrigin);
    if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)throw Error('Некорректный адрес сервиса.');
    return url.origin;
  };
  let turnstileWidget=null,turnstileValue='',turnstileStarted=false;
  window.ED_CLOUD={
    config,
    endpoint(path){return base()+path;},
    mediaURL(value){
      if(!value)return '';
      const url=new URL(value,location.href);
      if(url.origin===location.origin&&url.pathname.startsWith('/media/'))return url.href;
      if(url.origin===config.workerOrigin&&url.pathname.startsWith('/media/'))return url.href;
      return '';
    },
    catalogue(kind){return catalogues.get(kind);},
    publish(kind,items){catalogues.set(kind,items);window.dispatchEvent(new CustomEvent('ed:catalogue',{detail:{kind,items}}));},
    turnstileToken(){return turnstileValue;},
    resetTurnstile(){turnstileValue='';if(turnstileWidget!==null)window.turnstile?.reset(turnstileWidget);}
  };
  const form=document.querySelector('#booking-form');
  if(form&&config.turnstileSiteKey)form.addEventListener('focusin',()=>{
    if(turnstileStarted)return;turnstileStarted=true;
    const target=document.createElement('div');target.id='booking-protection';target.setAttribute('aria-label','Защита формы от спама');
    const submit=form.querySelector('[type="submit"]');submit.before(target);
    const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>{turnstileWidget=window.turnstile.render(target,{sitekey:config.turnstileSiteKey,action:'booking',theme:'auto',callback:value=>turnstileValue=value,'expired-callback':()=>turnstileValue='','error-callback':()=>turnstileValue=''});};
    document.head.append(script);
  });
})();
