"""Public-site regression in real Chromium; media/Worker are controlled fixtures.
No production analytics, mail or cloud writes. Run after node tools/build.mjs --draft.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import io, json, math, struct, wave

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build'/'public-browser';OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'public'),**kwargs)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
cover=b'''<svg xmlns="http://www.w3.org/2000/svg" width="1248" height="832" viewBox="0 0 1248 832"><rect width="1248" height="832" fill="#363b38"/><path d="M500 0h210L300 832H90zM1050 0h210L850 832H640z" fill="#686d65"/><text x="660" y="430" fill="#ece9df" font-size="26" font-family="sans-serif">TEST MEDIA</text></svg>'''
sound=io.BytesIO()
with wave.open(sound,'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000)
 w.writeframes(b''.join(struct.pack('<h',int(1200*math.sin(2*math.pi*220*i/8000))) for i in range(8000*3)))
audio=sound.getvalue();api_calls=[]
config={'firebase':{},'workerOrigin':'https://media.fixture.test','turnstileSiteKey':''}
def route_handler(route):
 req=route.request;u=req.url
 if '/js/cloud-config.js' in u:route.fulfill(content_type='text/javascript',body='window.ED_CLOUD_CONFIG='+json.dumps(config));return
 if '/js/live-catalog.mjs' in u:route.fulfill(content_type='text/javascript',body='// Static catalogue fixture.');return
 if '/media/' in u or any(p in u for p in ['/assets/img/','/assets/images/','/assets/responsive/']):
  photo=any(p in u.lower() for p in ['.webp','.png','.jpg','.jpeg'])
  route.fulfill(content_type='image/svg+xml' if photo else 'audio/wav',body=cover if photo else audio,headers={'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes'});return
 if u.startswith('https://media.fixture.test'):
  if req.method=='OPTIONS':
   route.fulfill(status=204,headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return
  api_calls.append({'path':u,'method':req.method,'body':req.post_data})
  if '/api/applications' in u:
   response={'token':'fixture-token','policyVersion':'fixture-policy'} if req.method=='GET' else {'ok':True,'reference':'TEST-ONLY','delivery':'mail-service-accepted'}
   route.fulfill(content_type='application/json',body=json.dumps(response),headers={'Access-Control-Allow-Origin':base});return
  route.fulfill(status=503,content_type='application/json',body='{"error":"fixture only"}',headers={'Access-Control-Allow-Origin':base});return
 if u.startswith(base):route.continue_();return
 route.abort()
def no_overflow(page,label):
 page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');width=page.evaluate('document.documentElement.scrollWidth');assert width<=page.viewport_size['width'],f'{label}: {width}'
def capture(page,name):
 page.evaluate('''async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,12));}scrollTo(0,0);await document.fonts.ready;}''')
 page.wait_for_timeout(150);page.screenshot(path=str(OUT/name),full_page=True)
report={'liveServices':False,'media':'controlled geometric image and generated WAV fixtures','checks':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1440,'height':1000},locale='ru-RU',reduced_motion='reduce')
 ctx.route('**/*',route_handler);page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 pages=['index','music','video','bio','news','contacts','press-kit','privacy','cookies','data-consent']
 for name in pages:
  page.goto(base+'/'+name+'.html');page.wait_for_load_state('networkidle');no_overflow(page,name+' desktop')
  assert page.locator('.site-header').is_visible()
  if name in ['index','music','contacts']:capture(page,name+'-desktop.png')
  for width in [320,390,768]:
   page.set_viewport_size({'width':width,'height':844});no_overflow(page,name+' '+str(width))
  if name=='index':capture(page,'home-tablet.png')
  page.set_viewport_size({'width':1440,'height':1000})
 report['checks'].append('10 public pages at 1440,768,390,320px without horizontal overflow')
 page.goto(base+'/');expect(page.locator('#intro-dialog')).not_to_be_visible()
 page.locator('#cookie-reject').click();assert not [c for c in api_calls if '/api/analytics' in c['path']]
 page.set_viewport_size({'width':390,'height':844});capture(page,'home-mobile.png')
 page.locator('#menu-toggle').click();expect(page.locator('#mobile-nav')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#mobile-nav')).not_to_be_visible()
 page.set_viewport_size({'width':1440,'height':1000})
 page.goto(base+'/music.html');page.locator('#music-search').fill('Одесса');assert page.locator('#music-grid .music-card:visible').count()==1
 page.locator('#music-grid .music-card:visible [data-fav]').click();expect(page.locator('#music-grid .music-card:visible [data-fav]')).to_have_attribute('aria-pressed','true')
 page.locator('#music-grid .music-card:visible [data-play]').click();expect(page.locator('#player')).to_be_visible();page.wait_for_function('window.ED_ANALYTICS_PLAYER.audio.currentTime > 0')
 page.set_viewport_size({'width':320,'height':844});no_overflow(page,'active player 320');page.set_viewport_size({'width':1440,'height':1000});page.locator('#player-close').click();expect(page.locator('#player')).not_to_be_visible()
 page.locator('#theme').click();expect(page.locator('html')).to_have_attribute('data-theme','light');page.reload();expect(page.locator('html')).to_have_attribute('data-theme','light')
 page.set_viewport_size({'width':320,'height':844});no_overflow(page,'music light 320');page.set_viewport_size({'width':1440,'height':1000});page.locator('#theme').click()
 page.locator('#language').click();expect(page.locator('html')).to_have_attribute('lang','en');page.locator('#language').click()
 report['checks']+=['search/favourites/player/audio playback/stop','language and persistent light/dark theme','no automatic intro; mobile navigation with Escape','privacy refusal causes zero telemetry requests']
 page.goto(base+'/contacts.html?format=concert#booking');expect(page.locator('#booking-format')).to_have_value('concert')
 assert 'Концерт' in page.locator('[name=message]').input_value()
 page.locator('[name=message]').fill('Наш праздник. Сохранить этот текст.')
 page.locator('#booking-format').select_option('festival')
 assert 'Наш праздник. Сохранить этот текст.' in page.locator('[name=message]').input_value()
 page.locator('[name=message]').fill('Наш праздник. После выбора изменён весь текст.')
 page.locator('[name=email]').fill('test@example.com');page.locator('[name=name]').fill('Проверка');page.locator('[name=city]').fill('Москва');page.locator('#booking-consent').check()
 page.locator('#booking-form [type=submit]').click();expect(page.locator('#booking-status')).to_contain_text('TEST-ONLY')
 posts=[c for c in api_calls if c['method']=='POST' and '/api/applications' in c['path']];assert len(posts)==1
 payload=json.loads(posts[0]['body']);assert 'Наш праздник.' in payload['message'];assert 'Фестиваль' in payload['message']
 report['checks']+=['concert link prefills format','changing format preserves typed request','booking sends selected format in existing message field via fixture Worker']
 assert not errors,errors
 report.update({'passed':True,'pageErrors':errors,'fixtureBookingRequests':len(posts)})
 (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
 browser.close()
server.shutdown()
