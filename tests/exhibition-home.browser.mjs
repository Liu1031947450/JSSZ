import assert from 'node:assert/strict';
import { acceptDisclaimer } from './disclaimer.browser.mjs';

async function assertNoGrid(page) {
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.exhibition-home .photo-grid, .exhibition-home .photo-memory, .exhibition-home .wall-section, .exhibition-home .wall-filters, .exhibition-highlight-list'))), false, '新版不再渲染作品网格、列表或列表筛选栏');
}

export async function checkExhibitionHome(page, origin = 'http://127.0.0.1:4175') {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const instrumentation = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__exhibitionErrors = []; addEventListener('error', event => window.__exhibitionErrors.push(event.message)); addEventListener('unhandledrejection', event => window.__exhibitionErrors.push(String(event.reason)));` });
  try {
    await page.goto(origin);
    await acceptDisclaimer(page);
    await page.waitForSelector('.photo-open');
    const originalCount = await page.evaluate(() => document.querySelectorAll('.photo-memory').length);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /three\.module/.test(entry.name))), false);
    await page.click('.home-version-switch');
    await page.waitForSelector('.scene-ready');
    await assertNoGrid(page);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.exhibition-room')].reduce((count, room) => count + Number(room.dataset.roomTotal), 0)), originalCount);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.disclaimer-modal'))), false);
    await page.click('[aria-label="下一件立体展品"]');
    assert.match(await page.evaluate(() => document.querySelector('.exhibition-current small').textContent), /02/);
    await page.click('.exhibition-current');
    await page.waitForSelector('.detail-modal');
    await page.waitForFunction(() => document.querySelector('.exhibition-scene').dataset.rendering === 'paused');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    await page.click('.exhibition-hero-motion');
    await page.waitForFunction(() => document.querySelector('.exhibition-scene').dataset.rendering === 'paused');
    await page.click('.exhibition-hero-motion');
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.waitForFunction(() => document.querySelector('.exhibition-home').dataset.motion === 'off');
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await page.evaluate(() => { window.__retiredCanvas = document.querySelector('.exhibition-scene canvas'); });
      await page.click('.home-version-switch');
      await page.waitForSelector('.hero');
      assert.equal(await page.evaluate(() => window.__retiredCanvas.getContext('webgl2').isContextLost()), true);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.photo-memory').length), originalCount, '旧版作品墙保持不变');
      await page.click('.home-version-switch');
      await page.waitForSelector('.scene-ready');
      await assertNoGrid(page);
    }
    await page.evaluate(() => document.querySelector('.exhibition-scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForSelector('.exhibition-scene-notice');
    await assertNoGrid(page);
    await page.click('.exhibition-scene-notice button');
    await page.waitForSelector('.scene-ready');
    await page.click('.home-version-switch');
    await page.waitForSelector('.hero');
    await page.evaluate(() => history.back());
    await page.waitForSelector('.scene-ready');
    await page.evaluate(() => history.forward());
    await page.waitForSelector('.hero');
    await page.click('.home-version-switch');
    await page.waitForSelector('.scene-ready');
    await page.click('.admin-entry');
    await page.waitForSelector('.admin-page');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.exhibition-shell, .exhibition-room, .exhibition-scene, .home-version-switch'))), false);
    assert.deepEqual(await page.evaluate(() => window.__exhibitionErrors), []);
    console.log(`新旧切换、${originalCount} 件作品保留、详情、暂停、WebGL 释放、历史与工作台隔离通过`);
  } finally {
    await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });
    await page.cdp('Emulation.clearDeviceMetricsOverride');
  }
}

export async function checkExhibitionWholePage(page, origin = 'http://127.0.0.1:4175') {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  try {
    await page.goto(`${origin}/?home=3d`);
    await acceptDisclaimer(page);
    await page.waitForSelector('.exhibition-room');
    await assertNoGrid(page);
    const response = await page.fetch(`${origin}/catalog.json`);
    const catalog = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    const expectedRooms = new Map();
    const ordered = [...catalog.products].sort((first, second) => (first.pinOrder ?? Infinity) - (second.pinOrder ?? Infinity) || 0);
    for (const product of ordered) {
      if (!expectedRooms.has(product.category)) expectedRooms.set(product.category, []);
      expectedRooms.get(product.category).push(product);
    }
    const visited = [];
    let roomIndex = 0;
    for (const [category, products] of expectedRooms) {
      const selector = `#exhibition-room-${roomIndex}`;
      await page.evaluate(selector => document.querySelector(selector).scrollIntoView({ behavior: 'instant' }), selector);
      await page.waitForFunction(selector => document.querySelector(selector).dataset.inView === 'true', selector);
      assert.equal(await page.evaluate(selector => Number(document.querySelector(selector).dataset.roomTotal), selector), products.length);
      assert.equal(await page.evaluate(selector => document.querySelector(selector).dataset.roomCategory, selector), category || '手作手记');
      await page.focus(`${selector} input[type="range"]`);
      for (let position = 0; position < products.length; position += 1) {
        if (position > 0) await page.keyboard.press('ArrowRight');
        const current = await page.evaluate(selector => document.querySelector(`${selector} .room-product`).dataset.productId, selector);
        assert.equal(current, products[position].id, '按原有置顶与组内顺序可逐件访问');
        assert.equal(await page.evaluate(selector => document.querySelector(`${selector} .room-product img`).getAttribute('src'), selector), `/${products[position].photos[0].src}`, '展场大封面使用高清详情图，不放大缩略图');
        visited.push(current);
      }
      if (products.length > 1) {
        await page.click(`${selector} .room-next`);
        assert.equal(await page.evaluate(selector => document.querySelector(`${selector} input`).value, selector), '0', '最后一件循环到第一件');
        await page.click(`${selector} .room-prev`);
        assert.equal(await page.evaluate(selector => Number(document.querySelector(`${selector} input`).value), selector), products.length - 1);
        await page.focus(`${selector} .room-product`);
        await page.keyboard.press('Home');
        assert.equal(await page.evaluate(selector => document.querySelector(`${selector} input`).value, selector), '0');
      }
      await page.click(`${selector} .room-detail`);
      await page.waitForSelector('.detail-modal');
      await page.waitForFunction(() => document.querySelector('.exhibition-home').dataset.motion === 'off');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.detail-modal', { state: 'hidden' });
      assert.equal(await page.evaluate(selector => document.querySelector(`${selector} .room-product`).dataset.productId, selector), products[0].id);
      roomIndex += 1;
    }
    assert.deepEqual([...visited].sort(), catalog.products.map(product => product.id).sort(), '全部作品无遗漏、无重复归组');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.room-product').length), expectedRooms.size, '每个场景只呈现当前主作品，不铺开全部作品');
    if (expectedRooms.size >= 3) assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll('.exhibition-room')].map(room => room.className)).size), 3);

    for (const width of [320, 390, 768, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 760 });
      for (let index = 0; index < expectedRooms.size; index += 1) {
        await page.evaluate(index => document.querySelector(`#exhibition-room-${index}`).scrollIntoView({ behavior: 'instant' }), index);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px 展场 ${index} 无横向溢出`);
        assert.ok(await page.evaluate(index => [...document.querySelectorAll(`#exhibition-room-${index} .room-step-buttons button`)].every(button => button.getBoundingClientRect().height >= 44), index));
      }
    }
    await page.evaluate(() => document.querySelector('#exhibition-room-1').scrollIntoView({ behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#exhibition-room-1').dataset.inView === 'true');
    const transform = await page.evaluate(() => getComputedStyle(document.querySelector('#exhibition-room-1 .room-object-position')).transform);
    await page.evaluate(() => scrollBy({ top: 180, behavior: 'instant' }));
    await page.waitForFunction(transform => getComputedStyle(document.querySelector('#exhibition-room-1 .room-object-position')).transform !== transform, transform);
    await page.click('.exhibition-motion');
    await page.waitForFunction(() => document.querySelector('.exhibition-home').dataset.motion === 'off');
    assert.equal(await page.evaluate(() => document.querySelector('.exhibition-home').getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), false);
    await page.click('#exhibition-room-1 .room-next');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#exhibition-room-1 .room-product-enter')).opacity), '1', '暂停时切换仍可立即看到作品');
    await page.click('.exhibition-motion');
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.waitForFunction(() => document.querySelector('.exhibition-home').dataset.motion === 'off');
    await assertNoGrid(page);
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });

    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await page.evaluate(() => document.querySelector('#exhibition-room-0 .room-artwork').scrollIntoView({ behavior: 'instant', block: 'center' }));
    const swipe = await page.evaluate(() => { const bounds = document.querySelector('#exhibition-room-0 .room-product').getBoundingClientRect(); return { x: bounds.left + bounds.width * .8, y: bounds.top + bounds.height * .5, distance: bounds.width * .55 }; });
    const beforeSwipe = await page.evaluate(() => document.querySelector('#exhibition-room-0 .room-product').dataset.productId);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipe.x, y: swipe.y }] });
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipe.x - swipe.distance, y: swipe.y }] });
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual(await page.evaluate(() => document.querySelector('#exhibition-room-0 .room-product').dataset.productId), beforeSwipe);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.detail-modal'))), false, '滑动不误开详情');
    await page.click('#exhibition-room-0 .room-detail');
    await page.waitForSelector('.detail-modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    console.log(`${visited.length} 件作品逐件核对、三种展场、四种屏宽、触屏滑动、暂停与详情通过`);
  } finally {
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });
    await page.cdp('Emulation.clearDeviceMetricsOverride');
  }
}

