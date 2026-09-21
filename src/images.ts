import { DETAIL_BYTES, MAX_FILE_BYTES, MAX_PIXELS, THUMB_BYTES, validateFileHeader } from './catalog.ts';
import type { Photo } from './catalog.ts';

export type CropArea = { x: number; y: number; width: number; height: number };
export type ImageSource = { bitmap: ImageBitmap; url: string; width: number; height: number; compressedBytes?: number };

export async function readImage(file: File): Promise<ImageSource> {
  validateFileHeader(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()), true);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('无法解码这张图片，文件可能损坏，请换一张试试'); }
  if (!bitmap.width || !bitmap.height) {
    bitmap.close(); throw new Error('图片尺寸无效，请换一张试试');
  }
  try {
    let image: Blob = file;
    if (file.size > MAX_FILE_BYTES || bitmap.width * bitmap.height > MAX_PIXELS) {
      image = await compressImage(bitmap);
      bitmap.close();
      bitmap = await createImageBitmap(image);
    }
    return { bitmap, url: URL.createObjectURL(image), width: bitmap.width, height: bitmap.height, ...(image !== file ? { compressedBytes: image.size } : {}) };
  } catch (reason) { bitmap.close(); throw reason; }
}

async function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') throw new Error('此浏览器不能导出 WebP，请升级浏览器后重试');
  return blob;
}

async function compressImage(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法处理图片');
  try {
    const qualities = [1, 0.95, 0.9, 0.85, 0.8];
    const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    for (let attempt = 0; attempt < 10; attempt++) {
      const scale = pixelScale * Math.min(1, 0.85 ** (attempt - qualities.length + 1));
      canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
      canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await encodeWebp(canvas, qualities[Math.min(attempt, qualities.length - 1)]);
      if (blob.size <= MAX_FILE_BYTES) return blob;
    }
    throw new Error('自动压缩后仍超过 10MB，请先缩小图片或换一张试试');
  } finally { canvas.width = 0; canvas.height = 0; }
}

async function encodeCrop(bitmap: ImageBitmap, area: CropArea, edge: number, budget: number, rotation: number): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, edge / Math.max(area.width, area.height));
  canvas.width = Math.max(1, Math.round(area.width * ratio));
  canvas.height = Math.max(1, Math.round(area.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法处理图片');
  context.imageSmoothingQuality = 'high';
  context.scale(canvas.width / area.width, canvas.height / area.height);
  context.translate(-area.x, -area.y);
  context.translate((rotation % 180 ? bitmap.height : bitmap.width) / 2, (rotation % 180 ? bitmap.width : bitmap.height) / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  for (const quality of [0.88, 0.78, 0.66, 0.52, 0.38]) {
    const blob = await encodeWebp(canvas, quality);
    if (blob.size <= budget) return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error('图片细节过于复杂，压缩后仍超出预算，请缩小裁剪区域或更换图片');
}

export async function processImage(source: ImageSource, area: CropArea, productId: string, alt: string, rotation = 0): Promise<{ photo: Photo; assets: Record<string, Blob> }> {
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('旋转角度无效，请重新选择');
  const width = rotation % 180 ? source.height : source.width;
  const height = rotation % 180 ? source.width : source.height;
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1 || area.x + area.width > width + 1 || area.y + area.height > height + 1) throw new Error('裁剪范围无效，请重新选择');
  const detail = await encodeCrop(source.bitmap, area, 1600, DETAIL_BYTES, rotation);
  const thumbnail = await encodeCrop(source.bitmap, area, 480, THUMB_BYTES, rotation);
  const id = crypto.randomUUID();
  const src = `images/${productId}/${id}-detail.webp`;
  const thumbnailPath = `images/${productId}/${id}-thumb.webp`;
  return {
    photo: { id, src, thumbnail: thumbnailPath, width: detail.width, height: detail.height, bytes: detail.blob.size, thumbnailBytes: thumbnail.blob.size, alt },
    assets: { [src]: detail.blob, [thumbnailPath]: thumbnail.blob },
  };
}
