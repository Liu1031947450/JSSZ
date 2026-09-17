export const MAX_PHOTOS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 24_000_000;
export const IMAGE_BUDGET = 200 * 1024 * 1024;
export const DETAIL_BYTES = 600 * 1024;
export const THUMB_BYTES = 100 * 1024;
export const MAX_CATALOG_BYTES = 1_000_000;
export const textLimits = { name: 60, description: 1000, category: 30, material: 120, size: 80, alt: 120 };

export type Photo = {
  id: string;
  src: string;
  thumbnail: string;
  width: number;
  height: number;
  bytes: number;
  thumbnailBytes: number;
  alt: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  material: string;
  size: string;
  createdAt: string;
  updatedAt: string;
  photos: Photo[];
};

export type Catalog = { schemaVersion: 1; revision: string; updatedAt: string; products: Product[] };
export type Draft = { catalog: Catalog; baseSha: string; assets: Record<string, Blob>; savedAt: string; pendingRevision?: string; editing?: Product };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const imagePath = /^images\/[0-9a-f-]{36}\/[0-9a-f-]{36}-(detail|thumb)\.webp$/;
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('作品数据格式不正确');
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error(`${label}格式不正确或超过 ${maximum} 字`);
  return value.trim();
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !isoDate.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('作品日期格式不正确');
  return value;
}

function positive(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('图片尺寸或大小无效');
  return value;
}

export function isImagePath(path: string): boolean { return imagePath.test(path); }

export function parseCatalog(input: unknown): Catalog {
  const source = record(input);
  if (source.schemaVersion !== 1 || !Array.isArray(source.products)) throw new Error('不支持的清单版本，请更新网站后重试');
  const revision = text(source.revision, 80, '发布批次', true);
  if (!/^[a-zA-Z0-9-]+$/.test(revision)) throw new Error('发布批次无效');
  const seen = new Set<string>();
  const products = source.products.map((item): Product => {
    const product = record(item);
    const id = text(product.id, 36, '作品 ID', true);
    if (!uuid.test(id) || seen.has(id)) throw new Error('作品 ID 无效或重复');
    seen.add(id);
    if (!Array.isArray(product.photos) || product.photos.length < 1 || product.photos.length > MAX_PHOTOS) throw new Error(`每件作品需要 1～${MAX_PHOTOS} 张照片`);
    const photoIds = new Set<string>();
    const photos = product.photos.map((item): Photo => {
      const photo = record(item);
      const photoId = text(photo.id, 36, '图片 ID', true);
      if (!uuid.test(photoId) || photoIds.has(photoId)) throw new Error('图片 ID 无效或重复');
      photoIds.add(photoId);
      const src = `images/${id}/${photoId}-detail.webp`;
      const thumbnail = `images/${id}/${photoId}-thumb.webp`;
      if (photo.src !== src || photo.thumbnail !== thumbnail) throw new Error('图片只能使用本站作品目录中的安全路径');
      return { id: photoId, src, thumbnail, width: positive(photo.width, 1600), height: positive(photo.height, 1600), bytes: positive(photo.bytes, DETAIL_BYTES), thumbnailBytes: positive(photo.thumbnailBytes, THUMB_BYTES), alt: text(photo.alt, textLimits.alt, '图片说明', true) };
    });
    return { id, name: text(product.name, textLimits.name, '名称', true), description: text(product.description, textLimits.description, '简介'), category: text(product.category, textLimits.category, '分类'), material: text(product.material, textLimits.material, '材质'), size: text(product.size, textLimits.size, '尺寸'), createdAt: date(product.createdAt), updatedAt: date(product.updatedAt), photos };
  });
  const catalog: Catalog = { schemaVersion: 1, revision, updatedAt: date(source.updatedAt), products };
  if (new TextEncoder().encode(`${JSON.stringify(catalog, null, 2)}\n`).length > MAX_CATALOG_BYTES) throw new Error('作品清单超过 1MB，请减少作品或精简介绍后再发布');
  return catalog;
}

export function newProduct(): Product {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: '', description: '', category: '', material: '', size: '', createdAt: now, updatedAt: now, photos: [] };
}

export function imagePaths(catalog: Catalog): string[] {
  return catalog.products.flatMap((product) => product.photos.flatMap((photo) => [photo.src, photo.thumbnail]));
}

export function acknowledgePublication(draft: Draft, published: Catalog, sha: string): Draft {
  if (draft.pendingRevision !== published.revision) throw new Error('发布批次不匹配，不能确认本次提交');
  return { ...draft, baseSha: sha };
}

export function usedBytes(catalog: Catalog): number {
  return catalog.products.reduce((total, product) => total + product.photos.reduce((sum, photo) => sum + photo.bytes + photo.thumbnailBytes, 0), 0);
}

export function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请重试'; }

export function validateFileHeader(file: { name: string; type: string; size: number }, header: Uint8Array): void {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('请选择非空且不超过 10MB 的图片');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const signature = String.fromCharCode(...header.slice(0, 12));
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const webp = signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP';
  const valid = (jpeg && ['jpg', 'jpeg'].includes(extension || '') && file.type === 'image/jpeg') || (png && extension === 'png' && file.type === 'image/png') || (webp && extension === 'webp' && file.type === 'image/webp');
  if (!valid) throw new Error('只支持真实的 JPEG、PNG、WebP 图片；HEIC、GIF、SVG 请先转换格式');
}
