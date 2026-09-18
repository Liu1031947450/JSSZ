import { DETAIL_BYTES, imagePaths, isImagePath, MAX_CATALOG_BYTES, parseCatalog } from './catalog.ts';
import type { Catalog, Draft } from './catalog.ts';

export type Repository = { owner: string; repo: string; branch: string };
export type Snapshot = { catalog: Catalog; sha: string; treeSha: string };
type GitEntry = { path: string; mode: '100644'; type: 'blob'; sha: string | null };

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.name = 'GitHubError'; this.status = status; }
}

export function repositoryPath(repository: Repository): string {
  if (!/^[a-zA-Z0-9-]+$/.test(repository.owner) || !/^[a-zA-Z0-9_.-]+$/.test(repository.repo) || repository.repo === '.' || repository.repo === '..' || !repository.branch || /[\x00-\x20~^:?*[\\]/.test(repository.branch) || repository.branch.includes('..')) throw new Error('GitHub 仓库配置无效，请检查 owner、repo 和 branch');
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

const branchPath = (repository: Repository) => repository.branch.split('/').map(encodeURIComponent).join('/');

async function withRequestTimeout<Data>(milliseconds: number, run: (signal: AbortSignal) => Promise<Data>, signal?: AbortSignal): Promise<Data> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时，请稍后重试', 'TimeoutError')), milliseconds);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function request<Data>(token: string, path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<Data> {
  return withRequestTimeout(30_000, async (signal) => {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      throw new GitHubError('无法连接 GitHub 或请求超时。草稿仍在本机，请检查网络后重新同步');
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: '令牌无效或已过期，请退出并重新输入 fine-grained PAT',
        403: 'GitHub 拒绝操作：请检查 Contents 读写权限、分支保护及 API 速率限制',
        404: '找不到仓库、分支或作品清单，请检查配置及令牌的仓库授权',
        409: '远端已变化或分支状态冲突。草稿已保留，请重新同步，不要强制覆盖',
        422: 'GitHub 未接受更新：可能存在远端冲突、分支保护或无效配置。请重新同步检查',
        429: 'GitHub 请求过于频繁，请稍后重试',
      };
      throw new GitHubError(messages[response.status] || `GitHub 暂时无法完成请求（${response.status}），草稿已保留`, response.status);
    }
    return response.json() as Promise<Data>;
  });
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export async function authenticate(repository: Repository, token: string): Promise<string> {
  if (!/^github_pat_[a-zA-Z0-9_]{15,}$/.test(token)) throw new Error('请输入 github_pat_ 开头的 fine-grained PAT，不支持账号密码或 classic token');
  const path = repositoryPath(repository);
  const user = await request<{ login: string }>(token, '/user');
  const access = await request<{ permissions?: { push?: boolean }; archived?: boolean; visibility?: string }>(token, path);
  if (access.archived || !access.permissions?.push) throw new Error('当前账号没有此仓库的写权限，或仓库已归档');
  return user.login;
}

export async function readSnapshot(repository: Repository, token: string): Promise<Snapshot> {
  const path = repositoryPath(repository);
  const reference = await request<{ object: { sha: string } }>(token, `${path}/git/ref/heads/${branchPath(repository)}`);
  const sha = reference.object.sha;
  const commit = await request<{ tree: { sha: string } }>(token, `${path}/git/commits/${sha}`);
  const file = await request<{ content: string; encoding: string; size: number }>(token, `${path}/contents/public/catalog.json?ref=${encodeURIComponent(sha)}`);
  if (file.encoding !== 'base64' || file.size > MAX_CATALOG_BYTES || typeof file.content !== 'string') throw new Error('作品清单超过 1MB 或格式不可读取，请先整理仓库内容');
  const decoded = Uint8Array.from(atob(file.content.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  let catalog: Catalog;
  try { catalog = parseCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded))); }
  catch { throw new Error('远端作品清单未通过校验，请先修复清单；不会覆盖现有内容'); }
  return { catalog, sha, treeSha: commit.tree.sha };
}

export async function readBackupImage(repository: Repository, token: string, revision: string, image: string, expectedBytes: number): Promise<Blob> {
  if (!isImagePath(image) || !/^[a-zA-Z0-9-]{1,80}$/.test(revision)) throw new Error('备份图片路径或基准版本无效');
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > DETAIL_BYTES) throw new Error('备份图片大小无效');
  const file = await request<{ content: string; encoding: string; size: number }>(token, `${repositoryPath(repository)}/contents/public/${image}?ref=${encodeURIComponent(revision)}`);
  if (file.encoding !== 'base64' || file.size !== expectedBytes || typeof file.content !== 'string') throw new Error('备份对应版本的图片不可读取或大小不符');
  const content = file.content.replace(/\s/g, '');
  if (content.length !== Math.ceil(expectedBytes / 3) * 4) throw new Error('备份图片编码大小不符');
  return new Blob([Uint8Array.from(atob(content), character => character.charCodeAt(0))], { type: 'image/webp' });
}

