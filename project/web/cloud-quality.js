  async function scheduleQuality(t,forceEconomy=false) {
    if(!t)return;
    const selected=playbackSource(t,qualityMode,navigator.connection,forceEconomy),job=++qualityJob;
    qualityController?.abort();
    const source=streamURL(selected.url,window.ED_CLOUD_CONFIG?.workerOrigin,location.origin);
    if(!source)return;
    if(qualityApplied!==selected.quality)await swapQuality(source,t,job,selected.quality);
    qualityStatus.textContent=selected.quality==='original'?tr('Оригинал','Original'):selected.quality+' kbps';
    if(selected.quality==='original'&&['128','192'].includes(qualityMode))toast(tr('Копия этого качества ещё не подготовлена. Доступен оригинал.','This quality is not prepared yet. The original is available.'));
  }
