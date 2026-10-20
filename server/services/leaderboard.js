// Holder leaderboard: the wallets with the largest tokenized-stock portfolios on Robinhood Chain.
//
// Every 30 minutes:
//   1. read the first page of holders (top 50) of every official stock token with a price;
//   2. sum each individual wallet's value across tokens to find the candidates;
//   3. re-value the top candidates exactly from their full token balances (insights.portfolio),
//      so a wallet's total also counts positions where it is not a top-50 holder.
// Contracts (pools, vaults, bridges) are excluded: the board ranks people, not protocols.
// The result survives restarts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';
import * as eco from './ecosystem.js';
import { portfolio } from './insights.js';

const NET = 'mainnet';
const EXACT = 60; // candidates re-valued exactly
const SHOW = 50;
const FILE = path.join(CACHE_DIR, 'leaderboard.json');

let board = null;
let building = false;
try {
  board = JSON.parse(readFileSync(FILE, 'utf8'));
} catch {}

const units = (raw, decimals) => {
  try {
    return Number((BigInt(raw) * 1_000_000n) / 10n ** BigInt(decimals ?? 18)) / 1_000_000;
  } catch {
    return 0;
  }
};

export async function build() {
  if (building) return;
  building = true;
  const started = Date.now();
  try {
    const stocks = (await eco.stockTokens(NET)).value.filter((s) => s.price);
    const wallets = new Map();
    let scanned = 0;
    for (const s of stocks) {
      try {
        const r = await eco.bs(NET, `/tokens/${s.address}/holders`, 20 * 60_000);
        scanned++;
        for (const h of r.value.items || []) {
          const a = h.address;
          if (!a?.hash || a.is_contract) continue;
          const usd = units(h.value, s.decimals ?? 18) * s.price;
          if (usd < 1) continue;
          const w = wallets.get(a.hash) || { address: a.hash, name: a.name || null, est: 0 };
          w.est += usd;
          wallets.set(a.hash, w);
        }
      } catch {
        /* skip a token that fails; the next build retries it */
      }
    }
    const candidates = [...wallets.values()].sort((a, b) => b.est - a.est).slice(0, EXACT);
    const rows = [];
    for (const c of candidates) {
      try {
        const p = await portfolio(NET, c.address);
        const top = p.holdings[0];
        rows.push({
          address: c.address,
          name: c.name,
          valueUsd: p.stocksValueUsd,
          positions: p.holdings.length,
          top: top ? { symbol: top.symbol, address: top.address, weight: p.stocksValueUsd ? (top.valueUsd || 0) / p.stocksValueUsd : 0 } : null,
          symbols: p.holdings.slice(0, 5).map((h) => h.symbol),
          copycats: p.copycats.length,
        });
      } catch {
        rows.push({ address: c.address, name: c.name, valueUsd: c.est, positions: null, top: null, symbols: [], copycats: 0, estimated: true });
      }
    }
    rows.sort((a, b) => b.valueUsd - a.valueUsd);
    const prev = new Map((board?.rows || []).map((r, i) => [r.address, i + 1]));
    board = {
      at: Date.now(),
      took: Date.now() - started,
      tokens: scanned,
      wallets: wallets.size,
      rows: rows.slice(0, SHOW).map((r, i) => ({ ...r, rank: i + 1, prevRank: prev.get(r.address) ?? null })),
      totalUsd: rows.slice(0, SHOW).reduce((s, r) => s + r.valueUsd, 0),
    };
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(board));
    } catch {}
  } finally {
    building = false;
  }
}

export function startLeaderboard() {
  const due = !board || Date.now() - board.at > 30 * 60_000;
  setTimeout(() => due && build().catch(() => {}), 20_000).unref?.();
  setInterval(() => build().catch(() => {}), 30 * 60_000).unref();
}

export function leaderboard() {
  if (!board) return { building: true, rows: [], note: 'The first ranking is being built from the chain. This takes a minute or two.' };
  return {
    ...board,
    building,
    note: `Individual wallets only (contracts, pools and vaults excluded). Candidates come from the top 50 holders of each of ${board.tokens} official stock tokens; the top ${EXACT} are valued exactly from their full balances. Refreshed every 30 minutes.`,
  };
}
