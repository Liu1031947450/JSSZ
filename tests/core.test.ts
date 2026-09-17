import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { acknowledgePublication, DETAIL_BYTES, filterProducts, formatBytes, formatPrice, getFilterOptions, imagePaths, isImagePath, MAX_FILE_BYTES, newProduct, parseCatalog, parsePrice, usedBytes, validateFileHeader } from '../src/catalog.ts';
import type { Catalog, Draft, Product } from '../src/catalog.ts';
import { authenticate, encodeBase64, fetchPublishedCatalog, GitHubError, publishCatalog, readSnapshot, repositoryPath } from '../src/github.ts';
import type { Snapshot } from '../src/github.ts';

const repository = { owner: 'test-owner', repo: 'handmade', branch: 'main' };
const token = 'github_pat_test_only_not_a_real_token';
const date = '2026-09-17T00:00:00.000Z';
const productId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

function product(): Product {
  return { id: productId, name: '小小编织袋', description: '棉线与一个安静的下午', category: '编织', material: '棉线', size: '12 × 8 cm', createdAt: date, updatedAt: date, photos: [{ id: photoId, src: `images/${productId}/${photoId}-detail.webp`, thumbnail: `images/${productId}/${photoId}-thumb.webp`, width: 800, height: 1000, bytes: webp.length, thumbnailBytes: webp.length, alt: '手工编织袋的正面' }] };
}

function catalog(products: Product[] = []): Catalog { return { schemaVersion: 1, revision: 'initial', updatedAt: date, products }; }

function fixture(previous: Catalog = catalog()) {
  const next = catalog([product()]); next.revision = 'publish-test';
  const snapshot: Snapshot = { catalog: previous, sha: 'baseline', treeSha: 'base-tree' };
  const draft: Draft = { catalog: next, baseSha: snapshot.sha, assets: Object.fromEntries(imagePaths(next).map((path) => [path, new Blob([webp], { type: 'image/webp' })])), savedAt: date, pendingRevision: next.revision };
  return { snapshot, draft };
}

type Call = { url: string; method: string; body: any; headers: HeadersInit | undefined };
function mockGitHub(context: TestContext, respond?: (call: Call) => Response | undefined | Promise<Response | undefined>) {
  const calls: Call[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers };
    calls.push(call);
    const custom = await respond?.(call);
    if (custom) return custom;
    if (call.url.endsWith('/user')) return Response.json({ login: 'maker' });
    if (call.url.endsWith('/repos/test-owner/handmade')) return Response.json({ permissions: { push: true } });
    if (call.url.includes('/git/ref/heads/')) return Response.json({ object: { sha: 'baseline' } });
    if (call.url.includes('/git/commits/baseline')) return Response.json({ tree: { sha: 'base-tree' } });
    if (call.url.includes('/contents/')) return Response.json({ content: encodeBase64(new TextEncoder().encode(JSON.stringify(catalog()))), encoding: 'base64', size: 200 });
    if (call.url.includes('/git/blobs')) return Response.json({ sha: `blob-${calls.length}` });
    if (call.url.includes('/git/trees')) return Response.json({ sha: 'next-tree' });
    if (call.url.includes('/git/commits')) return Response.json({ sha: 'next-commit' });
    if (call.method === 'PATCH') return Response.json({ object: { sha: 'next-commit' } });
    throw new Error(`Unexpected test request ${call.url}`);
  });
  return calls;
}

test('清单允许空墙并保留中文、日期与有效图片路径', () => {
  assert.deepEqual(parseCatalog(catalog()), catalog());
  assert.deepEqual(parseCatalog(catalog([product()])), catalog([product()]));
  assert.equal(usedBytes(catalog([product()])), 24);
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
});

