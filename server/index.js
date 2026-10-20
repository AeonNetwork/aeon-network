import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { installDoh } from './lib/dns.js';

import { PORT, NETWORKS, DEFAULT_NETWORK, AI, INDEXER, BLOCKSCOUT, COINGECKO } from './config.js';
import { loadFromDisk, saveToDisk } from './lib/cache.js';
import { ipLimiter, dailyCap } from './lib/limiter.js';
import { sseHandler, clientCount } from './lib/sse.js';
import * as chain from './services/chain.js';
import * as indexer from './services/indexer.js';
import * as eco from './services/ecosystem.js';
import { chat, tokenUniverse } from './services/ai.js';
import * as insights from './services/insights.js';

installDoh();
const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// One canonical host: www.getaeon.network -> getaeon.network.
app.use((req, res, next) => {
  const host = req.get('host') || '';
  if (host.startsWith('www.')) return res.redirect(301, `${req.protocol}://${host.slice(4)}${req.originalUrl}`);
  next();
});

// gzip/brotli for everything except the live event stream (it must flush immediately).
app.use(compression({ filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res) }));
app.use(express.json({ limit: '200kb' }));

// Security headers. No inline scripts anywhere in the app, so scripts are locked to this origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': CSP,
  });
  if (req.secure) res.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  next();
});

// Uniform JSON handler: unwraps cache results, adds freshness headers, maps errors.
const api = (fn, browserCacheSec = 10) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (res.headersSent) return;
    if (out && typeof out === 'object' && 'value' in out && 'at' in out && 'stale' in out) {
      res.set({ 'x-data-at': new Date(out.at).toISOString(), 'x-data-stale': String(out.stale), 'cache-control': `public, max-age=${browserCacheSec}` });
      return res.json(out.value);
    }
    res.set('cache-control', `public, max-age=${browserCacheSec}`);
    res.json(out);
  } catch (err) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message || 'upstream error' });
  }
};

const net = (req) => {
  if (!NETWORKS[req.params.net]) throw Object.assign(new Error('unknown network'), { status: 400 });
  return req.params.net;
};
const value = (p) => p.then((r) => r.value);
const settle = async (p) => {
  try {
    return await p;
  } catch {
    return null;
  }
};

const publicNetworks = Object.fromEntries(
  Object.entries(NETWORKS).map(([k, n]) => [k, { key: k, name: n.name, chainId: n.chainId, rpc: n.publicRpc, explorer: n.explorer, faucet: n.faucet || null, ecosystem: Boolean(n.llamaChain), currency: n.currency }]),
);

app.get('/api/config', (req, res) => res.json({ networks: publicNetworks, defaultNetwork: DEFAULT_NETWORK, indexed: INDEXER.networks, indexerMode: INDEXER.mode, ai: { enabled: AI.enabled, providers: AI.providers.map((p) => ({ name: p.label, model: p.model })) } }));

app.get('/api/health', (req, res) =>
  res.json({ uptime: process.uptime(), viewers: clientCount(), rpc: chain.health, upstream: eco.upstream, indexer: Object.fromEntries(indexer.networks().map((n) => [n, indexer.summary(n)])), keys: { alchemy: Boolean(process.env.ALCHEMY_API_KEY), coingecko: Boolean(COINGECKO.key), blockscout: BLOCKSCOUT.key ? (BLOCKSCOUT.pro ? 'pro' : 'explorer') : false, ai: AI.providers.map((p) => p.name) } }),
);

