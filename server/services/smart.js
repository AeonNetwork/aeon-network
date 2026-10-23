// Smart Money: wallets that keep getting into Pons tokens early, before those tokens graduate.
// From the chain: the factory's graduation events (last ~10 days), each graduated token's launch
// (curve, creator, block), the first buys on its curve, then what the repeat early buyers are
// buying right now. Wallets that buy in the launch block itself are tagged as snipers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';
import * as eco from './ecosystem.js';
import * as chain from './chain.js';
import { PONS, ponsRpc, ponsCalls, decodeString, toEth, curveOf, radarLaunches, radarBlockMs } from './radar.js';

const GRADUATED = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259'; // factory: (token) graduated
const BUY = '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455'; // curve: (sender, recipient) ethIn, tokensOut, fees
const CURVE_GRADUATED = '0xa69e8258ccc7b9bbb70ab953fc2d1062b4ee28b8ca827534097e1732e87b0262'; // curve: logged once, when it graduates
const WINDOW = 9_000_000; // blocks, about 10 days
const EARLY = 25; // first buys that count as early
const FILE = path.join(CACHE_DIR, 'smart.json');
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO_WORD = '0x' + '0'.repeat(64);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const addr = (t) => '0x' + t.slice(26);
const hex = (n) => '0x' + n.toString(16);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let state = { at: 0, graduated: [], wallets: [], buyingNow: [], window: null };
let curves = {}; // token -> { curve, symbol, name, creator, launchedAt }, kept across builds
try {
  const j = JSON.parse(readFileSync(FILE, 'utf8'));
  ({ curves = {}, ...state } = { ...state, ...j });
} catch {}

async function build() {
  const head = Number(await ponsRpc('eth_blockNumber', []));
  const from = head - WINDOW;
  // 1. tokens that graduated in the window
  const grads = await ponsRpc('eth_getLogs', [{ address: PONS.FACTORY, topics: [GRADUATED], fromBlock: hex(from), toBlock: hex(head) }]);
  const tokens = [...new Map(grads.map((l) => [addr(l.topics[1]), { token: addr(l.topics[1]), gradBlock: Number(l.blockNumber) }])).values()];
  if (!tokens.length) return;
  // 2. each token's curve: the curve logs its own graduation event in the same transaction.
  //    (Topic lists on this RPC only span 100k blocks, so receipts are the reliable route.)
  for (const l of grads) {
    const t = tokens.find((x) => x.token === addr(l.topics[1]));
    if (!t || t.curve) continue;
    const known = curves[t.token];
    if (known) {
      Object.assign(t, known);
      continue;
    }
    const rc = await chain.rpc('mainnet', 'eth_getTransactionReceipt', [l.transactionHash]).catch(() => null);
    const c = rc?.logs.find((x) => x.topics[0] === CURVE_GRADUATED);
    if (c) t.curve = c.address.toLowerCase();
    else if (rc) {
      // Graduated from outside: the curve is whoever sent the token in that transaction and
      // answers token() with it.
      const senders = [...new Set(rc.logs.filter((x) => x.address.toLowerCase() === t.token && x.topics[0] === TRANSFER && x.topics[1] !== ZERO_WORD).map((x) => addr(x.topics[1])))];
      for (const s of senders) {
        const r = await chain.rpc('mainnet', 'eth_call', [{ to: s, data: '0xfc0c546a' }, 'latest']).catch(() => null);
        if (r && r !== '0x' && addr(r) === t.token) {
          t.curve = s;
          break;
        }
      }
    }
    await wait(120);
  }
  const list = tokens.filter((t) => t.curve);
  // 3. names, creators and launch times, in bulk
  const fresh = list.filter((t) => !curves[t.token]);
  const res = await ponsCalls(fresh.flatMap((t) => [[t.token, PONS.SEL.symbol], [t.token, PONS.SEL.name], [t.curve, '0xd5f39488'], [t.curve, PONS.SEL.launchedAt]]));
  fresh.forEach((t, i) => {
    t.symbol = decodeString(res[i * 4]) || null;
    t.name = decodeString(res[i * 4 + 1]) || null;
    t.creator = res[i * 4 + 2] ? addr(res[i * 4 + 2]) : null;
    t.launchedAt = res[i * 4 + 3] ? Number(BigInt(res[i * 4 + 3])) * 1000 : null;
    curves[t.token] = { curve: t.curve, symbol: t.symbol, name: t.name, creator: t.creator, launchedAt: t.launchedAt };
  });
  // 4. the first buys on each curve
  const wallets = new Map();
  for (const t of list) {
    const logs = await ponsRpc('eth_getLogs', [{ address: t.curve, topics: [BUY], fromBlock: hex(Math.max(PONS.FIRST_BLOCK, t.gradBlock - 9_999_999)), toBlock: hex(t.gradBlock) }]).catch(() => null);
    if (!logs) continue;
    const first = logs.length ? Number(logs[0].blockNumber) : 0;
    const seen = new Set();
    let rank = 0;
    for (const l of logs) {
      const buyer = addr(l.topics[2]);
      if (buyer === t.creator || buyer === ZERO || seen.has(buyer)) continue;
      seen.add(buyer);
      rank++;
      const w = wallets.get(buyer) || { address: buyer, hits: 0, sameBlock: 0, rankSum: 0, eth: 0, tokens: [] };
      w.hits++;
      w.rankSum += rank;
      w.eth += toEth('0x' + l.data.slice(2, 66)) || 0;
      if (Number(l.blockNumber) === first) w.sameBlock++; // bought in the very first trading block
      w.tokens.push({ token: t.token, symbol: t.symbol, rank });
      wallets.set(buyer, w);
      if (rank >= EARLY) break;
    }
  }
  const ranked = [...wallets.values()]
    .filter((w) => w.hits >= 2)
    .map((w) => ({ address: w.address, hits: w.hits, avgRank: w.rankSum / w.hits, earlyEth: w.eth, sniper: w.sameBlock >= Math.max(2, w.hits / 2), sameBlock: w.sameBlock, tokens: w.tokens.slice(-6).reverse() }))
    .sort((a, b) => b.hits - a.hits || a.avgRank - b.avgRank)
    .slice(0, 50);
  // 5. what the top wallets bought in the last ~6 hours (topic 2 = recipient, as a list)
  const top = ranked.slice(0, 40);
  // With no contract address, the RPC spans at most 30k blocks per query: eight windows, about four hours.
  const recent = [];
  if (top.length) for (let lo = head - 8 * 30_000 + 1; lo <= head; lo += 30_000) recent.push(...(await ponsRpc('eth_getLogs', [{ topics: [BUY, null, top.map((w) => word(w.address))], fromBlock: hex(lo), toBlock: hex(Math.min(head, lo + 29_999)) }]).catch(() => [])));
  const now = Date.now();
  const byCurve = new Map(radarLaunches().map((l) => [l.curve, l]));
  const buyingNow = [];
  for (const l of recent.slice(-200).reverse()) {
    const k = byCurve.get(l.address.toLowerCase());
    if (!k) continue; // only curves the radar knows: Pons launches of the last two days
    buyingNow.push({ wallet: addr(l.topics[2]), token: k.token, symbol: k.symbol, name: k.name, curve: l.address, block: Number(l.blockNumber), eth: toEth('0x' + l.data.slice(2, 66)) || 0, progress: k.threshold ? Math.min(1, (k.raised ?? 0) / k.threshold) : null, graduated: Boolean(k.graduated), tx: l.transactionHash });
    if (buyingNow.length >= 40) break;
  }
  // Names and curve progress for tokens the radar has not read in full yet.
  const missing = [...new Map(buyingNow.filter((b) => !b.symbol || b.progress == null).map((b) => [b.token, b])).values()].slice(0, 40);
  if (missing.length) {
    const r2 = await ponsCalls(missing.flatMap((b) => [[b.token, PONS.SEL.symbol], [b.token, PONS.SEL.name], [b.curve, PONS.SEL.realQuote], [b.curve, PONS.SEL.threshold], [b.curve, PONS.SEL.graduated]]));
    const info = new Map(missing.map((b, i) => [b.token, { symbol: decodeString(r2[i * 5]) || null, name: decodeString(r2[i * 5 + 1]) || null, raised: toEth(r2[i * 5 + 2]), threshold: toEth(r2[i * 5 + 3]), graduated: r2[i * 5 + 4] ? BigInt(r2[i * 5 + 4]) === 1n : false }]));
    for (const b of buyingNow) {
      const m = info.get(b.token);
      if (!m) continue;
      b.symbol ||= m.symbol;
      b.name ||= m.name;
      if (b.progress == null && m.threshold) b.progress = Math.min(1, (m.raised ?? 0) / m.threshold);
      b.graduated ||= m.graduated;
    }
  }
  // block -> time, from the radar's calibration
  const timeOf = (b) => now - (head - b) * radarBlockMs();
  for (const b of buyingNow) b.time = timeOf(b.block);
  state = { at: now, window: { blocks: WINDOW, from, head, graduated: list.length, total: tokens.length }, graduated: list.slice(-20).reverse().map(({ token, symbol, name, creator }) => ({ token, symbol, name, creator })), wallets: ranked, buyingNow };
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ ...state, curves }));
  } catch {}
}

