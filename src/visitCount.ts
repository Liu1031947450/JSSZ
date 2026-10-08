// 页脚访问计数：客户端 24h 节流（同一人反复刷新只上报 1 次），
// 服务端按「访客ID + 东八区日期」再做权威去重，两层任一失效都不会虚增。
export const COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
const VID_KEY = 'jssz_vid';
const COUNTED_KEY = 'jssz_counted_at';
const VID_PATTERN = /^[0-9a-f-]{8,64}$/i;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return (globalThis as { localStorage?: KeyValueStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/count`;

function toCount(data: unknown): number | null {
  const count = (data as { count?: unknown } | null)?.count;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null;
}

/** 读取（或首次生成）本机访客标识；存储不可用时返回空串表示不参与上报。 */
export function getVisitorId(store: KeyValueStore | null = defaultStore()): string {
  if (!store) return '';
  try {
    const saved = store.getItem(VID_KEY);
    if (saved && VID_PATTERN.test(saved)) return saved;
    const fresh = globalThis.crypto?.randomUUID?.() ?? '';
    if (!fresh) return '';
    store.setItem(VID_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

/** 距上次成功上报不足 24h（或时间戳损坏/来自未来）时的自愈判断。 */
export function shouldCount(
  last: string | null,
  now: number = Date.now(),
  windowMs: number = COUNT_WINDOW_MS,
): boolean {
  if (!last) return true;
  const at = Number(last);
  if (!Number.isFinite(at) || at > now) return true;
  return now - at >= windowMs;
}

export function lastCounted(store: KeyValueStore | null = defaultStore()): string | null {
  try {
    return store?.getItem(COUNTED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function markCounted(now: number = Date.now(), store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(COUNTED_KEY, String(now));
  } catch {
    // 存储失败时下次访问会重发上报，由服务端按日去重兜底
  }
}

export async function fetchTotal(baseUrl: string): Promise<number | null> {
  try {
    const res = await fetch(endpoint(baseUrl), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return toCount(await res.json());
  } catch {
    return null;
  }
}

export async function reportVisit(baseUrl: string, vid: string): Promise<number | null> {
  if (!vid) return null;
  try {
    const res = await fetch(endpoint(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vid }),
    });
    if (!res.ok) return null;
    return toCount(await res.json());
  } catch {
    return null;
  }
}
