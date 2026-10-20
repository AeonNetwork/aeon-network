// Features built on top of chain + Blockscout data:
//   portfolio()  - official stock tokens held, copycats, other tokens, ETH
//   approvals()  - token approvals granted by an address, with live allowance
//   crosscheck() - the same object read from RPC and from Blockscout, field by field
//   status       - live probes of every upstream, with history
// Everything here is read-only; nothing is ever signed by the server.

import { NETWORKS, INDEXER } from '../config.js';
import * as chain from './chain.js';
import * as eco from './ecosystem.js';
import * as indexer from './indexer.js';
import { aiHealth } from './ai.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const units = (raw, decimals) => {
  try {
    return Number((BigInt(raw) * 1_000_000n) / 10n ** BigInt(decimals ?? 18)) / 1_000_000;
  } catch {
    return 0;
  }
};

// Scam tokens put phishing messages in their name ("assets frozen, verify at …").
// Never repeat those: drop links and long text, and say what it is instead.
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(xyz|com|io|net|org|app|site|top|fun|info|live|online|pro|link|claims?|gift|vip)\b|\bt\.me\b)/i;
const PHISHY = /(verify|frozen|freeze|kyc|claim|airdrop|reward|alert|suspend|restore|compliance|visit|urgent)/i;
function safeLabel(symbol, name) {
  const s = String(symbol ?? ''), n = String(name ?? '');
  if (LINKISH.test(s + ' ' + n) || (PHISHY.test(s + ' ' + n) && (s + n).length > 40)) return { symbol: '⚠ phishing', name: 'Scam token: its name tells holders to visit a website. Do not follow it.', phishing: true };
  return { symbol: s.slice(0, 16), name: n.length > 48 ? n.slice(0, 47) + '…' : n };
}

// ---------------- wallet check: stock holdings & copycats ----------------

export async function portfolio(net, addr) {
  if (!ADDR.test(addr)) throw bad('invalid address');
  const [balances, stocks, eth] = await Promise.all([
    eco.bs(net, `/addresses/${addr}/token-balances`, 30_000),
    net === 'mainnet' ? eco.stockTokens(net).then((r) => r.value).catch(() => []) : [],
    chain.rpc(net, 'eth_getBalance', [addr, 'latest']).then((h) => BigInt(h).toString()).catch(() => null),
  ]);
  const official = new Map(stocks.map((s) => [s.address.toLowerCase(), s]));
  const officialSymbols = new Set(stocks.map((s) => (s.symbol || '').toUpperCase()));
  const holdings = [];
  const copycats = [];
  const others = [];
  for (const b of balances.value || []) {
    const t = b.token;
    if (!t || !b.value || b.value === '0') continue;
    const decimals = Number(t.decimals ?? 18);
    const amount = units(b.value, decimals);
    const stock = official.get((t.address_hash || '').toLowerCase());
    if (stock) {
      holdings.push({ address: stock.address, symbol: stock.symbol, name: stock.name, icon: stock.icon, kind: stock.kind, price: stock.price, amount, valueUsd: stock.price != null ? amount * stock.price : null });
    } else if (t.type !== 'ERC-721' && t.type !== 'ERC-1155' && (officialSymbols.has((t.symbol || '').toUpperCase()) || /robinhood/i.test(t.name || ''))) {
      copycats.push({ address: t.address_hash, ...safeLabel(t.symbol, t.name), type: t.type, amount });
    } else {
      const price = t.exchange_rate != null ? Number(t.exchange_rate) : null;
      const label = safeLabel(t.symbol, t.name);
      others.push({ address: t.address_hash, ...label, type: t.type, amount: t.type === 'ERC-721' ? Number(b.value) : amount, price, valueUsd: price != null ? amount * price : null, scam: t.reputation === 'scam' || Boolean(label.phishing) });
    }
  }
  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  others.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return {
    address: addr,
    network: net,
    ethWei: eth,
    holdings,
    stocksValueUsd: holdings.reduce((s, h) => s + (h.valueUsd || 0), 0),
    copycats,
    others: others.slice(0, 40),
    othersCount: others.length,
    othersValueUsd: others.reduce((s, o) => s + (o.valueUsd || 0), 0),
    note: 'Token balances from Blockscout (first page of holdings); stock prices from the official token list.',
  };
}

// ---------------- portfolio: brokerage-style view of stock tokens ----------------
// Adds what a broker app shows on top of portfolio(): 24 h change, a 7-day sparkline per
// position, what the current positions were worth over the last 7 days, and recent
// stock-token transfers. Prices: CoinGecko hourly history; balances: Blockscout.

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const priceAt = (points, t) => {
  let v = null;
  for (const p of points) {
    if (p.t > t) break;
    v = p.v;
  }
  return v;
};
const downsample = (points, n) => (points.length <= n ? points : Array.from({ length: n }, (_, i) => points[Math.round((i * (points.length - 1)) / (n - 1))]));

