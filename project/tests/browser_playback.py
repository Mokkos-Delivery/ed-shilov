"""Real MP3/MP4 playback and seeking through actual Worker code with local fake Google."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from urllib.parse import urlparse
import subprocess, tempfile, json, time, urllib.request
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build'/'playback';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','lavfi','-i','sine=frequency=220:duration=20','-c:a','libmp3lame','-b:a','192k',str(OUT/'audio.mp3')],check=True)
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','lavfi','-i','testsrc2=size=960x540:rate=30','-t','20','-c:v','libx264','-preset','ultrafast','-b:v','5M','-minrate','5M','-maxrate','5M','-bufsize','5M','-x264-params','nal-hrd=cbr','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'video.mp4')],check=True)
assert (OUT/'video.mp4').stat().st_size>8*1024*1024
log=open(OUT/'server.log','w');process=subprocess.Popen(['node','tests/fixtures/playback-server.mjs',str(OUT),'8798'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
local_open=urllib.request.build_opener(urllib.request.ProxyHandler({})).open
base='http://127.0.0.1:8798';worker='https://stream.fixture.test'
try:
 for _ in range(100):
  try:
   local_open(base+'/__stats',timeout=1).read();break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Fixture server did not start')
 tracks=json.loads((ROOT/'public/assets/tracks.json').read_text());videos=json.loads((ROOT/'public/videos.json').read_text())
 tracks[0]['audio_mp3']='/media/original_audio_123/audio.mp3';tracks[0]['qualities']={'192':'/media/quality_audio_192/audio.mp3','128':'/media/quality_audio_128/audio.mp3'}
 videos[0]['video720pUrl']='/media/video_720_file_123/video.mp4';videos[0]['video1080pUrl']='/media/video_1080_file_123/video.mp4'
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);context=browser.new_context();context.add_init_script("Object.defineProperty(navigator,'connection',{value:{effectiveType:'4g',downlink:10,saveData:false,addEventListener(){}}});")
  def route(r):
   u=r.request.url;path=urlparse(u).path
   if path=='/js/cloud-config.js':r.fulfill(content_type='text/javascript',body='window.ED_CLOUD_CONFIG='+json.dumps({'workerOrigin':worker}));return
   if path=='/assets/tracks.json':r.fulfill(content_type='application/json',body=json.dumps(tracks));return
   if path=='/videos.json':r.fulfill(content_type='application/json',body=json.dumps(videos));return
   if path=='/api/catalogue':r.fulfill(content_type='application/json',body='{"ok":true,"seeded":false,"items":[]}',headers={'Access-Control-Allow-Origin':base});return
   if '/media/' in path and not path.endswith(('.mp3','.mp4')):r.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"/>');return
   if u.startswith(worker):
    response=context.request.fetch(base+u[len(worker):],headers={k:v for k,v in r.request.headers.items() if k.lower() in ['range','origin']})
    r.fulfill(response=response);return
   if u.startswith(base):r.continue_();return
   r.abort()
  context.route('**/*',route);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+'/music.html');page.wait_for_load_state('networkidle');page.locator('[data-play]').first.click();page.wait_for_function('window.ED_ANALYTICS_PLAYER.audio.currentTime>.3')
  assert '/quality_audio_192/' in page.evaluate('window.ED_ANALYTICS_PLAYER.audio.src'), page.evaluate('window.ED_ANALYTICS_PLAYER.audio.src')
  expect(page.locator('#audio-quality-status')).to_have_text('192 kbps')
  page.locator('#audio-quality').select_option('128');page.wait_for_function('window.ED_ANALYTICS_PLAYER.audio.src.includes("quality_audio_128") && !window.ED_ANALYTICS_PLAYER.audio.paused')
  page.goto(base+'/video.html');page.wait_for_load_state('networkidle');page.locator('[data-video="'+videos[0]['id']+'"]').first.click();page.wait_for_function('document.querySelector("#video-player").currentTime>.3')
  assert '/video_720_file_123/' in page.locator('#video-player').get_attribute('src')
  page.locator('#video-player').evaluate('(v)=>{v.currentTime=18;v.play();}');page.wait_for_function('document.querySelector("#video-player").currentTime>18.2',timeout=20000)
  stats=json.loads(local_open(base+'/__stats').read())
  assert not any('original_audio_123' in q['path'] or 'video_1080_file_123' in q['path'] for q in stats['requests'])
  assert sum('/video_720_file_123/' in q['path'] for q in stats['requests'])>=2
  assert not errors,errors
  # A repeated start is served from the cache, keeping the request's Range intact.
  repeat=context.request.get(base+'/media/video_720_file_123/video.mp4?stream=1',headers={'Range':'bytes=0-'})
  assert repeat.status==206 and repeat.headers['x-media-cache']=='HIT'
  report={'passed':True,'liveServices':False,'checks':['Prepared MP3 chosen on first request, without loading original','Explicit quality switch resumes playback','720p selected before 1080p','Real MP4 larger than two chunks plays and seeks to 18 seconds','Repeated starting chunk served from cache'],'videoBytes':stats['videoBytes'],'requests':stats['requests'],'pageErrors':errors}
  (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));browser.close()
finally:
 process.terminate();process.wait(timeout=10);log.close()