test('价格支持零和两位小数，拒绝负数、非数字、溢出和过高精度', () => {
  for (const price of [0, 0.01, 0.29, 19.9, 128.56, 999999.99]) {
    assert.equal(parsePrice(price), price);
    assert.equal(parseCatalog(catalog([{ ...product(), price }])).products[0].price, price);
  }
  for (const price of [-1, -0.01, NaN, Infinity, -Infinity, 0.001, Number.MAX_SAFE_INTEGER, '12.50', '', null, true]) {
    assert.throws(() => parsePrice(price), /价格/);
    assert.throws(() => parseCatalog(catalog([{ ...product(), price } as Product])), /价格/);
  }
  assert.equal(formatPrice(0), '¥0.00');
  assert.equal(formatPrice(128.5), '¥128.50');
  assert.equal(formatPrice(), '暂未标价');
});

test('旧尺寸不会被误作价格，新增价格兼容未标价和无尺寸的作品', () => {
  const legacy = parseCatalog(catalog([product()])).products[0];
  assert.equal(legacy.size, '12 × 8 cm');
  assert.equal(legacy.price, undefined);
  const current = { ...product(), price: 12.5 } as Partial<Product>;
  delete current.size;
  const parsed = parseCatalog(catalog([current as Product])).products[0];
  assert.equal(parsed.size, '');
  assert.equal(parsed.price, 12.5);
  assert.equal(parseCatalog(catalog([{ ...parsed, price: undefined }])).products[0].price, undefined);
  assert.equal(newProduct().price, undefined);
});

test('分类和材质去空白去重，忽略空值或异常值，并随作品变化更新', () => {
  const products = [
    { ...product(), category: ' 项链 ', material: '925银' },
    { ...product(), category: '项链', material: ' 925银 ' },
    { ...product(), category: '手链', material: '珍珠' },
    { ...product(), category: ' ', material: '' },
    { ...product(), category: null, material: 123 },
  ] as Product[];
  const options = getFilterOptions(products);
  assert.deepEqual(new Set(options.categories), new Set(['项链', '手链']));
  assert.deepEqual(new Set(options.materials), new Set(['925银', '珍珠']));
  assert.deepEqual(getFilterOptions([]), { categories: [], materials: [] });
  assert.equal(getFilterOptions([...products, { ...product(), category: '戒指', material: '黄铜' }]).categories.includes('戒指'), true);
  assert.deepEqual(getFilterOptions(products.slice(0, 1)), { categories: ['项链'], materials: ['925银'] });
  assert.equal(products[0].category, ' 项链 ');
});

test('筛选支持全部、单独分类、单独材质及交集，无匹配返回空列表', () => {
  const products = [
    { ...product(), category: ' 项链 ', material: '925银' },
    { ...product(), category: '手链', material: '925银' },
    { ...product(), category: '项链', material: '珍珠' },
    { ...product(), category: '', material: '' },
  ];
  assert.deepEqual(filterProducts(products), products);
  assert.deepEqual(filterProducts(products, '项链'), [products[0], products[2]]);
  assert.deepEqual(filterProducts(products, '', '925银'), [products[0], products[1]]);
  assert.deepEqual(filterProducts(products, '项链', '925银'), [products[0]]);
  assert.deepEqual(filterProducts(products, '手链', '珍珠'), []);
  assert.deepEqual(filterProducts([], '项链', '925银'), []);
});

test('清单拒绝缺失名称、超限字段、未知版本和重复作品', () => {
  assert.throws(() => parseCatalog({ ...catalog(), schemaVersion: 2 }));
  assert.throws(() => parseCatalog(catalog([{ ...product(), name: ' ' }])));
  assert.throws(() => parseCatalog(catalog([{ ...product(), name: '名'.repeat(61) }])));
  assert.throws(() => parseCatalog(catalog([product(), product()])));
  assert.throws(() => parseCatalog(catalog([{ ...product(), createdAt: 'yesterday' }])));
  assert.throws(() => parseCatalog({ ...catalog(), products: null }));
});

test('每件必须有 1～5 张不重复照片', () => {
  assert.throws(() => parseCatalog(catalog([{ ...product(), photos: [] }])));
  assert.throws(() => parseCatalog(catalog([{ ...product(), photos: Array(6).fill(product().photos[0]) }])));
  assert.throws(() => parseCatalog(catalog([{ ...product(), photos: [product().photos[0], product().photos[0]] }])));
});

