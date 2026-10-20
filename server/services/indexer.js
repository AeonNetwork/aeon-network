// Network indexer: follows the head of each Robinhood Chain network over RPC
// and maintains rolling activity statistics shared by every visitor.
//
// Robinhood Chain produces ~10 blocks/second, so there are two modes:
//   sample (default) - read the newest block every few seconds. Rates (TPS,
//                      txs per minute) are estimated from the sampled blocks
//                      and the measured block time. Fits free RPC plans.
//   full             - read every block plus ERC-20 Transfer logs in batched
//                      calls. Exact counts; needs a paid RPC at this chain's speed.
// When the RPC is unreachable, the live feed falls back to Blockscout.

import fs from 'node:fs';
import path from 'node:path';
import { INDEXER, CACHE_DIR, NETWORKS, BLOCKSCOUT } from '../config.js';
import { broadcast } from '../lib/sse.js';
import { rpc, rpcBatch, hex, num, slimBlock, slimTx, health, TRANSFER_TOPIC, ARB_SYSTEM } from './chain.js';
import * as eco from './ecosystem.js';

const MINUTE = 60_000;
const HOUR = 3600_000;
const KEEP_MINUTES = 24 * 60;

function emptyState() {
  return {
    since: Date.now(),
    lastBlock: null,
    blocksIndexed: 0,
    gaps: 0,
    minutes: {}, // minuteTs -> bucket (counts over the blocks actually read)
    hours: {}, // hourTs -> { contracts: {addr: n}, tokens: {addr: n} }
    seen: {}, // address -> last seen ts
    tokens: {}, // token address -> { first, transfers }
    recentTxs: [],
    recentBlocks: [],
    deploys: [],
  };
}

const states = {};
const minuteSets = {};
const source = {}; // net -> 'rpc' | 'blockscout' | null
const file = (net) => path.join(CACHE_DIR, `indexer-${net}.json`);

function load(net) {
  try {
    const s = JSON.parse(fs.readFileSync(file(net), 'utf8'));
    if (Date.now() - (s.savedAt || 0) > 10 * MINUTE) s.lastBlock = null;
    if (s.mode !== INDEXER.mode) Object.assign(s, { minutes: {}, hours: {}, seen: {}, tokens: {}, since: Date.now(), blocksIndexed: 0, gaps: 0 });
    states[net] = { ...emptyState(), ...s };
  } catch {
    states[net] = emptyState();
  }
  states[net].mode = INDEXER.mode;
}

function save(net) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file(net) + '.tmp', JSON.stringify({ ...states[net], savedAt: Date.now() }));
    fs.renameSync(file(net) + '.tmp', file(net));
  } catch (err) {
    console.warn('[indexer] save failed:', err.message);
  }
}

function prune(net) {
  const s = states[net];
  const minCut = Date.now() - KEEP_MINUTES * MINUTE;
  for (const k of Object.keys(s.minutes)) if (+k < minCut) delete s.minutes[k];
  for (const k of Object.keys(minuteSets[net] || {})) if (+k < Date.now() - 2 * MINUTE) delete minuteSets[net][k];
  const hourCut = Date.now() - 25 * HOUR;
  for (const k of Object.keys(s.hours)) if (+k < hourCut) delete s.hours[k];
  const seenCut = Date.now() - 24 * HOUR;
  for (const [a, t] of Object.entries(s.seen)) if (t < seenCut) delete s.seen[a];
  if (Object.keys(s.seen).length > 300_000) s.seen = Object.fromEntries(Object.entries(s.seen).sort((a, b) => b[1] - a[1]).slice(0, 200_000));
  const toks = Object.entries(s.tokens);
  if (toks.length > 5000) s.tokens = Object.fromEntries(toks.sort((a, b) => b[1].transfers - a[1].transfers).slice(0, 4000));
}

