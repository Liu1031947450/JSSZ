import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkHeroLayout(page) {
  await page.waitForSelector('.hero');
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [[320, 640], [390, 844], [480, 800], [600, 900], [601, 900], [768, 1024], [800, 1024], [801, 900], [844, 390], [1024, 768], [1440, 900], [1920, 1080]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
    const layout = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const bounds = hero.getBoundingClientRect();
      const copy = hero.querySelector('.hero-copy').getBoundingClientRect();
      const contained = rectangle => rectangle.left >= bounds.left - 1 && rectangle.right <= bounds.right + 1 && rectangle.top >= bounds.top - 1 && rectangle.bottom <= bounds.bottom + 1;
      const decorations = [...hero.querySelectorAll('.hero-flower, .hero-label')].filter(element => getComputedStyle(element).display !== 'none').map(element => element.getBoundingClientRect());
      return {
        height: bounds.height,
        contained: contained(copy) && [...hero.querySelectorAll('.hero-copy > *, .title-spark')].every(element => contained(element.getBoundingClientRect())),
        overflow: hero.scrollWidth > hero.clientWidth,
        decorations: decorations.length,
        separated: decorations.every(rectangle => contained(rectangle) && (rectangle.right <= copy.left || rectangle.left >= copy.right)),
        wallBelow: document.querySelector('.wall-section').getBoundingClientRect().top >= bounds.bottom - 1,
        titleSize: parseFloat(getComputedStyle(hero.querySelector('h1')).fontSize),
      };
    });
    assert.ok(layout.height >= 160 && layout.height <= 224, `${width}px 首屏介绍应紧凑且不裁剪内容`);
    assert.equal(layout.contained && layout.separated && layout.wallBelow, true, `${width}px 文字、装饰和作品墙不能重叠`);
    assert.equal(layout.overflow, false, `${width}px 首屏介绍不应横向溢出`);
    assert.equal(layout.decorations, width <= 600 ? 0 : 2);
    assert.ok(layout.titleSize >= 32);
    console.log(`${width}×${height}: hero ${layout.height}px，文字与装饰无溢出或重叠`);
  }
}

