// Public presentation only. Catalogue IDs and the existing studio stay intact.
const words=(ru,en,tag='span',attrs='')=>`<${tag} ${attrs} data-ru="${ru}" data-en="${en}">${ru}</${tag}>`;
const arrow='<span class="rock-arrow" aria-hidden="true"><svg class="rock-icon" viewBox="0 0 24 24" fill="none"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.5"/></svg></span>';
const star='<svg class="rock-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1v22M1 12h22M4.2 4.2l15.6 15.6M4.2 19.8 19.8 4.2" stroke="currentColor" stroke-width="3"/></svg>';
const play='<svg class="rock-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 3 15 9L7 21Z" fill="currentColor"/></svg>';
const formats=[
  ['concert','01','Концерт','Concert','Вечер, который звучит по-настоящему.','An evening with a sound of its own.','Обсудим программу, площадку и продолжительность выступления.','Let’s discuss the programme, venue and length of the performance.'],
  ['festival','02','Фестиваль','Festival','Свой голос на большой сцене.','A distinct voice on the big stage.','Согласуем сет, тайминг и технические условия с вашей командой.','We’ll coordinate the set, timing and technical requirements with your team.'],
  ['private','03','Ваше событие','Your event','Музыка, которая собирает близких.','Music that brings people together.','Расскажите о поводе и гостях — вместе подберём формат.','Tell us about the occasion and your guests. We’ll find the right format.']
];
function offers(contact=false){return `<section class="section rock-booking" id="live" aria-labelledby="live-title">
  <div class="rock-booking-heading"><span class="eyebrow">LIVE / BOOKING</span>${words('Давайте<br>сделаем громче.','Let’s<br>make it live.','h2','id="live-title"').replaceAll('data-ru="Давайте<br>сделаем громче." data-en="Let’s<br>make it live."','data-ru-html="Давайте<br>сделаем громче." data-en-html="Let’s<br>make it live."')}<p>${words('Пригласить Эдуарда Шилова на вашу сцену.','Bring Eduard Shilov to your stage.')}</p><span class="rock-booking-star" aria-hidden="true">${star}</span></div>
  <div class="rock-formats">${formats.map(([key,no,title,enTitle,line,enLine,copy,enCopy])=>`<article class="rock-format"><span class="rock-number">${no}</span><div>${words(title,enTitle,'h3')}<p class="rock-format-line">${words(line,enLine)}</p><p>${words(copy,enCopy)}</p></div><a href="/contacts.html?format=${key}#booking" data-analytics-offer="${key}" ${contact?`data-booking-choice="${key}"`:''} aria-label="Обсудить формат: ${title}">${arrow}<span class="rock-link-label">${words('Обсудить','Enquire')}</span></a></article>`).join('')}<p class="rock-format-note">${words('Дата, состав и стоимость — после обсуждения вашего события.','Date, line-up and fee are agreed after discussing your event.')}</p></div>
</section>`;}
function hero(){return `<section class="rock-hero" aria-labelledby="rock-title">
  <div class="rock-hero-photo"><img src="/assets/img/hero/portrait.webp" srcset="/assets/responsive/b9971b656f2027-640.webp 640w, /assets/img/hero/portrait.webp 1248w" sizes="(max-width: 700px) 100vw, 65vw" width="1248" height="832" alt="Эдуард Шилов" decoding="async" fetchpriority="high"><span class="rock-photo-caption">${words('АРТИСТ / ОСНОВАТЕЛЬ ТРОiКА','ARTIST / FOUNDER OF ТРОiКА')}</span></div>
  <div class="rock-hero-copy"><div class="rock-edition"><span class="rock-live-dot" aria-hidden="true"></span>${words('МУЗЫКА. ВЕРА. ХАРАКТЕР.','MUSIC. FAITH. CHARACTER.')}<span class="rock-edition-line" aria-hidden="true"></span></div>
  <h1 id="rock-title">${words('Эдуард','Eduard')}<span class="rock-surname">${words('Шилов','Shilov')}<i aria-hidden="true">.</i></span></h1>
  <p class="rock-hero-description">${words('Музыка — это голос души, который нельзя заглушить.','Music is the voice of the soul that cannot be silenced.')}</p>
  <div class="actions"><a class="button rock-play-link" href="/music.html">${play}${words('Включить музыку','Explore the music')}</a><a class="rock-book-link" href="/contacts.html#booking" data-analytics-offer="booking">${words('Пригласить на сцену','Book a performance')}${arrow}</a></div>
  <div class="rock-hero-bottom"><button class="text-button intro-replay" id="intro-replay" type="button">${words('Смотреть заставку','Watch the intro')}${arrow}</button><a href="#listening" class="rock-scroll">${words('Листайте со звуком','Scroll with the sound')}<span aria-hidden="true">↓</span></a></div></div>
  <span class="rock-hero-index" aria-hidden="true">ЭШ / LIVE</span>
</section><div class="rock-soundline" aria-hidden="true"><span>ТРОiКА</span><span>${star}</span><span>МУЗЫКА ИМЕЕТ ХАРАКТЕР</span><span>${star}</span><span>EDUARD SHILOV</span><span>${star}</span><span>LIVE</span></div>`;}

