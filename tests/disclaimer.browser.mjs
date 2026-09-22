import assert from 'node:assert/strict';

export async function acceptDisclaimer(page) {
  await page.waitForSelector('.site-shell');
  if (!await page.evaluate(() => document.querySelector('.site-shell').inert)) return;
  await page.waitForSelector('.disclaimer-modal button');
  await page.click('.disclaimer-modal button');
  await page.waitForSelector('.disclaimer-modal', { state: 'hidden' });
}

export async function checkDisclaimer(page, origin = 'http://127.0.0.1:5173') {
  await page.goto('about:blank');
  await page.goto(new URL('?home=legacy', origin).href);
  await page.waitForSelector('.disclaimer-modal button');
  const initial = await page.evaluate(() => {
    const modal = document.querySelector('.disclaimer-modal');
    return { title: modal.querySelector('.animal-modal-title').textContent, content: modal.querySelector('#site-disclaimer').textContent, buttons: [...modal.querySelectorAll('button')].map(button => button.textContent.trim()), inert: document.querySelector('.site-shell').inert, scrollLocked: getComputedStyle(document.body).overflow === 'hidden', focusedInside: modal.contains(document.activeElement) };
  });
  assert.deepEqual(initial, { title: '重要声明', content: '本网站仅作为作品款式展示电子画册，所有咨询、沟通、订单交易，全部请在对应平台完成，网页不承接任何付款下单。', buttons: ['我同意'], inert: true, scrollLocked: true, focusedInside: true });
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2, { label: '点击声明外的遮罩' });
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.disclaimer-modal'))), true);
  await page.focus('.disclaimer-modal button');
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.disclaimer-modal button')), true);
  }
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
    await page.waitForFunction(() => document.querySelector('.disclaimer-modal').getAnimations().every(animation => animation.playState === 'finished'));
    const layout = await page.evaluate(() => {
      const modal = document.querySelector('.disclaimer-modal');
      const bounds = modal.getBoundingClientRect();
      const button = modal.querySelector('button').getBoundingClientRect();
      const copy = modal.querySelector('#site-disclaimer');
      return { contained: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, buttonVisible: button.top >= bounds.top && button.bottom <= bounds.bottom && button.height >= 44, textFits: copy.scrollWidth <= copy.clientWidth, noOverflow: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(layout, { contained: true, buttonVisible: true, textFits: true, noOverflow: true }, `${width}x${height}`);
  }
  await acceptDisclaimer(page);
  assert.equal(await page.evaluate(() => document.querySelector('.site-shell').inert || getComputedStyle(document.body).overflow === 'hidden'), false);
  await page.waitForSelector('.home-disclaimer');
  assert.equal(await page.evaluate(() => document.querySelector('.home-disclaimer p').textContent), initial.content);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
    const layout = await page.evaluate(() => {
      const notice = document.querySelector('.home-disclaimer');
      const bounds = notice.getBoundingClientRect();
      const copy = notice.querySelector('p');
      return { contained: bounds.left >= 0 && bounds.right <= innerWidth, textFits: copy.scrollWidth <= copy.clientWidth, separated: bounds.top >= document.querySelector('.hero').getBoundingClientRect().bottom - 1 && notice.nextElementSibling.getBoundingClientRect().top >= bounds.bottom - 1, normalFlow: getComputedStyle(notice).position === 'static', noOverflow: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(layout, { contained: true, textFits: true, separated: true, normalFlow: true, noOverflow: true }, `home disclaimer ${width}x${height}`);
  }
  await page.click('.site-header nav a[href="#about"]');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.disclaimer-modal'))), false);
  await page.focus('.admin-entry');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#github-token');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.disclaimer-modal'))), false);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.home-disclaimer'))), false);
  await page.reload();
  await page.waitForSelector('.disclaimer-modal button');
  await page.focus('.disclaimer-modal button');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.disclaimer-modal', { state: 'hidden' });
  await page.goto('about:blank');
  await page.goto(new URL('?home=legacy', origin).href);
  await page.waitForSelector('.disclaimer-modal button');
  await acceptDisclaimer(page);
  assert.equal(await page.evaluate(() => document.querySelector('.home-disclaimer p').textContent), initial.content);
  console.log('声明首次打开、刷新及重新打开、文案、唯一同意入口、焦点与滚动锁定、站内切换、首页常驻提示、桌面和手机布局通过');
}