test('拒绝发布管理 API 无法重新读取的超大清单', () => {
  const products = Array.from({ length: 650 }, () => {
    const item = product(); item.id = crypto.randomUUID(); item.description = '长'.repeat(1000);
    item.photos[0].src = item.photos[0].src.replace(productId, item.id);
    item.photos[0].thumbnail = item.photos[0].thumbnail.replace(productId, item.id);
    return item;
  });
  assert.throws(() => parseCatalog(catalog(products)), /1MB/);
});

test('图片路径不能外链、越界、使用查询串或指向其他作品', () => {
  for (const path of ['https://example.com/x.webp', 'javascript:alert(1)', '../image.webp', 'images/a/../../x.webp', '/images/a.webp', `${product().photos[0].src}?token=test`]) {
    assert.equal(isImagePath(path), false);
    const item = product(); item.photos[0].src = path;
    assert.throws(() => parseCatalog(catalog([item])));
  }
  const item = product(); item.photos[0].src = item.photos[0].src.replace(productId, photoId);
  assert.throws(() => parseCatalog(catalog([item])));
});

test('图片元数据限制尺寸、字节数和替代文本', () => {
  for (const patch of [{ width: 1601 }, { height: 0 }, { bytes: DETAIL_BYTES + 1 }, { thumbnailBytes: -1 }, { alt: '' }]) {
    const item = product(); Object.assign(item.photos[0], patch);
    assert.throws(() => parseCatalog(catalog([item])));
  }
});

test('新作品拥有不同的稳定 ID，初始没有伪造照片', () => {
  const first = newProduct(); const second = newProduct();
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.photos, []);
  assert.equal(first.createdAt, first.updatedAt);
});

test('恢复已提交的批次时保留提交后继续编辑的内容和本机图片', () => {
  const { draft } = fixture();
  const published = structuredClone(draft.catalog);
  draft.editing = { ...newProduct(), name: '上线等待期间的新草稿' };
  draft.catalog.products[0].description = '提交后继续修改的内容';
  const result = acknowledgePublication(draft, published, 'new-head');
  assert.equal(result.baseSha, 'new-head');
  assert.equal(result.editing?.name, '上线等待期间的新草稿');
  assert.equal(result.catalog.products[0].description, '提交后继续修改的内容');
  assert.equal(Object.keys(result.assets).length, 2);
});

