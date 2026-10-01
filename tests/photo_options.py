"""Browser coverage for fitting and replacing photos, called by browser-smoke.py."""
import base64


MODEL = """async () => {
  const {state} = await import('/js/state.js');
  const render = await import('/js/render.js');
  return {photos: state.pool.map(p => ({id:p.id, name:p.name, tf:p.tf,
    size:[p.bitmap.width,p.bitmap.height], cut:!!p.cut})), selected:state.selected,
    params:state.params, order:render.currentPlacement(render.currentCells()).map(p=>p?.id)};
}"""


def check_photo_options(browser, engine, base, artifacts):
    context = browser.new_context(viewport={'width':390, 'height':844},
        is_mobile=True, has_touch=True, device_scale_factor=1, service_workers='block')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base, wait_until='networkidle')
    page.wait_for_function("!document.querySelector('#main').inert")
    images = page.evaluate("""() => [0,1,2].map(i => {
      const c = document.createElement('canvas');
      c.width = i === 2 ? 300 : 600; c.height = i === 2 ? 600 : 200;
      const x = c.getContext('2d');
      x.fillStyle = i ? '#aa9988' : '#669977'; x.fillRect(0,0,c.width,c.height);
      if (i !== 1) {
        x.fillStyle = '#e24039'; x.fillRect(0,0,40,c.height);
        x.fillStyle = '#395de2'; x.fillRect(c.width-40,0,40,c.height);
      }
      return c.toDataURL('image/png').split(',')[1];
    })""")
    files = [{'name': name, 'mimeType':'image/png', 'buffer':base64.b64decode(data)}
        for name, data in zip(['Landscape.png', 'Other.png', 'Replacement.png'], images)]
    page.locator('#file').set_input_files(files[:2])
    page.wait_for_function("document.querySelector('#count').textContent === '2 photos'")
    box = page.locator('#stage').bounding_box()
    page.touchscreen.tap(box['x']+box['width']*.25, box['y']+box['height']*.5)
    page.locator('[data-act="editselected"]').click()
    assert page.locator('.mobile-tools [data-panel-target="photos"]').get_attribute('aria-pressed') == 'true'
    assert page.locator('[data-fit="fill"]').get_attribute('aria-pressed') == 'true'

    # Recognisable edge pixels disappear in Fill and survive in Fit, through
    # the real preview and the downloaded PNG, not a duplicate renderer.
    color_counts = """c => {
      const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let red=0, blue=0;
      for(let i=0;i<d.length;i+=4) {
        if(d[i]===226 && d[i+1]===64 && d[i+2]===57) red++;
        if(d[i]===57 && d[i+1]===93 && d[i+2]===226) blue++;
      }
      return {red,blue,pixels:c.width*c.height};
    }"""
    assert page.locator('#stage').evaluate(color_counts)['red'] == 0
    page.locator('[data-fit="fit"]').click()
    fitted = page.locator('#stage').evaluate(color_counts)
    assert fitted['red'] > 20 and fitted['blue'] > 20, fitted
    page.locator('[data-act="undo"]').click()
    assert page.locator('#stage').evaluate(color_counts)['red'] == 0
    page.locator('[data-act="redo"]').click()
    assert page.locator('[data-fit="fit"]').get_attribute('aria-pressed') == 'true'
    page.evaluate("async () => (await import('/js/history.js')).reset()")
    page.locator('[data-fit="fit"]').click()
    assert page.evaluate("async () => !(await import('/js/history.js')).canUndo()")

    for width, height in [(320,568), (390,844), (844,390), (1440,900)]:
        page.set_viewport_size({'width':width,'height':height})
        page.locator('[data-act="editselected"]').click()
        # The quick actions fit inside the scrolling panel at every size.
        for selector in ['[data-act="replace"]', '[data-fit="fit"]']:
            page.locator(selector).scroll_into_view_if_needed()
            rect = page.locator(selector).bounding_box()
            assert rect['x'] >= 0 and rect['x']+rect['width'] <= width
            assert rect['height'] >= 44
            if width <= 1024:
                nav = page.locator('.mobile-tools').bounding_box()
                assert rect['y']+rect['height'] <= nav['y'] + 1
        assert page.evaluate('document.documentElement.scrollWidth') == width
        page.screenshot(path=str(artifacts / f'{engine}-photo-options-{width}.png'))
    page.set_viewport_size({'width':390,'height':844})
    page.locator('.mobile-tools [data-panel-target="export"]').click()
    with page.expect_download() as download:
        page.locator('#downloadCollage').click()
    destination = artifacts / f'{engine}-fit.png'
    download.value.save_as(destination)
    exported = page.evaluate("""async ({data,count}) => {
      const blob = await (await fetch('data:image/png;base64,'+data)).blob();
      const bitmap = await createImageBitmap(blob), c = document.createElement('canvas');
      c.width=bitmap.width; c.height=bitmap.height; c.getContext('2d').drawImage(bitmap,0,0);
      return (new Function('return ('+count+')'))()(c);
    }""", {'data':base64.b64encode(destination.read_bytes()).decode(), 'count':color_counts})
    assert exported['red'] > 100 and exported['blue'] > 100
    assert abs(exported['red']/exported['pixels'] - fitted['red']/fitted['pixels']) < .01

    # Dragging a rotated photo still follows the finger in screen coordinates.
    page.evaluate("""async () => {
      const {state} = await import('/js/state.js');
      state.pool[0].tf.rot=90;
      (await import('/js/events.js')).repaint();
    }""")
    box = page.locator('#stage').bounding_box()
    x, y = box['x']+box['width']*.25, box['y']+box['height']*.5
    page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x+12,y,steps=3); page.mouse.up()
    rotated = page.evaluate(MODEL)['photos'][0]['tf']
    assert abs(rotated['ox']) < .0001 and rotated['oy'] < 0, rotated
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(MODEL)['photos'][0]['tf']['oy'] == 0

    # Replacement preserves edits and manual ordering, even if selection
    # changes while the operating system's file picker is open.
    page.evaluate("""async () => {
      const {state,swapCells,resolvePlacement} = await import('/js/state.js');
      const p=state.pool[0];
      Object.assign(p.tf,{cx:.05,cy:.1,cw:.9,ch:.8,zoom:1.2,ox:.05,rot:12,flipH:true});
      p.tf.adj.bright=111;
      swapCells(0,1,resolvePlacement(2));
      (await import('/js/events.js')).repaint();
    }""")
    before = page.evaluate(MODEL)
    page.locator('[data-act="editselected"]').click()
    with page.expect_file_chooser() as chooser:
        page.locator('[data-act="replace"]').click()
    page.evaluate("""async () => {
      const {state} = await import('/js/state.js');state.selected=state.pool[1].id;
      (await import('/js/events.js')).repaint();
    }""")
    chooser.value.set_files(files[2])
    page.wait_for_function("document.querySelector('#importStatus').hidden && [...document.querySelectorAll('.thumb-label')].some(e=>e.textContent.includes('Replacement.png'))")
    replaced = page.evaluate(MODEL)
    assert replaced['order'] == before['order'] and replaced['params'] == before['params']
    assert replaced['photos'][0]['tf'] == before['photos'][0]['tf']
    assert replaced['photos'][0]['id'] == before['photos'][0]['id']
    assert replaced['photos'][0]['size'] == [300,600]
    assert replaced['photos'][1] == before['photos'][1]
    assert replaced['selected'] == before['photos'][1]['id']
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(MODEL)['photos'] == before['photos']
    page.locator('[data-act="redo"]').click()
    assert page.evaluate(MODEL)['photos'] == replaced['photos']

    target_id = replaced['photos'][0]['id']
    page.locator(f'.thumb[data-id="{target_id}"] .thumb-select').click()
    page.locator('[data-act="editselected"]').click()
    page.evaluate("async () => (await import('/js/history.js')).reset()")
    with page.expect_file_chooser() as chooser:
        page.locator('[data-act="replace"]').click()
    chooser.value.set_files({'name':'broken.png','mimeType':'image/png','buffer':b'not an image'})
    page.wait_for_function("document.querySelector('.toast').textContent.includes('original photo is still here')")
    assert page.evaluate(MODEL)['photos'] == replaced['photos']
    assert page.evaluate("async () => !(await import('/js/history.js')).canUndo()")
    assert page.locator('[data-act="replace"]').is_enabled()
    with page.expect_file_chooser() as chooser:
        page.locator('[data-act="replace"]').click()
    chooser.value.set_files([])
    assert page.evaluate(MODEL)['photos'] == replaced['photos']

    # A stale picker target cannot resurrect a removed photo.
    with page.expect_file_chooser() as chooser:
        page.locator('[data-act="replace"]').click()
    page.evaluate("""async () => {
      const {state,removePhoto} = await import('/js/state.js');
      (await import('/js/history.js')).mark(state);removePhoto(state.selected);
      (await import('/js/events.js')).repaint();
    }""")
    chooser.value.set_files(files[0])
    page.wait_for_function("document.querySelector('.toast').textContent.includes('no longer in the collage')")
    assert len(page.evaluate(MODEL)['photos']) == 1
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(MODEL)['photos'] == replaced['photos']

    # Wait for the real autosave commit, then verify new source and fit on reload.
    for _ in range(100):
        saved = page.evaluate("""async () => {
          const db = await new Promise(r=>{const q=indexedDB.open('mosaic');q.onsuccess=()=>r(q.result)});
          const rows = await new Promise(r=>{const q=db.transaction('photos').objectStore('photos').getAll();q.onsuccess=()=>r(q.result)});
          db.close();return rows.find(p=>p.name==='Replacement.png')?.tf;
        }""")
        if saved == replaced['photos'][0]['tf']: break
        page.wait_for_timeout(100)
    else: raise AssertionError('Replacement was not autosaved')
    page.reload(wait_until='networkidle')
    page.wait_for_function("!document.querySelector('#main').inert")
    restored = page.evaluate(MODEL)
    assert restored['photos'] == replaced['photos'] and restored['order'] == replaced['order']
    page.locator('.mobile-tools [data-panel-target="photos"]').click()
    page.locator(f'.thumb[data-id="{target_id}"] .thumb-select').click()
    page.locator('[data-act="editselected"]').click()
    assert page.locator('[data-fit="fit"]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-act="reset"]').click()
    assert page.locator('[data-fit="fill"]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-act="undo"]').click()
    assert page.evaluate(MODEL)['photos'] == replaced['photos']
    assert not errors, errors
    context.close()
    print(f'{engine}: fit pixels, export, rotated drag, replacement, failures, undo and autosave passed')