export async function checkFloatingContacts(page) {
  await page.goto('http://127.0.0.1:4174', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.photo-grid');
  for (const width of [320, 390, 768, 800, 801, 1440]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 600 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForSelector('.floating-contacts', { state: 'hidden' });
    await page.evaluate(() => window.scrollTo({ top: document.querySelector('.site-header').getBoundingClientRect().bottom + scrollY + 24, behavior: 'instant' }));
    await page.waitForSelector('.floating-contacts', { state: 'visible' });
    const dock = await page.evaluate(() => document.querySelector('.floating-contacts').getBoundingClientRect().toJSON());
    assert.ok(dock.width <= 60 && dock.height <= (width <= 800 ? 108 : 280), `${width}px 悬浮入口应紧凑`);
    if (width <= 800) {
      await page.waitForSelector('#floating-contact-panel', { state: 'hidden' });
      await page.click('.floating-contact-toggle');
      await page.waitForSelector('#floating-contact-panel', { state: 'visible' });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.floating-contact-links')).gridTemplateColumns.split(' ').length), 2);
    }
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.floating-contact-links .contact-link')].every(link => {
      const bounds = link.getBoundingClientRect();
      return bounds.width >= 44 && bounds.height >= 44 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
    })), true, `${width}px 联系按钮可触摸且不溢出屏幕`);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.floating-contact-links a')].map(link => link.href)), await page.evaluate(() => [...document.querySelectorAll('.header-contacts a')].map(link => link.href)));
    if (width <= 800) {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#floating-contact-panel', { state: 'hidden' });
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('floating-contact-toggle')), true);
      await page.click('.floating-contact-toggle');
      await page.focus('#wall-category');
      await page.waitForSelector('#floating-contact-panel', { state: 'hidden' });
    }
    await page.click('.floating-back-top');
    await page.waitForFunction(() => scrollY === 0 && !document.querySelector('.floating-contacts'));
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.header-contacts') !== null), true);
    await page.click('.photo-open >> nth=0');
    await page.waitForSelector('.detail-modal');
    assert.equal(await page.evaluate(() => !document.querySelector('.floating-contacts') || getComputedStyle(document.querySelector('.floating-contacts')).visibility === 'hidden'), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.detail-modal', { state: 'hidden' });
    console.log(`${width}px: 悬浮联系显隐、触摸尺寸、收起展开、键盘操作与返回顶部通过`);
  }
}

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
      const selectors = innerWidth > 800 ? ['.animal-modal-title', '.detail-actions'] : ['.animal-modal-title', '.detail-gallery', '.detail-copy', '.detail-actions'];
      return {
        centered: selectors.every((selector) => { const rect = modal.querySelector(selector).getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - bounds.left - bounds.width / 2) < 2; }),
        responsive: innerWidth > 800 ? copy.left >= gallery.right && Math.abs(copy.top - gallery.top) < 1 : copy.top >= gallery.bottom,
        textAlign: getComputedStyle(modal.querySelector('.detail-copy')).textAlign === (innerWidth > 800 ? 'left' : 'center'),
        contained: [...modal.querySelectorAll('.animal-modal-title, .animal-modal-body, .detail-layout, .detail-gallery, .detail-copy, .detail-footer, dl, dd')].every((element) => element.scrollWidth <= element.clientWidth + 1),
      };
    });
    assert.deepEqual(layout, { centered: true, responsive: true, textAlign: true, contained: true }, '宽屏图片居左资料居右，窄屏保持居中竖排，标题和按钮居中且长文本不溢出');
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
      const geometry = () => page.evaluate(selector => {
        const parent = document.querySelector(selector).parentElement;
        return [...parent.children].map(element => ({ width: element.offsetWidth, height: element.offsetHeight, left: element.offsetLeft - parent.offsetLeft, top: element.offsetTop - parent.offsetTop }));
      }, selector);
      await page.focus(selector);
      const before = await geometry();
      await page.evaluate(() => {
        window.__wechatCopyCalls = 0;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => {
          window.__wechatCopyCalls += 1;
          return new Promise(resolve => { window.__finishWechatCopy = resolve; });
        } } });
      });
      await page.click(selector);
      await page.waitForFunction(selector => document.querySelector(selector).getAttribute('aria-busy') === 'true', selector);
      assert.deepEqual(await geometry(), before, '复制期间按钮与相邻元素的宽度、位置不能改变');
      assert.equal(await page.evaluate(selector => document.querySelector(selector).getAttribute('aria-disabled'), selector), 'true');
      await page.evaluate(selector => document.querySelector(selector).click(), selector);
      assert.equal(await page.evaluate(() => window.__wechatCopyCalls), 1, '复制期间重复点击不能再次请求剪贴板');
      await page.evaluate(() => { window.__finishWechatCopy(); delete window.__finishWechatCopy; });
      await page.waitForSelector('.contact-notification', { state: 'visible' });
      assert.deepEqual(await geometry(), before, '复制完成后按钮与相邻元素位置保持不变');
      await page.click('.contact-notification .animal-notification-close');
      await page.waitForSelector('.contact-notification', { state: 'hidden' });
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
      await page.evaluate(() => { window.__finishWechatCopy?.(); delete window.__finishWechatCopy; delete window.__wechatCopyCalls; window.__restoreWechatClipboard(); delete window.__restoreWechatClipboard; });
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
    const thumbnail = document.createElement('canvas');
    const ratio = Math.min(1, 480 / Math.max(width, height));
    thumbnail.width = Math.round(width * ratio); thumbnail.height = Math.round(height * ratio);
    thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    const thumbnailContent = thumbnail.toDataURL('image/webp').split(',')[1];
    return { width, height, content, bytes: atob(content).length, thumbnailContent, thumbnailBytes: atob(thumbnailContent).length };
  }));
  const blobs = await Promise.all(images.map((image) => request('/__github/git/blobs', { content: image.content, encoding: 'base64' })));
  const thumbnails = await Promise.all(images.map((image) => request('/__github/git/blobs', { content: image.thumbnailContent, encoding: 'base64' })));
  const treeEntries = [];
  const now = new Date().toISOString();
  const products = Array.from({ length: 4 }, (_, position) => {
    const id = randomUUID();
    const photos = images.map((image, imageIndex) => {
      const photoId = randomUUID();
      const src = `images/${id}/${photoId}-detail.webp`;
      const thumbnail = `images/${id}/${photoId}-thumb.webp`;
      treeEntries.push({ path: `public/${src}`, sha: blobs[imageIndex].sha }, { path: `public/${thumbnail}`, sha: thumbnails[imageIndex].sha });
      return { id: photoId, src, thumbnail, width: image.width, height: image.height, bytes: image.bytes, thumbnailBytes: image.thumbnailBytes, alt: imageIndex ? '横幅测试图' : '长幅测试图' };
    });
    return { id, name: `布局验收 ${position + 1}`, description: '仅用于本地隔离验收'.repeat(position === 1 ? 80 : 1), category: ['项链', '手链', '戒指', '项链'][position], material: ['925银', '棉线与木珠'.repeat(24), '925银', '珍珠'][position], price: [128.5, 0, undefined, 48][position], size: '12 × 8 cm', createdAt: now, updatedAt: now, photos };
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
    assert.equal(layout.columns, width > 800 ? 4 : 2);
    assert.equal(layout.overflow, false, `${width}px 页面不应横向溢出`);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.filter-field')].every(label => {
      const range = document.createRange();
      range.selectNodeContents(label.firstChild);
      const text = range.getBoundingClientRect();
      const select = label.querySelector('select').getBoundingClientRect();
      return text.right <= select.left && Math.abs(text.top + text.height / 2 - select.top - select.height / 2) < 2 && select.width >= 100;
    })), true, `${width}px 分类和材质标签应在下拉框左侧且垂直居中`);
    const captions = await page.evaluate(() => [...document.querySelectorAll('.photo-memory figcaption')].map(caption => ({
      order: [...caption.children].map(element => element.className),
      name: caption.querySelector('h3').textContent,
      tags: [...caption.querySelectorAll('.photo-tags .animal-tag')].map(tag => tag.textContent),
      price: caption.querySelector('.photo-price').textContent,
      description: Boolean(caption.querySelector('p')),
      contained: caption.scrollWidth <= caption.clientWidth + 1,
    })));
    assert.deepEqual(captions, products.map((product, position) => ({
      order: ['photo-caption-heading', 'photo-tags', 'photo-price'],
      name: product.name,
      tags: [product.category, product.material],
      price: ['¥128.50', '¥0.00', '暂未标价', '¥48.00'][position],
      description: false,
      contained: true,
    })), `${width}px 卡片依次展示名称、分类与材质标签、价格，长材质不溢出`);
    const filterOptions = await page.evaluate(() => ({ categories: [...document.querySelector('#wall-category').options].map((option) => option.value), materials: [...document.querySelector('#wall-material').options].map((option) => option.value) }));
    assert.deepEqual(new Set(filterOptions.categories), new Set(['', '项链', '手链', '戒指']));
    assert.equal(filterOptions.categories.length, 4);
    assert.deepEqual(new Set(filterOptions.materials), new Set(['', '925银', '棉线与木珠'.repeat(24), '珍珠']));
    assert.equal(filterOptions.materials.length, 4);
    async function checkVisible(names) {
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.photo-caption-heading h3')].map((heading) => heading.textContent)), names);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.selectOption('#wall-category', '项链');
    await checkVisible(['布局验收 1', '布局验收 4']);
    await page.selectOption('#wall-material', '925银');
    await checkVisible(['布局验收 1']);
    assert.equal(await page.evaluate(() => document.querySelector('.filter-summary').textContent.includes('项链 · 925银')), true);
    await page.selectOption('#wall-category', '');
    await checkVisible(['布局验收 1', '布局验收 3']);
    await page.selectOption('#wall-category', '手链');
    await checkVisible([]);
    await page.waitForSelector('.filtered-empty', { state: 'visible' });
    await page.click('.filtered-empty button');
    await checkVisible(['布局验收 1', '布局验收 2', '布局验收 3', '布局验收 4']);
    assert.equal(await page.evaluate(() => document.querySelector('.filter-all').getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.photo-price')[1].textContent), '¥0.00');
    if (width <= 480) {
      await page.waitForFunction(() => [...document.querySelectorAll('.photo-memory')].every((card) => card.getAnimations().every((animation) => animation.playState !== 'running')));
      const cards = await page.evaluate(() => [...document.querySelectorAll('.photo-memory')].map((card) => {
        const bounds = card.getBoundingClientRect();
        const photo = card.querySelector('.photo-open').getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, photoWidth: photo.width, contained: card.scrollWidth <= card.clientWidth + 1 };
      }));
      assert.ok(cards.every((card) => card.left >= 0 && card.right <= width && card.photoWidth >= 100 && card.contained), `${width}px 双列照片应清晰可见，卡片文字不溢出`);
      assert.ok(cards[0].right < cards[1].left && cards[2].right < cards[3].left, '每行两张卡片不能重叠');
      assert.ok(cards[2].top > Math.max(cards[0].bottom, cards[1].bottom), '下一行应位于上一行下方');
    }
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
    assert.equal(await page.evaluate(() => document.querySelector('.detail-price').textContent), '¥128.50');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.detail-copy dt')].some((item) => item.textContent === '尺寸')), false);
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
    console.log(`${width}px: 价格、分类与材质单独/组合筛选、无匹配恢复、双列布局、联系入口、详情和全屏照片回归通过`);
  }
}