export async function portfolioDetail(net, addr) {
  const base = await portfolio(net, addr);
  const now = Date.now();
  // One shared, cached market snapshot for all stock tokens (see eco.stockMarkets).
  const markets = await within(eco.stockMarkets(net), 12_000).then((r) => r.value || {}).catch(() => ({}));
  const top = base.holdings;
  const series = top.map((h) => {
    const pts = markets[h.address.toLowerCase()]?.points;
    return pts?.length > 1 ? pts : null;
  });
  let change24hUsd = 0, coveredUsd = 0;
  const holdings = base.holdings.map((h, i) => {
    const pts = series[i];
    const change24h = markets[h.address.toLowerCase()]?.change24h ?? null;
    if (change24h == null) return { ...h, change24h: null, spark: pts ? downsample(pts, 48).map((p) => p.v) : null };
    if (change24h != null && h.valueUsd) {
      change24hUsd += h.valueUsd - h.valueUsd / (1 + change24h);
      coveredUsd += h.valueUsd;
    }
    return { ...h, change24h, spark: pts ? downsample(pts, 48).map((p) => p.v) : null };
  });

  // What the current positions were worth over the last 7 days, hour by hour.
  const history = [];
  if (series.some(Boolean)) {
    const start = Math.ceil((now - 7 * 86_400_000) / 3_600_000) * 3_600_000;
    for (let t = start; t <= now; t += 3_600_000) {
      let v = 0, any = false;
      top.forEach((h, i) => {
        const p = series[i] && priceAt(series[i], t);
        if (p != null) (v += h.amount * p), (any = true);
      });
      if (any) history.push({ t, v });
    }
  }

  // Recent transfers of the five largest positions.
  const lower = addr.toLowerCase();
  const pages = await Promise.all(
    base.holdings.slice(0, 5).map((h) => eco.bs(net, `/addresses/${addr}/token-transfers?token=${h.address}`, 60_000).then((r) => ({ h, items: r.value.items || [] })).catch(() => ({ h, items: [] }))),
  );
  const activity = pages
    .flatMap(({ h, items }) =>
      items.map((x) => {
        const incoming = (x.to?.hash || '').toLowerCase() === lower;
        const other = incoming ? x.from : x.to;
        const amount = units(x.total?.value ?? '0', Number(x.total?.decimals ?? 18));
        return { t: Date.parse(x.timestamp), dir: incoming ? 'in' : 'out', symbol: h.symbol, token: h.address, amount, valueNowUsd: h.price != null ? amount * h.price : null, counterparty: other?.hash || null, counterpartyName: other?.name || null, counterpartyIsContract: Boolean(other?.is_contract), tx: x.transaction_hash, method: x.method || null };
      }),
    )
    .sort((a, b) => b.t - a.t)
    .slice(0, 30);

  return {
    ...base,
    holdings,
    change24hUsd: coveredUsd ? change24hUsd : null,
    change24hPct: coveredUsd ? change24hUsd / (coveredUsd - change24hUsd) : null,
    priceCoverage: base.stocksValueUsd ? coveredUsd / base.stocksValueUsd : 0,
    history,
    activity,
    note: 'Balances from Blockscout; current prices from the official token list; 24 h change and history from CoinGecko hourly prices. History values your current positions at past prices.',
  };
}

// A real, current example: the largest individual (non-contract) holder of the most-held stock token.
export async function portfolioExample(net) {
  if (net !== 'mainnet') throw Object.assign(new Error('Examples are available on mainnet'), { status: 404 });
  const stocks = (await eco.stockTokens(net)).value.filter((s) => s.holders).sort((a, b) => b.holders - a.holders);
  for (const s of stocks.slice(0, 4)) {
    const p = await eco.tokenProfile(net, s.address).then((r) => r.value ?? r).catch(() => null);
    const holder = p?.topHolders?.find((h) => !h.isContract);
    if (holder) return { address: holder.address, reason: `Largest individual holder of ${s.symbol}` };
  }
  throw Object.assign(new Error('No example available right now'), { status: 503 });
}

// ---------------- token approvals ----------------

