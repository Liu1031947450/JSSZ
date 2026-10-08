// /api/count 反向代理到计数 Worker：workers.dev 在部分网络被 DNS+SNI 封锁，
// 浏览器只访问可达的 jssz.pages.dev，Cloudflare 边缘之间转发不受影响。
const WORKER = 'https://jssz-visit-counter.1031947450.workers.dev';

export const onRequest = async ({ request }: { request: Request }): Promise<Response> => {
  const url = new URL(request.url);
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  return fetch(WORKER + url.pathname + url.search, init);
};
