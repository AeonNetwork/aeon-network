// New Token Radar: every token launched on Pons (Robinhood Chain's launchpad), read from the chain.
// Launches come from the Pons factory's launch event; each token's bonding curve is then read
// directly: ETH raised, graduation threshold, price, graduated or not. The creator of every launch
// is known, so wallets that launch token after token stand out. The most active tokens get an
// automatic safety scan. Uses the official RPC (wide eth_getLogs ranges) at a pace it accepts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';
import { postJSON } from '../lib/doh.js';
import { NETWORKS } from '../config.js';
import * as eco from './ecosystem.js';
import * as chain from './chain.js';

const NET = 'mainnet';
const FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607'; // (token, curve, creator)
const SEL = {
  realQuote: '0x4f1f58fd', // realQuoteReserve(): ETH actually raised
  quote: '0x9da771f4', // quoteReserve(): virtual + real ETH, for the price
  tokens: '0xcbcb3171', // tokenReserve()
  graduated: '0xe7c2b772',
  threshold: '0x8b0bc501', // graduationThreshold()
  launchedAt: '0xbf56b371',
  launchSupply: '0x3f7ed6b7',
  native: '0xdc08e094', // isNativeQuote(): paid in ETH, or in another token
  pair: '0x3de35b79', // pairToken()
  name: '0x06fdde03',
  symbol: '0x95d89b41',
};
const KEEP_MS = 48 * 3600_000;
const DAY = 86_400_000;
const FILE = path.join(CACHE_DIR, 'radar.json');

const launches = new Map(); // token -> launch
let lastBlock = 0;
let blockMs = 260; // refined from the chain at start
let headAt = { block: 0, t: 0 };
let sweep = 0;
let lastRun = null;
const grades = new Map(); // token -> { grade, score, at }

// ---------- the official RPC, paced (it allows ~15 calls/s in small batches) ----------
// Two lanes: single calls (logs, block numbers; also the Dev Checker's) never queue behind the
// radar's bulk curve reads, which take one batch every 1.5 s.
const lanes = { single: 0, bulk: 0 };
const pace = async (lane, ms) => {
  const now = Date.now(), at = Math.max(now, lanes[lane]);
  lanes[lane] = at + ms;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
};
let id = 0;
async function rpc(method, params, attempt = 0) {
  await pace('single', 150);
  try {
    const r = await postJSON(NETWORKS[NET].publicRpc, { jsonrpc: '2.0', id: ++id, method, params }, { timeout: 60_000 });
    if (r.error) throw new Error(r.error.message);
    return r.result;
  } catch (err) {
    if (attempt >= 3 || !/rate limited|timeout|ECONNRESET/i.test(err.message)) throw err;
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    return rpc(method, params, attempt + 1);
  }
}
// Many eth_calls, 20 per request, one request every 1.5 s. Returns results in order (null on failure).
async function calls(list) {
  const out = new Array(list.length).fill(null);
  for (let i = 0; i < list.length; i += 20) {
    const part = list.slice(i, i + 20);
    await pace('bulk', 1500);
    try {
      const res = await postJSON(NETWORKS[NET].publicRpc, part.map(([to, data], k) => ({ jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to, data }, 'latest'] })), { timeout: 30_000 });
      for (const r of Array.isArray(res) ? res : []) if (!r.error && r.result && r.result !== '0x') out[i + r.id] = r.result;
    } catch (err) {
      if (/rate limited/.test(err.message)) lanes.bulk = Date.now() + 30_000; // back off
    }
  }
  return out;
}
const big = (h) => (h ? BigInt(h) : null);
const eth = (h) => (h ? Number(BigInt(h)) / 1e18 : null);
const addr = (topic) => '0x' + topic.slice(26);
function str(h) {
  if (!h || h.length < 130) return '';
  try {
    const len = Number(BigInt('0x' + h.slice(66, 130)));
    return Buffer.from(h.slice(130, 130 + len * 2), 'hex').toString('utf8').replace(/[\u0000-\u001f]/g, '').slice(0, 40);
  } catch {
    return '';
  }
}

// ---------- persistence ----------
function load() {
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'));
    lastBlock = j.lastBlock || 0;
    if (j.headAt?.t) (headAt = j.headAt), (blockMs = j.blockMs || blockMs);
    for (const l of j.launches || []) launches.set(l.token, l);
    for (const [k, v] of j.grades || []) grades.set(k, v);
  } catch {}
}
function save() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ lastBlock, headAt, blockMs, launches: [...launches.values()], grades: [...grades] }));
  } catch (err) {
    console.error('[radar] save failed:', err.message);
  }
}

// ---------- the loop ----------
const timeOf = (l) => l.launchedAt ?? (headAt.t ? headAt.t - (headAt.block - l.block) * blockMs : null);

async function calibrate(head) {
  const back = 200_000;
  const [a, b] = await Promise.all([rpc('eth_getBlockByNumber', ['0x' + head.toString(16), false]), rpc('eth_getBlockByNumber', ['0x' + (head - back).toString(16), false])]);
  blockMs = ((Number(a.timestamp) - Number(b.timestamp)) * 1000) / back;
  headAt = { block: head, t: Number(a.timestamp) * 1000 };
}