// ---------------- network ----------------
app.get(
  '/api/network/:net/overview',
  api(async (req) => {
    const n = net(req);
    const [bn, gas, price, stats] = await Promise.all([settle(value(chain.blockNumber(n))), settle(value(chain.gasPrice(n))), settle(value(eco.ethPrice())), eco.chainStats(n)]);
    return {
      network: n,
      chainId: NETWORKS[n].chainId,
      block: bn,
      gasPrice: gas,
      ethUsd: price?.usd ?? null,
      health: chain.health[n],
      indexer: indexer.summary(n),
      explorerStats: stats,
    };
  }, 3),
);
app.get('/api/network/:net/activity', api((req) => indexer.series(net(req), Math.min(1440, Math.max(10, Number(req.query.minutes) || 60))), 15));
app.get('/api/network/:net/recent', api((req) => indexer.recent(net(req)), 2));
app.get(
  '/api/network/:net/contracts',
  api(async (req) => {
    const n = net(req);
    const top = indexer.topContracts(n, 24, 15);
    return Promise.all(top.map(async (c) => ({ ...c, token: await chain.tokenMeta(n, c.address).catch(() => null) })));
  }, 30),
);
app.get('/api/network/:net/stats', api((req) => eco.explorerStats(net(req)), 30));
app.get('/api/network/:net/tx-history', api((req) => eco.txHistory(net(req)), 900));
app.get('/api/network/:net/top-tokens', api((req) => eco.topTokens(net(req)), 300));
app.get('/api/network/:net/stocks', api((req) => eco.stockTokens(net(req)), 300));
app.get(
  '/api/network/:net/stocks/:addr',
  api((req) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.addr)) throw Object.assign(new Error('invalid address'), { status: 400 });
    return eco.stockDetail(net(req), req.params.addr);
  }, 120),
);
app.get(
  '/api/network/:net/token/:addr/profile',
  api((req) => {
    if (!HEX40.test(req.params.addr)) throw Object.assign(new Error('invalid token address'), { status: 400 });
    return eco.tokenProfile(net(req), req.params.addr);
  }, 30),
);
app.get(
  '/api/network/:net/token/:addr/price',
  api((req) => {
    if (!HEX40.test(req.params.addr)) throw Object.assign(new Error('invalid token address'), { status: 400 });
    const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    return eco.tokenPriceHistory(net(req), req.params.addr, days);
  }, 300),
);
app.get('/api/network/:net/verify', api((req) => eco.verifyToken(net(req), String(req.query.q || '')), 300));
app.get(
  '/api/network/:net/tokens',
  api(async (req) => {
    const n = net(req);
    const top = indexer.activeTokens(n, 24, 60);
    const rows = await Promise.all(top.map(async (t) => ({ ...t, meta: await chain.tokenMeta(n, t.address).catch(() => null) })));
    return rows.filter((r) => r.meta);
  }, 30),
);
// Explorer details: RPC first; if the RPC is unreachable (502), Blockscout answers.
const rpcDown = (err) => err.status === 502;
async function withFallback(n, viaRpc, viaBlockscout) {
  try {
    return await viaRpc();
  } catch (err) {
    if (!rpcDown(err) || !eco.blockscoutAvailable(n)) throw err;
    return viaBlockscout();
  }
}
const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const HEX64 = /^0x[0-9a-fA-F]{64}$/;

app.get(
  '/api/network/:net/block/:id',
  api(async (req) => {
    const n = net(req);
    const id = req.params.id === 'latest' ? 'latest' : Number(req.params.id);
    if (id !== 'latest' && !Number.isSafeInteger(id)) throw Object.assign(new Error('invalid block number'), { status: 400 });
    return withFallback(n, () => chain.block(n, id), async () => eco.blockDetail(n, id === 'latest' ? (await eco.latest(n)).blocks[0].number : id));
  }, 5),
);
app.get(
  '/api/network/:net/tx/:hash',
  api((req) => {
    const n = net(req);
    if (!HEX64.test(req.params.hash)) throw Object.assign(new Error('invalid transaction hash'), { status: 400 });
    return withFallback(
      n,
      async () => {
        // RPC is the source of truth; Blockscout adds the decoded calldata and contract name.
        const [t, extra] = await Promise.all([chain.tx(n, req.params.hash), eco.txDetail(n, req.params.hash).catch(() => null)]);
        const method = /^0x[0-9a-f]{8}$/i.test(t.method) && extra?.decoded?.method ? extra.decoded.method : t.method;
        return { ...t, method, decoded: extra?.decoded ?? null, toName: extra?.toName ?? null, toVerified: extra?.toVerified ?? false, source: 'rpc' };
      },
      () => eco.txDetail(n, req.params.hash),
    );
  }, 5),
);
app.get(
  '/api/network/:net/address/:addr',
  api(async (req) => {
    const n = net(req);
    if (!HEX40.test(req.params.addr)) throw Object.assign(new Error('invalid address'), { status: 400 });
    return withFallback(
      n,
      async () => {
        const a = await chain.address(n, req.params.addr);
        const tokens = await tokenUniverse(n);
        const [balances, history] = await Promise.all([chain.tokenBalances(n, a.address, tokens).catch(() => []), eco.addressHistory(n, a.address)]);
        return { ...a, tokenBalances: balances, history, source: 'rpc', stock: await eco.officialStock(n, a.address) };
      },
      async () => {
        const [a, history] = await Promise.all([eco.addressDetail(n, req.params.addr), eco.addressHistory(n, req.params.addr)]);
        return { ...a, history, stock: await eco.officialStock(n, a.address) };
      },
    );
  }, 5),
);
app.get(
  '/api/network/:net/lookup',
  api(async (req) => {
    const n = net(req);
    const q = String(req.query.q || '').trim().slice(0, 80);
    return withFallback(
      n,
      () => chain.lookup(n, q),
      async () => {
        if (/^\d+$/.test(q)) return { type: 'block', id: Number(q) };
        if (HEX40.test(q)) return { type: 'address', id: q };
        if (HEX64.test(q)) return { type: 'tx', id: q };
        throw Object.assign(new Error('Enter a block number, transaction hash, or address'), { status: 400 });
      },
    );
  }, 0),
);

