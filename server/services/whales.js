// Whale tracker: large buys and sells of the official stock tokens on Robinhood Chain.
//
// Every 90 s the scanner reads the latest page of transfers for the most-traded stock
// tokens (Blockscout, paced with the rest of the app). A swap is often split across a
// router, a pool and the wallet, so transfers are grouped per transaction and token, and
// each wallet's NET flow is computed: a wallet that ends up with more shares BOUGHT, one
// that ends up with fewer SOLD. Only externally owned wallets count as traders.
// Everything worth >= $1,000 is kept for 7 days (and survives restarts); the page filters.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';
import * as eco from './ecosystem.js';

const NET = 'mainnet';
const KEEP_USD = 1_000;
const KEEP_MS = 7 * 86_400_000;
const TOKENS_PER_SCAN = 24;
const FILE = path.join(CACHE_DIR, 'whales.json');
const ZERO = '0x0000000000000000000000000000000000000000';

let items = []; // newest first
let lastScan = null;
let scanning = false;
const seen = new Set();

try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  items = (saved.items || []).filter((w) => Date.now() - w.t < KEEP_MS);
  items.forEach((w) => seen.add(w.id));
  lastScan = saved.lastScan || null;
} catch {}

const units = (raw, decimals) => {
  try {
    return Number((BigInt(raw) * 1_000_000n) / 10n ** BigInt(decimals ?? 18)) / 1_000_000;
  } catch {
    return 0;
  }
};

function save() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ lastScan, items }));
  } catch {}
}

// Turn one page of a token's transfers into buys/sells by net wallet flow.
function detect(stock, transfers) {
  const byTx = new Map();
  for (const x of transfers) {
    if (!x.transaction_hash) continue;
    if (!byTx.has(x.transaction_hash)) byTx.set(x.transaction_hash, []);
    byTx.get(x.transaction_hash).push(x);
  }
  const out = [];
  for (const [tx, list] of byTx) {
    const net = new Map(); // wallet -> { amount, name }
    const venues = new Set();
    let minted = false, burned = false, viaContract = false;
    for (const x of list) {
      const amt = units(x.total?.value ?? '0', Number(x.total?.decimals ?? stock.decimals ?? 18));
      const from = x.from?.hash, to = x.to?.hash;
      if (from === ZERO) minted = true;
      if (to === ZERO) burned = true;
      for (const [side, addr, sign] of [[x.from, from, -1], [x.to, to, 1]]) {
        if (!addr || addr === ZERO) continue;
        if (side?.is_contract) {
          viaContract = true;
          if (side.name) venues.add(side.name);
          continue;
        }
        const cur = net.get(addr) || { amount: 0 };
        cur.amount += sign * amt;
        net.set(addr, cur);
      }
    }
    // The trader is the wallet with the largest net change in this transaction.
    let best = null;
    for (const [addr, v] of net) if (!best || Math.abs(v.amount) > Math.abs(best.amount)) best = { address: addr, amount: v.amount };
    if (!best || Math.abs(best.amount) < 1e-9) continue;
    const usd = Math.abs(best.amount) * (stock.price || 0);
    if (usd < KEEP_USD) continue;
    const first = list[0];
    // Wallet to wallet, no contract in between: a plain transfer, not a trade.
    const plain = !viaContract && !minted && !burned;
    const sender = plain ? [...net].find(([, v]) => v.amount < 0)?.[0] : null;
    if (plain && best.amount < 0) {
      const recv = [...net].find(([, v]) => v.amount > 0);
      if (recv) best = { address: recv[0], amount: recv[1].amount };
    }
    out.push({
      id: `${tx}:${stock.address.toLowerCase()}`,
      t: Date.parse(first.timestamp),
      side: plain ? 'transfer' : minted && best.amount > 0 ? 'mint' : burned && best.amount < 0 ? 'redeem' : best.amount > 0 ? 'buy' : 'sell',
      from: sender || null,
      symbol: stock.symbol,
      name: stock.name,
      token: stock.address,
      shares: Math.abs(best.amount),
      price: stock.price,
      usd,
      wallet: best.address,
      venue: [...venues].find((v) => /pool|router|swap|exchange|dex|uniswap/i.test(v)) || null,
      tx,
      block: first.block_number ?? null,
    });
  }
  return out;
}

export async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const stocks = (await eco.stockTokens(NET)).value
      .filter((s) => s.price && s.volume24h)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, TOKENS_PER_SCAN);
    let added = 0;
    for (const s of stocks) {
      try {
        const r = await eco.bs(NET, `/tokens/${s.address}/transfers`, 60_000);
        for (const w of detect(s, r.value.items || [])) {
          if (seen.has(w.id)) continue;
          seen.add(w.id);
          items.push(w);
          added++;
        }
      } catch {
        /* one token failing never stops the scan */
      }
    }
    const cutoff = Date.now() - KEEP_MS;
    items = items.filter((w) => w.t >= cutoff).sort((a, b) => b.t - a.t).slice(0, 5000);
    lastScan = { at: Date.now(), tokens: stocks.length, added };
    save();
  } finally {
    scanning = false;
  }
}

export function startWhales() {
  setTimeout(() => scan().catch(() => {}), 8_000).unref?.();
  setInterval(() => scan().catch(() => {}), 90_000).unref();
}

// Filtered feed plus a 24 h summary and the biggest wallets.
export function whales({ min = 10_000, symbol = null, side = null, limit = 100 } = {}) {
  const sym = symbol ? String(symbol).toUpperCase() : null;
  const pick = (w) => w.usd >= min && (!sym || w.symbol === sym) && (!side || w.side === side);
  const feed = items.filter(pick);
  const day = feed.filter((w) => Date.now() - w.t < 86_400_000);
  const sum = (arr, s) => arr.filter((w) => w.side === s).reduce((a, w) => a + w.usd, 0);
  const wallets = new Map();
  for (const w of day) {
    const cur = wallets.get(w.wallet) || { wallet: w.wallet, buyUsd: 0, sellUsd: 0, trades: 0, symbols: new Set() };
    if (w.side === 'buy' || w.side === 'mint') cur.buyUsd += w.usd;
    else if (w.side === 'sell' || w.side === 'redeem') cur.sellUsd += w.usd;
    else continue;
    cur.trades++;
    cur.symbols.add(w.symbol);
    wallets.set(w.wallet, cur);
  }
  const top = [...wallets.values()]
    .map((v) => ({ ...v, symbols: [...v.symbols].slice(0, 4), totalUsd: v.buyUsd + v.sellUsd }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 8);
  const symbols = [...new Set(items.map((w) => w.symbol))].sort();
  return {
    min,
    symbol: sym,
    lastScan,
    summary: {
      trades24h: day.length,
      buyUsd24h: sum(day, 'buy') + sum(day, 'mint'),
      sellUsd24h: sum(day, 'sell') + sum(day, 'redeem'),
      biggest: day.reduce((m, w) => (!m || w.usd > m.usd ? w : m), null),
    },
    topWallets: top,
    symbols,
    items: feed.slice(0, Math.min(200, limit)),
    note: `Trades of the ${TOKENS_PER_SCAN} most-traded stock tokens, read from Blockscout every 90 s. Buy/sell = the wallet's net change in shares within one transaction; values use the current token price.`,
  };
}