export function applyRockPage(html,name){
  if(!html.includes('class="site-header"'))return html;
  html=html.replace('<body ','<body class="rock-site" ');
  html=html.replace(/<img[^>]+id="lang-logo"[^>]*>/,`<span class="rock-monogram" aria-hidden="true">Э<span>Ш</span></span><span class="rock-brand-name">${words('ЭДУАРД ШИЛОВ','EDUARD SHILOV')}<small>${words('ОФИЦИАЛЬНЫЙ САЙТ','OFFICIAL WEBSITE')}</small></span>`);
  html=html.replaceAll('class="button compact" href="/contacts.html"','class="button compact" href="/contacts.html#booking" data-analytics-offer="booking"');
  html=html.replaceAll('class="button" href="/contacts.html"','class="button" href="/contacts.html#booking" data-analytics-offer="booking"');
  html=html.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/g,nav=>nav.replace(/<a\b[^>]*>/g,tag=>tag.includes(`href="/${name}"`)?tag.replace(/\saria-current="[^"]*"/g,'').replace('<a ','<a aria-current="page" '):tag));
  html=html.replace('<div class="footer-top">',`<div class="rock-footer-word" aria-hidden="true">${words('ШИЛОВ.','SHILOV.')}</div><div class="footer-top">`);
  html=html.replace('<div class="footer-bottom">',`<div class="footer-bottom"><button id="motion-toggle" class="text-button rock-motion" type="button" aria-pressed="false">${words('Анимации','Animations')}<span class="rock-motion-state" aria-hidden="true"></span></button>`);
  if(name==='index.html'){
    html=html.replace(/<section class="hero stage-hero live-hero">[\s\S]*?<\/section>/,hero());
    html=html.replace('class="section home-listening"','class="section home-listening" id="listening"');
    html=html.replace('data-ru="Выберите свою песню" data-en="Find your song">Выберите свою песню','data-ru="Нажми на play." data-en="Press play.">Нажми на play.');
    html=html.replace('<section class="section restored-banners"',offers()+'<section class="section restored-banners"');
    html=html.replace('class="section about-short"','class="section about-short rock-about"');
  }
  if(name==='contacts.html'){
    html=html.replace('data-ru="Пригласить на выступление." data-en="Book a performance.">Пригласить на выступление.','data-ru="Встретимся на сцене." data-en="See you on stage.">Встретимся на сцене.');
    html=html.replace('<div class="contact-layout">','<div class="rock-booking-intro">'+words('КОНЦЕРТЫ / ФЕСТИВАЛИ / ВАШИ СОБЫТИЯ','CONCERTS / FESTIVALS / YOUR EVENTS','span','class="eyebrow"')+'</div><div class="contact-layout" id="booking">');
    html=html.replace('<div class="form-grid"><label>E-mail',`<label class="rock-format-select">${words('Формат выступления','Performance format')}<select id="booking-format"><option value="">${'Выберите формат / Choose a format'}</option>${formats.map(([key,,ru,en])=>`<option value="${key}" data-ru="${ru}" data-en="${en}">${ru}</option>`).join('')}</select></label><div class="form-grid"><label>E-mail`);
    html=html.replace('</main>',offers(true)+'</main>');
  }
  if(name==='press-kit.html'){
    html=html.replaceAll('Официальная биография артиста в формате PDF.','Официальная биография артиста в формате DOCX.').replaceAll('Official artist biography in PDF format.','Official artist biography in DOCX format.');
    html=html.replaceAll('Официальный логотип в векторном и растровом форматах.','Официальный логотип в формате JPEG.').replaceAll('Official logo in vector and raster formats.','Official logo in JPEG format.');
  }
  return html;
}