// ---------------- ecosystem (DefiLlama) ----------------
app.get('/api/ecosystem/:net/summary', api((req) => eco.chainSummary(net(req)), 300));
app.get('/api/ecosystem/:net/protocols', api((req) => eco.protocols(net(req)), 600));
app.get('/api/ecosystem/:net/tvl', api((req) => eco.tvlHistory(net(req)), 1800));
app.get('/api/ecosystem/:net/stablecoins', api((req) => eco.stablecoins(net(req)), 1800));
app.get('/api/ecosystem/:net/dex', api((req) => eco.dexVolume(net(req)), 600));
app.get('/api/ecosystem/:net/fees', api((req) => eco.fees(net(req)), 600));
app.get('/api/news', api(() => eco.news(), 300));
app.get('/api/eth-price', api(() => eco.ethPrice(), 30));

// ---------------- live stream ----------------
app.get(
  '/api/stream',
  sseHandler((send) => {
    for (const n of indexer.networks()) {
      const r = indexer.recent(n);
      if (r.blocks[0]) send('block', { network: n, block: r.blocks[0] });
      send('pulse', { network: n, ...indexer.summary(n) });
    }
  }),
);

// ---------------- insights ----------------
app.get('/api/status', (req, res) => res.set('cache-control', 'no-store').json(insights.status()));
app.get('/api/network/:net/portfolio/:addr', api((req) => insights.portfolio(net(req), req.params.addr), 20));
app.get('/api/network/:net/portfolio/:addr/detail', api((req) => insights.portfolioDetail(net(req), req.params.addr), 30));
app.get('/api/network/:net/portfolio-example', api((req) => insights.portfolioExample(net(req)), 300));
app.get('/api/network/:net/approvals/:addr', api((req) => insights.approvals(net(req), req.params.addr), 20));
app.get('/api/network/:net/crosscheck/:kind/:id', api((req) => insights.crosscheck(net(req), req.params.kind, req.params.id), 0));

