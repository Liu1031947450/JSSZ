import assert from 'node:assert/strict';

export async function checkImageEditor(page, origin = 'http://127.0.0.1:4174') {
  await page.goto(`${origin}/#/admin`);
  await page.reload();
  await page.waitForSelector('#github-token');
  await page.fill('#github-token', 'github_pat_test_only_not_a_real_token');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.save-status.saved');
  if (await page.evaluate(() => Boolean(document.querySelector('.editor-modal')))) {
    await page.click('.editor-actions button:first-child');
    await page.click('.confirmation-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.editor-modal', { state: 'hidden' });
    await page.waitForSelector('.save-status.saved');
  }
  await page.click('.works-list .section-heading button');
  await page.waitForSelector('#work-name');
  await page.fill('#work-name', '旋转与压缩验收');
  await page.fill('#work-price', '12.30');

  async function upload(kind = 'small') {
    const size = await page.evaluate(async (kind) => {
      const canvas = document.createElement('canvas');
      canvas.width = kind === 'pixels' ? 7200 : kind === 'large' ? 2200 : 600;
      canvas.height = kind === 'pixels' ? 4800 : kind === 'large' ? 1800 : 400;
      const context = canvas.getContext('2d');
      if (kind === 'large') {
        const pixels = context.createImageData(canvas.width, canvas.height);
        for (let offset = 0; offset < pixels.data.length; offset += 65536) crypto.getRandomValues(pixels.data.subarray(offset, offset + 65536));
        for (let offset = 3; offset < pixels.data.length; offset += 4) pixels.data[offset] = 255;
        context.putImageData(pixels, 0, 0);
      } else {
        for (const [index, color] of ['#f00', '#0f0', '#00f', '#ff0'].entries()) {
          context.fillStyle = color;
          context.fillRect(index % 2 * canvas.width / 2, Math.floor(index / 2) * canvas.height / 2, canvas.width / 2, canvas.height / 2);
        }
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File(kind === 'invalid' ? [blob, new Uint8Array(10 * 1024 * 1024)] : [blob], kind === 'invalid' ? 'invalid.jpg' : 'test.png', { type: kind === 'invalid' ? 'image/jpeg' : 'image/png' }));
      const size = data.files[0].size;
      const input = document.querySelector('input[aria-label="选择作品照片"]');
      input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      canvas.width = 0; canvas.height = 0;
      return size;
    }, kind);
    await page.waitForSelector('.crop-modal');
    return size;
  }

  async function ready() {
    await page.waitForSelector('.crop-modal .animal-modal-footer button:last-child:not([disabled])', { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector('.crop-modal').getAnimations().every(animation => animation.playState === 'finished'));
  }

  for (const [rotation, colors] of [[0, [0, 1, 2, 3]], [90, [2, 0, 3, 1]], [180, [3, 2, 1, 0]], [270, [1, 3, 0, 2]]]) {
    const size = await upload(rotation === 0 ? 'pixels' : 'small');
    await ready();
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.compression-result'))), rotation === 0);
    if (rotation === 0) {
      assert.ok(size < 10 * 1024 * 1024);
      const resized = await page.evaluate(async () => {
        const image = document.querySelector('.crop-stage img');
        const blob = await (await fetch(image.src)).blob();
        return { width: image.naturalWidth, height: image.naturalHeight, size: blob.size };
      });
      assert.deepEqual([resized.width, resized.height], [6000, 4000]);
      assert.ok(resized.size <= 10 * 1024 * 1024);
    }
    for (let turn = 0; turn < rotation / 90; turn++) {
      await page.click('.crop-rotation button:nth-child(2)');
      await ready();
    }
    if (rotation === 90) {
      await page.selectOption('.crop-controls select', '1');
      await ready();
      await page.selectOption('.crop-controls select', 'original');
      await ready();
      for (const [width, height] of [[390, 844], [844, 390], [1024, 520]]) {
        await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
        await page.waitForFunction(() => {
          const bounds = document.querySelector('.crop-modal .animal-modal-footer').getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight;
        });
        const layout = await page.evaluate(() => {
          const footer = document.querySelector('.crop-modal .animal-modal-footer');
          const button = footer.querySelector('button:last-child');
          const bounds = button.getBoundingClientRect();
          const body = document.querySelector('.crop-modal .animal-modal-body');
          body.scrollTop = body.scrollHeight;
          return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight && button.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)), noOverflow: document.documentElement.scrollWidth <= innerWidth, scrollable: body.scrollTop + body.clientHeight >= body.scrollHeight - 2 };
        });
        assert.deepEqual(layout, { visible: true, noOverflow: true, scrollable: true }, `${width}×${height}`);
      }
      await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await ready();
    }
    await page.click('.crop-modal .animal-modal-footer button:last-child');
    await page.waitForSelector('.crop-modal', { state: 'hidden' });
    const photo = await page.evaluate(async () => {
      const image = [...document.querySelectorAll('.edit-photo img')].at(-1);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([horizontal, vertical]) => [...context.getImageData(Math.floor(canvas.width * horizontal), Math.floor(canvas.height * vertical), 1, 1).data]), price: document.querySelector('#work-price').value };
    });
    assert.ok(Math.abs(photo.width / photo.height - (rotation % 180 ? 2 / 3 : 3 / 2)) < .02);
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    colors.forEach((color, index) => palette[color].forEach((channel, position) => assert.ok(Math.abs(channel - photo.pixels[index][position]) < 20, `rotation=${rotation}, pixel=${index}`)));
    assert.equal(photo.price, '12.30');
  }

  await upload('invalid');
  await page.waitForSelector('.crop-modal .notice.error');
  assert.match(await page.evaluate(() => document.querySelector('.crop-modal .notice.error').textContent), /真实的 JPEG/);
  assert.equal(await page.evaluate(() => document.querySelector('.crop-modal .animal-modal-footer button:last-child').disabled), true);
  await page.click('.crop-modal .animal-modal-footer button:first-child');
  await page.waitForSelector('.crop-modal', { state: 'hidden' });

  const originalSize = await upload('large');
  assert.ok(originalSize > 10 * 1024 * 1024);
  await ready();
  const compressed = await page.evaluate(async () => {
    const image = document.querySelector('.crop-stage img');
    const blob = await (await fetch(image.src)).blob();
    return { size: blob.size, width: image.naturalWidth, height: image.naturalHeight, note: document.querySelector('.compression-result').textContent };
  });
  assert.ok(compressed.size <= 10 * 1024 * 1024);
  assert.deepEqual([compressed.width, compressed.height], [2200, 1800]);
  assert.match(compressed.note, /已自动压缩至/);
  await page.focus('.crop-rotation button:first-child');
  await page.keyboard.press('Enter');
  await ready();
  assert.match(await page.evaluate(() => document.querySelector('.crop-rotation [role="status"]').textContent), /270/);
  await page.click('.crop-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.crop-modal .notice.error');
  assert.match(await page.evaluate(() => document.querySelector('.crop-modal .notice.error').textContent), /超出预算/);
  await page.focus('input[aria-label="图片缩放"]');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('input[aria-label="图片缩放"]').value === '3');
  await ready();
  await page.click('.crop-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.crop-modal', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.edit-photo').length), 5);
  assert.equal(await page.evaluate(() => document.querySelector('#work-price').value), '12.30');
  assert.deepEqual(await page.evaluate(() => window.__pageErrors), []);
  await page.click('.editor-actions button:first-child');
  await page.click('.confirmation-modal .animal-modal-footer button:last-child');
  await page.waitForSelector('.editor-modal', { state: 'hidden' });
  await page.waitForSelector('.save-status.saved');
  console.log(`四方向实际像素、原比例/方形切换、短屏/手机按钮、错误格式、像素超限缩小和输入保留通过；7200x4800 自动缩至 6000x4000；仅大小超限原图 ${originalSize} bytes，压缩后 ${compressed.size} bytes，分辨率不变`);
}
