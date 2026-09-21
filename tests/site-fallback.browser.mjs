import assert from 'node:assert/strict';
import { acceptDisclaimer } from './disclaimer.browser.mjs';

export async function checkStartupFallback(page, origin = 'http://127.0.0.1:5173') {
  await page.cdp('Network.enable');
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await page.cdp('Network.setBlockedURLs', { urls: ['*/src/main.tsx*', '*/assets/index-*.js*', '*/assets/index-*.css*'] });
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForSelector('#startup-fallback');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.site-shell'))), false);
    assert.equal(await page.evaluate(() => document.querySelector('#startup-backup').hidden), true);
    for (const width of [320, 390, 768, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 800 });
      assert.equal(await page.evaluate(() => {
        const notice = document.querySelector('#startup-fallback');
        const button = notice.querySelector('button').getBoundingClientRect();
        return notice.innerText.includes('加载失败') && button.left >= 0 && button.right <= innerWidth && button.top >= 0 && button.bottom <= innerHeight && button.height >= 44 && notice.scrollWidth <= innerWidth;
      }), true, `入口脚本和样式失败时 ${width}px 仍能操作`);
    }
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.click('#startup-fallback button');
    await acceptDisclaimer(page);
    await page.waitForSelector('.photo-grid');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#startup-fallback'))), false, '启动成功后移除原生兜底');
    console.log('入口脚本与样式失败、原生提示、手机布局、恢复网络后按钮刷新通过');
  } finally {
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
  }
}

export async function checkDetailImageRetry(page, origin = 'http://127.0.0.1:5173') {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await acceptDisclaimer(page);
  await page.waitForSelector('.photo-grid');
  const response = await page.fetch(new URL('catalog.json', `${origin.replace(/\/$/, '')}/`).href);
  const catalog = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  const product = catalog.products.find(item => item.photos.length > 1);
  assert.ok(product, '需要至少一件有多张照片的作品来验证当前照片保留');
  await page.selectOption('#wall-category', product.category || '');
  await page.selectOption('#wall-sort', 'desc');
  const before = await page.evaluate(() => [document.querySelector('#wall-category').value, document.querySelector('#wall-sort').value]);
  await page.cdp('Network.enable');
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await page.cdp('Network.setBlockedURLs', { urls: product.photos.map(photo => `*${photo.src}*`) });
  try {
    await page.click(`button[aria-label=${JSON.stringify(`查看作品：${product.name}`)}]`);
    await page.waitForSelector('.detail-gallery .load-error-notice');
    await page.click('button[aria-label="下一张"]');
    await page.waitForFunction(() => document.querySelector('.image-caption').textContent.startsWith('02'));
    await page.waitForFunction(() => document.querySelector('.detail-modal').getAnimations().every(animation => animation.playState === 'finished'));
    for (const width of [320, 390, 768, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 800 });
      assert.equal(await page.evaluate(() => {
        const notice = document.querySelector('.detail-gallery .load-error-notice').getBoundingClientRect();
        const button = document.querySelector('.detail-gallery .load-error-actions button').getBoundingClientRect();
        return notice.left >= 0 && notice.right <= innerWidth && button.left >= notice.left && button.right <= notice.right && button.height >= 44 && !document.querySelector('.detail-modal button button');
      }), true, `详情重试 ${width}px 可用且不嵌套按钮`);
    }
    await page.click('.detail-gallery .load-error-actions button');
    await page.waitForSelector('.detail-gallery .load-error-notice');
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.click('.detail-gallery .load-error-actions button');
    await page.waitForSelector('.detail-gallery .load-error-notice', { state: 'hidden' });
    await page.waitForFunction((path) => [...document.querySelectorAll('.detail-gallery img')].some(image => image.src.includes(path) && image.complete && image.naturalWidth > 0), product.photos[1].src);
    assert.equal(await page.evaluate(() => document.querySelector('.image-caption').textContent.startsWith('02')), true, '重试不跳回第一张');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'detail-photo-open', '详情重试后焦点留在当前照片');

    await page.evaluate(() => {
      for (const image of document.querySelectorAll('.detail-gallery img, .photo-lightbox-image img')) image.src = '/__detail-retry-missing.webp';
    });
    await page.waitForSelector('.detail-gallery .load-error-notice');
    await page.click(`button[aria-label=${JSON.stringify(`全屏查看：${product.photos[1].alt}`)}]`);
    await page.waitForSelector('dialog:modal .image-failed button');
    await page.click('dialog:modal .image-failed button');
    await page.waitForFunction(() => document.querySelector('dialog:modal img')?.naturalWidth > 0);
    await page.waitForSelector('.detail-gallery .load-error-notice', { state: 'hidden' });
    await page.waitForFunction((path) => [...document.querySelectorAll('.detail-gallery img')].some(image => image.src.includes(path) && image.naturalWidth > 0), product.photos[1].src);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('photo-lightbox-close')), true, '全屏重试后保留键盘操作焦点');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog:modal', { state: 'hidden' });
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.detail-modal'))), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#wall-category').value, document.querySelector('#wall-sort').value]), before);
    console.log('详情失败提示、连续失败可重试、详情和全屏同步恢复、保留当前照片与筛选排序通过');
  } finally {
    await page.cdp('Network.setBlockedURLs', { urls: [] });
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
  }
}

