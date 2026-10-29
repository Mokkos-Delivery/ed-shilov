import fs from 'node:fs';
export function buildAdminPreview(root){
  let html=fs.readFileSync(root+'/web/admin.html','utf8').replace(/<script[^>]*>[^]*?<\/script>/g,'');
  html=html.replace(/<link rel="stylesheet" href="\/assets\/css\/admin.css\?v=[^"]+">/,'<style>'+fs.readFileSync(root+'/web/admin.css','utf8')+'</style>');
  html=html.replace(/<img src="\/assets\/img\/branding\/RUS.webp"[^>]*>/,'<b style="font-size:26px;color:var(--accent)">ЭШ</b>');
  html=html.replace('id="login-screen"','id="login-screen" hidden').replace('id="studio" hidden','id="studio"');
  html=html.replace('<main>','<main><p class="social-preview"><strong>Предпросмотр админки.</strong> Данные демонстрационные. Загрузка и отправка постов отключены.</p>');
  html=html.replace('<strong id="account"></strong>','<strong id="account">Режим предпросмотра</strong>');
  let js=fs.readFileSync(root+'/web/social-composer.mjs','utf8').replace('export function initSocialComposer','function initSocialComposer');
  js+=`\nconst api=async(path,body,method)=>{
    if(method==='POST')throw Error('Это предпросмотр: посты не отправляются.');
    if(path.endsWith('/history'))return {ok:true,posts:[]};
    return {ok:true,channels:{
      telegram_1:{configured:true,platform:'telegram',id:'@demo_eduard',label:'Telegram · Эдуард Шилов (демо)'},
      telegram_2:{configured:true,platform:'telegram',id:'@demo_troika',label:'Telegram · ТРОiКА (демо)'},
      vk_troika:{enabled:false,configured:false,platform:'vk',id:'12345',label:'VK · ТРОiКА (демо)'},
      vk_eduard:{enabled:false,configured:false,platform:'vk',id:'56789',label:'VK · Эдуард Шилов (демо)'}}};
  };
  initSocialComposer(api).connect();
  for(const id of ['login','connect','logout','seed','prepare-all','new-item','save'])document.getElementById(id).disabled=true;
  document.getElementById('editor').onsubmit=e=>e.preventDefault();\n`;
  html=html.replace('</body>','<script type="module">'+js+'</script></body>');
  fs.mkdirSync(root+'/preview',{recursive:true});fs.writeFileSync(root+'/preview/admin.html',html);
}
