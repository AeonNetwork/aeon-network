// Alchemy enhanced APIs on Robinhood Chain (same key as the RPC): token balances, asset
// transfers and token metadata. Used where they replace many Blockscout calls with one.
import { NETWORKS } from '../config.js';
import { cached } from '../lib/cache.js';

const KEY = process.env.ALCHEMY_API_KEY || '';
const HOST = { mainnet: 'robinhood-mainnet', testnet: 'robinhood-testnet' };
export const alchemyEnabled = (net) => Boolean(KEY && HOST[net]);

// Alchemy's free tier limits compute units per second, and the site's RPC shares this key:
// space calls out (about 6 per second) and back off on 429 instead of bursting.
let next = 0;
const pace = async () => {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 170;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
};
let id = 0;
async function call(net, method, params, attempt = 0) {
  await pace();
  if (!alchemyEnabled(net)) throw Object.assign(new Error('Alchemy not configured'), { status: 503 });
  const r = await fetch(`https://${HOST[net]}.g.alchemy.com/v2/${KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 429 && attempt < 3) {
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    return call(net, method, params, attempt + 1);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw Object.assign(new Error(j?.error?.message || `Alchemy HTTP ${r.status}`), { status: 502 });
  return j.result;
}

const big = (hex) => {
  try {
    return BigInt(hex || '0x0');
  } catch {
    return 0n;
  }
};
export const units = (raw, decimals = 18) => Number((big(raw) * 1_000_000n) / 10n ** BigInt(decimals ?? 18)) / 1_000_000;

// All ERC-20 balances of a wallet (non-zero), across pages.
export async function tokenBalances(net, addr) {
  const out = [];
  let pageKey;
  for (let i = 0; i < 10; i++) {
    const r = await call(net, 'alchemy_getTokenBalances', pageKey ? [addr, 'erc20', { pageKey }] : [addr, 'erc20']);
    for (const b of r.tokenBalances || []) if (big(b.tokenBalance) > 0n) out.push({ address: b.contractAddress, raw: b.tokenBalance });
    pageKey = r.pageKey;
    if (!pageKey) break;
  }
  return out;
}

// Token name/symbol/decimals; cached for a day (they never change).
export function tokenMetadata(net, token) {
  return cached(`alc:meta:${net}:${token.toLowerCase()}`, 24 * 3600_000, () => call(net, 'alchemy_getTokenMetadata', [token])).then((r) => r.value);
}

// ERC-20 transfers of several tokens since a block, newest first, with block timestamps.
export async function transfers(net, { contracts, fromBlock, toAddress, fromAddress, max = 1000, order = 'desc', pages = 5 }) {
  const out = [];
  let pageKey;
  for (let i = 0; i < pages && out.length < max; i++) {
    const params = { category: ['erc20'], withMetadata: true, excludeZeroValue: true, order, maxCount: '0x' + Math.min(1000, max - out.length).toString(16) };
    if (contracts) params.contractAddresses = contracts;
    if (fromBlock != null) params.fromBlock = '0x' + Number(fromBlock).toString(16);
    if (toAddress) params.toAddress = toAddress;
    if (fromAddress) params.fromAddress = fromAddress;
    if (pageKey) params.pageKey = pageKey;
    const r = await call(net, 'alchemy_getAssetTransfers', [params]);
    out.push(...(r.transfers || []));
    pageKey = r.pageKey;
    if (!pageKey) break;
  }
  out.complete = !pageKey;
  return out;
}

// Is this address a contract? (pools, routers, vaults). Cached for a day.
export function isContract(net, addr) {
  return cached(`alc:code:${net}:${addr.toLowerCase()}`, 24 * 3600_000, async () => {
    const code = await call(net, 'eth_getCode', [addr, 'latest']);
    return Boolean(code && code !== '0x');
  }).then((r) => r.value);
}

export const chainId = (net) => NETWORKS[net]?.chainId;
