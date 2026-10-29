"""Real Chromium UI/flow regression; Google, Firebase and Worker are controlled fixtures.
No live sign-in, production writes or Telegram messages. Requires Python Playwright + Chromium.
Run from project/: python3 tests/browser_studio.py
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import io, json, math, struct, wave, re, subprocess

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build'/'browser'
OUT.mkdir(parents=True,exist_ok=True)
from PIL import Image, ImageDraw
image=Image.new('RGB',(800,800),'#243e37');draw=ImageDraw.Draw(image)
for n in range(460,10,-13):draw.ellipse((400-n,450-n,400+n,450+n),outline='#7c9786',width=2)
draw.rectangle((80,85,600,220),fill='#243e37');draw.text((100,120),'EDUARD SHILOV / STUDIO',fill='#ecebdc',font_size=30)
img=io.BytesIO();image.save(img,format='PNG');cover=img.getvalue()
sound=io.BytesIO()
with wave.open(sound,'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000)
 w.writeframes(b''.join(struct.pack('<h',int(2000*math.sin(2*math.pi*220*i/8000))) for i in range(24000)))
audio=sound.getvalue()
audio_path=OUT/'Город_у_моря.wav';audio_path.write_bytes(audio)
cover_path=OUT/'Обложка.png';cover_path.write_bytes(cover)
video_path=OUT/'fixture.mp4'
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','lavfi','-i','color=c=0x243e37:s=160x160:r=10','-t','0.4','-c:v','libx264','-pix_fmt','yuv420p',str(video_path)],check=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw): super().__init__(*args,directory=str(ROOT/'public'),**kw)
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
state={'creates':[],'files':{},'uploads':{},'next':0,'failPut':True,'sendCount':0,'posts':{}}
config={'firebase':{'projectId':'fixture-project','apiKey':'fixture-public','appId':'fixture-app'},'adminUid':'fixture_owner','workerOrigin':'https://media.fixture.test','uploadFolderId':'fixture_folder_1234'}
headers={'Access-Control-Allow-Origin':base,'Access-Control-Expose-Headers':'Location, Range, Content-Length, Content-Range','Access-Control-Allow-Headers':'*'}
def route_handler(route):
 request=route.request;u=request.url
 def reply(value,status=200,extra=None): route.fulfill(status=status,content_type='application/json',body=json.dumps(value),headers={**headers,**(extra or {})})
 if 'www.gstatic.com/firebasejs/' in u:
  route.fulfill(content_type='text/javascript',body=(ROOT/'tests/fixtures/browser-firebase.mjs').read_text(),headers=headers);return
 if '/js/cloud-config.js' in u: route.fulfill(content_type='text/javascript',body='window.ED_CLOUD_CONFIG='+json.dumps(config));return
 if '/js/cloud-image-map.js' in u:route.fulfill(content_type='text/javascript',body='window.SITE_IMAGE_MAP={};');return
 if '/drive/v3/files/generateIds?' in u:
  state['next']+=1;reply({'ids':[f'fixture_file_{state["next"]:04}']});return
 if 'www.googleapis.com/drive/v3/files/' in u:
  id=u.split('/files/')[1].split('?')[0]
  if id==config['uploadFolderId']:reply({'id':id,'mimeType':'application/vnd.google-apps.folder','capabilities':{'canAddChildren':True}})
  else:reply(state['files'].get(id,{}),200 if id in state['files'] else 404)
  return
 if 'www.googleapis.com/upload/drive/v3/files' in u:
  if request.method=='POST':
   metadata=json.loads(request.post_data);id=metadata['id'];state['creates'].append(id);state['uploads'][id]=metadata
   reply({},extra={'Location':'https://www.googleapis.com/upload/drive/v3/files?upload_id='+id});return
  id=u.split('upload_id=')[1];metadata=state['uploads'][id]
  if request.headers.get('content-range','').startswith('bytes */'):
   if id in state['files']:reply(state['files'][id])
   else:reply({},308)
   return
  if state['failPut']:state['failPut']=False;reply({},401);return
  value={**metadata,'size':str(len(request.post_data_buffer))};state['files'][id]=value;reply(value);return
 if u.startswith('https://media.fixture.test'):
  if '/api/admin/readiness' in u:reply({'ok':True,'readerReady':True,'release':'2026-10-29-studio-4'});return
  if '/api/admin/verify' in u:
   id=json.loads(request.post_data)['id'];f=state['files'][id]
   reply({'ok':True,'media':{'driveId':id,'name':f['name'],'mime':f['mimeType'],'size':int(f['size']),'published':True}});return
  if '/api/admin/social/history' in u:reply({'ok':True,'posts':list(state['posts'].values())});return
  if '/api/admin/social' in u:
   if request.method=='GET':reply({'ok':True,'channels':{k:{'enabled':True,'configured':True,'platform':'telegram','id':id,'label':name} for k,id,name in [('telegram_1','-1001111111111','Эдуард Шилов'),('telegram_2','-1002222222222','ТРОiКА')]}});return
   # Only a fixture receives multipart. A repeated ID returns the original result.
   raw=request.post_data_buffer.decode('utf-8',errors='replace');m=re.search(r'name="post"\r\n\r\n([^\r]+)',raw);body=json.loads(m.group(1)) if m else json.loads(raw)
   id=body['requestId']
   if id not in state['posts']:
    state['sendCount']+=len(body['channels']);state['posts'][id]={**body,'createdAt':'2026-10-29T12:00:00Z','results':{k:{'state':'sent','postId':'42'} for k in body['channels']}}
   reply({'ok':True,'post':state['posts'][id]});return
  if '/media/' in u:
   photo=any(x in u for x in ['.png','.webp','.jpg'])
   route.fulfill(content_type='image/png' if photo else 'audio/wav',body=cover if photo else audio,headers=headers);return
 if u.startswith(base): route.continue_();return
 route.abort()  # No requests to Google/Telegram/other external services escape.

def no_overflow(page,label):
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow: {label}'
def wait_ready(page):expect(page.locator('#studio')).to_be_visible();expect(page.locator('#drive-card')).to_have_attribute('data-state','ready')
report={'browser':'Chromium','liveServices':False,'checks':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1440,'height':1120},device_scale_factor=1,locale='ru-RU')
 context.route('**/*',route_handler)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/admin.html');expect(page.locator('#login-screen')).to_be_visible();page.locator('#login').click();wait_ready(page)
 assert page.evaluate('window.__studioFixture.persistence')=='LOCAL'
 page.locator('#file').set_input_files(str(audio_path))
 expect(page.locator('#title')).to_have_value('Город у моря')
 page.locator('#cover').set_input_files(str(cover_path))
 expect(page.locator('#preview-cover')).to_be_visible();expect(page.locator('#preview-audio')).to_be_visible()
 page.locator('#date').fill('2026-10-29')
 page.screenshot(path=str(OUT/'desktop-editor.png'),full_page=True);no_overflow(page,'desktop editor')
 page.locator('#save').click();expect(page.locator('#save')).to_have_text('Продолжить загрузку');expect(page.locator('#status')).to_contain_text('не опубликованы')
 assert len(state['creates'])==1
 page.locator('#connect').click();wait_ready(page)
 # Lose the Firestore response after accepting the batch, then retry the same ID.
 page.evaluate('window.__studioFixture.loseCommit=true');page.locator('#save').click();expect(page.locator('#upload-status')).to_contain_text('Ответ Firestore потерян');expect(page.locator('#save')).to_be_enabled()
 assert len(state['creates'])==2, {'creates':state['creates'],'phase':page.locator('#upload-status').inner_text(),'errors':errors}  # One audio file and one cover, no retry duplicate.
 page.reload();wait_ready(page)
 page.locator('#file').set_input_files(str(audio_path));page.locator('#cover').set_input_files(str(cover_path))
 page.locator('#save').click();expect(page.locator('#upload-phase')).to_have_text('Опубликовано')
 assert len(state['creates'])==2
 data=page.evaluate('JSON.parse(localStorage.getItem("fixtureCatalog"))');assert len(data['tracks'])==1;assert len(data['media'])==2
 popup_count=page.evaluate('window.__studioFixture.popupCount');page.reload();wait_ready(page)
 assert page.evaluate('window.__studioFixture.popupCount')==0
 report['checks']+=['native browser fetch + real WAV and cover preview','401 + reconnect + resumable retry','lost Firestore acknowledgement + F5 + same files and document ID','one audio and one cover, no duplicate files','F5 restores Firebase and unexpired Drive grant without popup']
 page.locator('#open-library').click();expect(page.locator('#items .item')).to_have_count(1);expect(page.locator('#items audio')).to_be_visible()
 page.locator('#items audio').evaluate('(a)=>a.play()');page.wait_for_function('document.querySelector("#items audio").currentTime>0')
 page.screenshot(path=str(OUT/'desktop-library.png'),full_page=True)
 page.locator('#items .item-actions button').nth(1).click()
 try:expect(page.locator('#items .badge')).to_contain_text('Скрыт')
 except Exception:
  print({'catalog':page.evaluate('localStorage.getItem("fixtureCatalog")'),'status':page.locator('#status').inner_text(),'errors':errors});raise
 page.locator('#items .item-actions button').first.click();expect(page.locator('#title')).to_have_value('Город у моря')
 report['checks']+=['library audio playback in Chromium','edit + visibility controls']
 page.locator('#open-social').click();page.locator('#social-text').fill('Тестовый анонс. Этот пост существует только в локальной проверке.')
 page.locator('#social-file').set_input_files({'name':'Обложка.png','mimeType':'image/png','buffer':cover})
 page.locator('#social-telegram_1').check();page.locator('#social-telegram_2').check();page.locator('#social-review').click()
 expect(page.locator('#social-preview')).to_be_visible();expect(page.locator('#social-send')).to_be_enabled()
 page.screenshot(path=str(OUT/'desktop-telegram.png'),full_page=True)
 page.locator('#social-send').click();expect(page.locator('#social-status')).to_contain_text('Опубликован');assert state['sendCount']==2
 page.locator('#social-send').click();expect(page.locator('#social-status')).to_contain_text('Опубликован');assert state['sendCount']==2
 report['checks']+=['Telegram local photo preview, explicit send, two recipients + same-attempt retry']
 page.locator('#social-new').click();page.locator('#social-file').set_input_files(str(video_path));expect(page.locator('#social-preview-video')).to_be_visible()
 page.locator('#social-telegram_2').check();page.locator('#social-text').fill('x'*1025);page.locator('#social-review').click();expect(page.locator('#social-send')).to_be_disabled();expect(page.locator('#social-status')).to_contain_text('1024')
 page.locator('#social-text').fill('Локальная проверка видео');page.locator('#social-review').click();expect(page.locator('#social-send')).to_be_enabled();assert state['sendCount']==2
 page.locator('#social-send').click();expect(page.locator('#social-status')).to_contain_text('Опубликован');assert state['sendCount']==3
 report['checks']+=['MP4 local preview, 1024-character validation, one recipient and no send before confirmation']
 # Same browser profile, new tab: restore valid Drive grant with no OAuth popup.
 second=context.new_page();second.goto(base+'/admin.html');wait_ready(second);assert second.evaluate('window.__studioFixture.popupCount')==0;second.close()
 # Expired Drive must not log out Firebase or prevent Telegram composition.
 page.evaluate('''()=>{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('edStudioDrive:')){const d=JSON.parse(localStorage.getItem(k));d.expiresAt=1;localStorage.setItem(k,JSON.stringify(d));}}}''')
 page.reload();expect(page.locator('#studio')).to_be_visible();expect(page.locator('#connect')).to_be_visible();page.locator('#open-social').click();expect(page.locator('#social-text')).to_be_editable()
 report['checks']+=['new tab restores valid authorization','expired Drive preserves site login and independent Telegram editor']
 page.locator('#connect').click();wait_ready(page)
 for width in [390,320,768]:
  page.set_viewport_size({'width':width,'height':844});page.locator('#open-editor').click();no_overflow(page,f'editor {width}')
  page.locator('#open-library').click();no_overflow(page,f'library {width}')
  page.locator('#open-social').click();no_overflow(page,f'telegram {width}')
 page.set_viewport_size({'width':390,'height':844});page.locator('#open-editor').click();page.screenshot(path=str(OUT/'mobile-editor.png'),full_page=True)
 page.locator('#open-social').click();page.screenshot(path=str(OUT/'mobile-telegram.png'),full_page=True)
 report['checks']+=['desktop 1440px + mobile/tablet 320, 390, 768px without horizontal overflow']
 assert not errors,errors
 report['pageErrors']=errors;report['fileCreates']=state['creates'];report['fixtureTelegramDeliveries']=state['sendCount'];report['passed']=True
 context.close();browser.close()
server.shutdown();(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