function ingest(net, rawBlock, logs) {
  const s = states[net];
  const b = slimBlock(rawBlock);
  const minute = Math.floor(b.time / MINUTE) * MINUTE;
  const hour = Math.floor(b.time / HOUR) * HOUR;
  const m = (s.minutes[minute] ??= { blocks: 0, txs: 0, gas: 0, baseFeeSum: 0, active: 0, deploys: 0, transfers: 0 });
  const h = (s.hours[hour] ??= { contracts: {}, tokens: {} });
  const set = ((minuteSets[net] ??= {})[minute] ??= new Set());

  m.blocks += 1;
  m.gas += b.gasUsed;
  if (b.baseFee != null) m.baseFeeSum += b.baseFee;
  const userTxs = rawBlock.transactions.filter((t) => t.from.toLowerCase() !== ARB_SYSTEM);
  m.txs += userTxs.length;
  for (const t of userTxs) {
    const from = t.from.toLowerCase();
    set.add(from);
    s.seen[from] = b.time;
    if (t.to) {
      const to = t.to.toLowerCase();
      h.contracts[to] = (h.contracts[to] || 0) + 1;
    } else {
      m.deploys += 1;
      s.deploys.unshift({ hash: t.hash, deployer: t.from, block: b.number, time: b.time });
    }
  }
  m.active = set.size;
  for (const log of logs) {
    if (log.topics.length !== 3) continue;
    const token = log.address.toLowerCase();
    m.transfers += 1;
    h.tokens[token] = (h.tokens[token] || 0) + 1;
    (s.tokens[token] ??= { first: b.time, transfers: 0 }).transfers += 1;
  }

  const txs = userTxs.map((t) => slimTx(t, b.time));
  s.recentTxs = [...txs.reverse(), ...s.recentTxs].slice(0, 60);
  s.recentBlocks = [b, ...s.recentBlocks].slice(0, 40);
  s.deploys = s.deploys.slice(0, 30);
  s.lastBlock = b.number;
  s.blocksIndexed += 1;
  return { block: b, txs };
}

async function stepFull(net) {
  const s = states[net];
  const head = num(await rpc(net, 'eth_blockNumber'));
  if (s.lastBlock == null || head - s.lastBlock > INDEXER.maxLag) {
    if (s.lastBlock != null) s.gaps += head - s.lastBlock;
    s.lastBlock = head - 1;
  }
  if (head <= s.lastBlock) return [];
  const from = s.lastBlock + 1;
  const to = Math.min(head, from + INDEXER.batchSize - 1);
  const calls = [];
  for (let n = from; n <= to; n++) calls.push(['eth_getBlockByNumber', [hex(n), true]]);
  calls.push(['eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC] }]]);
  const res = await rpcBatch(net, calls);
  const logs = res.pop();
  const byBlock = {};
  if (Array.isArray(logs)) for (const l of logs) (byBlock[num(l.blockNumber)] ??= []).push(l);
  const fresh = [];
  for (const raw of res) {
    if (raw instanceof Error || !raw) break;
    fresh.push(ingest(net, raw, byBlock[num(raw.number)] || []));
  }
  return fresh;
}

async function stepSample(net) {
  const s = states[net];
  // One call: the newest block with its transactions.
  const raw = await rpc(net, 'eth_getBlockByNumber', ['latest', true]);
  if (!raw || num(raw.number) === s.lastBlock) return [];
  return [ingest(net, raw, [])];
}

function publish(net, fresh) {
  if (!fresh.length) return;
  for (const f of fresh.slice(-6)) broadcast('block', { network: net, block: f.block });
  const newTxs = fresh.flatMap((f) => f.txs).slice(-12);
  if (newTxs.length) broadcast('txs', { network: net, txs: newTxs });
}

// Blockscout fallback feed: keeps the live blocks/txs real when RPC is down.
async function feedFromBlockscout(net) {
  const s = states[net];
  const { blocks, txs } = await eco.latest(net);
  const lastSeen = s.recentBlocks[0]?.number ?? 0;
  const newBlocks = blocks.filter((b) => b.number > lastSeen).sort((a, b) => a.number - b.number);
  const known = new Set(s.recentTxs.map((t) => t.hash));
  const newTxs = txs.filter((t) => !known.has(t.hash));
  s.recentBlocks = [...newBlocks.slice().reverse(), ...s.recentBlocks].sort((a, b) => b.number - a.number).slice(0, 40);
  s.recentTxs = [...newTxs, ...s.recentTxs].slice(0, 60);
  for (const b of newBlocks.slice(-6)) broadcast('block', { network: net, block: b });
  if (newTxs.length) broadcast('txs', { network: net, txs: newTxs.slice(0, 12).reverse() });
}

export function startIndexer() {
  for (const net of INDEXER.networks) {
    load(net);
    let running = false;
    let backoff = 0;
    let lastFeed = 0;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        if (Date.now() >= backoff) {
          try {
            publish(net, INDEXER.mode === 'full' ? await stepFull(net) : await stepSample(net));
            source[net] = 'rpc';
            return;
          } catch {
            backoff = Date.now() + 15_000;
            broadcast('chain-health', { network: net, health: health[net] });
          }
        }
        // RPC unavailable: Blockscout keeps the feed live (if it covers this chain).
        if (eco.blockscoutAvailable(net) && Date.now() - lastFeed >= BLOCKSCOUT.feedIntervalMs) {
          lastFeed = Date.now();
          try {
            await feedFromBlockscout(net);
            source[net] = 'blockscout';
          } catch {
            source[net] = null;
          }
        }
      } finally {
        running = false;
      }
    }, INDEXER.intervalMs).unref();
    setInterval(() => broadcast('pulse', { network: net, ...summary(net) }), 5000).unref();
    setInterval(() => {
      prune(net);
      save(net);
    }, MINUTE).unref();
  }
}

