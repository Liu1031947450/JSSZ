import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptDisclaimer } from './disclaimer.browser.mjs';

async function discardEditor(page) {
  if (await page.evaluate(() => Boolean(document.querySelector('.resume-editor')))) await page.click('.resume-editor');
  if (!await page.evaluate(() => Boolean(document.querySelector('.editor-modal')))) return;
  await page.click('.editor-actions button:first-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await page.waitForSelector('.save-status.saved');
}

async function parkEditor(page) {
  if (!await page.evaluate(() => Boolean(document.querySelector('.editor-modal')))) return;
  const name = await page.evaluate(() => document.querySelector('#work-name').value);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreParkPut = () => { IDBObjectStore.prototype.put = original; delete window.__restoreParkPut; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Test quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  try {
    await page.fill('#work-name', `${name} `);
    await page.fill('#work-name', name);
    await page.waitForSelector('.editor-modal .save-status.error');
  } finally { await page.evaluate(() => window.__restoreParkPut()); }
  await page.click('.editor-return');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await page.waitForSelector('.resume-editor');
}

export async function checkBackupImport(page) {
  const origin = 'http://127.0.0.1:4174';
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const baseline = await state();
  assert.ok(baseline.catalog.products.length, '请先运行公告墙和编辑器验收，生成隔离作品与图片');
  async function login() {
    await acceptDisclaimer(page);
    await page.waitForSelector('#github-token');
    await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
    await page.click('.login-card button[type="submit"]');
    await page.waitForSelector('.save-status.saved');
  }
  async function selectBackup(filename) {
    await parkEditor(page);
    const chooserEvent = page.waitForFileChooser({ timeout: 10_000 });
    await page.click('.draft-actions button:nth-child(2)');
    await (await chooserEvent).setFiles(filename);
    await page.waitForFunction(() => document.querySelector('.confirmation-modal .animal-modal-title')?.textContent.includes('导入备份并覆盖'));
  }
  async function checkOriginalEditor() {
    await page.click('.resume-editor');
    await page.waitForSelector('#work-name');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-name')?.value, document.querySelector('#work-price')?.value]), ['导入前保留内容', '77']);
    await parkEditor(page);
  }
  await page.goto(`${origin}/#/admin`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await login();
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  const directory = await mkdtemp(join(tmpdir(), 'jianshi-backup-test-'));
  try {
    const backupFile = join(directory, 'full-backup.json');
    const downloadEvent = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('.draft-actions button:first-child');
    await (await downloadEvent).saveAs(backupFile);
    const payload = JSON.parse(await readFile(backupFile, 'utf8'));
    assert.deepEqual(payload.catalog, baseline.catalog);
    assert.equal(Object.keys(payload.assets).length, new Set(payload.catalog.products.flatMap(product => product.photos.flatMap(photo => [photo.src, photo.thumbnail]))).size);
    assert.equal(payload.pendingRevision, undefined);
    assert.equal(JSON.stringify(payload).includes('github_pat_'), false);
    const editingFile = join(directory, 'editing-backup.json');
    await writeFile(editingFile, JSON.stringify({ ...payload, pendingRevision: 'obsolete', editing: { ...payload.catalog.products[0], name: '备份编辑内容', price: 18.88 } }));
    await page.click('.work-row-copy button >> nth=0');
    await page.fill('#work-name', '导入前保留内容');
    await page.fill('#work-price', '77');
    await page.waitForSelector('.save-status.saved');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.editor-draft-actions, #editor-backup-help'))), false);
    await parkEditor(page);
    const editingDownload = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('.draft-actions button:first-child');
    const unfinishedFile = join(directory, 'unfinished-backup.json');
    await (await editingDownload).saveAs(unfinishedFile);
    assert.equal(JSON.parse(await readFile(unfinishedFile, 'utf8')).editing.name, '导入前保留内容', '收起编辑器后可备份尚未完成的编辑');
    await selectBackup(editingFile);
    await page.click('.animal-modal-footer button:first-child');
    await page.waitForSelector('.confirmation-modal', { state: 'hidden' });
    await checkOriginalEditor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.resume-editor'));
    const invalidFile = join(directory, 'invalid.json');
    await writeFile(invalidFile, '{broken');
    await page.setInputFiles('input[aria-label="选择草稿备份文件"]', [invalidFile]);
    await page.waitForFunction(() => [...document.querySelectorAll('.notice.error')].some(notice => notice.textContent.includes('备份未导入')));
    await checkOriginalEditor();
    await selectBackup(editingFile);
    await fetch(`${origin}/__test/control`, { method: 'POST', body: JSON.stringify({ failure: 403 }) });
    await page.click('.animal-modal-footer button:last-child');
    await page.waitForFunction(() => [...document.querySelectorAll('.notice.error')].some(notice => notice.textContent.includes('导入失败')));
    await checkOriginalEditor();
    await selectBackup(editingFile);
    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put;
      window.__restoreBackupPut = () => { IDBObjectStore.prototype.put = originalPut; delete window.__restoreBackupPut; };
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'drafts') throw new DOMException('Test quota failure', 'QuotaExceededError');
        return originalPut.apply(this, args);
      };
    });
    try {
      await page.click('.animal-modal-footer button:last-child');
      await page.waitForFunction(() => [...document.querySelectorAll('.notice.error')].some(notice => notice.textContent.includes('导入失败')));
    } finally { await page.evaluate(() => window.__restoreBackupPut()); }
    await checkOriginalEditor();
    await page.click('.notice.error button:not([aria-label]):first-of-type');
    await page.waitForSelector('.save-status.saved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await login();
    await parkEditor(page);
    await checkOriginalEditor();
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await selectBackup(editingFile);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.click('.animal-modal-footer button:last-child');
    await page.waitForFunction(() => document.querySelector('.animal-notification-root')?.textContent.includes('备份已导入'));
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-name').value, document.querySelector('#work-price').value]), ['备份编辑内容', '18.88'], '同一个作品的编辑器也必须完整恢复，包括非受控价格输入');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await login();
    assert.equal(await page.evaluate(() => document.querySelector('#work-price').value), '18.88');
    const emptyFile = join(directory, 'empty-backup.json');
    await writeFile(emptyFile, JSON.stringify({ ...payload, catalog: { ...payload.catalog, products: [] }, assets: {} }));
    await selectBackup(emptyFile);
    assert.equal(await page.evaluate(() => document.querySelector('.confirmation-copy').textContent.includes('清空本机作品集')), true);
    await page.click('.animal-modal-footer button:last-child');
    await page.waitForSelector('.empty-workspace');
    await selectBackup(backupFile);
    await page.click('.animal-modal-footer button:last-child');
    await page.waitForFunction(() => document.querySelector('.animal-notification-root')?.textContent.includes('备份已导入'));
    await page.waitForSelector('.editor-modal', { state: 'hidden' });
    await page.waitForSelector('.save-status.saved');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.work-row h3')].map(heading => heading.textContent)), payload.catalog.products.map(product => product.name));
    const finalState = await state();
    assert.equal(finalState.head, baseline.head);
    assert.deepEqual(finalState.catalog, baseline.catalog);
    assert.ok(finalState.calls.slice(baseline.calls.length).every(call => call.method === 'GET'), '下载与导入只能读取远端，不能自动发布');
    assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
    console.log('备份导出/覆盖/取消/无效文件/网络和存储失败保护/空作品集/编辑器恢复验收通过');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function checkWorkspaceModal(page) {
  const origin = 'http://127.0.0.1:4174';
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const baseline = await state();
  assert.ok(baseline.catalog.products.length >= 4, '请先生成隔离测试作品');
  const names = () => page.evaluate(() => [...document.querySelectorAll('.work-row h3')].map(heading => heading.textContent));
  async function confirmDiscard() {
    await page.click('.confirmation-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.editor-modal', { state: 'hidden' });
    await page.waitForSelector('.save-status.saved');
  }
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  await acceptDisclaimer(page);
  await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.save-status.saved');
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.editor-placeholder, .editor-section, .admin-workspace'))), false);
  await page.click('.works-list .section-heading button');
  await page.waitForSelector('.editor-modal .animal-notification-root');
  await page.click('button[aria-label="关闭作品编辑器"]');
  await confirmDiscard();
  for (const close of [
    () => page.click('button[aria-label="关闭作品编辑器"]'),
    () => page.keyboard.press('Escape'),
    () => page.mouse.click(4, 4),
  ]) {
    await page.click('.work-row-copy button >> nth=0');
    await page.fill('#work-name', '取消时应保留的内容');
    await page.fill('#work-price', '0.001');
    await close();
    await page.waitForSelector('.confirmation-modal');
    await page.click('.confirmation-modal .animal-modal-footer button:first-child');
    await page.waitForSelector('.confirmation-modal', { state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-name').value, document.querySelector('#work-price').value, document.querySelector('#work-price').validity.valid]), ['取消时应保留的内容', '0.001', false]);
    await page.waitForFunction(() => document.querySelector('.editor-modal').contains(document.activeElement));
    await close();
    await confirmDiscard();
    assert.deepEqual(await names(), baseline.catalog.products.map(product => product.name));
    await page.waitForFunction(() => document.activeElement === document.querySelector('.work-row-copy button'));
  }
  await page.click('.work-row-copy button >> nth=0');
  await page.fill('#work-name', '长名称'.repeat(20));
  await page.fill('#work-price', '23.45');
  await page.evaluate(() => { window.__editorPriceInput = document.querySelector('#work-price'); });
  await page.click('.editor-actions button:nth-child(2)');
  await page.waitForSelector('.detail-modal');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.detail-modal', { state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => [Boolean(document.querySelector('.confirmation-modal')), document.querySelector('#work-price') === window.__editorPriceInput, document.querySelector('#work-price').value]), [false, true, '23.45']);
  await page.evaluate(() => {
    delete window.__editorPriceInput;
    const originalPut = IDBObjectStore.prototype.put;
    window.__restoreEditorPut = () => { IDBObjectStore.prototype.put = originalPut; delete window.__restoreEditorPut; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Test quota failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
  });
  try {
    await page.fill('#work-description', '弹窗保存失败后可以重试');
    await page.waitForSelector('.editor-modal .save-status.error');
    assert.equal(await page.evaluate(() => document.querySelector('.editor-modal [role="alert"]').textContent.includes('重试保存')), true);
  } finally { await page.evaluate(() => window.__restoreEditorPut()); }
  await page.click('.editor-modal .notice.error button:first-of-type');
  await page.waitForSelector('.editor-modal .save-status.saved');
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  for (const [width, columns] of [[1440, 4], [1000, 3], [801, 3], [800, 2], [390, 2], [361, 2], [360, 1], [320, 1]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.works-grid');
      const list = document.querySelector('.works-list');
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, fullWidth: Math.abs(grid.getBoundingClientRect().width - list.getBoundingClientRect().width) < 1, overflow: document.documentElement.scrollWidth > innerWidth, cardsContained: [...grid.children].every(card => card.scrollWidth <= card.clientWidth + 1) };
    });
    assert.deepEqual(layout, { columns, fullWidth: true, overflow: false, cardsContained: true }, `${width}px 网格铺满工作区，长标题与操作按钮不溢出`);
    await page.click('.works-list .section-heading button');
    await page.waitForSelector('.editor-modal');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.editor-modal')).animationName === 'none' || document.querySelector('.editor-modal').getAnimations().every(animation => animation.playState === 'finished'));
    assert.equal(await page.evaluate(() => {
      const modal = document.querySelector('.editor-modal');
      const bounds = modal.getBoundingClientRect();
      const body = modal.querySelector('.animal-modal-body');
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && body.scrollWidth <= body.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY);
    }), true, `${width}px 编辑弹窗完整显示且内容可内部滚动`);
    await page.fill('#work-name', '缺少照片应阻止保存');
    await page.click('.editor-actions button[type="submit"]');
    await page.waitForSelector('.editor-modal [role="alert"]');
    assert.equal(await page.evaluate(() => {
      const notice = document.querySelector('.editor-modal [role="alert"]').getBoundingClientRect();
      const body = document.querySelector('.editor-modal .animal-modal-body').getBoundingClientRect();
      return notice.top >= body.top - 1 && notice.bottom <= body.bottom + 1;
    }), true, '在表单底部提交失败时，错误提示也必须可见');
    await page.click('.editor-actions button:first-child');
    await confirmDiscard();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.works-list .section-heading button'));
  }
  await page.click('.draft-actions button:last-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  assert.deepEqual(await names(), baseline.catalog.products.map(product => product.name));
  assert.deepEqual((await state()).catalog, baseline.catalog, '布局和编辑验收不能自动发布');
  assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
  console.log('工作台网格断点/长标题、弹窗关闭确认/焦点、嵌套预览、保存失败重试与表单校验验收通过');
}

export async function checkProductPins(page, visitor) {
  const origin = 'http://127.0.0.1:4174';
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const baseline = await state();
  const products = baseline.catalog.products;
  assert.ok(products.length >= 4 && products.every(product => product.pinOrder === undefined), '请先生成未置顶的隔离作品');
  const originalOrder = products;
  const visibleNames = () => visitor.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map(heading => heading.textContent));
  const pinButton = position => `[data-work-id="${products[position].id}"] .work-pin-button`;
  async function login() {
    await acceptDisclaimer(page);
    await page.waitForSelector('#github-token');
    await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
    await page.click('.login-card button[type="submit"]');
    await page.waitForSelector('.save-status.saved');
  }
  async function publish() {
    await page.waitForSelector('.publish-panel > button:not([disabled])');
    await page.click('.publish-panel > button');
    await page.waitForFunction(() => document.querySelector('.notice.success')?.textContent.includes('网站已更新'));
    await visitor.reload();
    await acceptDisclaimer(visitor);
    await visitor.waitForSelector('.photo-grid');
  }
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  await login();
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  await visitor.goto(origin);
  await acceptDisclaimer(visitor);
  await visitor.waitForSelector('.photo-grid');
  for (const position of [2, 0, 1]) await page.click(pinButton(position));
  await page.waitForSelector('.save-status.saved');
  assert.deepEqual((await state()).catalog, baseline.catalog, '置顶只能修改本机，不能自动发布');
  assert.deepEqual(await visibleNames(), originalOrder.map(product => product.name));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.work-pin-button[aria-pressed="true"]').length), 3);
  await page.click(`[data-work-id="${products[2].id}"] .work-row-copy button:first-child`);
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await page.waitForSelector('.save-status.saved');
  await page.reload();
  await login();
  assert.equal(await page.evaluate(() => document.querySelectorAll('.work-pin-button[aria-pressed="true"]').length), 3, '编辑和刷新不能丢失置顶');
  const directory = await mkdtemp(join(tmpdir(), 'jianshi-pin-test-'));
  try {
    const downloadEvent = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('.draft-actions button:first-child');
    const backupFile = join(directory, 'pinned-backup.json');
    await (await downloadEvent).saveAs(backupFile);
    const backup = JSON.parse(await readFile(backupFile, 'utf8'));
    assert.deepEqual(backup.catalog.products.slice(0, 4).map(product => product.pinOrder), [2, 3, 1, undefined]);
  } finally { await rm(directory, { recursive: true, force: true }); }
  await publish();
  const ordered = [products[2], products[0], products[1], ...originalOrder.filter(product => !products.slice(0, 3).some(pinned => pinned.id === product.id))];
  assert.deepEqual(await visibleNames(), ordered.map(product => product.name), '先置顶先展示，后续按点击顺序排在队尾');
  assert.equal(await visitor.evaluate(() => document.querySelectorAll('.photo-pin').length), 3);
  for (const width of [320, 361, 390, 480, 481, 800, 801, 1000, 1001, 1100, 1440]) {
    for (const target of [page, visitor]) await target.cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 800 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.work-pin-button')].every(button => {
      const pin = button.getBoundingClientRect();
      const remove = button.previousElementSibling.getBoundingClientRect();
      return button.previousElementSibling.textContent === '删除' && pin.left >= remove.right - 1 && Math.abs(pin.top - remove.top) < 1;
    })), true, `${width}px 置顶按钮保持在删除右侧`);
    assert.equal(await visitor.evaluate(() => [...document.querySelectorAll('.photo-pin')].every(badge => {
      const card = badge.closest('.photo-memory').getBoundingClientRect();
      const bounds = badge.getBoundingClientRect();
      return badge.textContent === '置顶' && bounds.left >= card.left && bounds.right <= card.right;
    })), true, `${width}px 置顶徽标不溢出`);
    for (const target of [page, visitor]) assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await visitor.selectOption('#wall-category', products[0].category);
  assert.deepEqual(await visibleNames(), ordered.filter(product => product.category === products[0].category).map(product => product.name));
  await visitor.selectOption('#wall-category', '');
  await visitor.selectOption('#wall-material', products[0].material);
  assert.deepEqual(await visibleNames(), ordered.filter(product => product.material === products[0].material).map(product => product.name));
  await page.click(pinButton(2));
  await publish();
  assert.deepEqual((await visibleNames()).slice(0, 2), [products[0].name, products[1].name]);
  assert.equal(await visitor.evaluate(() => document.querySelectorAll('.photo-pin').length), 2);
  await visitor.selectOption('#wall-sort', 'asc');
  assert.deepEqual(await visibleNames(), [products[0], products[1], products[3], products[2]].map(product => product.name), '价格升序不能打乱置顶先后，未标价排在普通作品末尾');
  await visitor.selectOption('#wall-sort', 'desc');
  assert.deepEqual(await visibleNames(), [products[0], products[1], products[3], products[2]].map(product => product.name), '价格降序也保留置顶先后和未标价置后');
  await page.click(pinButton(2));
  await publish();
  assert.deepEqual((await visibleNames()).slice(0, 3), products.slice(0, 3).map(product => product.name), '重新置顶进入当前置顶队尾');
  for (const position of [0, 1, 2]) await page.click(pinButton(position));
  await publish();
  assert.deepEqual(await visibleNames(), originalOrder.map(product => product.name));
  assert.equal(await visitor.evaluate(() => document.querySelectorAll('.photo-pin').length), 0);
  assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
  assert.deepEqual(await visitor.evaluate(() => window.__pageErrors), []);
  console.log('多作品顺序置顶/取消和重新置顶、编辑/刷新/备份保留、发布生效、筛选排序和响应式徽标验收通过');
}

