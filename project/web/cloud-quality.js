  async function scheduleQuality(t,forceEconomy=false) {
    if(!t)return;
    const desired=desiredQuality(forceEconomy),job=++qualityJob;
    qualityController?.abort();
    if(desired==='original'){if(qualityApplied!=='original')await swapQuality(getAudio(t),t,job,'original');qualityStatus.textContent=tr('Оригинал','Original');return;}
    const source=window.ED_CLOUD.mediaURL(t.qualities?.[desired]);
    if(!source){
      if(qualityApplied!=='original')await swapQuality(getAudio(t),t,job,'original');
      qualityStatus.textContent=tr('Доступен оригинал','Original available');
      if(qualityMode!=='auto')toast(tr('Копия этого качества ещё не подготовлена. Доступен оригинал.','This quality is not prepared yet. The original is available.'));
      return;
    }
    await swapQuality(source,t,job,desired);
  }
