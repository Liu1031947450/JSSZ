// 页脚访问计数 Worker：GET 返回累计数，POST 按「访客ID + 东八区日期」去重后 +1。
// 隐私：不存 IP、不存 UA，只存随机访客ID（4 天后自动过期）。
// ponytail: KV 读改写非原子，极端并发下可能丢个位数计数，页脚展示可接受
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  VISIT_COUNT: KVNamespace;
}

const VID_PATTERN = /^[0-9a-f-]{8,64}$/i;
const ALLOWED_ORIGINS = new Set([
  'https://liu1031947450.github.io',
  'https://jssz.pages.dev',
]);
const LOCAL_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
const SEEN_TTL_SECONDS = 4 * 24 * 60 * 60;

function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
}

function json(body: unknown, origin: string | null, status = 200): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function total(env: Env): Promise<number> {
  return Number(await env.VISIT_COUNT.get('total')) || 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = corsOrigin(request);
    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      };
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      return new Response(null, { status: 204, headers });
    }
    if (request.method === 'GET') {
      return json({ count: await total(env) }, origin);
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, origin, 405);
    }
    let vid = '';
    try {
      const body = (await request.json()) as { vid?: unknown };
      vid = String(body?.vid ?? '').trim();
    } catch {
      // fall through to 400
    }
    if (!VID_PATTERN.test(vid)) return json({ error: 'bad vid' }, origin, 400);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const seenKey = `seen:${day}:${vid}`;
    if (await env.VISIT_COUNT.get(seenKey)) {
      return json({ count: await total(env) }, origin);
    }
    const count = (await total(env)) + 1;
    await Promise.all([
      env.VISIT_COUNT.put('total', String(count)),
      env.VISIT_COUNT.put(seenKey, '1', { expirationTtl: SEEN_TTL_SECONDS }),
    ]);
    return json({ count }, origin);
  },
};