let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    await build();
  } catch (err) {
    console.error('[smart]', err.message);
  } finally {
    running = false;
  }
}

export function startSmart() {
  const due = Date.now() - state.at > 20 * 60_000;
  setTimeout(() => due && run(), 90_000).unref?.();
  setInterval(run, 20 * 60_000).unref();
}

export async function smart() {
  const ethUsd = (await eco.ethPrice().catch(() => null))?.value?.usd ?? null;
  // Live progress for the tokens they are buying now.
  const buyingNow = state.buyingNow.map((b) => {
    const k = curveOf(b.token);
    return k ? { ...b, progress: k.threshold ? Math.min(1, (k.raised ?? 0) / k.threshold) : b.progress, graduated: Boolean(k.graduated) } : b;
  });
  // Tokens more than one smart wallet bought.
  const crowd = new Map();
  for (const b of buyingNow) {
    const c = crowd.get(b.token) || { token: b.token, symbol: b.symbol, name: b.name, wallets: new Set(), eth: 0, progress: b.progress, graduated: b.graduated };
    c.wallets.add(b.wallet);
    c.eth += b.eth;
    crowd.set(b.token, c);
  }
  return {
    at: state.at || null,
    building: !state.at,
    window: state.window,
    ethUsd,
    wallets: state.wallets,
    buyingNow,
    together: [...crowd.values()].filter((c) => c.wallets.size >= 2).map((c) => ({ ...c, wallets: c.wallets.size })).sort((a, b) => b.wallets - a.wallets || b.eth - a.eth).slice(0, 8),
    note: `Early = among the first ${EARLY} buyers on the bonding curve, not counting the creator. Graduated tokens from the last ~10 days of Pons graduation events. Snipers buy in the launch block itself. Past results say nothing about the next trade. Not financial advice.`,
  };
}

export const refreshSmart = run;
