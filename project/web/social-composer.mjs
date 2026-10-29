const names={telegram_1:'Эдуард Шилов',telegram_2:'ТРОiКА'};
const destinationName=(post,key,channels)=>post.destinations?.[key]?.label||channels[key]?.label||names[key]||({telegram:'Telegram',vk:'VK'})[key]||'Площадка';
const states={sent:'Опубликован',failed:'Отклонён площадкой',unknown:'Результат неизвестен - проверьте площадку',pending:'В процессе или ответ не сохранён - проверьте площадку'};
export function initSocialComposer(api){
  const $=id=>document.getElementById(id),form=$('social-form'),preview=$('social-preview'),feedback=$('social-status');
  let attachmentFile=null,attachmentURL='',requiredAttachment=null;
  let channels={},reviewed=false,sending=false,attempted=false,requestId=crypto.randomUUID(),historyReady=false;
  let attemptPayload=null;
  const selected=()=>Object.keys(names).filter(k=>$('social-'+k).checked);
  function controls(){
    $('social-fields').disabled=sending||attempted;
    $('social-send').disabled=sending||!reviewed||!historyReady||!selected().length;
    $('social-new').disabled=sending;$('social-refresh').disabled=sending;$('social-review').disabled=sending||attempted;
  }
  function invalidate(){reviewed=false;preview.hidden=true;$('social-counter').textContent=String(($('social-text').value+($('social-url').value?'\n\n'+$('social-url').value:'')).length)+' / '+(attachmentFile?1024:4096);$('social-text').required=!attachmentFile;controls();}
  function clearAttachment(){if(attachmentURL)URL.revokeObjectURL(attachmentURL);attachmentURL='';attachmentFile=null;requiredAttachment=null;$('social-file').value='';$('social-file-preview').hidden=true;$('social-preview-image').removeAttribute('src');$('social-preview-video').pause();$('social-preview-video').removeAttribute('src');}
  function reset(){clearAttachment();form.reset();attempted=false;attemptPayload=null;requestId=crypto.randomUUID();$('social-send').textContent='Отправить в выбранные каналы →';feedback.textContent='';invalidate();configure();}
  function configure(){
    for(const key of Object.keys(names)){const input=$('social-'+key);input.disabled=!channels[key]?.configured;input.closest('label').hidden=channels[key]?.enabled===false;if(input.disabled)input.checked=false;$('social-'+key+'-state').textContent=channels[key]?.configured?'Подключён':'Не настроен';$('social-'+key+'-name').textContent=channels[key]?.label||names[key];}
    controls();
  }
  function showResult(post,parent){
    for(const channel of post.channels){
      const result=post.results?.[channel]||{state:'pending'},row=document.createElement('p');
      row.className='social-result '+result.state;row.textContent=destinationName(post,channel,channels)+': '+(states[result.state]||states.unknown);
      if(result.code)row.append(' (код '+result.code+')');
      if(result.message)row.append('. '+result.message);
      // Snapshot IDs preserve the original destination even if configuration changes.
      const target=post.destinations?.[channel]||channels[channel];
      let href='';if(result.state==='sent'&&/^\d+$/.test(result.postId||'')){
        if(target?.platform==='vk'&&/^[1-9]\d*$/.test(target.id||''))href='https://vk.ru/wall-'+target.id+'_'+result.postId;
        if(target?.platform==='telegram'){
          if(/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target.id||''))href='https://t.me/'+target.id.slice(1)+'/'+result.postId;
          else if(/^-100\d{5,20}$/.test(target.id||''))href='https://t.me/c/'+target.id.slice(4)+'/'+result.postId;
        }
      }
      if(href){const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' Открыть пост ↗';row.append(link);}
      parent.append(row);
    }
  }
  async function refresh(){
    $('social-refresh').disabled=true;
    try{
      const result=await api('/api/admin/social/history',undefined,'GET');historyReady=true;$('social-history').replaceChildren();
      if(!result.posts.length)$('social-history').textContent='Публикаций пока нет.';
      for(const post of result.posts){
        const card=document.createElement('article');card.className='social-history-item';const date=document.createElement('small');date.textContent=new Date(post.createdAt).toLocaleString('ru-RU');
        const text=document.createElement('p');text.className='social-history-text';text.textContent=post.text+(post.url?'\n\n'+post.url:'');card.append(date,text);if(post.attachment){const media=document.createElement('small');media.textContent=(post.attachment.kind==='photo'?'Картинка: ':'Видео: ')+post.attachment.name;card.append(media);}showResult(post,card);
        const failed=post.channels.filter(x=>post.results?.[x]?.state==='failed');
        if(failed.length){const retry=document.createElement('button');retry.type='button';retry.textContent='Подготовить повтор: '+failed.map(x=>destinationName(post,x,channels)).join(', ');retry.onclick=()=>{if(sending)return;reset();$('social-text').value=post.text;$('social-url').value=post.url;for(const k of failed)if(names[k]&&channels[k]?.configured)$('social-'+k).checked=true;requiredAttachment=post.attachment||null;feedback.textContent='Выбраны только площадки, отклонившие пост. '+(requiredAttachment?'Прикрепите файл заново и проверьте предпросмотр.':'Проверьте предпросмотр.');controls();form.scrollIntoView({behavior:'smooth',block:'start'});};card.append(retry);}
        $('social-history').append(card);
      }
    }catch(error){historyReady=false;$('social-history').textContent=error.message;}
    finally{controls();}
  }
  $('social-review').onclick=()=>{
    if(!form.reportValidity()||!selected().length){feedback.textContent='Введите текст и выберите настроенную площадку.';return;}
    const text=$('social-text').value.trim(),url=$('social-url').value.trim(),message=text+(url?'\n\n'+url:'');
    if((!text&&!attachmentFile)||message.length>(attachmentFile?1024:4096)){feedback.textContent=attachmentFile?'С картинкой или видео подпись со ссылкой — до 1024 символов.':'Введите текст до 4096 символов.';return;}if(requiredAttachment&&!attachmentFile){feedback.textContent='Для повтора прикрепите картинку или видео заново.';return;}
    if(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{feedback.textContent='Укажите публичную ссылку https://';return;}}
    $('social-preview-text').textContent=message;$('social-preview-destinations').textContent='Каналы: '+selected().map(x=>channels[x].label).join(', ');
    preview.hidden=false;reviewed=true;feedback.textContent='Проверьте текст и площадки. Кнопка ниже опубликует пост сейчас.';controls();
  };
  form.addEventListener('input',invalidate);
  form.onsubmit=async event=>{
    event.preventDefault();if(sending||!reviewed||!historyReady)return;
    // A retry must use an immutable snapshot, including the original recipients.
    // Refreshing channel configuration must not change an uncertain attempt.
    let payload=attemptPayload;
    if(!payload){payload={requestId,text:$('social-text').value,url:$('social-url').value,channels:selected(),confirmed:true};if(attachmentFile){const form=new FormData();form.set('post',JSON.stringify(payload));form.set('media',attachmentFile);payload=form;}attemptPayload=payload;}
    sending=true;attempted=true;feedback.textContent='Отправка…';controls();
    try{
      const result=await api('/api/admin/social',payload,'POST');feedback.replaceChildren();showResult(result.post,feedback);
      if(result.journalWarning)feedback.append(document.createTextNode(result.journalWarning));
      // A second click uses the same ID and only retrieves the existing result.
      $('social-send').textContent='Проверить результат попытки';await refresh();
    }catch(error){feedback.textContent=error.message+' Повторная проверка использует тот же номер и не отправляет пост второй раз.';$('social-send').textContent='Проверить результат попытки';}
    finally{sending=false;controls();}
  };
  $('social-file').onchange=()=>{
    if(sending||attempted)return;$('social-preview-video').pause();$('social-preview-video').removeAttribute('src');if(attachmentURL)URL.revokeObjectURL(attachmentURL);attachmentURL='';attachmentFile=null;
    const file=$('social-file').files[0];$('social-file-preview').hidden=!file;
    if(file){const extension=file.name.split('.').pop().toLowerCase(),mime=({'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','mp4':'video/mp4'})[extension];
      if(!mime||file.size<=0||(file.type&&file.type!==mime)||file.size>(mime==='video/mp4'?20:10)*1024*1024){$('social-file').value='';$('social-file-preview').hidden=true;feedback.textContent='Выберите JPG/PNG до 10 МБ или MP4 до 20 МБ.';invalidate();return;}
      attachmentFile=new File([file],file.name,{type:mime});attachmentURL=URL.createObjectURL(attachmentFile);$('social-preview-image').hidden=mime==='video/mp4';$('social-preview-video').hidden=mime!=='video/mp4';$(mime==='video/mp4'?'social-preview-video':'social-preview-image').src=attachmentURL;$('social-file-name').textContent=file.name;
    }invalidate();
  };
  $('social-remove-file').onclick=()=>{if(sending||attempted)return;clearAttachment();invalidate();};
  $('social-new').onclick=()=>{reset();$('social-send').textContent='Опубликовать на выбранных площадках';};$('social-refresh').onclick=refresh;
  return {
    async connect(){reset();try{channels=(await api('/api/admin/social',undefined,'GET')).channels;configure();await refresh();}catch(error){channels={};historyReady=false;configure();feedback.textContent='Публикации пока не подключены. '+error.message;}},
    disconnect(){channels={};historyReady=false;reset();$('social-history').replaceChildren();feedback.textContent='';}
  };
}