test('上传要求扩展名、MIME 和文件头一致', () => {
  validateFileHeader({ name: 'photo.JPG', type: 'image/jpeg', size: 100 }, new Uint8Array([255, 216, 255]));
  validateFileHeader({ name: 'photo.png', type: 'image/png', size: 100 }, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  validateFileHeader({ name: 'photo.webp', type: 'image/webp', size: 100 }, webp);
  for (const name of ['photo.heic', 'photo.gif', 'photo.svg', 'photo.exe', 'photo.jpg']) assert.throws(() => validateFileHeader({ name, type: 'image/webp', size: 100 }, webp));
  assert.throws(() => validateFileHeader({ name: 'photo.png', type: 'image/png', size: 100 }, webp));
  assert.throws(() => validateFileHeader({ name: 'photo.webp', type: 'image/jpeg', size: 100 }, webp));
  assert.throws(() => validateFileHeader({ name: 'photo.webp', type: '', size: 100 }, webp));
});

test('上传拒绝空文件、过大文件和截断文件头', () => {
  for (const size of [0, MAX_FILE_BYTES + 1]) assert.throws(() => validateFileHeader({ name: 'photo.webp', type: 'image/webp', size }, webp));
  assert.throws(() => validateFileHeader({ name: 'photo.png', type: 'image/png', size: 100 }, new Uint8Array([137, 80])));
});

test('仓库配置拒绝路径注入，并正确编码合法仓库名', () => {
  assert.equal(repositoryPath(repository), '/repos/test-owner/handmade');
  for (const owner of ['../owner', 'owner/x', 'https://example.com']) assert.throws(() => repositoryPath({ ...repository, owner }));
  for (const repo of ['..', '../repo', 'repo?x=1', 'repo/x']) assert.throws(() => repositoryPath({ ...repository, repo }));
  assert.throws(() => repositoryPath({ ...repository, branch: '../main' }));
});

test('认证令牌只发往 GitHub API，不接受账号密码', async (context) => {
  const calls = mockGitHub(context);
  assert.equal(await authenticate(repository, token), 'maker');
  assert.ok(calls.every((call) => call.url.startsWith('https://api.github.com/') && !call.url.includes(token)));
  assert.equal(new Headers(calls[0].headers).get('Authorization'), `Bearer ${token}`);
  await assert.rejects(authenticate(repository, 'password'));
});

test('拒绝无写权限或已归档仓库', async (context) => {
  mockGitHub(context, (call) => call.url.endsWith('/handmade') ? Response.json({ permissions: { push: false } }) : undefined);
  await assert.rejects(authenticate(repository, token), /写权限/);
});

test('快照读取绑定同一 commit，正确解码 UTF-8 中文', async (context) => {
  const expected = catalog([product()]);
  const calls = mockGitHub(context, (call) => call.url.includes('/contents/') ? Response.json({ content: encodeBase64(new TextEncoder().encode(JSON.stringify(expected))), encoding: 'base64', size: 500 }) : undefined);
  const result = await readSnapshot(repository, token);
  assert.deepEqual(result.catalog, expected);
  assert.ok(calls.at(-1)!.url.endsWith('?ref=baseline'));
});

test('超大或错误远端清单不会被静默替换为空清单', async (context) => {
  mockGitHub(context, (call) => call.url.includes('/contents/') ? Response.json({ encoding: 'none', size: 1_000_001 }) : undefined);
  await assert.rejects(readSnapshot(repository, token), /1MB/);
});

test('图片与清单一次提交，沿用基准树，最后非强制更新引用', async (context) => {
  const calls = mockGitHub(context);
  const { snapshot, draft } = fixture();
  const result = await publishCatalog(repository, token, snapshot, draft);
  assert.equal(result.sha, 'next-commit');
  const tree = calls.find((call) => call.url.endsWith('/git/trees'))!.body;
  assert.equal(tree.base_tree, 'base-tree');
  assert.deepEqual(tree.tree.map((entry: any) => entry.path).sort(), ['public/catalog.json', ...imagePaths(draft.catalog).map((path) => `public/${path}`)].sort());
  assert.ok(tree.tree.every((entry: any) => entry.mode === '100644' && entry.type === 'blob'));
  const commit = calls.find((call) => call.url.endsWith('/git/commits'))!.body;
  assert.deepEqual(commit.parents, ['baseline']);
  assert.deepEqual(calls.at(-1)!.body, { sha: 'next-commit', force: false });
  assert.equal(calls.at(-1)!.method, 'PATCH');
});

test('删除只移除旧清单引用的图片，正文和删除处于同一棵树', async (context) => {
  const calls = mockGitHub(context);
  const { snapshot, draft } = fixture(catalog([product()]));
  draft.catalog.products = [];
  await publishCatalog(repository, token, snapshot, draft);
  const entries = calls.find((call) => call.url.endsWith('/git/trees'))!.body.tree;
  assert.equal(entries.filter((entry: any) => entry.sha === null).length, 2);
  assert.ok(entries.every((entry: any) => entry.path === 'public/catalog.json' || entry.path.startsWith(`public/images/${productId}/`)));
});

test('文字编辑不重新上传已有图片', async (context) => {
  const calls = mockGitHub(context);
  const { snapshot, draft } = fixture(catalog([product()])); draft.assets = {}; draft.catalog.products[0].name = '新的名字';
  await publishCatalog(repository, token, snapshot, draft);
  assert.equal(calls.filter((call) => call.url.endsWith('/git/blobs')).length, 1);
});

test('价格保存到发布清单，无效价格在任何网络写入前被拦截', async (context) => {
  const calls = mockGitHub(context);
  const { snapshot, draft } = fixture(catalog([product()]));
  draft.catalog.products[0].price = -1;
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /价格/);
  assert.equal(calls.length, 0);
  draft.catalog.products[0].price = 128.5;
  const result = await publishCatalog(repository, token, snapshot, draft);
  const manifest = calls.find((call) => call.url.endsWith('/git/blobs') && call.body.encoding === 'utf-8')!;
  assert.equal(JSON.parse(manifest.body.content).products[0].price, 128.5);
  assert.equal(result.catalog.products[0].price, 128.5);
});