export async function checkSiteFallback(page, origin = 'http://127.0.0.1:5173') {
  const injected = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__siteFallbackFetch = window.fetch;
    window.__failCatalog = true;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
      if (window.__failCatalog && url.pathname.endsWith('/catalog.json')) return Promise.reject(new TypeError('Test catalog failure'));
      return window.__siteFallbackFetch(input, init);
    };
  ` });
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await acceptDisclaimer(page);
    await page.waitForSelector('.load-error-notice');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.photo-grid'))), false);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.backup-site-link'))), false, '本地失败不跳转到正式站点');
    assert.deepEqual(await page.evaluate(async () => {
      const { getBackupSiteUrl } = await import('/src/LoadErrorNotice.tsx');
      return ['liu1031947450.github.io', 'jssz.pages.dev', 'localhost', 'other.github.io', 'jssz.pages.dev.example.com'].map(getBackupSiteUrl);
    }), ['https://jssz.pages.dev/', 'https://liu1031947450.github.io/JSSZ/', '', '', '']);

    await page.evaluate(() => { window.__failCatalog = false; });
    await page.click('.load-error-actions button');
    await page.waitForSelector('.photo-grid');
    await page.waitForSelector('.load-error-notice', { state: 'hidden' });
    const total = await page.evaluate(() => document.querySelectorAll('.photo-open').length);
    assert.ok(total > 0);

    await page.evaluate(() => { window.__failCatalog = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForSelector('.load-error-notice');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.photo-open').length), total, '核对失败保留已加载作品');
    await page.evaluate(() => { window.__failCatalog = false; });
    await page.click('.load-error-actions button');
    await page.waitForSelector('.load-error-notice', { state: 'hidden' });

    const category = await page.evaluate(() => document.querySelector('#wall-category option:nth-child(2)')?.value || '');
    await page.selectOption('#wall-category', category);
    await page.selectOption('#wall-sort', 'desc');
    const before = await page.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map(element => element.textContent));
    await page.evaluate(() => { document.querySelector('.photo-open img').src = '/__site-fallback-missing.webp'; });
    await page.waitForSelector('.image-failed');
    await page.waitForSelector('#works .load-error-notice');
    for (const width of [320, 390, 768, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
      assert.equal(await page.evaluate(() => {
        const notice = document.querySelector('#works .load-error-notice').getBoundingClientRect();
        const button = document.querySelector('#works .load-error-actions button').getBoundingClientRect();
        return notice.left >= 0 && notice.right <= innerWidth && button.left >= notice.left && button.right <= notice.right && button.top >= notice.top && button.bottom <= notice.bottom && button.height >= 44 && document.documentElement.scrollWidth <= innerWidth;
      }), true, `失败提示布局 ${width}px`);
    }
    await page.click('#works .load-error-actions button');
    await page.waitForSelector('#works .load-error-notice', { state: 'hidden' });
    await page.waitForFunction(() => {
      const image = document.querySelector('.photo-open img');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map(element => element.textContent)), before);
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#wall-category').value, document.querySelector('#wall-sort').value]), [category, 'desc']);
    await page.evaluate(() => { document.querySelector('.photo-open img').src = '/__site-fallback-missing-again.webp'; });
    await page.waitForSelector('#works .load-error-notice');
    await page.click('.filter-all');
    await page.waitForSelector('#works .load-error-notice', { state: 'hidden' });
    console.log('双向备用地址、未知域名隐藏、清单失败及恢复、保留已加载作品、图片失败及重试、筛选与排序保留、手机布局通过');
  } finally {
    await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    await page.evaluate(() => { if (window.__siteFallbackFetch) window.fetch = window.__siteFallbackFetch; delete window.__siteFallbackFetch; delete window.__failCatalog; });
  }
}