// ---------------- share pages (link previews) ----------------
// Crawlers ignore #routes, so /s/... renders Open Graph tags, then sends people to the app.
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortHex = (h) => (h ? h.slice(0, 8) + '…' + h.slice(-4) : '');
const ethStr = (wei) => (wei == null ? '?' : (Number(BigInt(wei) / 10n ** 12n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 }));
app.get('/s/:kind/:net/:id', async (req, res) => {
  const { kind, id } = req.params;
  const n = NETWORKS[req.params.net] ? req.params.net : 'mainnet';
  const chainName = NETWORKS[n].name;
  let title = `${chainName} · Aeon Network`;
  let desc = 'The live hub for Robinhood Chain.';
  let target = '/#/';
  try {
    if (kind === 'tx' && HEX64.test(id)) {
      target = `/#/explorer/tx/${id}`;
      const t = await withFallback(
        n,
        async () => {
          const [r, extra] = await Promise.all([chain.tx(n, id), eco.txDetail(n, id).catch(() => null)]);
          return { ...r, method: /^0x[0-9a-f]{8}$/i.test(r.method) && extra?.decoded?.method ? extra.decoded.method : r.method };
        },
        () => eco.txDetail(n, id),
      );
      title = `Transaction ${shortHex(id)} · ${chainName}`;
      desc = `${t.status === 'success' ? '✓ Success' : t.status === 'failed' ? '✕ Failed' : 'Pending'} · ${t.method} · ${ethStr(t.valueWei)} ETH · from ${shortHex(t.from)}${t.to ? ' to ' + shortHex(t.to) : ''}${t.transfers?.length ? ` · ${t.transfers.length} token transfer(s)` : ''} · block #${t.block?.toLocaleString('en-US') ?? 'pending'}`;
    } else if (kind === 'address' && HEX40.test(id)) {
      target = `/#/explorer/address/${id}`;
      const a = await withFallback(n, () => chain.address(n, id), () => eco.addressDetail(n, id));
      title = `${a.token ? a.token.name + ' (' + a.token.symbol + ')' : a.isContract ? 'Contract' : 'Wallet'} ${shortHex(id)} · ${chainName}`;
      desc = `${a.balanceWei != null ? ethStr(a.balanceWei) + ' ETH · ' : ''}${a.isContract ? 'Smart contract' : 'Wallet'} on ${chainName}. View balances, tokens and history on Aeon Network.`;
    } else if (kind === 'block' && /^\d+$/.test(id)) {
      target = `/#/explorer/block/${id}`;
      const b = await withFallback(n, () => chain.block(n, Number(id)), () => eco.blockDetail(n, Number(id)));
      title = `Block #${Number(id).toLocaleString('en-US')} · ${chainName}`;
      desc = `${b.txs} transactions · ${new Date(b.time).toUTCString()}`;
    } else if (kind === 'token' && HEX40.test(id)) {
      target = `/#/token/${id}`;
      const t = await eco.tokenProfile(n, id);
      title = `${t.symbol} · ${t.name} · token on ${chainName}`;
      const verdict = t.official ? '✓ Official Robinhood stock token · ' : t.looksLikeStock ? '⚠ Not an official Robinhood token · ' : '';
      const price = t.price != null ? `$${t.price} · ` : '';
      desc = `${verdict}${price}${(t.holders ?? 0).toLocaleString('en-US')} holders · ${(t.transfers ?? 0).toLocaleString('en-US')} transfers`;
    } else if (kind === 'stock' && HEX40.test(id)) {
      target = '/#/stocks';
      const s = await eco.stockDetail(n, id);
      title = `${s.symbol} · ${s.name} · Robinhood stock token`;
      desc = `${s.official ? '✓ Official ERC-8056 token' : '⚠ Not an official Robinhood token'} · $${s.price ?? '?'} · ${(s.holders ?? 0).toLocaleString('en-US')} holders on ${chainName}`;
    }
  } catch {
    /* fall back to the generic card */
  }
  const url = `${req.protocol}://${req.get('host')}`;
  res.set('cache-control', 'public, max-age=60').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}">
<link rel="icon" href="/img/logo.svg" type="image/svg+xml"><meta property="og:site_name" content="Aeon Network"><meta property="og:type" content="website">
<meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url + req.originalUrl)}"><meta property="og:image" content="${escHtml(url)}/img/og.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@getaeon_network"><meta name="twitter:title" content="${escHtml(title)}"><meta name="twitter:description" content="${escHtml(desc)}"><meta name="twitter:image" content="${escHtml(url)}/img/og.png">
<meta http-equiv="refresh" content="0;url=${escHtml(target)}"></head>
<body style="background:#000;color:#fff;font-family:sans-serif"><p>${escHtml(title)}</p><p>${escHtml(desc)}</p><a href="${escHtml(target)}" style="color:#fff">Open on Aeon Network</a>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`);
});

// ---------------- icon proxy ----------------
// Token logos come from CDNs that are DNS-blocked in some countries; serve them from here.
const ICON_HOSTS = new Set(['cdn.robinhood.com', 'assets.coingecko.com', 'coin-images.coingecko.com', 'icons.llamao.fi', 'icons.llama.fi']);
const icons = new Map();
app.get('/api/icon', async (req, res) => {
  let url;
  try {
    url = new URL(String(req.query.u || ''));
  } catch {
    return res.status(400).end();
  }
  if (url.protocol !== 'https:' || !ICON_HOSTS.has(url.hostname)) return res.status(400).end();
  let hit = icons.get(url.href);
  if (!hit) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const type = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !type.startsWith('image/') || buf.length > 512 * 1024) return res.status(404).end();
      hit = { type, buf };
      if (icons.size > 800) icons.delete(icons.keys().next().value);
      icons.set(url.href, hit);
    } catch {
      return res.status(502).end();
    }
  }
  res.set({ 'content-type': hit.type, 'cache-control': 'public, max-age=86400' }).send(hit.buf);
});

// ---------------- public RPC proxy ("Aeon RPC") ----------------
// Lets wallets reach Robinhood Chain where the official RPC domain is blocked.
const RPC_METHODS = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_sendRawTransaction', 'eth_getLogs', 'eth_getStorageAt', 'web3_clientVersion', 'eth_syncing']);
app.options('/rpc/:net', (req, res) => res.set({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }).status(204).end());
app.post('/rpc/:net', ipLimiter({ max: 600, windowMs: 5 * 60_000 }), async (req, res) => {
  res.set('access-control-allow-origin', '*');
  if (!NETWORKS[req.params.net]) return res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'unknown network' } });
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (!calls.length || calls.length > 20) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch must have 1-20 calls' } });
  const bad = calls.find((c) => !c || typeof c.method !== 'string' || !RPC_METHODS.has(c.method));
  if (bad) return res.json({ jsonrpc: '2.0', id: bad?.id ?? null, error: { code: -32601, message: `method not allowed: ${bad?.method}` } });
  try {
    res.json(await chain.forward(req.params.net, req.body));
  } catch (err) {
    res.status(502).json({ jsonrpc: '2.0', id: Array.isArray(req.body) ? null : req.body.id ?? null, error: { code: -32603, message: err.message } });
  }
});

// ---------------- AI ----------------
// Per-visitor limit plus a global daily ceiling, so free AI quotas cannot be drained.
app.post('/api/ai/chat', dailyCap(AI.dailyLimit, 'The AI has reached its daily limit. It resets at 00:00 UTC.'), ipLimiter({ max: AI.maxRequests, windowMs: AI.windowMs }), chat);

// ---------------- crawlers ----------------
const origin = (req) => `${req.protocol}://${req.get('host')}`;
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /rpc/