test('远端预检冲突时不写入任何对象', async (context) => {
  const calls = mockGitHub(context, (call) => call.url.includes('/git/ref/') ? Response.json({ object: { sha: 'other-commit' } }) : undefined);
  const { snapshot, draft } = fixture();
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), (error: unknown) => error instanceof GitHubError && error.status === 409);
  assert.equal(calls.length, 1);
});

test('最终分支引用冲突不会 force 或自动重试', async (context) => {
  const calls = mockGitHub(context, (call) => call.method === 'PATCH' ? Response.json({}, { status: 422 }) : undefined);
  const { snapshot, draft } = fixture();
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /未接受更新/);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.equal(calls.at(-1)!.body.force, false);
});

test('缺失图片或未完成编辑阻止提交', async (context) => {
  const calls = mockGitHub(context);
  const { snapshot, draft } = fixture(); draft.assets = {};
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /图片缺失/);
  draft.editing = newProduct();
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /正在编辑/);
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('图片上传失败不创建清单提交、不改动原草稿', async (context) => {
  const calls = mockGitHub(context, (call) => call.url.endsWith('/git/blobs') ? Response.json({}, { status: 500 }) : undefined);
  const { snapshot, draft } = fixture(); const before = JSON.stringify(draft.catalog);
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /500/);
  assert.equal(JSON.stringify(draft.catalog), before);
  assert.ok(!calls.some((call) => call.url.endsWith('/git/commits') || call.method === 'PATCH'));
});

test('过期令牌、分支保护和限流均返回明确错误', async (context) => {
  let status = 401;
  mockGitHub(context, () => Response.json({}, { status }));
  for (const code of [401, 403, 404, 429]) {
    status = code;
    await assert.rejects(authenticate(repository, token), (error: unknown) => error instanceof GitHubError && error.status === code && !error.message.includes(token));
  }
});

test('提交应答断网后先核对批次，确认成功后不重复写入', async (context) => {
  const { snapshot, draft } = fixture(); let patched = false;
  const calls = mockGitHub(context, (call) => {
    if (call.method === 'PATCH') { patched = true; throw new TypeError('network down'); }
    if (patched && call.url.includes('/contents/')) return Response.json({ content: encodeBase64(new TextEncoder().encode(JSON.stringify(draft.catalog))), encoding: 'base64', size: 500 });
  });
  const result = await publishCatalog(repository, token, snapshot, draft);
  assert.equal(result.catalog.revision, draft.catalog.revision);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
});

test('无法确认提交结果时提示核对，不自动重试提交', async (context) => {
  const calls = mockGitHub(context, (call) => { if (call.method === 'PATCH') throw new TypeError('network down'); });
  const { snapshot, draft } = fixture();
  await assert.rejects(publishCatalog(repository, token, snapshot, draft), /结果暂未确认/);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
});

test('公开读取禁用缓存、兼容子目录且不携带管理令牌', async (context) => {
  let requested = ''; let options: RequestInit | undefined;
  context.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => { requested = String(input); options = init; return Response.json(catalog()); });
  await fetchPublishedCatalog('https://example.com/JSSZ');
  assert.ok(requested.startsWith('https://example.com/JSSZ/catalog.json?fresh='));
  assert.equal(options?.cache, 'no-store');
  assert.equal(options?.headers, undefined);
  await assert.rejects(fetchPublishedCatalog('javascript:alert(1)'));
});

test('公开读取不会用无效返回值伪装成空墙', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ products: [] }));
  await assert.rejects(fetchPublishedCatalog('https://example.com/'), /版本/);
});