const SEL_APPROVE = '0x095ea7b3';
const SEL_APPROVE_ALL = '0xa22cb465';
const MAX_UINT_HALF = 2n ** 255n;
const pad = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export async function approvals(net, owner) {
  if (!ADDR.test(owner)) throw bad('invalid address');
  // Scan the owner's outgoing transactions (newest first) for approval calls.
  const seen = new Map(); // token|spender -> approval
  let scanned = 0;
  let oldest = null;
  let params = '';
  for (let page = 0; page < 4; page++) {
    const { value } = await eco.bs(net, `/addresses/${owner}/transactions?filter=from${params}`, 60_000);
    for (const t of value.items || []) {
      scanned++;
      oldest = t.timestamp ? Date.parse(t.timestamp) : oldest;
      const raw = t.raw_input || '';
      const sel = raw.slice(0, 10).toLowerCase();
      if ((sel !== SEL_APPROVE && sel !== SEL_APPROVE_ALL) || !t.to?.hash || t.status === 'error') continue;
      const spender = '0x' + raw.slice(34, 74);
      if (!ADDR.test(spender)) continue;
      const key = `${t.to.hash.toLowerCase()}|${spender.toLowerCase()}`;
      if (seen.has(key)) continue; // newest wins
      seen.set(key, {
        kind: sel === SEL_APPROVE ? 'token' : 'nft',
        token: t.to.hash,
        tokenName: t.to.name || null,
        spender,
        tx: t.hash,
        time: t.timestamp ? Date.parse(t.timestamp) : null,
      });
    }
    const next = value.next_page_params;
    if (!next) break;
    params = '&' + new URLSearchParams(Object.entries(next).filter(([, v]) => v != null)).toString();
  }
  const list = [...seen.values()];

  // Current state from the chain: allowance(owner, spender) / isApprovedForAll(owner, operator).
  let live = false;
  if (list.length) {
    try {
      const calls = list.map((a) => ['eth_call', [{ to: a.token, data: (a.kind === 'token' ? '0xdd62ed3e' : '0xe985e9c5') + pad(owner) + pad(a.spender) }, 'latest']]);
      const res = await chain.rpcBatch(net, calls);
      res.forEach((r, i) => {
        if (r instanceof Error || !r || r === '0x') return;
        const v = BigInt(r);
        list[i].allowance = v.toString();
        list[i].unlimited = list[i].kind === 'nft' ? v === 1n : v >= MAX_UINT_HALF;
        list[i].active = v > 0n;
      });
      live = true;
    } catch {
      /* RPC unavailable: report what was granted, without current state */
    }
  }

  // Token metadata and spender labels (cached; limited to keep the API budget sane).
  await Promise.all(
    list.slice(0, 30).map(async (a) => {
      const [meta, sp] = await Promise.all([chain.tokenMeta(net, a.token).catch(() => null), eco.bs(net, `/addresses/${a.spender}`, 6 * 3600_000).catch(() => null)]);
      if (meta) Object.assign(a, { symbol: meta.symbol, decimals: meta.decimals });
      if (sp?.value) Object.assign(a, { spenderName: sp.value.name || null, spenderVerified: Boolean(sp.value.is_verified), spenderScam: Boolean(sp.value.is_scam), spenderIsContract: Boolean(sp.value.is_contract) });
    }),
  );
  for (const a of list) {
    a.risk = a.spenderScam ? 'high' : a.active && a.unlimited && !a.spenderVerified ? 'high' : a.active && (a.unlimited || !a.spenderVerified) ? 'medium' : 'low';
  }
  const rank = { high: 0, medium: 1, low: 2 };
  list.sort((x, y) => (y.active === true) - (x.active === true) || rank[x.risk] - rank[y.risk] || (y.time ?? 0) - (x.time ?? 0));
  return { owner, network: net, scanned, since: oldest, liveAllowances: live, approvals: list };
}

// ---------------- cross-check RPC vs Blockscout ----------------

const norm = (v) => (v == null ? null : typeof v === 'string' && v.startsWith('0x') ? v.toLowerCase() : String(v));

export async function crosscheck(net, kind, id) {
  let viaRpc, viaBs, fields;
  if (kind === 'tx') {
    if (!HASH.test(id)) throw bad('invalid transaction hash');
    viaRpc = () => chain.tx(net, id);
    viaBs = () => eco.txDetail(net, id);
    fields = [['status', 'Status'], ['block', 'Block'], ['from', 'From'], ['to', 'To'], ['valueWei', 'Value (wei)'], ['nonce', 'Nonce'], ['gasUsed', 'Gas used'], ['feeWei', 'Fee (wei)']];
  } else if (kind === 'block') {
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n < 0) throw bad('invalid block number');
    viaRpc = () => chain.block(net, n);
    viaBs = () => eco.blockDetail(net, n);
    fields = [['hash', 'Hash'], ['parentHash', 'Parent hash'], ['time', 'Timestamp'], ['gasUsed', 'Gas used'], ['baseFee', 'Base fee']];
  } else if (kind === 'address') {
    if (!ADDR.test(id)) throw bad('invalid address');
    viaRpc = () => chain.address(net, id);
    viaBs = () => eco.addressDetail(net, id);
    fields = [['balanceWei', 'ETH balance (wei)'], ['isContract', 'Is contract']];
  } else throw bad('unknown kind');

  const [r, b] = await Promise.allSettled([viaRpc(), viaBs()]);
  const rv = r.status === 'fulfilled' ? r.value : null;
  const bv = b.status === 'fulfilled' ? b.value : null;
  const rows = fields.map(([key, label]) => {
    const a = norm(rv?.[key]);
    const c = norm(bv?.[key]);
    return { field: label, rpc: a, blockscout: c, match: a != null && c != null ? a === c : null };
  });
  const compared = rows.filter((x) => x.match !== null);
  return {
    kind,
    id,
    rpc: rv ? 'ok' : r.reason?.message || 'unavailable',
    blockscout: bv ? 'ok' : b.reason?.message || 'unavailable',
    rows,
    matched: compared.filter((x) => x.match).length,
    compared: compared.length,
    note: kind === 'address' ? 'Balances can differ if the address transacted between the two reads.' : null,
    at: Date.now(),
  };
}

