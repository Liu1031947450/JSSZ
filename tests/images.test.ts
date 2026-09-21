import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILE_BYTES, MAX_PIXELS } from '../src/catalog.ts';
import { processImage, readImage } from '../src/images.ts';

function file(size = 100, name = 'photo.png', type = 'image/png') {
  const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type });
  Object.defineProperty(image, 'size', { value: size });
  return image;
}

function browser(context: TestContext, options: { width?: number; height?: number; encode?: (attempt: number) => Blob | null; decodeError?: boolean } = {}) {
  const frames: { width: number; height: number; quality: number; operations: [string, ...unknown[]][] }[] = [];
  const bitmaps: { width: number; height: number; closed: boolean; close: () => void }[] = [];
  const urls: Blob[] = [];
  for (const [name, value] of Object.entries({
    document: { createElement: () => {
      const operations: [string, ...unknown[]][] = [];
      const canvas = { width: 0, height: 0, getContext: () => ({
        drawImage: (...args: unknown[]) => operations.push(['drawImage', ...args]),
        scale: (...args: unknown[]) => operations.push(['scale', ...args]),
        translate: (...args: unknown[]) => operations.push(['translate', ...args]),
        rotate: (...args: unknown[]) => operations.push(['rotate', ...args]),
      }), toBlob: (callback: (blob: Blob | null) => void, _type: string, quality: number) => {
        frames.push({ width: canvas.width, height: canvas.height, quality, operations: [...operations] });
        callback(options.encode ? options.encode(frames.length) : { size: 100, type: 'image/webp' } as Blob);
      } };
      return canvas;
    } },
    createImageBitmap: async () => {
      if (options.decodeError) throw new Error('Invalid image');
      const bitmap = { width: frames.at(-1)?.width ?? options.width ?? 400, height: frames.at(-1)?.height ?? options.height ?? 200, closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  }
  context.mock.method(URL, 'createObjectURL', (blob: Blob) => { urls.push(blob); return 'blob:test-image'; });
  return { frames, bitmaps, urls };
}

test('10MB 以内及边界图片不额外压缩，保留原始图片供裁剪', async (context) => {
  const state = browser(context);
  for (const size of [100, MAX_FILE_BYTES]) {
    const original = file(size);
    const source = await readImage(original);
    assert.equal(source.compressedBytes, undefined);
    assert.equal(state.urls.at(-1), original);
    assert.equal(source.width, 400);
  }
  assert.equal(state.frames.length, 0);
});

test('大小和像素恰好达到上限时不压缩', async (context) => {
  const state = browser(context, { width: 6000, height: 4000 });
  const original = file(MAX_FILE_BYTES);
  const source = await readImage(original);
  assert.equal(source.width * source.height, MAX_PIXELS);
  assert.equal(source.compressedBytes, undefined);
  assert.equal(state.urls[0], original);
  assert.equal(state.frames.length, 0);
});

for (const [width, height] of [[6000, 4001], [8000, 6000], [6000, 8000]]) {
  test(`${width}x${height} 图片即使不到 10MB 也等比例缩小至像素上限以内`, async (context) => {
    const state = browser(context, { width, height });
    const source = await readImage(file());
    const scale = Math.sqrt(MAX_PIXELS / (width * height));
    assert.deepEqual([source.width, source.height], [Math.floor(width * scale), Math.floor(height * scale)]);
    assert.ok(source.width * source.height <= MAX_PIXELS);
    assert.ok(Math.abs(source.width / source.height - width / height) < 0.001);
    assert.equal(state.frames.length, 1);
    assert.equal(state.frames[0].quality, 1);
    assert.equal(source.compressedBytes, 100);
    assert.equal(state.bitmaps[0].closed, true);
    assert.equal(state.bitmaps[1].closed, false);
    assert.equal(state.urls[0].size, source.compressedBytes);
  });
}

test('像素和大小同时超限时先缩小像素，再继续压缩至 10MB 以内', async (context) => {
  const state = browser(context, { width: 7200, height: 4800, encode: attempt => ({ type: 'image/webp', size: attempt < 6 ? MAX_FILE_BYTES + 1 : MAX_FILE_BYTES } as Blob) });
  const source = await readImage(file(MAX_FILE_BYTES + 1));
  assert.ok(state.frames.every(frame => frame.width * frame.height <= MAX_PIXELS));
  assert.ok(state.frames.slice(0, 5).every(frame => frame.width === 6000 && frame.height === 4000));
  assert.deepEqual([source.width, source.height], [5100, 3400]);
  assert.deepEqual(state.frames.map(frame => frame.quality), [1, 0.95, 0.9, 0.85, 0.8, 0.8]);
  assert.equal(source.compressedBytes, MAX_FILE_BYTES);
  assert.ok(state.frames.every(frame => frame.operations.filter(operation => operation[0] === 'drawImage').every(operation => operation[1] === state.bitmaps[0])));
});

test('超限图片从最高质量开始压缩，达到 10MB 后停止且不缩小分辨率', async (context) => {
  const state = browser(context, { encode: attempt => ({ type: 'image/webp', size: attempt < 3 ? MAX_FILE_BYTES + 1 : MAX_FILE_BYTES - 1 } as Blob) });
  const source = await readImage(file(MAX_FILE_BYTES + 1));
  assert.deepEqual(state.frames.map(frame => frame.quality), [1, 0.95, 0.9]);
  assert.ok(state.frames.every(frame => frame.width === 400 && frame.height === 200));
  assert.equal(source.compressedBytes, MAX_FILE_BYTES - 1);
  assert.equal(state.bitmaps[0].closed, true);
  assert.equal(state.bitmaps[1].closed, false);
  assert.equal(state.urls[0].size, source.compressedBytes);
});

test('质量调整仍超限才按原图缩小尺寸，不重复缩放已压缩图片', async (context) => {
  const state = browser(context, { encode: attempt => ({ type: 'image/webp', size: attempt < 6 ? MAX_FILE_BYTES + 1 : 9000 } as Blob) });
  const source = await readImage(file(MAX_FILE_BYTES + 1));
  assert.ok(state.frames.slice(0, 5).every(frame => frame.width === 400 && frame.height === 200));
  assert.deepEqual([source.width, source.height], [340, 170]);
  assert.equal(state.frames[5].quality, 0.8);
  assert.ok(state.frames.every(frame => frame.operations.filter(operation => operation[0] === 'drawImage').every(operation => operation[1] === state.bitmaps[0])));
});

test('超限压缩仍拒绝错误格式、空文件和无效尺寸，且释放已解码图片', async (context) => {
  const state = browser(context, { width: 0, height: 4000 });
  await assert.rejects(readImage(file(MAX_FILE_BYTES + 1, 'photo.jpg', 'image/jpeg')), /真实的 JPEG/);
  await assert.rejects(readImage(file(0)), /非空/);
  assert.equal(state.bitmaps.length, 0);
  await assert.rejects(readImage(file(MAX_FILE_BYTES + 1)), /图片尺寸无效/);
  assert.equal(state.bitmaps[0].closed, true);
  assert.equal(state.frames.length, 0);
  assert.equal(state.urls.length, 0);
});

test('损坏图片给出解码提示', async (context) => {
  browser(context, { decodeError: true });
  await assert.rejects(readImage(file(MAX_FILE_BYTES + 1)), /无法解码/);
});

test('压缩失败会释放图片并显示错误，不放行超限文件', async (context) => {
  const state = browser(context, { encode: () => ({ type: 'image/webp', size: MAX_FILE_BYTES + 1 } as Blob) });
  await assert.rejects(readImage(file(MAX_FILE_BYTES + 1)), /自动压缩后仍超过 10MB/);
  assert.equal(state.frames.length, 10);
  assert.equal(state.bitmaps[0].closed, true);
  assert.equal(state.urls.length, 0);
});

test('浏览器不支持 WebP 时不使用回退格式冒充成功', async (context) => {
  const state = browser(context, { encode: () => ({ type: 'image/png', size: 100 } as Blob) });
  await assert.rejects(readImage(file(MAX_FILE_BYTES + 1)), /不能导出 WebP/);
  assert.equal(state.bitmaps[0].closed, true);
  assert.equal(state.urls.length, 0);
});

test('四个旋转方向使用旋转后的裁剪坐标，详情和缩略图方向一致', async (context) => {
  const state = browser(context);
  const source = await readImage(file());
  for (const rotation of [0, 90, 180, 270]) {
    const width = rotation % 180 ? 200 : 400;
    const height = rotation % 180 ? 400 : 200;
    const result = await processImage(source, { x: 10, y: 20, width: width - 10, height: height - 20 }, 'product', '照片', rotation);
    assert.deepEqual([result.photo.width, result.photo.height], [width - 10, height - 20]);
    assert.equal(Object.keys(result.assets).length, 2);
    for (const frame of state.frames.slice(-2)) {
      assert.ok(frame.operations.some(operation => operation[0] === 'rotate' && operation[1] === rotation * Math.PI / 180));
      assert.deepEqual(frame.operations.filter(operation => operation[0] === 'translate'), [['translate', -10, -20], ['translate', width / 2, height / 2]]);
    }
  }
  await assert.rejects(processImage(source, { x: 0, y: 0, width: 400, height: 200 }, 'product', '', 90), /裁剪范围无效/);
  await assert.rejects(processImage(source, { x: 0, y: 0, width: 200, height: 400 }, 'product', '', 45), /旋转角度无效/);
  assert.equal(state.frames.length, 8);
});