export async function publishCatalog(repository: Repository, token: string, snapshot: Snapshot, draft: Draft, onProgress: (text: string) => void = () => {}): Promise<Snapshot> {
  if (draft.editing) throw new Error('请先将正在编辑的作品存入草稿');
  if (draft.baseSha !== snapshot.sha) throw new GitHubError('本地草稿与远端版本不一致，请先重新同步', 409);
  const catalog = parseCatalog(draft.catalog);
  if (!draft.pendingRevision || draft.pendingRevision !== catalog.revision) throw new Error('缺少发布批次，已阻止发布');
  const path = repositoryPath(repository);
  const current = await request<{ object: { sha: string } }>(token, `${path}/git/ref/heads/${branchPath(repository)}`);
  if (current.object.sha !== snapshot.sha) throw new GitHubError('远端内容已变化，草稿已保留。请重新同步后再发布', 409);
  const previousPaths = new Set(imagePaths(snapshot.catalog));
  const nextPaths = new Set(imagePaths(catalog));
  const entries: GitEntry[] = [];
  for (const image of nextPaths) {
    if (!isImagePath(image)) throw new Error('禁止写入作品目录以外的路径');
    if (!previousPaths.has(image) && !(draft.assets[image] instanceof Blob)) throw new Error('草稿图片缺失，请重新上传后发布');
  }
  let completed = 0;
  const uploads = [...nextPaths].filter((image) => !previousPaths.has(image));
  for (const image of uploads) {
    onProgress(`正在上传图片 ${++completed} / ${uploads.length}`);
    const asset = draft.assets[image];
    const photo = catalog.products.flatMap((product) => product.photos).find((photo) => photo.src === image || photo.thumbnail === image)!;
    if (asset.type !== 'image/webp' || asset.size !== (photo.src === image ? photo.bytes : photo.thumbnailBytes)) throw new Error('草稿图片类型或大小与清单不一致，请重新处理图片');
    const bytes = new Uint8Array(await asset.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') throw new Error('草稿中存在无效 WebP 图片，请重新上传');
    const blob = await request<{ sha: string }>(token, `${path}/git/blobs`, { content: encodeBase64(bytes), encoding: 'base64' });
    entries.push({ path: `public/${image}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const image of previousPaths) if (!nextPaths.has(image)) entries.push({ path: `public/${image}`, mode: '100644', type: 'blob', sha: null });
  onProgress('正在提交作品清单');
  const manifest = await request<{ sha: string }>(token, `${path}/git/blobs`, { content: `${JSON.stringify(catalog, null, 2)}\n`, encoding: 'utf-8' });
  entries.push({ path: 'public/catalog.json', mode: '100644', type: 'blob', sha: manifest.sha });
  const tree = await request<{ sha: string }>(token, `${path}/git/trees`, { base_tree: snapshot.treeSha, tree: entries });
  const commit = await request<{ sha: string }>(token, `${path}/git/commits`, { message: `content: publish handmade collection ${catalog.revision}`, tree: tree.sha, parents: [snapshot.sha] });
  try {
    await request(token, `${path}/git/refs/heads/${branchPath(repository)}`, { sha: commit.sha, force: false }, 'PATCH');
  } catch (error) {
    if (error instanceof GitHubError && error.status === 0) {
      try {
        const recovered = await readSnapshot(repository, token);
        if (recovered.catalog.revision === catalog.revision) return recovered;
      } catch { /* ponytail: ambiguous network writes require a fresh snapshot, never automatic retry */ }
      throw new GitHubError('提交结果暂未确认。草稿和发布批次已保留，请重新连接并同步，切勿直接重复提交');
    }
    throw error;
  }
  return { catalog, sha: commit.sha, treeSha: tree.sha };
}

export async function fetchPublishedCatalog(site: string, signal?: AbortSignal): Promise<Catalog> {
  const location = new URL(site);
  if (!['https:', 'http:'].includes(location.protocol) || location.username || location.password) throw new Error('公开站点地址无效');
  if (!location.pathname.endsWith('/')) location.pathname += '/';
  const url = new URL('catalog.json', location);
  url.searchParams.set('fresh', `${Date.now()}`);
  return withRequestTimeout(15_000, async (requestSignal) => {
    const response = await fetch(url, { cache: 'no-store', signal: requestSignal });
    if (!response.ok) throw new Error(`作品清单加载失败（${response.status}）`);
    return parseCatalog(await response.json());
  }, signal);
}
