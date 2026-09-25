"""Browser regressions for the collage workbench.

Start `make serve`, then run `python3 tests/browser-smoke.py`.
Requires Playwright for Python and its Chromium/WebKit browsers:
  python3 -m pip install playwright
  python3 -m playwright install chromium webkit
Screenshots/downloads go to a temporary directory, never into the repo.
"""
import base64
import json
import os
from pathlib import Path
import struct
import tempfile
from playwright.sync_api import sync_playwright

BASE = os.environ.get('MOSAIC_URL', 'http://localhost:8867')
ARTIFACTS = Path(tempfile.mkdtemp(prefix='mosaic-smoke-'))
READ = """async () => {
  const {state} = await import('/js/state.js');
  const render = await import('/js/render.js');
  const cells = render.currentCells();
  return {ids: state.pool.map(p => p.id), params: state.params,
    captions: state.overlays.map(o => o.text), selected: state.selected,
    zoom: state.pool[0]?.tf.zoom, cells,
    order: render.currentPlacement(cells).filter(Boolean).map(p => p.id)};
}"""

def select_panel(page, name):
    page.locator(f'.mobile-tools [data-panel-target="{name}"]').click()


def run_flow(browser, engine):
    context = browser.new_context(viewport={'width': 390, 'height': 844},
        device_scale_factor=1, is_mobile=True, has_touch=True, service_workers='block')
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_function("document.querySelectorAll('[data-template]').length === 6 && !document.querySelector('#main').inert")
    state = page.evaluate(READ)
    assert state['params']['ratio'] == '16:9' and state['params']['cols'] == 2
    select_panel(page, 'export')
    assert page.locator('#downloadCollage').is_disabled()
    select_panel(page, 'layout')

    # Exercise real file input, using images generated locally in the browser.
    images = page.evaluate("""() => ['#906c99', '#e5aa62'].map((color, i) => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,400,300);
      ctx.fillStyle = '#eee6db'; ctx.fillRect(40 + i*60,40,180,200);
      return c.toDataURL('image/png').split(',')[1];
    })""")
    page.locator('#file').set_input_files([
        {'name': f'Photo {i + 1}.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(data)}
        for i, data in enumerate(images)
    ])
    page.wait_for_function("document.querySelector('#count').textContent === '2 photos'")
    initial = page.evaluate(READ)
    assert len(initial['cells']) == 2 and initial['cells'][0]['y'] == initial['cells'][1]['y']
    assert initial['cells'][0]['x'] < initial['cells'][1]['x']

    # The workbench and preview must fit without horizontal scrolling or
    # an active panel extending behind the fixed navigation on short phones.
    for width, height in [(320,568), (360,640), (390,844), (768,1024), (844,390), (900,720), (932,430), (1025,720), (1024,768), (1440,900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(100)
        metrics = page.evaluate("""() => {
          const r = document.querySelector('#stage').getBoundingClientRect();
          const nav = document.querySelector('.mobile-tools').getBoundingClientRect();
          const rail = document.querySelector('#rail').getBoundingClientRect();
          return {width: innerWidth, scroll: document.documentElement.scrollWidth,
            canvas: {left:r.left,right:r.right,top:r.top,bottom:r.bottom}, nav:nav.top, panelBottom:rail.bottom};
        }""")
        assert metrics['scroll'] <= width, (engine, width, metrics)
        assert 0 <= metrics['canvas']['left'] < metrics['canvas']['right'] <= width, metrics
        if width <= 1024:
            assert metrics['panelBottom'] <= metrics['nav'] + 2, (engine, width, height, metrics)
        page.screenshot(path=str(ARTIFACTS / f'{engine}-{width}x{height}.png'))
    page.set_viewport_size({'width': 390, 'height': 844})

    # Presets retain the photo pool and produce the requested canvas shape.
    for template, ratio in [('banner','19:6'), ('story','9:16'), ('square','1:1'), ('pair','16:9')]:
        page.locator(f'[data-template="{template}"]').click()
        state = page.evaluate(READ)
        assert state['ids'] == initial['ids'] and state['params']['ratio'] == ratio
    select_panel(page, 'photos')
    page.locator('.thumb-select').first.focus()
    page.keyboard.press('Enter')
    page.locator('#selectionActions [data-photo-move="1"]').click()
    assert page.evaluate(READ)['order'] == initial['order'][::-1]
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(READ)['order'] == initial['order']
    page.locator('.thumb-x').first.click()
    assert len(page.evaluate(READ)['ids']) == 1
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(READ)['ids'] == initial['ids']
    page.locator('[data-act="redo"]').click()
    assert len(page.evaluate(READ)['ids']) == 1
    page.locator('[data-act="undo"]').click()

    # Tapping a photo must not create a no-op history entry.
    page.evaluate("async () => (await import('/js/history.js')).reset()")
    box = page.locator('#stage').bounding_box()
    page.touchscreen.tap(box['x'] + box['width']*.25, box['y'] + box['height']*.5)
    assert page.evaluate("async () => !(await import('/js/history.js')).canUndo()")

    # Real two-finger input, including save and one-step undo at gesture end.
    if engine == 'chromium':
        client = context.new_cdp_session(page)
        x, y = box['x'] + box['width']*.25, box['y'] + box['height']*.5
        def touch(kind, points):
            client.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})
        touch('touchStart', [{'x':x-12,'y':y,'id':1}])
        touch('touchStart', [{'x':x-12,'y':y,'id':1}, {'x':x+12,'y':y,'id':2}])
        touch('touchMove', [{'x':x-24,'y':y,'id':1}, {'x':x+24,'y':y,'id':2}])
        touch('touchEnd', [])
        assert page.evaluate(READ)['zoom'] > 1.5
        page.locator('[data-act="undo"]').click()
        assert page.evaluate(READ)['zoom'] == 1

    select_panel(page, 'text')
    page.locator('[data-act="addtext"]').click()
    page.locator('#otext').fill('Our weekend')
    select_panel(page, 'export')
    assert page.locator('#exportDimensions').text_content() == '1600 × 900 pixels · PNG'
    with page.expect_download() as download:
        page.locator('#downloadCollage').click()
    dest = ARTIFACTS / f'{engine}-collage.png'
    download.value.save_as(dest)
    assert struct.unpack('>II', dest.read_bytes()[16:24]) == (1600, 900)
    page.locator('[data-fmt="jpeg"]').click()
    page.locator('#exportSize').select_option('800')
    with page.expect_download() as download:
        page.locator('#downloadCollage').click()
    dest = ARTIFACTS / f'{engine}-collage.jpg'
    download.value.save_as(dest)
    assert dest.read_bytes().startswith(b'\xff\xd8') and dest.stat().st_size > 500

    # The full-screen editor keeps Done visible and backgrounds inert.
    select_panel(page, 'photos')
    page.locator('.thumb-select').first.click()
    page.locator('[data-act="editselected"]').click()
    assert page.locator('#editor').is_visible()
    assert page.evaluate("document.querySelector('.mobile-tools').inert && document.querySelector('.workspace-toolbar').inert")
    done = page.locator('[data-ed="done"]').bounding_box()
    assert done['x'] >= 0 and done['x'] + done['width'] <= 390 and done['y'] < 80
    page.locator('[data-ed="done"]').click()
    page.wait_for_function("document.querySelector('#editor').hidden")

    # Deliberately customize the project; a reload must not reset to defaults.
    select_panel(page, 'layout')
    page.locator('#ratio').select_option('4:5')
    page.locator('#cols').focus(); page.keyboard.press('ArrowRight')
    before_restore = page.evaluate(READ)
    page.locator('.mobile-tools [data-panel-target="photos"]').click()
    # This installed WebKit/Playwright combination does not await Promise
    # predicates in wait_for_function. Evaluate and poll the committed record.
    for attempt in range(100):
        if page.evaluate("""async () => {
      const db = await new Promise((resolve,reject) => {
        const request = indexedDB.open('mosaic');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const record = await new Promise(resolve => {
        const request = db.transaction('meta','readonly').objectStore('meta').get('session');
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return record?.params.ratio === '4:5' && record?.params.cols === 3;
    }"""): break
        page.wait_for_timeout(100)
    else:
        raise AssertionError('Autosave did not persist the current canvas settings')
    page.reload(wait_until='networkidle')
    page.wait_for_function("!document.querySelector('#main').inert")
    restored = page.evaluate(READ)
    assert restored['params']['ratio'] == '4:5' and restored['params']['cols'] == 3, {'engine':engine, 'before':before_restore, 'after':restored}
    assert restored['ids'] == initial['ids'] and restored['captions'] == ['Our weekend']
    select_panel(page, 'text')
    page.locator('[data-act="addtext"]').click()
    page.locator('#otext').fill('A second caption')
    page.locator('#text-heading').click()
    page.locator('#captionList button').first.click()
    assert page.locator('#otext').input_value() == 'Our weekend'
    assert page.evaluate("async()=>{const {state}=await import('/js/state.js');return new Set(state.overlays.map(o=>o.id)).size===2}")
    select_panel(page, 'photos')
    page.locator('.photo-extras summary').click()
    page.locator('[data-act="clear"]').click()
    assert not page.evaluate(READ)['ids']
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(READ)['ids'] == initial['ids']
    assert page.evaluate("async()=>{const{state}=await import('/js/state.js');return (await import('/js/store.js')).saveSession(state)}") is True
    page.reload(wait_until='networkidle')
    page.wait_for_function("!document.querySelector('#main').inert")
    assert page.evaluate(READ)['captions'] == ['Our weekend', 'A second caption']
    assert not errors, errors
    context.close()
    print(f'{engine}: mobile/desktop sizes, import, presets, reorder, undo, captions, export, editor, restore passed')


def check_offline(browser):
    context = browser.new_context(viewport={'width':390, 'height':844})
    # The external theme CDN is optional; all editor essentials are local.
    context.route('https://cdn.neorgon.org/**', lambda route: route.abort())
    page = context.new_page()
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    page.wait_for_function("document.querySelectorAll('[data-template]').length === 6")
    # The install promise completes only after every local precache entry.
    assert page.evaluate("async()=> {const cache=await caches.open('mosaic-v2'); return !!(await cache.match('/js/workspace.js'))}")
    context.set_offline(True)
    page.reload(wait_until='load')
    page.wait_for_function("document.querySelectorAll('[data-template]').length === 6 && !document.querySelector('#main').inert")
    page.locator('#empty [data-demo="duo"]').click()
    page.wait_for_function("document.querySelector('#count').textContent === '2 photos'")
    assert page.evaluate('document.documentElement.scrollWidth') == 390
    page.screenshot(path=str(ARTIFACTS / 'offline.png'))
    context.close()
    print('Offline reload, local assets and sample photos passed')


def check_storage(browser, engine):
    context = browser.new_context(viewport={'width':390, 'height':844}, service_workers='block')
    first = context.new_page()
    first.goto(BASE, wait_until='networkidle')
    first.locator('#empty [data-demo="duo"]').click()
    first.wait_for_function("document.querySelector('#count').textContent === '2 photos'")
    claim = """async () => {
      const {state} = await import('/js/state.js');
      (await import('/js/autosave.js')).scheduleSave(1000000);
      return (await import('/js/store.js')).saveSession(state);
    }"""
    assert first.evaluate(claim) is True
    second = context.new_page()
    second.goto(BASE, wait_until='domcontentloaded')
    second.wait_for_function("document.querySelector('#count').textContent === '2 photos'")
    second.evaluate("async () => (await import('/js/autosave.js')).scheduleSave(1000000)")
    assert first.evaluate("""async () => {
      // Synchronize the first tab after the second tab's initial restore save.
      // Network timing differs across engines; both hold the same project here.
      await (await import('/js/store.js')).loadSession();
      const {state} = await import('/js/state.js'); state.params.ratio = '1:1';
      return (await import('/js/store.js')).saveSession(state);
    }""") is True
    second.evaluate("""async () => {
      const {state} = await import('/js/state.js'); state.params.ratio = '19:6';
      (await import('/js/autosave.js')).scheduleSave(0);
    }""")
    second.wait_for_function("document.querySelector('#saveNotice').textContent.startsWith('Another tab')")
    assert second.evaluate("async () => (await (await import('/js/store.js')).loadSession()).meta.params.ratio") == '1:1'
    context.close()

    # A storage failure must be visible while the working collage stays usable.
    context = browser.new_context(viewport={'width':390, 'height':844}, service_workers='block')
    context.add_init_script("indexedDB.open = () => { throw new DOMException('Unavailable', 'SecurityError'); };")
    page = context.new_page()
    page.goto(BASE, wait_until='networkidle')
    page.locator('#empty [data-demo="duo"]').click()
    page.wait_for_function("!document.querySelector('#saveNotice').hidden")
    assert 'Autosave is unavailable' in page.locator('#saveNotice').text_content()
    select_panel(page, 'export')
    assert page.locator('#downloadCollage').is_enabled()
    context.close()
    print(f'{engine}: two-tab protection and visible storage failures passed')


with sync_playwright() as playwright:
    for engine in os.environ.get('MOSAIC_BROWSERS', 'chromium,webkit').split(','):
        browser = getattr(playwright, engine).launch()
        try:
            run_flow(browser, engine)
            check_storage(browser, engine)
            if engine == 'chromium':
                check_offline(browser)
        finally:
            browser.close()
print(f'Browser artifacts: {ARTIFACTS}')