export async function checkExhibitionFallbacks(page, origin = 'http://127.0.0.1:4175') {
  await page.cdp('Network.enable');
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  try {
    for (const urls of [['*three.module*.js'], ['*ExhibitionHome*.js'], ['*catalog.json*']]) {
      await page.cdp('Network.setBlockedURLs', { urls });
      await page.goto(`${origin}/?home=3d`);
      await acceptDisclaimer(page);
      await page.waitForSelector(urls[0].includes('three') ? '.exhibition-scene-notice' : '.load-error-notice');
      await assertNoGrid(page);
      if (urls[0].includes('three')) {
        await page.click('.room-detail >> nth=0');
        await page.waitForSelector('.detail-modal');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.detail-modal', { state: 'hidden' });
      }
      await page.click('.home-version-switch');
      await page.waitForSelector('.hero');
    }
    await page.cdp('Network.setBlockedURLs', { urls: ['*-detail.webp'] });
    await page.goto(`${origin}/?home=3d`);
    await acceptDisclaimer(page);
    await page.evaluate(() => document.querySelector('.room-product').scrollIntoView({ behavior: 'instant', block: 'center' }));
    await page.waitForSelector('.room-image-retry');
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.click('.room-image-retry >> nth=0');
    await page.waitForFunction(() => { const image = document.querySelector('.room-product img'); return image?.complete && image.naturalWidth > 0; });
  } finally {
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
  }
  for (const mode of ['no-webgl', 'empty', 'single']) {
    const source = mode === 'no-webgl' ? `const originalGetContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...options) { return type === 'webgl2' ? null : originalGetContext.call(this, type, ...options); };` : `const originalFetch = window.fetch; window.fetch = async (...args) => { const response = await originalFetch(...args); if (!String(args[0]).includes('catalog.json')) return response; const catalog = await response.json(); return new Response(JSON.stringify({ ...catalog, products: ${mode === 'empty' ? '[]' : 'catalog.products.slice(0, 1)'} }), { headers: { 'Content-Type': 'application/json' } }); };`;
    const script = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source });
    try {
      await page.goto(`${origin}/?home=3d`);
      await acceptDisclaimer(page);
      await page.waitForSelector(mode === 'empty' ? '.exhibition-empty' : mode === 'no-webgl' ? '.exhibition-scene-notice' : '.exhibition-room');
      await assertNoGrid(page);
      if (mode === 'single') {
        assert.equal(await page.evaluate(() => document.querySelectorAll('.exhibition-room').length), 1);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.room-prev, .room-next, .room-scrubber input')].every(control => control.disabled)), true);
      }
      if (mode === 'empty') assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /three\.module/.test(entry.name))), false);
    } finally {
      await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
    }
  }
  console.log('模块与图片弱网重试、无 WebGL、空展厅与单件作品降级通过，未退回网格');
}
