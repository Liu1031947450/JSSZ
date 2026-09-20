import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function checkWorkspaceInteractions(page, visitor, origin = 'http://127.0.0.1:4174') {
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const baseline = await state();
  const products = baseline.catalog.products;
  assert.equal(products.length, 4, '先生成四件未置顶的隔离测试作品');
  const ids = products.map(product => product.id);
  const card = id => `[data-work-id="${id}"]`;
  const order = () => page.evaluate(() => [...document.querySelectorAll('[data-work-id]')].map(element => element.dataset.workId));
  const directory = await mkdtemp(join(tmpdir(), 'jianshi-interaction-'));
  async function desktop() {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  async function login() {
    await page.waitForSelector('#github-token');
    await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
    await page.click('.login-card button[type="submit"]');
    await page.waitForSelector('.save-status.saved');
  }
  async function mouseDrag(source, target, after = false, cancel = false) {
    await page.evaluate(selector => document.querySelector(selector).scrollIntoView({ block: 'center' }), card(source));
    const points = await page.evaluate(({ source, target, after }) => {
      const handle = document.querySelector(`${source} .work-drag-handle`).getBoundingClientRect();
      const bounds = document.querySelector(target).getBoundingClientRect();
      return { start: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 }, end: { x: bounds.left + bounds.width * (after ? .8 : .2), y: bounds.top + 100 } };
    }, { source: card(source), target: card(target), after });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.end, button: 'left', buttons: 1 });
    if (cancel) await page.keyboard.press('Escape');
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', clickCount: 1 });
    await page.waitForSelector('.work-row.is-dragging', { state: 'hidden' });
  }
  async function keyMove(id, direction, cancel = false) {
    await page.focus(`${card(id)} .work-drag-handle`);
    await page.keyboard.press('Space');
    await page.keyboard.press(direction);
    await page.keyboard.press(cancel ? 'Escape' : 'Enter');
  }
  async function backup(filename) {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('.draft-actions button:first-child');
    await (await download).saveAs(filename);
    return JSON.parse(await readFile(filename, 'utf8'));
  }
  async function importBackup(filename) {
    await page.setInputFiles('input[aria-label="选择草稿备份文件"]', [filename]);
    await page.waitForSelector('.confirmation-modal');
    await page.click('.confirmation-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.confirmation-modal', { state: 'hidden' });
    await page.waitForSelector('.save-status.saved');
    await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  }
  async function failWrites() {
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      window.__restoreInteractionPut = () => { IDBObjectStore.prototype.put = original; delete window.__restoreInteractionPut; };
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'drafts') throw new DOMException('Test quota', 'QuotaExceededError'); return original.apply(this, args); };
    });
  }
  try {
    await desktop();
    await page.goto(`${origin}/#/admin`); await page.reload(); await login();
    await page.click('.draft-actions button:last-child');
    await page.click('.confirmation-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
    await page.waitForSelector('.work-drag-handle');
    const originalFile = join(directory, 'original.json');
    const original = await backup(originalFile);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.work-drag-handle')].every(handle => { const bounds = handle.getBoundingClientRect(); return bounds.width >= 44 && bounds.height >= 44; })), true);
    const colors = [];
    for (const position of [1, 2, 3, 4]) {
      await page.hover(`${card(ids[0])} .work-row-copy button:nth-child(${position})`);
      await page.waitForFunction(selector => document.querySelector(selector).getAnimations().every(animation => animation.playState === 'finished'), `${card(ids[0])} .work-row-copy button:nth-child(${position})`);
      colors.push(await page.evaluate(selector => getComputedStyle(document.querySelector(selector)).backgroundColor, `${card(ids[0])} .work-row-copy button:nth-child(${position})`));
    }
    assert.ok(colors.every(color => color === colors[0] && color !== 'rgba(0, 0, 0, 0)'), '删除与其他操作具有相同悬停背景');
    await mouseDrag(ids[0], ids[2], true);
    assert.deepEqual(await order(), [ids[1], ids[2], ids[0], ids[3]], '鼠标插入排序，不是交换');
    await keyMove(ids[2], 'ArrowLeft');
    assert.deepEqual(await order(), [ids[2], ids[1], ids[0], ids[3]]);
    await keyMove(ids[2], 'ArrowRight', true);
    await mouseDrag(ids[2], ids[3], true, true);
    assert.deepEqual(await order(), [ids[2], ids[1], ids[0], ids[3]], '取消不落盘');
    await page.click(`${card(ids[0])} .work-pin-button`);
    await page.click(`${card(ids[3])} .work-pin-button`);
    await keyMove(ids[3], 'ArrowLeft');
    assert.deepEqual(await order(), [ids[3], ids[0], ids[2], ids[1]]);
    await mouseDrag(ids[0], ids[2]);
    assert.deepEqual(await order(), [ids[3], ids[0], ids[2], ids[1]], '跨组拖动不改变顺序和置顶状态');
    await page.click(`${card(ids[0])} .work-pin-button`);
    assert.deepEqual(await order(), [ids[3], ids[2], ids[1], ids[0]], '取消置顶恢复原普通槽位');
    await page.click(`${card(ids[0])} .work-pin-button`);
    assert.deepEqual(await order(), [ids[3], ids[0], ids[2], ids[1]], '再次置顶进入队尾');
    await page.waitForSelector('.save-status.saved');
    assert.equal((await state()).head, baseline.head, '拖动与置顶不能自动发布');
    await page.reload(); await login();
    assert.deepEqual(await order(), [ids[3], ids[0], ids[2], ids[1]], '刷新后保留组内顺序');
    const orderedFile = join(directory, 'ordered.json');
    const saved = await backup(orderedFile);
    assert.deepEqual(saved.catalog.products.map(product => product.id), [ids[2], ids[1], ids[0], ids[3]]);
    await importBackup(orderedFile);
    await page.click('.publish-panel > button');
    await page.waitForFunction(() => document.querySelector('.notice.success')?.textContent.includes('网站已更新'));
    await visitor.goto(origin); await visitor.waitForSelector('.photo-grid');
    const visible = () => visitor.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map(heading => heading.textContent));
    assert.deepEqual(await visible(), [products[3], products[0], products[2], products[1]].map(product => product.name));
    await visitor.selectOption('#wall-sort', 'asc');
    assert.deepEqual(await visible(), [products[3], products[0], products[1], products[2]].map(product => product.name));
    await visitor.selectOption('#wall-sort', '');
    assert.deepEqual(await visible(), [products[3], products[0], products[2], products[1]].map(product => product.name));
    await failWrites();
    try { await keyMove(ids[1], 'ArrowLeft'); await page.waitForSelector('.save-status.error'); }
    finally { await page.evaluate(() => window.__restoreInteractionPut()); }
    assert.deepEqual(await order(), [ids[3], ids[0], ids[1], ids[2]], '保存失败保留内存顺序');
    await page.click('.notice.error button:first-of-type'); await page.waitForSelector('.save-status.saved');
    await page.click(`${card(ids[0])} .work-row-copy button:first-child`);
    await page.waitForSelector('#work-price');
    await failWrites();
    try { await page.fill('#work-price', '-2'); await page.waitForSelector('.editor-modal .save-status.error'); }
    finally { await page.evaluate(() => window.__restoreInteractionPut()); }
    await page.click('.editor-return'); await page.waitForSelector('.resume-editor');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.editor-modal'))), false);
    assert.equal(await page.evaluate(() => document.querySelector('.publish-panel > button').disabled && document.querySelector('.works-list .section-heading button').disabled && [...document.querySelectorAll('.work-drag-handle')].every(button => button.disabled)), true);
    await page.click('.draft-actions button:first-child');
    await page.waitForFunction(() => [...document.querySelectorAll('.notice.error')].some(notice => notice.textContent.includes('价格无效')));
    await page.click('.resume-editor'); await page.waitForSelector('#work-price');
    assert.equal(await page.evaluate(() => document.querySelector('#work-price').value), '-2');
    await page.fill('#work-price', '77.70');
    await failWrites();
    try { await page.fill('#work-description', '保留输入和照片'); await page.waitForSelector('.editor-modal .save-status.error'); }
    finally { await page.evaluate(() => window.__restoreInteractionPut()); }
    await page.click('.editor-return'); await page.waitForSelector('.resume-editor');
    const unfinished = await backup(join(directory, 'unfinished.json'));
    assert.equal(unfinished.editing.price, 77.7);
    assert.equal(unfinished.editing.description, '保留输入和照片');
    await page.click('.resume-editor'); await page.waitForSelector('#work-price');
    assert.equal(await page.evaluate(() => document.querySelector('#work-price').value), '77.70', '收起再恢复保留价格输入格式');
    await page.click('.editor-actions button:first-child');
    await page.click('.confirmation-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.editor-modal', { state: 'hidden' });
    const large = structuredClone(original);
    large.assets = {};
    large.catalog.products = Array.from({ length: 12 }, (_, position) => {
      const source = products[position % products.length]; const id = randomUUID();
      const photos = Array.from({ length: 5 }, (_, index) => {
        const photo = source.photos[index % source.photos.length]; const photoId = randomUUID();
        const src = `images/${id}/${photoId}-detail.webp`; const thumbnail = `images/${id}/${photoId}-thumb.webp`;
        large.assets[src] = original.assets[photo.src]; large.assets[thumbnail] = original.assets[photo.thumbnail];
        return { ...photo, id: photoId, src, thumbnail };
      });
      return { ...source, id, name: `长表单验收 ${position}`, photos };
    });
    const largeFile = join(directory, 'large.json'); await writeFile(largeFile, JSON.stringify(large));
    await importBackup(largeFile);
    for (const [width, height] of [[1440, 600], [1024, 480], [390, 844], [844, 390], [320, 480]]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
      await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: width < 900 });
      if (width < 900) await page.waitForSelector('.work-drag-handle', { state: 'hidden' });
      if (width === 390) {
        await page.evaluate(() => document.querySelector('.works-grid').scrollIntoView({ block: 'start', behavior: 'instant' }));
        const before = await page.evaluate(() => scrollY);
        await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 450 }] });
        for (const height of [400, 350, 300, 250]) await page.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: height }] });
        await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(previous => scrollY > previous + 30, before);
        assert.deepEqual(await order(), large.catalog.products.map(product => product.id), '手机滑动只滚动页面，不触发排序');
      }
      await page.click('.work-row-copy button >> nth=0'); await page.waitForSelector('.editor-modal');
      await page.waitForFunction(() => document.querySelector('.editor-modal').getAnimations().every(animation => animation.playState === 'finished'));
      assert.equal(await page.evaluate(() => !document.querySelector('.editor-draft-actions, #editor-backup-help')), true);
      for (const bottom of [false, true]) {
        await page.evaluate(bottom => { const body = document.querySelector('.editor-modal .animal-modal-body'); body.scrollTop = bottom ? body.scrollHeight : 0; }, bottom);
        assert.equal(await page.evaluate(() => {
          const button = document.querySelector('.editor-actions button[type="submit"]'); const bounds = button.getBoundingClientRect();
          const modal = document.querySelector('.editor-modal').getBoundingClientRect();
          return bounds.bottom + 6 <= innerHeight && bounds.top >= 0 && bounds.bottom < modal.bottom && document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest('button') === button && document.documentElement.scrollWidth <= innerWidth;
        }), true, `${width}×${height} 长表单滚动前后提交按钮完整可点击`);
      }
      await page.screenshot({ path: `/tmp/jianshi-editor-${width}.png` });
      await page.click('.editor-actions button:first-child'); await page.click('.confirmation-modal .animal-modal-footer button:last-child');
      await page.waitForSelector('.editor-modal', { state: 'hidden' });
    }
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
      const viewport = new EventTarget(); Object.assign(viewport, { height: 320, offsetTop: 90 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.__restoreViewport = () => { if (original) Object.defineProperty(window, 'visualViewport', original); else delete window.visualViewport; delete window.__restoreViewport; };
    });
    try {
      await page.click('.work-row-copy button >> nth=0'); await page.waitForSelector('.editor-modal');
      await page.waitForFunction(() => document.querySelector('.editor-modal').getAnimations().every(animation => animation.playState === 'finished'));
      for (const [height, top] of [[320, 90], [280, 40]]) {
        await page.evaluate(({ height, top }) => { window.visualViewport.height = height; window.visualViewport.offsetTop = top; window.visualViewport.dispatchEvent(new Event('resize')); }, { height, top });
        assert.equal(await page.evaluate(({ height, top }) => { const bounds = document.querySelector('.editor-modal').getBoundingClientRect(); return bounds.top >= top && bounds.bottom <= top + height; }, { height, top }), true, '模拟软键盘可见区域缩小时弹窗整体仍在可见区域内');
      }
      await page.click('.editor-actions button:first-child'); await page.click('.confirmation-modal .animal-modal-footer button:last-child');
      await page.waitForSelector('.editor-modal', { state: 'hidden' });
    } finally { await page.evaluate(() => window.__restoreViewport()); }
    await desktop(); await page.waitForSelector('.work-drag-handle');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.focus('.work-drag-handle >> nth=0');
    const point = await page.evaluate(() => { const bounds = document.querySelector('.work-drag-handle').getBoundingClientRect(); return { x: bounds.left + 20, y: bounds.top + 20 }; });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: 895, button: 'left', buttons: 1 });
    await page.waitForFunction(previous => scrollY > previous + 50, scrollBefore);
    await page.keyboard.press('Escape');
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: 895, button: 'left', clickCount: 1 });
    assert.deepEqual(await order(), large.catalog.products.map(product => product.id), '边缘滚动后取消不修改顺序');
    await importBackup(originalFile);
    assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
    console.log('电脑拖动/键盘/取消/跨组保护/边缘滚动、手机禁用拖动、顺序备份发布、保存失败恢复和短屏长表单验收通过');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
