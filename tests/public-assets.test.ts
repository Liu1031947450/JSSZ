import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('公开 JPEG Logo 不携带 EXIF、XMP、IPTC 或注释元数据', async () => {
  const image = await readFile(new URL('../public/723f445fcaa1fd6b873042c974bb8afa.jpg', import.meta.url));
  assert.equal(image.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 4 <= image.length) {
    assert.equal(image[offset], 0xff);
    const marker = image[offset + 1];
    if (marker === 0xda || marker === 0xd9) return;
    assert.ok(![0xe1, 0xed, 0xfe].includes(marker), '请先移除图片元数据再发布');
    const size = image.readUInt16BE(offset + 2);
    assert.ok(size >= 2 && offset + size + 2 <= image.length);
    offset += size + 2;
  }
  assert.fail('JPEG 文件结构不完整');
});

test('公开 PNG Logo 不携带 EXIF、XMP 或文本元数据', async () => {
  const image = await readFile(new URL('../public/logo.png', import.meta.url));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  while (offset + 12 <= image.length) {
    const size = image.readUInt32BE(offset);
    const type = image.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + size + 12 <= image.length);
    assert.ok(!['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(type), '请先移除图片元数据再发布');
    if (type === 'IEND') return;
    offset += size + 12;
  }
  assert.fail('PNG 文件结构不完整');
});
