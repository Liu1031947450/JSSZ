import assert from 'node:assert/strict';
import { acceptDisclaimer } from './disclaimer.browser.mjs';

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