export const indexing = (net) => Boolean(states[net]);

// ---------------- read API ----------------

// Block time measured from the block numbers/timestamps we have read.
function measuredBlockTime(net) {
  const r = states[net]?.recentBlocks || [];
  if (r.length < 2) return null;
  const dn = r[0].number - r.at(-1).number;
  const dt = (r[0].time - r.at(-1).time) / 1000;
  return dn > 0 && dt > 0 ? dt / dn : null;
}

function windowAgg(net, ms) {
  const s = states[net];
  const cut = Date.now() - ms;
  const agg = { blocks: 0, txs: 0, gas: 0, deploys: 0, transfers: 0 };
  for (const [k, m] of Object.entries(s.minutes)) {
    if (+k < cut) continue;
    agg.blocks += m.blocks;
    agg.txs += m.txs;
    agg.gas += m.gas;
    agg.deploys += m.deploys;
    agg.transfers += m.transfers;
  }
  return agg;
}

export function summary(net) {
  const s = states[net];
  if (!s) return null;
  const sample = s.mode === 'sample';
  const blockTime = measuredBlockTime(net);
  const coveredMs = Math.min(24 * HOUR, Date.now() - s.since);
  const lastMin = windowAgg(net, 2 * MINUTE);
  const hourAgg = windowAgg(net, HOUR);
  const dayAgg = windowAgg(net, 24 * HOUR);
  // In sample mode, scale the sampled average to the real block rate.
  const perBlock = (a) => (a.blocks ? a.txs / a.blocks : 0);
  // Without RPC samples, use the latest blocks from the Blockscout feed.
  const feed = s.recentBlocks.slice(0, 20);
  const feedPerBlock = feed.length ? feed.reduce((sum, b) => sum + b.txs, 0) / feed.length : null;
  const tps = !blockTime ? null : lastMin.blocks ? perBlock(lastMin) / blockTime : sample || source[net] === 'blockscout' ? (feedPerBlock != null ? feedPerBlock / blockTime : null) : lastMin.txs / 120;
  const estTxs = (a, ms) => (sample ? (blockTime ? Math.round(perBlock(a) * (Math.min(ms, coveredMs) / 1000 / blockTime)) : null) : a.txs);
  return {
    mode: s.mode,
    source: source[net] || null,
    lastBlock: s.recentBlocks[0]?.number ?? s.lastBlock,
    indexedSince: s.since,
    coverageHours: +(coveredMs / HOUR).toFixed(2),
    blocksIndexed: s.blocksIndexed,
    gaps: s.gaps,
    blockTime,
    tps,
    txsPerBlock: perBlock(lastMin) || feedPerBlock,
    hour: { txs: estTxs(hourAgg, HOUR), deploys: sample ? null : hourAgg.deploys, transfers: sample ? null : hourAgg.transfers, active: sample ? null : Object.values(s.seen).filter((t) => t > Date.now() - HOUR).length },
    day: { txs: estTxs(dayAgg, 24 * HOUR), deploys: sample ? null : dayAgg.deploys, active: sample ? null : Object.keys(s.seen).length },
  };
}

export function series(net, minutes = 60) {
  const s = states[net];
  if (!s) return [];
  const sample = s.mode === 'sample';
  const blockTime = measuredBlockTime(net);
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const out = [];
  for (let t = now - (minutes - 1) * MINUTE; t <= now; t += MINUTE) {
    const m = s.minutes[t];
    const txs = !m?.blocks ? 0 : sample ? (blockTime ? Math.round((m.txs / m.blocks) * (60 / blockTime)) : 0) : m.txs;
    out.push({ t, blocks: m?.blocks || 0, txs, estimated: sample, active: sample ? null : m?.active || 0, baseFee: m?.blocks ? m.baseFeeSum / m.blocks : null });
  }
  return out;
}

function topFrom(net, key, hours, limit) {
  const s = states[net];
  const cut = Date.now() - hours * HOUR;
  const counts = {};
  for (const [k, h] of Object.entries(s.hours)) {
    if (+k < cut - HOUR) continue;
    for (const [a, n] of Object.entries(h[key])) counts[a] = (counts[a] || 0) + n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([address, count]) => ({ address, count, share: count / total }));
}

export const topContracts = (net, hours = 24, limit = 15) => topFrom(net, 'contracts', hours, limit);
export const activeTokens = (net, hours = 24, limit = 50) => topFrom(net, 'tokens', hours, limit);
export const recent = (net) => ({ blocks: states[net]?.recentBlocks || [], txs: states[net]?.recentTxs || [], deploys: states[net]?.deploys || [], source: source[net] || null, mode: states[net]?.mode });
export const networks = () => Object.keys(NETWORKS).filter((n) => states[n]);
export const mode = () => INDEXER.mode;
