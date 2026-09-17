import { DETAIL_BYTES, MAX_PIXELS, THUMB_BYTES, validateFileHeader } from './catalog.ts';
import type { Photo } from './catalog.ts';

export type CropArea = { x: number; y: number; width: number; height: number };
export type ImageSource = { bitmap: ImageBitmap; url: string; width: number; height: number };

export async function readImage(file: File): Promise<ImageSource> {
  validateFileHeader(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('无法解码这张图片，文件可能损坏，请换一张试试'); }
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close(); throw new Error('图片不得超过 2400 万像素，请先缩小分辨率');
  }
  return { bitmap, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
}

async function encodeCrop(bitmap: ImageBitmap, area: CropArea, edge: number, budget: number): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, edge / Math.max(area.width, area.height));
  canvas.width = Math.max(1, Math.round(area.width * ratio));
  canvas.height = Math.max(1, Math.round(area.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法处理图片');
  context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.88, 0.78, 0.66, 0.52, 0.38]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('此浏览器不能导出 WebP，请升级浏览器后重试');
    if (blob.size <= budget) return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error('图片细节过于复杂，压缩后仍超出预算，请缩小裁剪区域或更换图片');
}

export async function processImage(source: ImageSource, area: CropArea, productId: string, alt: string): Promise<{ photo: Photo; assets: Record<string, Blob> }> {
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1 || area.x + area.width > source.width + 1 || area.y + area.height > source.height + 1) throw new Error('裁剪范围无效，请重新选择');
  const detail = await encodeCrop(source.bitmap, area, 1600, DETAIL_BYTES);
  const thumbnail = await encodeCrop(source.bitmap, area, 480, THUMB_BYTES);
  const id = crypto.randomUUID();
  const src = `images/${productId}/${id}-detail.webp`;
  const thumbnailPath = `images/${productId}/${id}-thumb.webp`;
  return {
    photo: { id, src, thumbnail: thumbnailPath, width: detail.width, height: detail.height, bytes: detail.blob.size, thumbnailBytes: thumbnail.blob.size, alt },
    assets: { [src]: detail.blob, [thumbnailPath]: thumbnail.blob },
  };
}