async function newLaunches(head) {
  let from = lastBlock ? lastBlock + 1 : Math.max(0, head - Math.round(26 * 3600_000 / blockMs));
  while (from <= head) {
    const to = Math.min(head, from + 500_000);
    const logs = await rpc('eth_getLogs', [{ address: FACTORY, topics: [LAUNCH], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
    for (const l of logs) {
      const token = addr(l.topics[1]);
      if (!launches.has(token)) launches.set(token, { token, curve: addr(l.topics[2]), creator: addr(l.topics[3]), block: Number(l.blockNumber), tx: l.transactionHash });
    }
    lastBlock = to;
    from = to + 1;
  }
}

async function refresh() {
  const all = [...launches.values()];
  const byNew = [...all].sort((a, b) => b.block - a.block);
  const live = all.filter((l) => !l.graduated);
  const hot = [...live].sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0)).slice(0, 60);
  const fresh = byNew.filter((l) => !l.graduated).slice(0, 60);
  const full = new Map([...fresh, ...hot].map((l) => [l.token, l]));
  // Everything else in rotation, raised + graduated only.
  const rest = live.filter((l) => !full.has(l.token)).sort((a, b) => a.block - b.block);
  const slice = rest.slice(sweep, sweep + 300);
  sweep = sweep + 300 >= rest.length ? 0 : sweep + 300;

  const plan = [];
  for (const l of full.values()) plan.push([l, 'realQuote', l.curve], [l, 'quote', l.curve], [l, 'tokens', l.curve], [l, 'graduated', l.curve]);
  for (const l of slice) plan.push([l, 'realQuote', l.curve], [l, 'graduated', l.curve]);
  // Once per token, only for tokens that show up in a list: fixed facts and names.
  const shown = [...full.values(), ...byNew.slice(0, 100), ...all.filter((l) => (l.raised ?? 0) >= 0.2 || l.graduated)];
  for (const l of shown) {
    if (l.threshold == null) plan.push([l, 'threshold', l.curve], [l, 'launchedAt', l.curve], [l, 'launchSupply', l.curve]);
    if (l.native == null) plan.push([l, 'native', l.curve], [l, 'pair', l.curve]);
    if (l.symbol == null) plan.push([l, 'name', l.token], [l, 'symbol', l.token]);
  }
  const seen = new Set();
  const uniq = plan.filter(([l, k]) => !seen.has(l.token + k) && seen.add(l.token + k));
  const res = await calls(uniq.map(([, k, to]) => [to, SEL[k]]));
  const now = Date.now();
  uniq.forEach(([l, k], i) => {
    const r = res[i];
    if (r == null) return;
    if (k === 'realQuote') l.raised = eth(r);
    else if (k === 'quote') l.quoteRaw = big(r).toString();
    else if (k === 'tokens') l.tokensRaw = big(r).toString();
    else if (k === 'graduated') l.graduated = big(r) === 1n;
    else if (k === 'threshold') l.threshold = eth(r);
    else if (k === 'launchedAt') l.launchedAt = Number(big(r)) * 1000;
    else if (k === 'launchSupply') l.supply = eth(r);
    else if (k === 'native') l.native = big(r) === 1n;
    else if (k === 'pair') l.pair = addr(r);
    else if (k === 'name') l.name = str(r);
    else if (k === 'symbol') l.symbol = str(r);
    l.at = now;
  });
  // Curves paid in another token: learn that token's symbol and decimals once.
  for (const l of all.filter((x) => x.native === false && x.pair && x.quoteSymbol == null).slice(0, 20)) {
    const m = await chain.tokenMeta(NET, l.pair).catch(() => null);
    if (m) (l.quoteSymbol = m.symbol || 'tokens'), (l.quoteDecimals = m.decimals ?? 18);
  }
}

// The most active tokens get the full safety scan, one at a time.
let scanning = false;
async function scanSome() {
  if (scanning) return;
  scanning = true;
  try {
    const { scan } = await import('./scanner.js');
    const wanted = [...launches.values()].filter((l) => !l.graduated && (l.raised ?? 0) > 0).sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0)).slice(0, 15);
    for (const l of wanted) {
      const g = grades.get(l.token);
      if (g && Date.now() - g.at < 30 * 60_000) continue;
      try {
        const s = await scan(NET, l.token);
        grades.set(l.token, { grade: s.grade, score: s.score, flags: s.checks.filter((c) => c.level === 'fail').length, at: Date.now() });
      } catch {}
      await new Promise((r) => setTimeout(r, 15_000));
    }
  } finally {
    scanning = false;
  }
}

