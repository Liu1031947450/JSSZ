import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function checkNewWorkSync(page) {
  const origin = 'http://127.0.0.1:4174';
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const names = () => page.evaluate(() => [...document.querySelectorAll('.work-row h3')].map(heading => heading.textContent));
  async function cancelEditor() {
    await page.click('.editor-actions button:first-child');
    await page.click('.animal-modal-footer button:last-child');
    await page.waitForSelector('.editor-placeholder');
    await page.waitForSelector('.save-status.saved');
  }
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  await page.waitForSelector('#github-token');
  await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.save-status.saved');
  await page.click('.draft-actions button:last-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.save-status.saved');
  await page.waitForSelector('.editor-placeholder');
  const baseline = await state();
  assert.ok(baseline.catalog.products.length > 0, '隔离清单需要至少一件作品');
  await page.click('.work-row-copy button >> nth=0');
  await page.fill('#work-name', '自动核对保留本地草稿');
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-placeholder');
  await page.waitForSelector('.save-status.saved');
  const draftNames = await names();
  for (const width of [390, 1440]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 800 });
    const before = await state();
    await page.click('.works-list .section-heading button');
    await page.waitForSelector('#work-name');
    await page.waitForFunction(() => document.querySelector('.animal-notification-root[role="status"]')?.textContent.includes('已自动核对远程'));
    const calls = (await state()).calls.slice(before.calls.length);
    assert.equal(calls.length, 3, '每次新增只核对一次，发出三次读取请求');
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.match(calls[0].path, /\/git\/ref\/heads\//);
    assert.match(calls[1].path, /\/git\/commits\//);
    assert.match(calls[2].path, /\/contents\/public\/catalog\.json$/);
    assert.equal(await page.evaluate(() => document.querySelector('#work-name').value), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await names(), draftNames, '核对后仍保留待发布修改');
    await cancelEditor();
  }
  for (const failure of [429, 403]) {
    await fetch(`${origin}/__test/control`, { method: 'POST', body: JSON.stringify({ failure }) });
    const before = await state();
    await page.click('.works-list .section-heading button');
    await page.waitForSelector('.admin-page > .notice.error');
    await page.waitForSelector('.works-list .section-heading button:not([disabled])');
    assert.equal((await state()).calls.length - before.calls.length, 1, '失败时不自动重试');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#work-name'))), false);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.animal-notification-root'))), false, '失败不能显示成功消息');
    assert.deepEqual(await names(), draftNames);
  }
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    window.__restoreDraftPut = () => { IDBObjectStore.prototype.put = originalPut; delete window.__restoreDraftPut; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Test quota failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
  });
  try {
    await page.click('.works-list .section-heading button');
    await page.waitForSelector('.save-status.error');
    await page.waitForSelector('.works-list .section-heading button:not([disabled])');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#work-name'))), false);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.animal-notification-root'))), false);
    assert.deepEqual(await names(), draftNames);
  } finally { await page.evaluate(() => window.__restoreDraftPut()); }
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.__restoreSyncFetch = () => { window.fetch = originalFetch; delete window.__restoreSyncFetch; };
    window.fetch = async (input, init) => {
      if (String(input).includes('/git/ref/heads/')) await new Promise(resolve => { window.__releaseSync = resolve; });
      return originalFetch(input, init);
    };
  });
  const beforeSlowCheck = await state();
  try {
    await page.click('.works-list .section-heading button');
    await page.waitForFunction(() => Boolean(window.__releaseSync));
    assert.equal(await page.evaluate(() => document.querySelector('.works-list .section-heading button').disabled), true);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#work-name'))), false, '核对完成前不能打开编辑器');
    await page.evaluate(() => document.querySelector('.works-list .section-heading button').click());
  } finally {
    await page.evaluate(() => { window.__restoreSyncFetch(); window.__releaseSync?.(); delete window.__releaseSync; });
  }
  await page.waitForSelector('#work-name');
  assert.equal((await state()).calls.length - beforeSlowCheck.calls.length, 3, '核对期间重复点击不增加请求');
  await cancelEditor();
  await fetch(`${origin}/__test/control`, { method: 'POST', body: JSON.stringify({ advanceHead: true }) });
  await page.click('.works-list .section-heading button');
  await page.waitForFunction(() => document.querySelector('.admin-page > .notice.error')?.textContent.includes('远端已有新的提交'));
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#work-name'))), false);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.animal-notification-root'))), false);
  assert.deepEqual(await names(), draftNames, '冲突时保留本地草稿');
  const finalState = await state();
  assert.deepEqual(finalState.catalog, baseline.catalog, '自动核对不能更改远端作品');
  assert.ok(finalState.calls.slice(baseline.calls.length).every(call => call.method === 'GET'));
  assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
  console.log('新增前自动核对、重复点击、成功提示、保留草稿、限流/权限/存储失败和远端冲突验收通过');
}

export async function checkCatalogEditor(page, visitor) {
  const origin = 'http://127.0.0.1:4174';
  async function checkEditorOptions(products) {
    for (const field of ['category', 'material']) {
      const input = await page.evaluate(field => {
        const input = document.getElementById(`work-${field}`);
        return { editable: input.type === 'text' && !input.readOnly && !input.disabled, values: [...input.list.options].map(option => option.value) };
      }, field);
      const expected = [...new Set(products.map(product => product[field].trim()).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'zh-CN'));
      assert.equal(input.editable, true, `${field} 既可选已有值，也可自由填写`);
      assert.deepEqual(input.values, expected, `${field} 候选应来自当前清单，去重并随保存更新`);
    }
  }
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
  await checkEditorOptions(state.catalog.products);
  await page.fill('#work-category', '手链');
  await page.fill('#work-material', '珍珠');
  await page.waitForSelector('.save-status.saved');
  await page.reload();
  await login();
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-category').value, document.querySelector('#work-material').value]), ['手链', '珍珠'], '已有候选值应正常保存为编辑草稿');
  await page.fill('#work-category', '项链');
  await page.fill('#work-material', '925银');
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
  await checkEditorOptions(state.catalog.products);
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
  await page.click('.work-row-copy button >> nth=0');
  await checkEditorOptions([...state.catalog.products, { category: '耳环', material: '黄铜' }]);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-category').value, document.querySelector('#work-material').value]), ['耳环', '黄铜']);
  await page.click('.editor-actions button:first-child');
  await page.click('.animal-modal-footer button:last-child');
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
