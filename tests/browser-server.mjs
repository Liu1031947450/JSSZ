import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve('dist');
let catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
let head = 'test-baseline';
let published = structuredClone(catalog);
let tree = new Map();
const blobs = new Map();
const trees = new Map([['test-base-tree', tree]]);
const commits = new Map([[head, { tree: 'test-base-tree', parents: [] }]]);
const calls = [];
let failure = 0;
let delayDeployment = false;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const bridge = `<script>const originalFetch = window.fetch.bind(window); window.fetch = (input, init) => { const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href); if (url.hostname === 'api.github.com') return originalFetch('/__github' + url.pathname + url.search, init); if (url.hostname.endsWith('.github.io') && url.pathname.endsWith('/catalog.json')) return originalFetch('/__published' + url.search, init); return originalFetch(input, init); }; window.__pageErrors = []; window.addEventListener('error', event => window.__pageErrors.push(event.message)); window.addEventListener('unhandledrejection', event => window.__pageErrors.push(String(event.reason)));</script>`;

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const reply = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  try {
    let body;
    if (request.method === 'POST' || request.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
    if (url.pathname === '/__test/state') return reply({ head, catalog, published, calls, delayDeployment });
    if (url.pathname === '/__test/control' && request.method === 'POST') {
      failure = body.failure || 0;
      delayDeployment = body.delayDeployment ?? delayDeployment;
      if (body.deploy) published = structuredClone(catalog);
      if (body.advanceHead) {
        const next = randomUUID(); commits.set(next, { ...commits.get(head), parents: [head] }); head = next;
      }
      return reply({ ok: true });
    }
    if (url.pathname === '/__published') return reply(published);
    if (url.pathname.startsWith('/__github')) {
      const path = url.pathname.slice('/__github'.length);
      calls.push({ path, method: request.method, ...(request.method === 'PATCH' ? { force: body.force } : {}) });
      if (failure) { const status = failure; failure = 0; return reply({ message: 'Test failure' }, status); }
      if (!request.headers.authorization?.startsWith('Bearer github_pat_test_only')) return reply({ message: 'Use only the documented fake test token' }, 401);
      if (path === '/user') return reply({ login: 'local-test-maker' });
      if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return reply({ permissions: { push: true } });
      if (path.includes('/git/ref/heads/')) return reply({ object: { sha: head } });
      if (path.includes('/contents/public/catalog.json')) return reply({ content: Buffer.from(JSON.stringify(catalog)).toString('base64'), encoding: 'base64', size: Buffer.byteLength(JSON.stringify(catalog)) });
      if (path.endsWith('/git/blobs')) { const sha = randomUUID(); blobs.set(sha, Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')); return reply({ sha }); }
      if (path.endsWith('/git/trees')) {
        const next = new Map(trees.get(body.base_tree));
        for (const entry of body.tree) if (entry.sha === null) next.delete(entry.path); else next.set(entry.path, entry.sha);
        const sha = randomUUID(); trees.set(sha, next); return reply({ sha });
      }
      if (path.endsWith('/git/commits')) { const sha = randomUUID(); commits.set(sha, body); return reply({ sha }); }
      if (path.includes('/git/commits/')) { const commit = commits.get(path.split('/').pop()); return reply({ tree: { sha: commit.tree } }); }
      if (path.includes('/git/refs/heads/') && request.method === 'PATCH') {
        const commit = commits.get(body.sha);
        if (body.force || commit.parents[0] !== head) return reply({ message: 'Not a fast forward' }, 422);
        head = body.sha; tree = trees.get(commit.tree);
        catalog = JSON.parse(blobs.get(tree.get('public/catalog.json')).toString('utf8'));
        if (!delayDeployment) published = structuredClone(catalog);
        return reply({ object: { sha: head } });
      }
      return reply({ message: `Unhandled fixture request ${path}` }, 404);
    }
    if (url.pathname === '/catalog.json') return reply(published);
    if (url.pathname.startsWith('/images/')) {
      const image = blobs.get(tree.get(`public${url.pathname}`));
      if (!image) return reply({}, 404);
      response.writeHead(200, { 'Content-Type': 'image/webp' }); response.end(image); return;
    }
    const filename = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!filename.startsWith(root + sep)) return reply({}, 403);
    let content = await readFile(filename);
    if (filename.endsWith('index.html')) content = Buffer.from(content.toString().replace('<head>', `<head>${bridge}`));
    response.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(content);
  } catch { reply({ message: 'Fixture request failed' }, 404); }
}).listen(4174, '127.0.0.1', () => console.log('Browser fixture: http://127.0.0.1:4174 — fake token only: github_pat_test_only_not_a_real_token'));
