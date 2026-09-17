import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkPhotoWall(page) {
  const origin = 'http://127.0.0.1:4174';
  async function request(path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer github_pat_test_only_not_a_real_token' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.ok, true, `${method} ${path}`);
    return response.json();
  }
  async function checkCenteredDetail() {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.detail-modal')).opacity === '1');
    const layout = await page.evaluate(() => {
      const modal = document.querySelector('.detail-modal');
      const bounds = modal.getBoundingClientRect();
      const gallery = modal.querySelector('.detail-gallery').getBoundingClientRect();
      const copy = modal.querySelector('.detail-copy').getBoundingClientRect();
      const selectors = ['.animal-modal-title', '.detail-gallery', '.detail-copy', '.detail-actions'];
      return {
        centered: selectors.every((selector) => { const rect = modal.querySelector(selector).getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - bounds.left - bounds.width / 2) < 2; }),
        stacked: copy.top >= gallery.bottom,
        textAlign: getComputedStyle(modal.querySelector('.detail-copy')).textAlign,
        contained: [...modal.querySelectorAll('.animal-modal-title, .animal-modal-body, .detail-layout, .detail-gallery, .detail-copy, .detail-footer, dl, dd')].every((element) => element.scrollWidth <= element.clientWidth + 1),
      };
    });
    assert.deepEqual(layout, { centered: true, stacked: true, textAlign: 'center', contained: true }, '详情标题、图片、资料和按钮应居中，长文本不应横向溢出');
  }
  async function checkWechatCopy(selector, checkDuration = false) {
    const initialUrl = await page.url();
    const detailOpen = await page.evaluate(() => Boolean(document.querySelector('.detail-modal')));
    await page.evaluate(() => {
      const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      const execCommand = document.execCommand;
      window.__restoreWechatClipboard = () => {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else delete navigator.clipboard;
        document.execCommand = execCommand;
      };
    });
    try {
      for (const mode of ['clipboard', 'unavailable', 'denied', 'failure', 'error']) {
        await page.evaluate((mode) => {
          window.__copiedWechat = '';
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText: async (text) => {
            if (mode !== 'clipboard') throw new DOMException('Clipboard denied', 'NotAllowedError');
            window.__copiedWechat = text;
          } } });
          document.execCommand = (command) => {
            if (mode === 'error') throw new Error('Copy unavailable');
            if (mode === 'failure' || command !== 'copy') return false;
            const input = document.activeElement;
            if (!input?.matches('textarea.visually-hidden')) return false;
            window.__copiedWechat = input.value.slice(input.selectionStart, input.selectionEnd);
            return true;
          };
        }, mode);
        await page.click(selector);
        await page.waitForSelector('.contact-notification', { state: 'visible' });
        const success = mode !== 'failure' && mode !== 'error';
        const result = await page.evaluate((selector) => {
          const notice = document.querySelector('.contact-notification');
          const root = notice.closest('.animal-notification-root');
          const bounds = notice.getBoundingClientRect();
          return { text: notice.querySelector('.animal-notification-title').textContent, copied: window.__copiedWechat, temporaryInputs: document.querySelectorAll('textarea.visually-hidden').length, focused: document.activeElement === document.querySelector(selector), role: root.getAttribute('role'), floating: getComputedStyle(root).position === 'fixed' && bounds.top >= 0 && bounds.top < 100, contained: bounds.left >= 0 && bounds.right <= innerWidth, inlineNotice: Boolean(document.querySelector('.wechat-notice, .detail-footer .contact-notification, .site-footer .contact-notification')) };
        }, selector);
        assert.deepEqual(result, { text: success ? '微信号复制成功！打开微信搜索添加' : '复制失败，请手动复制微信号：JS-200sz', copied: success ? 'JS-200sz' : '', temporaryInputs: 0, focused: true, role: success ? 'status' : 'alert', floating: true, contained: true, inlineNotice: false }, `微信复制模式：${mode}`);
        assert.equal(await page.url(), initialUrl, '微信咨询不应跳转页面');
        if (checkDuration && mode === 'clipboard') {
          await page.waitForSelector('.contact-notification', { state: 'hidden', timeout: 6000 });
        } else {
          await page.click('.contact-notification .animal-notification-close');
          await page.waitForSelector('.contact-notification', { state: 'hidden' });
        }
        assert.equal(await page.evaluate(() => Boolean(document.querySelector('.detail-modal'))), detailOpen, '关闭浮动消息不应关闭作品详情');
      }
    } finally {
      await page.evaluate(() => { window.__restoreWechatClipboard(); delete window.__restoreWechatClipboard; });
    }
  }
  const state = await request('/__test/state');
  assert.equal(state.head, 'test-baseline', '请重新启动隔离验收服务，避免覆盖已有测试数据');
  await page.goto(origin);
  const images = await page.evaluate(() => [[320, 960], [1280, 320]].map(([width, height]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d6dbc5'; context.fillRect(0, 0, width, height);
    context.fillStyle = '#ba8275'; context.fillRect(0, 0, width, 40);
    context.fillStyle = '#71835e'; context.fillRect(0, height - 40, width, 40);
    const content = canvas.toDataURL('image/webp').split(',')[1];
    return { width, height, content, bytes: atob(content).length };
  }));
  const blobs = await Promise.all(images.map((image) => request('/__github/git/blobs', { content: image.content, encoding: 'base64' })));
  const treeEntries = [];
  const now = new Date().toISOString();
  const products = Array.from({ length: 4 }, (_, position) => {
    const id = randomUUID();
    const photos = images.map((image, imageIndex) => {
      const photoId = randomUUID();
      const src = `images/${id}/${photoId}-detail.webp`;
      const thumbnail = `images/${id}/${photoId}-thumb.webp`;
      for (const path of [src, thumbnail]) treeEntries.push({ path: `public/${path}`, sha: blobs[imageIndex].sha });
      return { id: photoId, src, thumbnail, width: image.width, height: image.height, bytes: image.bytes, thumbnailBytes: image.bytes, alt: imageIndex ? '横幅测试图' : '长幅测试图' };
    });
    return { id, name: `布局验收 ${position + 1}`, description: '仅用于本地隔离验收'.repeat(position === 1 ? 80 : 1), category: '测试分类', material: '棉线与木珠'.repeat(position === 1 ? 24 : 1), size: '12 × 8 cm', createdAt: now, updatedAt: now, photos };
  });
  const catalog = { schemaVersion: 1, revision: randomUUID(), updatedAt: now, products };
  const manifest = await request('/__github/git/blobs', { content: JSON.stringify(catalog), encoding: 'utf-8' });
  treeEntries.push({ path: 'public/catalog.json', sha: manifest.sha });
  const tree = await request('/__github/git/trees', { base_tree: 'test-base-tree', tree: treeEntries });
  const commit = await request('/__github/git/commits', { tree: tree.sha, parents: [state.head] });
  await request('/__github/git/refs/heads/main', { sha: commit.sha, force: false }, 'PATCH');
  await page.reload();
  await page.waitForSelector('.photo-grid');
  console.log(await page.snapshot({ scope: 'full_page' }));
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: width === 390 ? 'reduce' : 'no-preference' }] });
    const layout = await page.evaluate(() => ({ columns: getComputedStyle(document.querySelector('.photo-grid')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(layout.columns, width > 800 ? 4 : width > 480 ? 2 : 1);
    assert.equal(layout.overflow, false, `${width}px 页面不应横向溢出`);
    assert.equal(await page.evaluate(() => document.querySelector('.site-header').textContent.includes('日子慢慢，心意满满')), false, '顶部联系入口应替换原来的文案');
    const contacts = await page.evaluate(() => [...document.querySelectorAll('.footer-contacts .contact-link')].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent, href: element.getAttribute('href'), target: element.getAttribute('target'), safe: !element.href || element.rel.includes('noopener'), icon: Boolean(element.querySelector('svg')), touchTarget: bounds.width >= 44 && bounds.height >= 44 };
    }));
    assert.deepEqual(contacts.map(({ label, href, target }) => ({ label, href, target })), [
      { label: '打开抖音个人主页', href: 'https://v.douyin.com/5DgnKMqN27g/', target: '_blank' },
      { label: '打开小红书个人主页', href: 'https://xhslink.cn/o/9KyCVFtZBCC', target: '_blank' },
      { label: '打开快手个人主页', href: 'https://live.kuaishou.com/profile/3x4wrxmmgvrfqz4', target: '_blank' },
      { label: '复制微信号', href: null, target: null },
    ]);
    assert.ok(contacts.every(({ safe, icon, touchTarget }) => safe && icon && touchTarget));
    assert.deepEqual(await page.evaluate(() => ({ afterAbout: document.querySelector('.header-contacts').previousElementSibling?.getAttribute('href') === '#about', header: [...document.querySelectorAll('.header-contacts .contact-link')].map((element) => element.getAttribute('href')), footer: [...document.querySelectorAll('.footer-contacts .contact-link')].map((element) => element.getAttribute('href')) })), { afterAbout: true, header: contacts.map(({ href }) => href), footer: contacts.map(({ href }) => href) }, '顶部关于手作后应展示相同的联系入口，底部保留');
    await checkWechatCopy('.header-contacts .contact-wechat');
    await checkWechatCopy('.footer-contacts .contact-wechat', width === 320);
    await page.click('button[aria-label="查看作品：布局验收 1"]');
    await page.waitForSelector('.detail-photo-open', { state: 'visible' });
    console.log(await page.snapshot());
    await checkCenteredDetail();
    assert.deepEqual(await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.detail-actions button')];
      const [back, contact] = buttons.map((button) => button.getBoundingClientRect());
      return { labels: buttons.map((button) => button.textContent), right: contact.left >= back.right, sameRow: Math.abs(contact.top - back.top) < 1 };
    }), { labels: ['回到作品墙', '跳转微信咨询'], right: true, sameRow: true });
    await checkWechatCopy('.detail-actions button:last-child', width === 320);
    await checkCenteredDetail();
    for (const alt of ['长幅测试图', '横幅测试图']) {
      if (alt === '横幅测试图') await page.click('button[aria-label="下一张"]');
      const trigger = `button[aria-label="全屏查看：${alt}"]`;
      await page.focus(trigger);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('dialog:modal img')?.naturalWidth > 0);
      const image = await page.evaluate(() => {
        const dialog = document.querySelector('dialog:modal');
        const photo = dialog.querySelector('img');
        const bounds = photo.getBoundingClientRect();
        const container = dialog.querySelector('.photo-lightbox-image').getBoundingClientRect();
        return { ratio: bounds.width / bounds.height, naturalRatio: photo.naturalWidth / photo.naturalHeight, contained: bounds.top >= container.top - 1 && bounds.bottom <= container.bottom + 1 && bounds.left >= container.left - 1 && bounds.right <= container.right + 1, height: dialog.getBoundingClientRect().height, viewportHeight: innerHeight, focusInside: dialog.contains(document.activeElement), scrollLocked: getComputedStyle(document.body).overflow === 'hidden', motion: getComputedStyle(dialog).animationDuration };
      });
      assert.ok(Math.abs(image.ratio - image.naturalRatio) < .01, '图片应保持原比例');
      assert.equal(image.contained, true, '完整图片应位于遮罩可用范围内');
      assert.equal(image.height, image.viewportHeight);
      assert.equal(image.focusInside && image.scrollLocked, true);
      if (width === 390) assert.ok(parseFloat(image.motion) < .001);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('dialog:modal').contains(document.activeElement)), true);
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => ({ open: Boolean(document.querySelector('dialog:modal')), detail: Boolean(document.querySelector('.detail-modal')), focused: document.activeElement?.className })), { open: false, detail: true, focused: 'detail-photo-open' });
    }
    await page.click('button[aria-label="全屏查看：横幅测试图"]');
    await page.click('button[aria-label="关闭全屏照片"]');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('dialog:modal'))), false);
    await page.click('button[aria-label="全屏查看：横幅测试图"]');
    await page.mouse.click(2, 450, { label: '点击大图遮罩空白处' });
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('dialog:modal'))), false);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '查看作品：布局验收 1');
    await page.click('button[aria-label="查看作品：布局验收 2"]');
    await page.waitForSelector('.detail-photo-open', { state: 'visible' });
    await checkCenteredDetail();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
    console.log(`${width}px: 顶部与底部联系图标、主页链接、三处微信复制及浮动消息、失败兜底、按钮排列、详情居中、长文本、全屏照片及焦点检查通过`);
  }
}