export async function checkNewWorkSync(page) {
  const origin = 'http://127.0.0.1:4174';
  const state = async () => (await fetch(`${origin}/__test/state`)).json();
  const names = () => page.evaluate(() => [...document.querySelectorAll('.work-row h3')].map(heading => heading.textContent));
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  await acceptDisclaimer(page);
  await page.waitForSelector('#github-token');
  await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.save-status.saved');
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  const baseline = await state();
  assert.ok(baseline.catalog.products.length > 0, '隔离清单需要至少一件作品');
  await page.click('.work-row-copy button >> nth=0');
  await page.fill('#work-name', '自动核对保留本地草稿');
  await page.click('.editor-actions button[type="submit"]');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
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
    await discardEditor(page);
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
  await discardEditor(page);
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

export async function checkUploadZone(page, origin = 'http://127.0.0.1:4174') {
  const baseline = await (await fetch(`${origin}/__test/state`)).json();
  await page.goto(`${origin}/#/admin`); await page.reload();
  await acceptDisclaimer(page);
  await page.waitForSelector('#github-token');
  await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.save-status.saved');
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  const directory = await mkdtemp(join(tmpdir(), 'jianshi-upload-zone-'));
  try {
    const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80; return canvas.toDataURL('image/png').split(',')[1]; });
    const filename = join(directory, 'upload.png');
    await writeFile(filename, Buffer.from(image, 'base64'));
    for (const width of [1440, 390]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
      await page.click('.works-list .section-heading button');
      await page.waitForSelector('.upload-zone');
      const name = `上传区域验收 ${width}`;
      await page.fill('#work-name', name); await page.fill('#work-price', '12.30');
      for (const mode of ['新增', '编辑']) {
        await page.evaluate(() => { window.__uploadClicks = 0; document.querySelector('input[aria-label="选择作品照片"]').addEventListener('click', () => window.__uploadClicks++); });
        for (const [position, action] of ['空白', '图标', '文字', 'Enter', 'Space'].entries()) {
          await page.waitForFunction(() => document.querySelector('.editor-modal').getAnimations().every(animation => animation.playState === 'finished'));
          await page.focus('.upload-zone');
          const chooser = page.waitForFileChooser({ timeout: 10_000 });
          if (action === 'Enter' || action === 'Space') await page.keyboard.press(action);
          else if (action === '空白') {
            await page.waitForFunction(() => { const zone = document.querySelector('.upload-zone'); const bounds = zone.getBoundingClientRect(); return zone.contains(document.elementFromPoint(bounds.left + 8, bounds.top + 8)); });
            const point = await page.evaluate(() => { const bounds = document.querySelector('.upload-zone').getBoundingClientRect(); return { x: bounds.left + 8, y: bounds.top + 8 }; });
            await page.mouse.click(point.x, point.y, { label: '点击上传区域空白处' });
          } else await page.click(action === '图标' ? '.upload-zone svg' : '.upload-zone-label');
          await (await chooser).setFiles(filename);
          await page.waitForSelector('.crop-modal .animal-modal-footer button:last-child:not([disabled])');
          assert.equal(await page.evaluate(() => window.__uploadClicks), position + 1, `${width}px ${mode}点击${action}只打开一次文件选择`);
          await page.evaluate(() => document.querySelector('.upload-zone').click());
          assert.equal(await page.evaluate(() => window.__uploadClicks), position + 1, '裁剪期间禁用上传区域');
          const accept = mode === '新增' && action === 'Space';
          await page.click(`.crop-modal .animal-modal-footer button:${accept ? 'last' : 'first'}-child`);
          await page.waitForSelector('.crop-modal', { state: 'hidden' });
          assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-name').value, document.querySelector('#work-price').value]), [name, '12.30']);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !document.querySelector('.upload-zone button')), true);
        if (mode === '编辑' && width === 1440) {
          for (const count of [2, 1]) {
            await page.evaluate(({ image, count }) => {
              const transfer = new DataTransfer();
              for (let index = 0; index < count; index++) transfer.items.add(new File([Uint8Array.from(atob(image), character => character.charCodeAt(0))], `drop-${index}.png`, { type: 'image/png' }));
              document.querySelector('.upload-zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            }, { image, count });
            if (count === 2) await page.waitForFunction(() => document.querySelector('.editor-modal [role="alert"]')?.textContent.includes('每次添加一张照片'));
            else {
              await page.waitForSelector('.crop-modal .animal-modal-footer button:last-child:not([disabled])');
              await page.click('.crop-modal .animal-modal-footer button:first-child');
              await page.waitForSelector('.crop-modal', { state: 'hidden' });
            }
          }
        }
        await page.click('.editor-actions button[type="submit"]');
        await page.waitForSelector('.editor-modal', { state: 'hidden' });
        await page.waitForSelector('.save-status.saved');
        if (mode === '新增') {
          const id = await page.evaluate(name => [...document.querySelectorAll('[data-work-id]')].find(card => card.querySelector('h3').textContent === name).dataset.workId, name);
          await page.click(`[data-work-id="${id}"] .work-row-copy button:first-child`);
          await page.waitForSelector('.upload-zone');
          await page.fill('#work-price', '12.30');
        }
      }
    }
    assert.equal((await (await fetch(`${origin}/__test/state`)).json()).head, baseline.head, '选图和本地保存不能发布');
    assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
    console.log('新增/编辑：整区空白、图标、文字、Enter/空格选图，单次触发、裁剪返回、禁用、拖放及手机布局验收通过');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function checkCatalogEditor(page, visitor) {
  const origin = 'http://127.0.0.1:4174';
  async function checkEditorOptions(products) {
    for (const field of ['category', 'material']) {
      await page.waitForSelector(`#work-${field}`);
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
    await acceptDisclaimer(page);
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
  await acceptDisclaimer(visitor);
  await visitor.waitForSelector('#wall-category');
  await visitor.selectOption('#wall-category', '项链');
  await visitor.selectOption('#wall-material', '925银');
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  console.log(await page.snapshot());
  await login();
  await discardEditor(page);
  await page.click('.draft-actions button:last-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.admin-toolbar button:first-child:not([disabled])');
  await page.waitForSelector('.save-status.saved');
  await page.click('.work-row-copy button >> nth=0');
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
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
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
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await page.click('.work-row-copy button >> nth=0');
  await checkEditorOptions([...state.catalog.products, { category: '耳环', material: '黄铜' }]);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#work-category').value, document.querySelector('#work-material').value]), ['耳环', '黄铜']);
  await page.click('.editor-actions button:first-child');
  await page.click('.animal-modal-footer button:last-child');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await publish();
  await visitor.waitForFunction(() => [...document.querySelector('#wall-category').options].some((option) => option.value === '耳环'));
  assert.equal(await visitor.evaluate(() => [...document.querySelector('#wall-material').options].some((option) => option.value === '黄铜')), true);
  await visitor.selectOption('#wall-category', '耳环');
  await visitor.selectOption('#wall-material', '黄铜');
  assert.deepEqual(await visitor.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map((heading) => heading.textContent)), ['分类更新验收']);
  assert.equal(await visitor.evaluate(() => document.querySelector('.photo-price').textContent), '¥0.00');
  const published = (await (await fetch(`${origin}/__test/state`)).json()).catalog;
  assert.equal(published.products.find((product) => product.name === '分类更新验收').price, 0);

  await page.click('.work-row-copy button >> nth=2');
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
    assert.deepEqual(await visitor.evaluate(() => [...document.querySelectorAll('.wall-filters select')].map((select) => ({ disabled: select.disabled, options: select.options.length }))), [{ disabled: true, options: 1 }, { disabled: true, options: 1 }, { disabled: true, options: 3 }]);
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