Sitemap: ${origin(req)}/sitemap.xml
`));
app.get('/sitemap.xml', (req, res) => {
  const pages = ['/'];
  res.type('application/xml').set('cache-control', 'public, max-age=3600').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((p) => `<url><loc>${escHtml(origin(req) + p)}</loc></url>`).join('')}</urlset>
`,
  );
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// maxAge 0: browsers revalidate via ETag, so updates show up immediately.
// ---------------- live snapshot in the HTML ----------------
// The app renders with JavaScript, so crawlers and checkers that do not run JS would
// see an empty page. The shell therefore ships a snapshot of real chain data, which
// the app replaces on load. Rebuilt at most every 15 s.
const INDEX_HTML = readFileSync(path.join(here, '..', 'public', 'index.html'), 'utf8');
const unwrap = (x) => (x && typeof x === 'object' && 'value' in x && 'at' in x ? x.value : x);
const num = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
let snapshot = { at: 0, html: '' };
async function snapshotHtml() {
  if (Date.now() - snapshot.at < 15_000) return snapshot.html;
  const n = 'mainnet';
  const ex = NETWORKS[n].explorer;
  const [bn, gas, price, stats, summary, stocks] = await Promise.all([
    settle(value(chain.blockNumber(n))),
    settle(value(chain.gasPrice(n))),
    settle(value(eco.ethPrice())),
    settle(eco.chainStats(n)),
    settle(eco.chainSummary(n)),
    settle(eco.stockTokens(n)),
  ]).then((r) => r.map(unwrap));
  const ix = indexer.summary(n);
  const transfer = gas && price?.usd ? (gas * 21_000 * price.usd) / 1e18 : null;
  const rows = [
    ['Latest block', bn ? `<a href="${escHtml(ex)}/block/${bn}">#${num(bn)}</a>` : '—'],
    ['Block time', stats?.averageBlockTimeMs ? `${num(stats.averageBlockTimeMs)} ms` : ix?.blockTime ? `${num(ix.blockTime * 1000)} ms` : '—'],
    ['Transactions per second', stats?.transactionsToday ? `${num(stats.transactionsToday / 86_400, 1)} (24 h average, Blockscout)` : ix?.tps ? `${num(ix.tps, 1)} (estimated from sampled blocks)` : '—'],
    ['Gas price', gas ? `${num(gas / 1e9, 4)} gwei` : '—'],
    ['ETH transfer cost', transfer != null ? `$${transfer.toFixed(4)}` : '—'],
    ['Transactions, last day', num(stats?.transactionsToday)],
    ['Total transactions', num(stats?.totalTransactions)],
    ['Total addresses', num(stats?.totalAddresses)],
    ['Total value locked', summary?.tvl ? `$${num(summary.tvl)}${summary.rank ? ` (#${summary.rank} of ${summary.chains} chains, DefiLlama)` : ''}` : '—'],
  ];
  const top = (Array.isArray(stocks) ? stocks : []).filter((s) => s.holders).sort((a, b) => b.holders - a.holders).slice(0, 5);
  const html = `
  <section class="box prerender" aria-label="Live snapshot of Robinhood Chain">
    <div class="box-head">Robinhood Chain mainnet · live snapshot · ${escHtml(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC</div>
    <div class="box-body">
      <h1>The live hub for Robinhood Chain</h1>
      <p>Aeon Network reads Robinhood Chain (chain ID ${NETWORKS[n].chainId}) directly: every block, transaction, tokenized stock and protocol, as it happens. Every figure below is real and links to its source.</p>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      ${top.length ? `<h2>Most-held tokenized stocks</h2><ol>${top.map((s) => `<li><a href="${escHtml(ex)}/token/${escHtml(s.address)}">${escHtml(s.symbol)}</a> · ${escHtml(s.name)} · ${num(s.holders)} holders${s.price ? ` · $${num(s.price, 2)}` : ''}</li>`).join('')}</ol>` : ''}
      <p>Sources: Robinhood Chain RPC, <a href="${escHtml(ex)}">Blockscout</a>, DefiLlama, CoinGecko. Live view, explorer, stock-token verification and network AI load with JavaScript.</p>
    </div>
  </section>`;
  snapshot = { at: Date.now(), html };
  return html;
}
const sendShell = async (req, res) => {
  const html = await snapshotHtml().catch(() => '');
  res.set('cache-control', 'no-cache').type('html').send(INDEX_HTML.replace('<main id="view" tabindex="-1"></main>', () => `<main id="view" tabindex="-1">${html}</main>`));
};
app.get(['/', '/index.html'], sendShell);

// "no-cache" = keep a copy but revalidate (ETag -> 304) on every load. A plain max-age=0 lets
// Cloudflare's Browser Cache TTL rewrite it to hours, which would hide updates from visitors.
app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'], setHeaders: (res) => res.set('cache-control', 'no-cache') }));
app.get('/{*splat}', sendShell);

// Last-resort error handler: never leak stack traces to visitors.
app.use((err, req, res, next) => {
  console.error('[http]', req.method, req.originalUrl, err.message);
  if (res.headersSent) return next(err);
  res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: err.status === 400 ? 'bad request' : 'internal error' });
});
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message || err));
process.on('uncaughtException', (err) => {
  // State may be corrupt: persist the cache and exit; the process manager restarts us.
  console.error('[uncaughtException]', err);
  saveToDisk();
  process.exit(1);
});

loadFromDisk();
setInterval(saveToDisk, 60_000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (saveToDisk(), process.exit(0)));

indexer.startIndexer();
insights.startStatus();
// Warm ecosystem data in the background, staggered.
setTimeout(() => eco.chainSummary('mainnet').catch(() => {}), 2000);
setTimeout(() => eco.protocols('mainnet').catch(() => {}), 4000);
setTimeout(() => eco.ethPrice().catch(() => {}), 6000);

app.listen(PORT, (err) => {
  if (err) {
    console.error(`\n  Cannot start on port ${PORT}: ${err.code === 'EADDRINUSE' ? 'port already in use (another instance running?)' : err.message}\n`);
    process.exit(1);
  }
  console.log(`\n  Aeon Network running → http://localhost:${PORT}`);
  console.log(`  Indexer: ${INDEXER.networks.join(', ') || 'off'} (${INDEXER.mode} mode) · Blockscout: ${BLOCKSCOUT.key ? (BLOCKSCOUT.pro ? 'PRO API' : 'explorer API') : 'public'}`);
  console.log(`  AI: ${AI.providers.map((p) => `${p.label} (${p.model})`).join(' → ') || 'off'}\n`);
});
