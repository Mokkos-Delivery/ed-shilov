import {count,mergedTracks,tracksCSV} from './analytics-core.mjs?v=studio-4';
const number=new Intl.NumberFormat('ru-RU');
const date=value=>{const d=new Date(String(value).slice(0,10)+'T12:00:00Z');return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});};
const pageNames={'/':'Главная','/index.html':'Главная','/music.html':'Музыка','/video.html':'Видео','/bio.html':'Биография','/news.html':'Новости','/contacts.html':'Контакты','/press-kit.html':'Пресс-кит','/privacy.html':'Конфиденциальность','/cookies.html':'Cookies','/data-consent.html':'Согласие'};
const offerNames={booking:'Общая заявка',concert:'Концерт',private:'Частное мероприятие',festival:'Фестиваль'};
export function initAdminAnalytics(api,loadTracks,documentRoot=document){
  const $=id=>documentRoot.getElementById(id),d=documentRoot;
  let connected=false,revision=0,controller=null,rows=[],report=null;
  function text(tag,value,className){const node=d.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
  function message(value,error=false){$('analytics-status').textContent=value;$('analytics-status').dataset.error=String(error);}
  function controls(loading){$('analytics-refresh').disabled=loading||!connected;$('analytics-export').disabled=loading||!report;$('analytics-data').setAttribute('aria-busy',String(loading));}
  function clearReport(){
    report=null;rows=[];$('analytics-data').hidden=true;
    for(const key of ['visits','pageViews','plays','completions','downloads','offerClicks'])$('analytics-'+key).textContent='—';
    for(const id of ['analytics-tracks','analytics-chart','analytics-daily','analytics-pages','analytics-offers'])$(id).replaceChildren();
    for(const id of ['analytics-date-range','analytics-started'])$(id).textContent='';
    $('analytics-track-count').textContent='0';
  }
  function renderTracks(){
    const q=$('analytics-search').value.trim().toLocaleLowerCase('ru-RU'),shown=rows.filter(r=>r.title.toLocaleLowerCase('ru-RU').includes(q)),max=Math.max(1,...rows.map(r=>r.plays));
    $('analytics-tracks').replaceChildren();$('analytics-track-count').textContent=String(rows.length);$('analytics-no-tracks').hidden=shown.length>0;
    for(const r of shown){
      const tr=d.createElement('tr'),name=d.createElement('td');name.append(text('span',r.title,'analytics-track-name'),text('span',r.removed?'Удалён из каталога':r.published?'На сайте':'Скрыт','analytics-track-state'));
      const bar=d.createElement('span');bar.className='analytics-track-bar';bar.setAttribute('aria-hidden','true');const fill=d.createElement('span');fill.style.width=(r.plays/max*100)+'%';bar.append(fill);name.append(bar);tr.append(name);
      for(const key of ['plays','completions','downloads'])tr.append(text('td',number.format(r[key])));$('analytics-tracks').append(tr);
    }
  }
  function renderDaily(daily){
    $('analytics-daily').replaceChildren();
    for(const day of daily){const tr=d.createElement('tr');tr.append(text('td',date(day.date)));for(const key of ['visits','pageViews','plays'])tr.append(text('td',number.format(count(day[key]))));$('analytics-daily').append(tr);}
    const ns='http://www.w3.org/2000/svg',svg=d.createElementNS(ns,'svg'),make=(name,attrs)=>{const n=d.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));return n;};
    svg.setAttribute('viewBox','0 0 720 205');svg.setAttribute('role','img');svg.setAttribute('aria-label','Количество визитов по дням. Подробные значения — в таблице ниже.');
    const max=Math.max(1,...daily.map(x=>count(x.visits))),left=36,right=710,top=12,bottom=170,width=(right-left)/Math.max(1,daily.length);
    for(const fraction of [0,.5,1]){const y=bottom-(bottom-top)*fraction;svg.append(make('line',{x1:left,y1:y,x2:right,y2:y,class:fraction===0?'chart-baseline':'chart-grid'}));const label=make('text',{x:left-8,y:y+4,'text-anchor':'end'});label.textContent=number.format(Math.round(max*fraction));svg.append(label);}
    for(let i=0;i<daily.length;i++){const item=daily[i],height=(bottom-top)*count(item.visits)/max,bar=make('rect',{x:left+i*width+Math.min(2,width/6),y:bottom-height,width:Math.max(1,width-Math.min(4,width/3)),height,rx:Math.min(2,width/5),class:'chart-bar'});const title=make('title',{});title.textContent=date(item.date)+': '+number.format(count(item.visits))+' визитов';bar.append(title);svg.append(bar);}
    if(daily.length)for(const i of [...new Set([0,Math.floor((daily.length-1)/2),daily.length-1])]){const label=make('text',{x:i===0?left:i===daily.length-1?right:left+i*width,y:195,'text-anchor':i===0?'start':i===daily.length-1?'end':'middle'});label.textContent=date(daily[i].date);svg.append(label);}
    $('analytics-chart').replaceChildren(svg);
  }
  function ranking(id,items,names,key){
    const parent=$(id);parent.replaceChildren();if(!items.length){parent.append(text('p','За выбранный период данных пока нет.','hint'));return;}
    for(const item of items){const row=d.createElement('div');row.append(text('span',names[item.id||item.path]||item.id||item.path),text('strong',number.format(count(item[key]))));parent.append(row);}
  }
  function render(data,catalogue){
    report=data;rows=mergedTracks(catalogue,data.tracks);
    for(const key of ['visits','pageViews','plays','completions','downloads','offerClicks'])$('analytics-'+key).textContent=number.format(count(data.totals?.[key]));
    $('analytics-date-range').textContent=date(data.from)+' — '+date(data.to)+' · UTC';
    $('analytics-empty-message').hidden=!data.empty;renderDaily(data.daily||[]);renderTracks();ranking('analytics-pages',data.pages||[],pageNames,'views');ranking('analytics-offers',data.offers||[],offerNames,'clicks');
    $('analytics-started').textContent=data.startedAt?'Сбор данных начался '+date(data.startedAt)+'. Статистика за время до подключения недоступна.':'Сбор данных начнётся после первого посещения с согласием на статистику.';
    $('analytics-data').hidden=false;$('analytics-unavailable').hidden=true;
    message(data.limited?'За один из дней достигнут лимит сбора статистики. Часть посещений могла не попасть в отчёт.':'Обновлено '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'. Учитываются только визиты с согласием на статистику.');
  }
  async function refresh(){
    if(!connected)return;controller?.abort();controller=new AbortController();const generation=++revision,signal=controller.signal;
    controls(true);message('Загружаем посещения и статистику всех песен…');$('analytics-unavailable').hidden=true;
    try{const [data,catalogue]=await Promise.all([api('/api/admin/analytics?days='+$('analytics-period').value,undefined,'GET',signal),loadTracks()]);if(generation!==revision||!connected)return;render(data,catalogue);}
    catch(error){if(generation!==revision||!connected||error.name==='AbortError')return;report=null;rows=[];$('analytics-data').hidden=true;$('analytics-unavailable').hidden=false;const missing=error.code==='ANALYTICS_NOT_CONFIGURED';$('analytics-unavailable-title').textContent=missing?'Статистика ещё не подключена':'Не удалось получить статистику';$('analytics-unavailable-text').textContent=missing?'Подключите хранилище статистики при обновлении сайта. После этого здесь появятся реальные посещения и прослушивания. Данные за прошлое время восстановить нельзя.':'Проверьте подключение к интернету и нажмите «Обновить». '+(error.message||'Сервис временно недоступен.');message(missing?'Сбор данных пока не включён.':'Данные не загружены.',!missing);}
    finally{if(generation===revision)controls(false);}
  }
  $('analytics-refresh').onclick=refresh;$('analytics-period').onchange=refresh;$('analytics-search').oninput=renderTracks;
  $('analytics-export').onclick=()=>{if(!report)return;const blob=new Blob([tracksCSV(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=d.createElement('a');a.href=url;a.download='eduard-shilov-tracks-'+String(report.from).slice(0,10)+'_'+String(report.to).slice(0,10)+'.csv';d.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return {connect(){connected=true;controls(false);},open(){return refresh();},disconnect(){connected=false;revision++;controller?.abort();clearReport();$('analytics-unavailable').hidden=true;$('analytics-search').value='';message('Войдите в студию, чтобы открыть статистику.');controls(false);}};
}