let running = false;
async function run() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    const head = Number(await rpc('eth_blockNumber', []));
    if (!headAt.t || head - headAt.block > 500_000) await calibrate(head);
    else headAt = { block: head, t: headAt.t + (head - headAt.block) * blockMs };
    await newLaunches(head);
    for (const [k, l] of launches) if (Date.now() - (timeOf(l) ?? Date.now()) > KEEP_MS) launches.delete(k);
    await refresh();
    lastRun = { at: Date.now(), took: Date.now() - t0, tokens: launches.size, ok: true };
    save();
    scanSome().catch(() => {});
  } catch (err) {
    lastRun = { at: Date.now(), took: Date.now() - t0, ok: false, error: err.message };
    console.error('[radar]', err.message);
  } finally {
    running = false;
  }
}

export function startRadar() {
  load();
  setTimeout(() => run(), 8_000).unref?.();
  setInterval(run, 60_000).unref();
}

// Curve state for one token, if it launched on Pons (used by the scanner).
export const curveOf = (token) => launches.get(String(token).toLowerCase()) || null;

// ---------- the API ----------
const TABS = {
  hot: (a, b) => (b.raised ?? 0) - (a.raised ?? 0),
  new: (a, b) => b.block - a.block,
  near: (a, b) => (b.progress ?? 0) - (a.progress ?? 0),
  graduated: (a, b) => b.block - a.block,
};
export async function radar({ tab = 'hot', limit = 50 } = {}) {
  if (!TABS[tab]) throw Object.assign(new Error('tab must be hot, new, near or graduated'), { status: 400 });
  const ethUsd = (await eco.ethPrice().catch(() => null))?.value?.usd ?? null;
  const now = Date.now();
  const all = [...launches.values()].map((l) => {
    const t = timeOf(l);
    const price = l.quoteRaw && l.tokensRaw && BigInt(l.tokensRaw) > 0n ? Number(BigInt(l.quoteRaw)) / Number(BigInt(l.tokensRaw)) : null; // ETH per token
    return { ...l, time: t, progress: l.threshold && l.raised != null ? Math.min(1, l.raised / l.threshold) : null, mcapEth: price != null && l.supply ? price * l.supply : null };
  });
  const day = all.filter((l) => l.time && now - l.time < DAY);
  const byCreator = new Map();
  for (const l of day) byCreator.set(l.creator, (byCreator.get(l.creator) || 0) + 1);
  const isEth = (l) => l.native !== false;
  const pick = { hot: (l) => isEth(l) && !l.graduated && (l.raised ?? 0) > 0, new: () => true, near: (l) => !l.graduated && (l.progress ?? 0) >= 0.25, graduated: (l) => l.graduated };
  const rows = day
    .filter(pick[tab])
    .sort(TABS[tab])
    .slice(0, Math.min(100, limit))
    .map((l) => ({
      token: l.token,
      name: l.name || null,
      symbol: l.symbol || null,
      curve: l.curve,
      creator: l.creator,
      creatorLaunches24h: byCreator.get(l.creator) || 1,
      time: l.time,
      exactTime: l.launchedAt != null,
      raisedEth: isEth(l) ? l.raised ?? null : null,
      thresholdEth: isEth(l) ? l.threshold ?? null : null,
      // Paid in another token: amounts in that token (the curve stores 18-decimal units).
      quote: isEth(l) ? null : { symbol: l.quoteSymbol || 'tokens', raised: l.raised != null ? l.raised * 10 ** (18 - (l.quoteDecimals ?? 18)) : null, threshold: l.threshold != null ? l.threshold * 10 ** (18 - (l.quoteDecimals ?? 18)) : null },
      progress: l.progress,
      graduated: Boolean(l.graduated),
      mcapEth: isEth(l) ? l.mcapEth : null,
      mcapUsd: isEth(l) && l.mcapEth != null && ethUsd ? l.mcapEth * ethUsd : null,
      tx: l.tx,
      scan: grades.get(l.token) || null,
    }));
  const hour = day.filter((l) => now - l.time < 3600_000);
  return {
    at: lastRun?.at ?? null,
    building: !lastRun?.ok && !launches.size,
    tab,
    ethUsd,
    stats: {
      launches24h: day.length,
      launches1h: hour.length,
      graduated24h: day.filter((l) => l.graduated).length,
      raisedEth24h: day.filter(isEth).reduce((s, l) => s + (l.raised || 0), 0),
      creators24h: byCreator.size,
      serialLaunchers: [...byCreator.values()].filter((n) => n >= 5).length,
      topSerial: [...byCreator].sort((a, b) => b[1] - a[1])[0] || null,
    },
    rows,
    source: 'Pons launch events and each token’s bonding curve, read from Robinhood Chain',
  };
}
export const radarStatus = () => lastRun;

// Shared with the Dev Checker: the factory, the curve selectors, the paced official-RPC client
// and the decoders, so both stay within the RPC's rate limit together.
export const PONS = { FACTORY, LAUNCH, SEL, FIRST_BLOCK: 26_840_000 };
export const radarLaunches = () => [...launches.values()];
export const radarBlockMs = () => blockMs;
export { rpc as ponsRpc, calls as ponsCalls, str as decodeString, eth as toEth };
