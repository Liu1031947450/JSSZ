import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function checkCatalogEditor(page, visitor) {
  const origin = 'http://127.0.0.1:4174';
  async function login() {
    await page.waitForSelector('#github-token');
    await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
    await page.click('.login-card button[type="submit"]');
    await page.waitForSelector('.save-status.saved');
  }
  async function publish() {
    await page.waitForSelector('.publish-panel > button:not([disabled])');
    await page.click('.publish-panel > button');
    await page.waitForFunction(() => document.querySelector('.notice.success')?.textContent.includes('网站已更新'));
    await visitor.cdp('Page.bringToFront');
    await visitor.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  }
  const state = await (await fetch(`${origin}/__test/state`)).json();
  assert.equal(state.catalog.products.length, 4, '请先运行 checkPhotoWall 创建隔离测试作品');
  await visitor.goto(origin);
  await visitor.waitForSelector('#wall-category');
  await visitor.selectOption('#wall-category', '项链');
  await visitor.selectOption('#wall-material', '925银');
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  console.log(await page.snapshot());
  await login();
  await page.click('.draft-actions button:last-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.save-status.saved');
  await page.click('.work-row button >> nth=0');
  assert.deepEqual(await page.evaluate(() => ({ price: document.querySelector('#work-price').value, type: document.querySelector('#work-price').type, size: Boolean(document.querySelector('#work-size')) })), { price: '128.5', type: 'number', size: false });
  for (const invalid of ['-1', '0.001', '9007199254740992']) {
    await page.fill('#work-price', invalid);
    await page.click('.editor-actions button[type="submit"]');
    assert.equal(await page.evaluate(() => document.querySelector('#work-price')?.validity.valid), false);
    assert.equal((await (await fetch(`${origin}/__test/state`)).json()).head, state.head);
  }
  await page.fill('#work-price', '19.95');
  await page.waitForSelector('.save-status.saved');
  await page.reload();
  await login();
  assert.equal(await page.evaluate(() => document.querySelector('#work-price').value), '19.95', '刷新后应恢复未完成的价格草稿');
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-placeholder');
  await publish();
  await visitor.waitForFunction(() => document.querySelector('.photo-price')?.textContent === '¥19.95');
  assert.equal(await visitor.evaluate(() => document.querySelector('#wall-category').value), '项链');
  assert.equal(await visitor.evaluate(() => document.querySelector('#wall-material').value), '925银');

  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await page.click('.works-list .section-heading button');
  await page.fill('#work-name', '分类更新验收');
  await page.fill('#work-category', '耳环');
  await page.fill('#work-material', '黄铜');
  await page.fill('#work-price', '0');
  assert.equal(await page.evaluate(() => document.querySelector('#work-price').validity.valid), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const directory = await mkdtemp(join(tmpdir(), 'jianshi-price-test-'));
  try {
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 800;
      const context = canvas.getContext('2d');
      context.fillStyle = '#71835e'; context.fillRect(0, 0, 600, 800);
      return canvas.toDataURL('image/webp').split(',')[1];
    });
    const filename = join(directory, 'test.webp');
    await writeFile(filename, Buffer.from(image, 'base64'));
    await page.setInputFiles('input[type="file"][aria-label="选择作品照片"]', [filename]);
    await page.waitForSelector('.crop-modal .animal-modal-footer button:last-child:not([disabled])');
    await page.click('.crop-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.crop-modal', { state: 'hidden' });
  } finally { await rm(directory, { recursive: true, force: true }); }
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-placeholder');
  await publish();
  await visitor.waitForFunction(() => [...document.querySelector('#wall-category').options].some((option) => option.value === '耳环'));
  assert.equal(await visitor.evaluate(() => [...document.querySelector('#wall-material').options].some((option) => option.value === '黄铜')), true);
  await visitor.selectOption('#wall-category', '耳环');
  await visitor.selectOption('#wall-material', '黄铜');
  assert.deepEqual(await visitor.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map((heading) => heading.textContent)), ['分类更新验收']);
  assert.equal(await visitor.evaluate(() => document.querySelector('.photo-price').textContent), '¥0.00');
  const published = (await (await fetch(`${origin}/__test/state`)).json()).catalog;
  assert.equal(published.products.find((product) => product.name === '分类更新验收').price, 0);

  await page.click('.work-row button >> nth=2');
  await page.click('.animal-modal-footer button:last-child');
  await publish();
  await visitor.waitForFunction(() => document.querySelector('#wall-category').value === '' && document.querySelector('#wall-material').value === '');
  assert.equal(await visitor.evaluate(() => document.querySelectorAll('.photo-memory').length), 4, '已删除的分类和材质应自动回到全部');

  await visitor.evaluate(() => { window.__originalCatalogFetch = window.fetch; });
  try {
    await visitor.evaluate(() => {
      window.fetch = (input, init) => String(input).includes('catalog.json') ? Promise.resolve(Response.json({ schemaVersion: 1, revision: 'empty', updatedAt: new Date().toISOString(), products: [] })) : window.__originalCatalogFetch(input, init);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await visitor.waitForSelector('.empty-wall');
    assert.deepEqual(await visitor.evaluate(() => [...document.querySelectorAll('.wall-filters select')].map((select) => ({ disabled: select.disabled, options: select.options.length }))), [{ disabled: true, options: 1 }, { disabled: true, options: 1 }]);
    await visitor.evaluate(() => { window.fetch = window.__originalCatalogFetch; document.dispatchEvent(new Event('visibilitychange')); });
    await visitor.waitForSelector('.photo-grid');
    await visitor.evaluate(() => {
      window.fetch = (input, init) => String(input).includes('catalog.json') ? Promise.resolve(Response.json({ products: null })) : window.__originalCatalogFetch(input, init);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await visitor.waitForSelector('main > .notice.error');
    assert.equal(await visitor.evaluate(() => document.querySelectorAll('.photo-memory').length), 4, '异常数据不能清空已加载作品');
  } finally {
    await visitor.evaluate(() => { window.fetch = window.__originalCatalogFetch; delete window.__originalCatalogFetch; document.dispatchEvent(new Event('visibilitychange')); });
  }
  await visitor.waitForSelector('main > .notice.error', { state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
  assert.deepEqual(await visitor.evaluate(() => window.__pageErrors), []);
  console.log('价格输入/校验/草稿恢复/创建发布、分类缓存更新/删除恢复、空清单和异常数据验收通过');
}
