import { isImagePath, messageOf, parseCatalog, parseProduct, validateFileHeader } from './catalog.ts';
import type { Draft, Photo } from './catalog.ts';
import { encodeBase64 } from './github.ts';

export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份数据格式不正确');
  return value as Record<string, unknown>;
}

function backupImages(draft: Draft): Map<string, { bytes: number; photo: Photo }> {
  const images = new Map<string, { bytes: number; photo: Photo }>();
  for (const product of [...draft.catalog.products, ...(draft.editing ? [draft.editing] : [])]) {
    for (const photo of product.photos) {
      for (const path of [photo.src, photo.thumbnail]) {
        const bytes = path === photo.src ? photo.bytes : photo.thumbnailBytes;
        const previous = images.get(path);
        if (previous && (previous.bytes !== bytes || previous.photo.width !== photo.width || previous.photo.height !== photo.height)) throw new Error('备份中同一图片的信息不一致');
        images.set(path, { bytes, photo });
      }
    }
  }
  if ([...images.values()].reduce((total, image) => total + Math.ceil(image.bytes / 3) * 4, 0) > MAX_BACKUP_BYTES) throw new Error('完整备份超过 300MB，请改用仓库镜像备份保存完整作品集');
  return images;
}

export function parseDraftBackup(input: unknown): Draft {
  const source = record(input);
  if (source.format !== 'jianshi-draft-backup-v1') throw new Error('不支持的备份格式，请选择「下载草稿备份」导出的 JSON 文件');
  if (typeof source.baseSha !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(source.baseSha)) throw new Error('备份缺少有效的基准版本');
  if (typeof source.savedAt !== 'string' || !Number.isFinite(Date.parse(source.savedAt))) throw new Error('备份保存时间无效');
  const draft: Draft = { catalog: parseCatalog(source.catalog), baseSha: source.baseSha, savedAt: source.savedAt, assets: {}, ...(source.editing === undefined ? {} : { editing: parseProduct(source.editing, true) }) };
  const images = backupImages(draft);
  for (const [path, value] of Object.entries(record(source.assets))) {
    const image = images.get(path);
    if (!isImagePath(path) || !image) throw new Error('备份包含不属于作品集的图片路径');
    const asset = record(value);
    if (asset.type !== 'image/webp' || typeof asset.base64 !== 'string' || asset.base64.length !== Math.ceil(image.bytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) throw new Error('备份图片类型或编码无效');
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0)); }
    catch { throw new Error('备份图片 Base64 编码无效'); }
    if (bytes.length !== image.bytes) throw new Error('备份图片大小与作品信息不一致');
    validateFileHeader({ name: path, type: 'image/webp', size: bytes.length }, bytes.subarray(0, 12));
    draft.assets[path] = new Blob([bytes], { type: 'image/webp' });
  }
  return draft;
}

export async function completeBackupImages(draft: Draft, loadImage: (path: string, bytes: number) => Promise<Blob>, onProgress: (text: string) => void = () => {}): Promise<Draft> {
  draft = { ...draft, catalog: parseCatalog(draft.catalog), ...(draft.editing ? { editing: parseProduct(draft.editing, true) } : {}) };
  const images = backupImages(draft);
  const assets: Record<string, Blob> = {};
  let completed = 0;
  for (const [path, image] of images) {
    onProgress(`正在准备备份图片 ${++completed} / ${images.size}`);
    let blob = draft.assets[path];
    if (!blob) {
      try { blob = await loadImage(path, image.bytes); }
      catch (reason) { throw new Error(`备份缺少图片，无法从对应仓库版本补齐：${messageOf(reason)}`); }
    }
    if (blob.type !== 'image/webp' || blob.size !== image.bytes) throw new Error('备份图片类型或大小与作品信息不一致');
    validateFileHeader({ name: path, type: blob.type, size: blob.size }, new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error('备份中的图片已损坏或当前浏览器无法解码，请使用完整备份重试'); }
    try {
      if (path === image.photo.src ? bitmap.width !== image.photo.width || bitmap.height !== image.photo.height : bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 480 || bitmap.height > 480) throw new Error('备份图片尺寸与作品信息不一致');
    } finally { bitmap.close(); }
    assets[path] = blob;
  }
  return { ...draft, assets };
}

export async function encodeDraftBackup(draft: Draft): Promise<Blob> {
  const assets: Record<string, { type: string; base64: string }> = {};
  for (const [path, image] of backupImages(draft)) {
    const blob = draft.assets[path];
    if (!blob || blob.type !== 'image/webp' || blob.size !== image.bytes) throw new Error('备份图片不完整，无法导出');
    assets[path] = { type: blob.type, base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const payload = { format: 'jianshi-draft-backup-v1', catalog: draft.catalog, baseSha: draft.baseSha, savedAt: draft.savedAt, editing: draft.editing, assets };
  const backup = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  if (backup.size > MAX_BACKUP_BYTES) throw new Error('完整备份超过 300MB，请改用仓库镜像备份保存完整作品集');
  return backup;
}
