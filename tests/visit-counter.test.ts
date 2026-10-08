import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../counter/src/index.ts';
import type { Env } from '../counter/src/index.ts';
import { COUNT_WINDOW_MS, fetchTotal, getVisitorId, lastCounted, markCounted, reportVisit, shouldCount } from '../src/visitCount.ts';
import type { KeyValueStore } from '../src/visitCount.ts';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

function fakeEnv(): Env & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    VISIT_COUNT: {
      get: async (key) => data.get(key) ?? null,
      put: async (key, value) => { data.set(key, value); },
    },
  };
}

const post = (vid: string) => new Request('https://counter.test/count', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://liu1031947450.github.io' },
  body: JSON.stringify({ vid }),
});
const getCount = () => new Request('https://counter.test/count', { headers: { Origin: 'https://jssz.pages.dev' } });
const countOf = async (env: Env) => (await posted(env, getCount())).count as number;
const posted = async (env: Env, request: Request) => JSON.parse(await (await worker.fetch(request, env)).text()) as { count?: number };

test('24 小时内重复访问不重复计数，到期后恢复', () => {
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.equal(shouldCount(null, now), true, '首次访问立即计数');
  assert.equal(shouldCount(String(now - COUNT_WINDOW_MS + 1000), now), false, '窗口内不计');
  assert.equal(shouldCount(String(now - COUNT_WINDOW_MS), now), true, '满 24h 恢复计数');
  assert.equal(shouldCount('not-a-timestamp', now), true, '损坏时间戳自愈');
  assert.equal(shouldCount(String(now + 60_000), now), true, '未来时间戳自愈');
});

test('访客标识稳定且能自愈', () => {
  const store = memoryStore();
  const first = getVisitorId(store);
  assert.match(first, /^[0-9a-f-]{36}$/, '首次生成 UUID');
  assert.equal(getVisitorId(store), first, '重复读取保持不变');
  getVisitorId(memoryStore({ jssz_vid: 'broken!!' }));
  assert.match(getVisitorId(memoryStore({ jssz_vid: 'broken!!' })), /^[0-9a-f-]{36}$/, '损坏值重新生成');
  assert.equal(getVisitorId(null), '', '存储不可用时不参与上报');
});

test('上报成功写入时间戳，失败不写入', async (t) => {
  const store = memoryStore();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 7 }), { status: 200 }));
  assert.equal(await reportVisit('https://counter.test', 'abc'), 7);
  markCounted(123, store);
  assert.equal(lastCounted(store), '123', '成功后记录时间戳');
  assert.equal(await reportVisit('https://counter.test', ''), null, '无访客标识不发请求');
  assert.equal(await fetchTotal('https://counter.test/'), 7, 'GET 解析总数');
});

test('网络失败返回 null 而非抛错', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal(await fetchTotal('https://counter.test'), null);
  assert.equal(await reportVisit('https://counter.test', 'some-vid-0000'), null);
});

test('Worker：同一访客同一天只 +1，不同访客各自计数', async () => {
  const env = fakeEnv();
  assert.equal((await posted(env, post('11111111-1111-4111-8111-111111111111'))).count, 1);
  assert.equal((await posted(env, post('11111111-1111-4111-8111-111111111111'))).count, 1, '同日重复上报不累加');
  assert.equal((await posted(env, post('22222222-2222-4222-8222-222222222222'))).count, 2, '新访客 +1');
  assert.equal(await countOf(env), 2, 'GET 返回同一总数');
  assert.ok([...env.data.keys()].some((key) => key.startsWith('seen:') && key.endsWith('11111111-1111-4111-8111-111111111111')), '写入按日去重键');
});

test('Worker：拒绝非法访客标识与未知来源跨域写入', async () => {
  const env = fakeEnv();
  const bad = await worker.fetch(post('x'), env);
  assert.equal(bad.status, 400, '非法 vid 返回 400');
  assert.equal((await worker.fetch(getCount(), env)).headers.get('Access-Control-Allow-Origin'), 'https://jssz.pages.dev', '白名单域名放行');
  const evil = await worker.fetch(new Request('https://counter.test/count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    body: JSON.stringify({ vid: '33333333-3333-4333-8333-333333333333' }),
  }), env);
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null, '非白名单域名不给 CORS 头');
  assert.equal(JSON.parse(await evil.text()).count, 1, '服务端本身无秘密，直连仍可计数');
});
