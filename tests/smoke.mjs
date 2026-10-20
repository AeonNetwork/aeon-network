// Smoke test: every public endpoint answers, security headers are set, abuse is refused.
//   npm test                         -> starts a server on a spare port, tests it, stops it
//   BASE=https://getaeon.network npm test  -> tests a running deployment instead
import { spawn } from 'node:child_process';

const TSLA = '0x322F0929c4625eD5bAd873c95208D54E1c003b2d';
const WETH = '0xA3284897ad7c8FED700b04f573Cf64E4f6c10f2c';

let base = process.env.BASE;
let server;
if (!base) {
  const port = 3999;
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
  const until = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    if (Date.now() > until) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
}

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: err.message });
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function get(path, { status = 200, json = true, headers } = {}) {
  const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(30_000) });
  assert(r.status === status, `HTTP ${r.status}, expected ${status}`);
  return { r, body: json ? await r.json() : await r.text() };
}
const rpc = (net, body) => fetch(`${base}/rpc/${net}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// ---- pages & assets ----
await check('home page + security headers', async () => {
  const { r, body } = await get('/', { json: false });
  assert(body.includes('<div id="view"') || body.includes('id="view"'), 'app shell missing');
  assert(r.headers.get('content-security-policy')?.includes("script-src 'self'"), 'CSP missing');
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
});
await check('static assets are compressed', async () => {
  const { r } = await get('/js/app.js', { json: false, headers: { 'accept-encoding': 'gzip, br' } });
  assert(/gzip|br/.test(r.headers.get('content-encoding') || ''), 'no content-encoding');
});
for (const p of ['/css/style.css', '/img/logo.svg', '/img/og.png', '/manifest.webmanifest']) await check(`asset ${p}`, () => get(p, { json: false }));
await check('robots.txt', async () => assert((await get('/robots.txt', { json: false })).body.includes('Sitemap:'), 'no sitemap line'));
await check('sitemap.xml', async () => assert((await get('/sitemap.xml', { json: false })).body.includes('<urlset'), 'not a sitemap'));

// ---- API ----
await check('config', async () => assert((await get('/api/config')).body, 'empty'));
await check('health', () => get('/api/health'));
await check('status', () => get('/api/status'));
for (const net of ['mainnet', 'testnet']) {
  await check(`${net} overview has a block`, async () => assert((await get(`/api/network/${net}/overview`)).body.block > 0, 'no block'));
  for (const p of ['recent', 'activity', 'contracts', 'stats', 'tx-history', 'top-tokens', 'block/latest']) await check(`${net} ${p}`, () => get(`/api/network/${net}/${p}`));
}
await check('mainnet stocks list', async () => assert((await get('/api/network/mainnet/stocks')).body.length > 10, 'too few stocks'));
await check('stock detail (TSLA)', () => get(`/api/network/mainnet/stocks/${TSLA}`));
await check('token profile (WETH)', () => get(`/api/network/mainnet/token/${WETH}/profile`));
await check('portfolio example + detail', async () => {
  const ex = (await get('/api/network/mainnet/portfolio-example')).body;
  const d = (await get(`/api/network/mainnet/portfolio/${ex.address}/detail`)).body;
  assert(d.holdings.length > 0 && d.stocksValueUsd > 0, 'empty portfolio');
  assert(Array.isArray(d.activity) && Array.isArray(d.history), 'missing activity/history');
});
await check('address lookup', () => get(`/api/network/mainnet/address/${WETH}`));
await check('search', () => get(`/api/network/mainnet/lookup?q=${WETH}`));
for (const p of ['summary', 'protocols', 'tvl', 'dex', 'fees', 'stablecoins']) await check(`ecosystem ${p}`, () => get(`/api/ecosystem/mainnet/${p}`));
await check('eth price', async () => assert((await get('/api/eth-price')).body, 'empty'));
await check('share page has OG tags', async () => assert((await get(`/s/token/mainnet/${TSLA}`, { json: false })).body.includes('og:title'), 'no og:title'));

// ---- refusals ----
await check('unknown API route -> 404', () => get('/api/nope', { status: 404 }));
await check('unknown network -> 400', () => get('/api/network/nope/overview', { status: 400 }));
await check('bad tx hash -> 400', () => get('/api/network/mainnet/tx/0x123', { status: 400 }));
await check('Aeon RPC answers', async () => assert(/^0x[0-9a-f]+$/.test((await rpc('mainnet', { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })).result), 'no block number'));
await check('Aeon RPC refuses unsafe methods', async () => assert((await rpc('mainnet', { jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [] })).error, 'method was allowed'));

server?.kill();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok ' : 'FAIL '} ${r.name.padEnd(42)} ${String(r.ms).padStart(5)} ms${r.ok ? '' : '  ' + r.err}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
