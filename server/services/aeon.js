// The Aeon community token: live transparency data and holder perks.
//
// Holders prove ownership by signing a one-time message in their wallet (no transaction,
// no gas). The server verifies the signature, reads the balance on-chain, and returns a
// signed pass (24 h) that raises the visitor's Network AI allowance.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'viem';
import { AEON_TOKEN as T } from '../config.js';
import * as chain from './chain.js';
import * as eco from './ecosystem.js';
import { cached } from '../lib/cache.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SECRET = T.passSecret || randomBytes(32).toString('hex');
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const units = (raw, d = 18) => {
  try {
    return Number((BigInt(raw) * 1_000_000n) / 10n ** BigInt(d)) / 1_000_000;
  } catch {
    return 0;
  }
};

export async function balanceOf(addr) {
  const data = '0x70a08231' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const hex = await chain.rpc(T.network, 'eth_call', [{ to: T.address, data }, 'latest']);
  return units(BigInt(hex).toString());
}

// ---------- transparency ----------
export function tokenInfo() {
  return cached('aeon:token', 60_000, async () => {
    const [t, holders, creatorBal, team] = await Promise.all([
      // Blockscout (or its last saved answer); without it, the contract itself for name and supply.
      eco.bs(T.network, `/tokens/${T.address}`, 60_000).then((r) => r.value).catch(async () => {
        const m = await chain.tokenMeta(T.network, T.address);
        return { name: m.name, symbol: m.symbol, decimals: m.decimals, total_supply: m.totalSupply, holders_count: null };
      }),
      eco.bs(T.network, `/tokens/${T.address}/holders`, 60_000).then((r) => r.value.items || []).catch(() => []),
      balanceOf(T.creator).catch(() => null),
      Promise.all(T.teamWallets.map(async (a) => ({ address: a, balance: await balanceOf(a).catch(() => null) }))),
    ]);
    const supply = units(t.total_supply, Number(t.decimals ?? 18));
    const top = holders.slice(0, 20).map((h) => {
      const amount = units(h.value, Number(t.decimals ?? 18));
      const a = h.address?.hash;
      const label = T.labels[a?.toLowerCase()] || (a?.toLowerCase() === T.creator.toLowerCase() ? 'Creator (team)' : T.teamWallets.some((w) => w.toLowerCase() === a?.toLowerCase()) ? 'Team' : h.address?.name || null);
      return { address: a, isContract: Boolean(h.address?.is_contract), label, amount, pct: supply ? (amount / supply) * 100 : null };
    });
    const burned = top.find((h) => h.address?.toLowerCase() === '0x000000000000000000000000000000000000dead');
    const teamTotal = (creatorBal || 0) + team.reduce((s, w) => s + (w.balance || 0), 0);
    return {
      address: T.address,
      name: t.name,
      symbol: t.symbol,
      network: T.network,
      launchedOn: T.launchedOn,
      supply,
      holders: Number(t.holders_count) || null,
      top,
      burnedPct: burned?.pct ?? 0,
      creator: { address: T.creator, balance: creatorBal, buyTx: T.creatorBuyTx, burnTx: T.creatorBurnTx },
      team: { declared: T.teamWallets.length, wallets: team, total: teamTotal, pct: supply ? (teamTotal / supply) * 100 : 0 },
      perks: { min: T.holderMin, aiMultiplier: T.holderAiMultiplier },
    };
  });
}

// ---------- holder passes ----------
const challenges = new Map(); // nonce -> expiry
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of challenges) if (exp < now) challenges.delete(n);
}, 60_000).unref();

const message = (addr, nonce) => `Aeon Network holder check\n\nWallet: ${addr}\nNonce: ${nonce}\n\nSigning proves you own this wallet. It is free and sends no transaction.`;

export function challenge(addr) {
  if (!ADDR.test(addr || '')) throw bad('invalid address');
  const nonce = randomBytes(12).toString('hex');
  challenges.set(nonce, Date.now() + 10 * 60_000);
  return { nonce, message: message(addr, nonce) };
}

const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');
export function readPass(pass) {
  if (!pass || typeof pass !== 'string' || !pass.includes('.')) return null;
  const [body, mac] = pass.split('.');
  const want = sign(body);
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export async function verify({ address, nonce, signature }) {
  if (!ADDR.test(address || '')) throw bad('invalid address');
  if (!challenges.has(nonce)) throw bad('This check expired. Try again.');
  challenges.delete(nonce);
  const ok = await verifyMessage({ address, message: message(address, nonce), signature }).catch(() => false);
  if (!ok) throw bad('The signature does not match this wallet.', 401);
  const balance = await balanceOf(address);
  const holder = balance >= T.holderMin;
  const out = { address, balance, min: T.holderMin, holder };
  if (holder) {
    const body = Buffer.from(JSON.stringify({ a: address, b: balance, exp: Date.now() + 24 * 3600_000 })).toString('base64url');
    out.pass = `${body}.${sign(body)}`;
    out.expires = Date.now() + 24 * 3600_000;
  }
  return out;
}