// ---------------- status monitor ----------------

const HISTORY = 60; // one probe per minute → last hour
const checks = {}; // name -> { history: [{t, ok, ms}], lastOk, lastError }
const startedAt = Date.now();

function record(name, ok, ms, error) {
  const c = (checks[name] ??= { history: [], lastOk: null, lastError: null });
  c.history.push({ t: Date.now(), ok, ms });
  if (c.history.length > HISTORY) c.history.shift();
  if (ok) c.lastOk = Date.now();
  else c.lastError = { at: Date.now(), message: error };
}

async function timed(name, fn) {
  const t0 = performance.now();
  try {
    await fn();
    record(name, true, Math.round(performance.now() - t0));
  } catch (err) {
    record(name, false, Math.round(performance.now() - t0), err.message);
  }
}

async function probe() {
  // Live probes: cheap real calls against each source.
  await Promise.all([
    ...Object.keys(NETWORKS).map((net) => timed(`rpc:${net}`, () => chain.rpc(net, 'eth_blockNumber'))),
    timed('blockscout:mainnet', () => eco.bs('mainnet', '/stats', 50_000)),
    timed('blockscout:testnet', () => eco.bs('testnet', '/stats', 50_000)),
  ]);
}

// DefiLlama responses are large, so probe it less often with its smallest useful endpoint.
const probeLlama = () => timed('defillama', async () => {
  const r = await fetch('https://api.llama.fi/v2/historicalChainTvl/Robinhood%20Chain', { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  await r.arrayBuffer();
});

export function startStatus() {
  probe();
  probeLlama();
  setInterval(probe, 60_000).unref();
  setInterval(probeLlama, 5 * 60_000).unref();
}

export function status() {
  const up = (name) => checks[name] || { history: [], lastOk: null, lastError: null };
  const summarize = (name, label, kind) => {
    const c = up(name);
    const last = c.history.at(-1);
    const okCount = c.history.filter((h) => h.ok).length;
    return { id: name, label, kind, ok: last?.ok ?? null, latencyMs: last?.ms ?? null, uptime: c.history.length ? okCount / c.history.length : null, lastOk: c.lastOk, lastError: c.lastError, history: c.history.map((h) => (h.ok ? 1 : 0)) };
  };
  // Sources we don't probe on a timer report their most recent real fetch.
  const passive = (name, label, kind) => {
    const u = eco.upstream[name];
    return { id: name, label, kind, ok: u ? u.ok : null, latencyMs: null, uptime: null, lastOk: u?.ok ? u.at : null, lastError: u && !u.ok ? { at: u.at, message: u.error } : null, history: [] };
  };
  return {
    now: Date.now(),
    server: { startedAt, uptimeSec: Math.round(process.uptime()), node: process.version },
    checks: [
      summarize('rpc:mainnet', 'Robinhood Chain RPC · mainnet', 'Live probe every minute'),
      summarize('rpc:testnet', 'Robinhood Chain RPC · testnet', 'Live probe every minute'),
      summarize('blockscout:mainnet', 'Blockscout API · mainnet (PRO)', 'Live probe every minute'),
      summarize('blockscout:testnet', 'Blockscout API · testnet explorer', 'Live probe every minute'),
      summarize('defillama', 'DefiLlama', 'Live probe every 5 minutes'),
      passive('coingecko', 'CoinGecko', 'Last real request'),
    ],
    rpcEndpoints: Object.fromEntries(Object.keys(NETWORKS).map((n) => [n, chain.health[n]])),
    indexer: Object.fromEntries(
      indexer.networks().map((n) => {
        const s = indexer.summary(n);
        const head = indexer.recent(n).blocks[0];
        return [n, { ...s, lastBlockTime: head?.time ?? null, lagSec: head?.time ? Math.max(0, (Date.now() - head.time) / 1000) : null, mode: INDEXER.mode }];
      }),
    ),
    ai: aiHealth(),
  };
}
