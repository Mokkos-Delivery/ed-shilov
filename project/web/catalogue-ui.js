  // Firestore sends published items; DOM text is created without interpolating user HTML.
  function cloudImage(source,alt='') {
    const image=new Image();image.src=window.ED_CLOUD.mediaURL(source)||resolveImage('/assets/img/branding/RUS.webp');image.alt=alt;image.loading='lazy';image.decoding='async';image.width=800;image.height=800;return image;
  }
  function cloudButton(text,attribute,id,className='text-button') {
    const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;button.setAttribute(attribute,id);return button;
  }
  function cloudMusicCard(t) {
    const card=document.createElement('article');card.className='music-card';card.dataset.trackId=t.id;
    const cover=document.createElement('div');cover.className='cover';cover.append(cloudImage(t.cover),cloudButton('▶','data-play',t.id,'play-cover'));
    const row=document.createElement('div');row.className='card-row';const text=document.createElement('div');const label=document.createElement('small');label.className='eyebrow';label.dataset.ru='Эдуард Шилов';label.dataset.en='Eduard Shilov';label.textContent=tr(label.dataset.ru,label.dataset.en);
    const title=document.createElement('h3');title.textContent=t.title;text.append(label,title);
    row.append(text,cloudButton('♡','data-fav',t.id,'icon-button favourite'));
    const tools=document.createElement('div');tools.className='card-tools';const link=document.createElement('a');link.href=window.ED_CLOUD.mediaURL(t.audio_mp3||t.audio_wav)||'#';link.dataset.downloadTrack=t.id;link.download='';
    link.dataset.ru='Скачать';link.dataset.en='Download';link.textContent=tr(link.dataset.ru,link.dataset.en);
    const share=cloudButton(tr('Поделиться','Share'),'data-share-track',t.id);share.dataset.ru='Поделиться';share.dataset.en='Share';
    const ring=cloudButton(tr('Рингтон','Ringtone'),'data-ringtone',t.id);ring.dataset.ru='Рингтон';ring.dataset.en='Ringtone';
    tools.append(link,share,ring);card.append(cover,row,tools);return card;
  }
  function cloudVideoCard(v) {
    const card=document.createElement('article');card.className='video-card';card.dataset.videoId=v.id;
    const poster=cloudButton('','data-video',v.id,'video-poster');poster.setAttribute('aria-label',tr('Смотреть: ','Watch: ')+v.title);const play=document.createElement('span');play.className='play-cover';play.textContent='▶';play.setAttribute('aria-hidden','true');poster.append(cloudImage(v.coverUrl),play);
    const label=document.createElement('small');label.className='eyebrow';label.dataset.ru='Видео';label.dataset.en='Video';label.textContent=tr('Видео','Video');const title=document.createElement('h3');title.textContent=v.title;card.append(poster,label,title);return card;
  }
  function cloudNews(items) {
    for(const grid of $$('.news-grid')) {
      const shown=grid.id==='news-list'?items:items.slice(0,3);grid.replaceChildren();
      for(const n of shown){const card=document.createElement('article');card.className='news-card';const a=document.createElement('a');a.href='/news.html?item='+encodeURIComponent(n.id);if(n.cover)a.append(cloudImage(n.cover));const date=document.createElement('time');date.dateTime=n.date||'';date.textContent=n.date||'';const title=document.createElement('h3');title.textContent=n.title;const p=document.createElement('p');p.textContent=n.excerpt||'';const more=document.createElement('span');more.className='text-link';more.dataset.ru='Читать →';more.dataset.en='Read →';more.textContent=tr('Читать →','Read →');a.append(date,title,p,more);card.append(a);grid.append(card);}
    }
    const detail=$('#news-detail'),id=new URLSearchParams(location.search).get('item');if(!detail||!id)return;
    const n=items.find(x=>x.id===id);detail.replaceChildren();detail.hidden=false;$('#news-list').hidden=true;
    const back=document.createElement('a');back.href='/news.html';back.className='text-link';back.textContent=tr('← Все новости','← All news');detail.append(back);
    if(!n){const p=document.createElement('p');p.textContent=tr('Новость не опубликована.','This news item is not published.');detail.append(p);return;}
    const title=document.createElement('h2');title.textContent=n.title;const date=document.createElement('time');date.textContent=n.date||'';detail.append(title,date);if(n.cover)detail.append(cloudImage(n.cover,n.title));detail.append(safeContent(n.content||n.excerpt||''));
    for(const [key,value] of Object.entries(n.links||{})){const url=safeURL(value);if(!url)continue;const link=document.createElement('a');link.href=url;link.className='button secondary';link.textContent=key==='watch'?tr('Смотреть','Watch'):key==='listen'?tr('Слушать','Listen'):tr('Открыть','Open');detail.append(link);}
  }
  function applyCloudCatalogue({kind,items}) {
    if(kind==='tracks') {
      tracks=items;
      for(const grid of $$('.music-grid')) {
        const shown=grid.id==='music-grid'?tracks:tracks.filter(t=>t.featured).slice(0,6);
        const existing=new Map([...grid.children].filter(x=>x.dataset.trackId).map(x=>[x.dataset.trackId,x]));
        const nodes=shown.map(t=>{const card=existing.get(t.id);if(!card)return cloudMusicCard(t);card.querySelector('h3').textContent=t.title;const image=card.querySelector('img'),url=window.ED_CLOUD.mediaURL(t.cover);if(url&&image.src!==url){image.removeAttribute('srcset');image.src=url;}const link=card.querySelector('[data-download-track]');if(link)link.href=window.ED_CLOUD.mediaURL(t.audio_mp3||t.audio_wav)||'#';return card;});grid.replaceChildren(...nodes);
      }
      if(current){const item=tracks.find(x=>x.id===current.id);if(item){current=item;$('#player-title').textContent=item.title;}else{audio.pause();current=null;$('#player').hidden=true;document.body.classList.remove('has-player');}}
      updateFavouriteButtons();filterMusic();
    }else if(kind==='videos') {
      videos=items;const grid=$('#video-grid');if(grid)grid.replaceChildren(...videos.map(cloudVideoCard));filterVideo();
      if(videoItem&&!videos.some(v=>v.id===videoItem.id))$('#media-dialog').close();
    }else if(kind==='news')cloudNews(items);
    else if(kind==='photos'&&document.querySelector('.biography, .bio-body, .bio-content, .photo-grid')) {
      let section=$('#published-gallery');if(!section){section=document.createElement('section');section.id='published-gallery';section.className='section in-view';const heading=document.createElement('h2');heading.dataset.ru='Новые фотографии';heading.dataset.en='New photos';heading.textContent=tr('Новые фотографии','New photos');const grid=document.createElement('div');grid.className='photo-grid';section.append(heading,grid);document.querySelector('main').append(section);}
      section.hidden=items.length===0;const grid=section.querySelector('.photo-grid');grid.replaceChildren();for(const p of items){const button=document.createElement('button');button.type='button';button.className='photo-grid-item';button.dataset.photo=window.ED_CLOUD.mediaURL(p.cover);button.dataset.caption=p.title;button.append(cloudImage(p.cover,p.title));grid.append(button);}
    }
  }
  window.addEventListener('ed:catalogue',ev=>applyCloudCatalogue(ev.detail));
  for(const kind of ['tracks','videos','news','photos']){const items=window.ED_CLOUD?.catalogue(kind);if(items)applyCloudCatalogue({kind,items});}
