"""Analytics browser regressions against real built pages and controlled providers.
Run after `npm run prepare`: python tests/browser_analytics.py
No production statistics, credentials, e-mail or Telegram requests are sent.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
import io, json, math, struct, wave, re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'browser-analytics'
OUT.mkdir(parents=True, exist_ok=True)
sound = io.BytesIO()
with wave.open(sound, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b''.join(struct.pack('<h', int(1000 * math.sin(2 * math.pi * 220 * i / 8000))) for i in range(32000)))
audio_bytes = sound.getvalue()
image_bytes = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#273b32"/><circle cx="400" cy="400" r="210" fill="none" stroke="#b4bea1" stroke-width="3"/><text x="400" y="410" text-anchor="middle" fill="#dedace" font-size="40">LOCAL TEST</text></svg>'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)
    def log_message(self, *args): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
config = {'firebase': {'projectId': 'fixture-project', 'apiKey': 'fixture-public', 'appId': 'fixture-app'}, 'adminUid': 'fixture_owner', 'workerOrigin': 'https://analytics.fixture.test', 'uploadFolderId': 'fixture_folder_1234'}
headers = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range'}
state = {'events': [], 'reports': [], 'mode': 'ready', 'held': []}
tracked = ['analytics-core.mjs', 'site-analytics.mjs', 'admin-analytics.mjs', 'admin.mjs']
fixtures = {'tracks': {'heard': {'id': 'heard', 'title': 'Город у моря', 'published': True}, 'new': {'id': 'new', 'title': 'Новая без прослушиваний', 'published': True}, 'hidden': {'id': 'hidden', 'title': 'Скрытая песня', 'published': False}}, 'media': {}}

def report(days):
    return {'ok': True, 'configured': True, 'days': days, 'from': '2026-11-01', 'to': '2026-11-10', 'startedAt': '2026-11-01', 'empty': False, 'limited': False,
            'totals': {'visits': days, 'pageViews': 49, 'plays': 12, 'completions': 8, 'downloads': 5, 'offerClicks': 3},
            'daily': [{'date': f'2026-11-{i:02}', 'visits': i, 'pageViews': i+1, 'plays': i//2} for i in range(1, 11)],
            'tracks': [{'id': 'heard', 'plays': 12, 'completions': 8, 'downloads': 5}], 'pages': [{'path': '/music.html', 'views': 49}], 'offers': [{'id': 'concert', 'clicks': 3}]}

def route_handler(route):
    request = route.request; url = request.url; path = urlparse(url).path
    def reply(value, status=200):
        route.fulfill(status=status, content_type='application/json', body=json.dumps(value), headers=headers)
    if url.startswith('https://analytics.fixture.test'):
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers=headers); return
        if path == '/api/analytics':
            state['events'].append(json.loads(request.post_data)); reply({'ok': True}, 202); return
        if path == '/api/admin/analytics':
            assert request.headers.get('authorization') == 'Bearer fixture-id-token'
            days = int(parse_qs(urlparse(url).query)['days'][0]); state['reports'].append(days)
            if state['mode'] == 'hold': state['held'].append(route); return
            if state['mode'] == 'missing': reply({'ok': False, 'code': 'ANALYTICS_NOT_CONFIGURED', 'error': 'Storage not configured'}, 503); return
            if state['mode'] == 'failed': reply({'ok': False, 'error': 'Temporary outage'}, 503); return
            reply(report(days)); return
        if path == '/api/admin/readiness': reply({'ok': True, 'readerReady': True, 'release': '2026-11-10-rock-1'}); return
        if path == '/api/admin/social/history': reply({'ok': True, 'posts': []}); return
        if path == '/api/admin/social': reply({'ok': True, 'channels': {}}); return
    if 'www.gstatic.com/firebasejs/' in url:
        route.fulfill(content_type='text/javascript', body=(ROOT / 'tests/fixtures/browser-firebase.mjs').read_text(), headers=headers); return
    if 'www.googleapis.com/drive/v3/files/' in url:
        reply({'id': config['uploadFolderId'], 'mimeType': 'application/vnd.google-apps.folder', 'capabilities': {'canAddChildren': True}}); return
    if path.startswith('/media/'):
        if re.search(r'\.(?:mp3|wav)(?:$|\?)', url, re.I):
            route.fulfill(content_type='audio/wav', body=audio_bytes, headers=headers)
        else: route.fulfill(content_type='image/svg+xml', body=image_bytes, headers=headers)
        return
    if url.startswith(base):
        if path == '/admin.html': route.fulfill(content_type='text/html', body=(ROOT / 'web/admin.html').read_text()); return
        if path == '/assets/css/admin.css': route.fulfill(content_type='text/css', body=(ROOT / 'web/admin.css').read_text()); return
        if path == '/js/cloud-config.js': route.fulfill(content_type='text/javascript', body='window.ED_CLOUD_CONFIG='+json.dumps(config)); return
        if path == '/js/live-catalog.mjs': route.fulfill(content_type='text/javascript', body='// Static catalogue fixture.'); return
        name = path.rsplit('/', 1)[-1]
        if path.startswith('/js/') and name in tracked:
            route.fulfill(content_type='text/javascript', body=(ROOT / 'web' / name).read_text()); return
        route.continue_(); return
    route.abort()

checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='ru-RU', accept_downloads=True)
    context.route('**/*', route_handler)
    context.add_init_script("localStorage.setItem('es7_quality', JSON.stringify('original')); localStorage.setItem('introAnimationPlayed', 'true');")
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/music.html'); page.wait_for_function('!!window.ED_ANALYTICS_PLAYER')
    if page.locator('#cookie-reject').is_visible(): page.locator('#cookie-reject').click()
    expect(page.locator('[data-play]').first).to_be_visible()
    track_id = page.locator('[data-play]').first.get_attribute('data-play')
    page.locator('[data-play]').first.click()
    page.wait_for_function('window.ED_ANALYTICS_PLAYER.audio.currentTime > .6')
    page.evaluate('window.ED_ANALYTICS_PLAYER.audio.pause()')
    assert not state['events']; assert page.evaluate("sessionStorage.getItem('edAnalyticsSessionV1')") is None
    checks.append('No collection or session storage before explicit consent, even during real playback')
    page.locator('.privacy-open').first.click(); page.locator('#allow-analytics').check(); page.locator('#privacy-save').click()
    page.wait_for_timeout(200)
    assert [e['type'] for e in state['events']] == ['page_view'], state['events']
    session_id = state['events'][0]['sessionId']
    page.evaluate('''() => { const a=window.ED_ANALYTICS_PLAYER.audio; a.currentTime=0; return a.play(); }''')
    page.wait_for_function('window.ED_ANALYTICS_PLAYER.getTrack().id !== '+json.dumps(track_id), timeout=10000)
    page.evaluate('window.ED_ANALYTICS_PLAYER.audio.pause()')
    page.wait_for_timeout(200)
    counted = [e['type'] for e in state['events'] if e.get('trackId') == track_id]
    assert counted == ['track_play', 'track_complete'], state['events']
    checks.append('Actual short WAV playback counted once; completion captures original track before autoplay switches')
    page.evaluate("window.dispatchEvent(new CustomEvent('ed:download',{detail:{trackId:"+json.dumps(track_id)+"}}))")
    page.evaluate("window.dispatchEvent(new CustomEvent('ed:download',{detail:{trackId:"+json.dumps(track_id)+"}}))")
    page.wait_for_timeout(150)
    assert len([e for e in state['events'] if e['type']=='track_download']) == 1
    assert all(e['sessionId']==session_id for e in state['events'])
    # A UI revocation must work even before the old preference has been erased.
    before = len(state['events'])
    page.evaluate("window.dispatchEvent(new CustomEvent('ed:consent',{detail:{analytics:false}})); window.dispatchEvent(new CustomEvent('ed:download',{detail:{trackId:'blocked'}}))")
    page.wait_for_timeout(150)
    assert len(state['events']) == before
    assert page.evaluate("sessionStorage.getItem('edAnalyticsSessionV1')") is None
    checks.append('Downloads deduplicated per song/session; synchronous revocation immediately clears ID and stops requests')
    page.evaluate("localStorage.removeItem('es5_privacy'); document.cookie='es_privacy=; Max-Age=0; Path=/'")
    page.goto(base + '/admin.html'); page.evaluate('(data)=>localStorage.setItem("fixtureCatalog",JSON.stringify(data))', fixtures)
    expect(page.locator('#login-screen')).to_be_visible(); page.locator('#login').click(); expect(page.locator('#studio')).to_be_visible()
    page.locator('#open-analytics').click(); expect(page.locator('#analytics-data')).to_be_visible()
    expect(page.locator('#analytics-visits')).to_have_text('30'); expect(page.locator('#analytics-tracks tr')).to_have_count(3)
    expect(page.locator('#analytics-tracks')).to_contain_text('Новая без прослушиваний')
    expect(page.locator('#analytics-tracks')).to_contain_text('Скрытая песня')
    for days in ['7', '90', '30']:
        page.locator('#analytics-period').select_option(days); expect(page.locator('#analytics-visits')).to_have_text(days)
    page.locator('#analytics-search').fill('без прослушиваний'); expect(page.locator('#analytics-tracks tr')).to_have_count(1)
    expect(page.locator('#analytics-tracks td').nth(1)).to_have_text('0')
    page.locator('#analytics-search').fill('')
    with page.expect_download() as info: page.locator('#analytics-export').click()
    export = OUT / info.value.suggested_filename; info.value.save_as(str(export)); exported = export.read_text('utf-8-sig')
    assert 'Скрытая песня' in exported and 'Новая без прослушиваний' in exported and 'Город у моря' in exported
    checks.append('Owner bearer request, 7/30/90-day filters, zero/hidden tracks, search and real CSV download')
    page.locator('#analytics-panel').evaluate("el => {const p=document.createElement('p'); p.textContent='ЛОКАЛЬНАЯ ПРОВЕРКА · ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ'; p.style='font:11px monospace;color:#65715e'; el.prepend(p);}")
    page.screenshot(path=str(OUT / 'analytics-desktop.png'), full_page=True)
    for width in [320, 390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Analytics overflow at {width}'
    page.set_viewport_size({'width':390,'height':844}); page.screenshot(path=str(OUT / 'analytics-mobile.png'), full_page=True)
    checks.append('Analytics fits 320, 390, 768 and 1440px; wide data tables scroll within their own region')
    state['mode']='missing'; page.locator('#analytics-refresh').click(); expect(page.locator('#analytics-unavailable-title')).to_have_text('Статистика ещё не подключена'); expect(page.locator('#analytics-data')).to_be_hidden(); expect(page.locator('#analytics-export')).to_be_disabled()
    state['mode']='failed'; page.locator('#analytics-refresh').click(); expect(page.locator('#analytics-unavailable-title')).to_have_text('Не удалось получить статистику')
    state['mode']='ready'; page.locator('#analytics-refresh').click(); expect(page.locator('#analytics-data')).to_be_visible()
    state['mode']='hold'; page.locator('#analytics-refresh').click(); page.wait_for_timeout(100)
    state['mode']='ready'; page.locator('#analytics-period').select_option('7'); expect(page.locator('#analytics-visits')).to_have_text('7')
    for held in state['held']:
        try: held.fulfill(content_type='application/json',body=json.dumps(report(999)),headers=headers)
        except Exception: pass  # Superseded fetch was intentionally aborted.
    state['held'].clear(); page.wait_for_timeout(100); expect(page.locator('#analytics-visits')).to_have_text('7')
    page.locator('#logout').click(); expect(page.locator('#login-screen')).to_be_visible(); expect(page.locator('#analytics-data')).to_be_hidden()
    assert page.locator('#analytics-tracks tr').count()==0; expect(page.locator('#analytics-visits')).to_have_text('—'); expect(page.locator('#analytics-export')).to_be_disabled()
    assert len(state['events'])==before
    checks.append('Missing storage and transient outage differ; superseded responses discarded; logout clears report DOM and disables CSV')
    assert not errors, errors
    context.close(); browser.close()
server.shutdown()
result = {'passed':True,'liveServices':False,'browser':'Chromium','checks':checks,'pageErrors':errors,'eventTypes':[e['type'] for e in state['events']],'reportPeriods':state['reports']}
(OUT / 'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
