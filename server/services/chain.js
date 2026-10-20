// Robinhood Chain JSON-RPC access: endpoint failover, batching, caching,
// and decoding of the pieces explorers care about (ERC-20 metadata, transfers).

import { NETWORKS } from '../config.js';
import { cached } from '../lib/cache.js';

export const health = Object.fromEntries(Object.keys(NETWORKS).map((k) => [k, { ok: null, latency: null, endpoint: null, error: '', at: 0 }]));

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Arbitrum chains include one system transaction per block from this address.
export const ARB_SYSTEM = '0x00000000000000000000000000000000000a4b05';

const httpErr = (msg, status) => Object.assign(new Error(msg), { status });
let rpcId = 1;

// Log why an endpoint was skipped (at most once a minute per host), so a
// misconfigured RPC key shows up in the server log instead of failing silently.
const lastLog = {};
function logFailover(url, err, body) {
  const host = new URL(url).host;
  if (Date.now() - (lastLog[host] || 0) < 60_000) return;
  lastLog[host] = Date.now();
  const method = Array.isArray(body) ? `batch(${body.length}):${body[0]?.method}` : body?.method;
  console.warn(`[rpc] ${host} skipped (${method}): ${err.message}`);
}

async function post(net, body) {
  const cfg = NETWORKS[net];
  if (!cfg) throw httpErr('unknown network', 400);
  let lastErr;
  for (const url of cfg.rpc) {
    const started = performance.now();
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      if (res.status === 429) throw new Error('rate limited');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Provider-level rejection (network not enabled, bad key, quota):
      // this endpoint is unusable, so fail over to the next one.
      const providerError = (e) => e && (e.code === -32600 || /not enabled|unauthori[sz]ed|api key|authenticat|capacity|limit/i.test(e.message || ''));
      if (!Array.isArray(json) && providerError(json?.error)) throw new Error(json.error.message);
      // Batches come back as an array of the same provider error.
      if (Array.isArray(json) && json.length && json.every((r) => providerError(r.error))) throw new Error(json[0].error.message);
      health[net] = { ok: true, latency: Math.round(performance.now() - started), endpoint: new URL(url).host, error: '', at: Date.now() };
      return json;
    } catch (err) {
      lastErr = err;
      logFailover(url, err, body);
    }
  }
  health[net] = { ...health[net], ok: false, error: lastErr?.message || 'unreachable', at: Date.now() };
  throw httpErr(`Cannot reach ${cfg.name} RPC: ${lastErr?.message}`, 502);
}

// Raw JSON-RPC pass-through (used by the public /rpc proxy).
export const forward = (net, body) => post(net, body);

export async function rpc(net, method, params = []) {
  const body = await post(net, { jsonrpc: '2.0', id: rpcId++, method, params });
  if (body.error) throw httpErr(body.error.message || 'rpc error', 400);
  return body.result;
}

// One HTTP round-trip for many calls. Returns results in call order
// (an entry is an Error if that individual call failed).
export async function rpcBatch(net, calls) {
  if (!calls.length) return [];
  const base = rpcId;
  rpcId += calls.length;
  const body = await post(net, calls.map(([method, params], i) => ({ jsonrpc: '2.0', id: base + i, method, params })));
  if (!Array.isArray(body)) throw httpErr(body?.error?.message || 'batch not supported by RPC', 502);
  const byId = new Map(body.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const r = byId.get(base + i);
    if (!r) return new Error('missing response');
    return r.error ? new Error(r.error.message) : r.result;
  });
}

export const hex = (n) => '0x' + BigInt(n).toString(16);
export const num = (h) => (h == null ? null : Number(BigInt(h)));
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

// Common function selectors, so transactions read as actions, not hex.
export const METHODS = {
  '0xa9059cbb': 'transfer', '0x095ea7b3': 'approve', '0x23b872dd': 'transferFrom', '0xd0e30db0': 'deposit', '0x2e1a7d4d': 'withdraw',
  '0x38ed1739': 'swapExactTokensForTokens', '0x7ff36ab5': 'swapExactETHForTokens', '0x18cbafe5': 'swapExactTokensForETH', '0x414bf389': 'exactInputSingle',
  '0xc04b8d59': 'exactInput', '0x04e45aaf': 'exactInputSingle', '0x5ae401dc': 'multicall', '0xac9650d8': 'multicall', '0x3593564c': 'execute',
  '0x24856bc3': 'execute', '0x1fad948c': 'handleOps', '0x6a761202': 'execTransaction', '0x40c10f19': 'mint', '0x42966c68': 'burn',
  '0xa22cb465': 'setApprovalForAll', '0x42842e0e': 'safeTransferFrom', '0xb88d4fde': 'safeTransferFrom', '0x617ba037': 'supply', '0xa415bcad': 'borrow',
  '0x573ade81': 'repay', '0x69328dec': 'withdraw', '0x6e553f65': 'deposit', '0xba087652': 'redeem', '0xb460af94': 'withdraw', '0x94bf804d': 'mint',
};
export const methodName = (input) => (!input || input === '0x' ? 'ETH transfer' : METHODS[input.slice(0, 10)] || input.slice(0, 10));

export function slimBlock(b) {
  const user = b.transactions.filter((t) => typeof t === 'string' || t.from?.toLowerCase() !== ARB_SYSTEM);
  return {
    number: num(b.number),
    hash: b.hash,
    time: num(b.timestamp) * 1000,
    txs: user.length,
    gasUsed: num(b.gasUsed),
    gasLimit: num(b.gasLimit),
    baseFee: b.baseFeePerGas ? num(b.baseFeePerGas) : null,
    size: b.size ? num(b.size) : null,
  };
}

export function slimTx(t, time) {
  return {
    hash: t.hash,
    from: t.from,
    to: t.to,
    valueWei: BigInt(t.value).toString(),
    method: t.to ? methodName(t.input) : 'contract creation',
    block: num(t.blockNumber),
    time,
  };
}

export const blockNumber = (net) => cached(`rpc:${net}:bn`, 1500, async () => num(await rpc(net, 'eth_blockNumber')), { maxStaleMs: 60_000 });
export const gasPrice = (net) => cached(`rpc:${net}:gas`, 5000, async () => num(await rpc(net, 'eth_gasPrice')), { maxStaleMs: 60_000 });

export async function block(net, id) {
  const tag = id === 'latest' ? 'latest' : hex(id);
  const load = async () => {
    const b = await rpc(net, 'eth_getBlockByNumber', [tag, true]);
    if (!b) throw httpErr('block not found', 404);
    const time = num(b.timestamp) * 1000;
    return { ...slimBlock(b), parentHash: b.parentHash, miner: b.miner, transactions: b.transactions.filter((t) => t.from.toLowerCase() !== ARB_SYSTEM).map((t) => slimTx(t, time)) };
  };
  if (id === 'latest') return load();
  return (await cached(`rpc:${net}:blockfull:${id}`, 3600_000, load)).value;
}

// ---------------- tokens ----------------

function decodeString(h) {
  if (!h || h === '0x') return '';
  const data = h.slice(2);
  if (data.length === 64) return Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '');
  const len = Number(BigInt('0x' + data.slice(64, 128)));
  return Buffer.from(data.slice(128, 128 + len * 2), 'hex').toString('utf8');
}

export async function tokenMeta(net, addr) {
  if (!ADDR.test(addr)) throw httpErr('invalid address', 400);
  return (
    await cached(`tok:${net}:${addr.toLowerCase()}`, 24 * 3600_000, async () => {
      const call = (data) => ['eth_call', [{ to: addr, data }, 'latest']];
      const [name, symbol, decimals, supply] = await rpcBatch(net, [call('0x06fdde03'), call('0x95d89b41'), call('0x313ce567'), call('0x18160ddd')]);
      const ok = (v) => (v instanceof Error || !v || v === '0x' ? null : v);
      if (!ok(symbol) && !ok(supply)) throw httpErr('not an ERC-20 contract', 404);
      return {
        address: addr,
        name: ok(name) ? decodeString(name) : '',
        symbol: ok(symbol) ? decodeString(symbol) : '',
        decimals: ok(decimals) ? num(decimals) : 18,
        totalSupply: ok(supply) ? BigInt(supply).toString() : null,
      };
    })
  ).value;
}

export async function tokenBalances(net, holder, tokens) {
  if (!tokens.length) return [];
  const data = '0x70a08231' + holder.slice(2).toLowerCase().padStart(64, '0');
  const res = await rpcBatch(net, tokens.map((t) => ['eth_call', [{ to: t, data }, 'latest']]));
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const v = res[i];
    if (v instanceof Error || !v || v === '0x' || BigInt(v) === 0n) continue;
    try {
      out.push({ ...(await tokenMeta(net, tokens[i])), balance: BigInt(v).toString() });
    } catch {
      /* not a token */
    }
  }
  return out;
}

// ---------------- address / tx ----------------

export async function address(net, addr) {
  if (!ADDR.test(addr)) throw httpErr('invalid address', 400);
  return (
    await cached(`rpc:${net}:addr:${addr.toLowerCase()}`, 8000, async () => {
      const [bal, nonce, code] = await rpcBatch(net, [
        ['eth_getBalance', [addr, 'latest']],
        ['eth_getTransactionCount', [addr, 'latest']],
        ['eth_getCode', [addr, 'latest']],
      ]);
      if (bal instanceof Error) throw httpErr(bal.message, 502);
      const isContract = !(code instanceof Error) && code && code !== '0x';
      let token = null;
      if (isContract) token = await tokenMeta(net, addr).catch(() => null);
      return { address: addr, balanceWei: BigInt(bal).toString(), nonce: nonce instanceof Error ? null : num(nonce), isContract, codeSize: isContract ? (code.length - 2) / 2 : 0, token };
    })
  ).value;
}

export async function tx(net, hash) {
  if (!HASH.test(hash)) throw httpErr('invalid transaction hash', 400);
  const [t, r] = await rpcBatch(net, [
    ['eth_getTransactionByHash', [hash]],
    ['eth_getTransactionReceipt', [hash]],
  ]);
  if (t instanceof Error) throw httpErr(t.message, 502);
  if (!t) throw httpErr('transaction not found', 404);
  const receipt = r instanceof Error ? null : r;
  let time = null;
  if (t.blockNumber) {
    const b = await cached(`rpc:${net}:bt:${t.blockNumber}`, 3600_000, () => rpc(net, 'eth_getBlockByNumber', [t.blockNumber, false]));
    time = num(b.value.timestamp) * 1000;
  }
  const transfers = [];
  for (const log of receipt?.logs || []) {
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) continue;
    const meta = await tokenMeta(net, log.address).catch(() => null);
    transfers.push({
      token: log.address,
      symbol: meta?.symbol || '',
      decimals: meta?.decimals ?? 18,
      from: '0x' + log.topics[1].slice(26),
      to: '0x' + log.topics[2].slice(26),
      amount: log.data && log.data !== '0x' ? BigInt(log.data).toString() : '0',
    });
  }
  const gasUsed = receipt ? num(receipt.gasUsed) : null;
  const price = receipt?.effectiveGasPrice ? num(receipt.effectiveGasPrice) : null;
  return {
    hash,
    status: receipt ? (receipt.status === '0x1' ? 'success' : 'failed') : 'pending',
    block: num(t.blockNumber),
    time,
    from: t.from,
    to: t.to,
    contractCreated: receipt?.contractAddress || null,
    valueWei: BigInt(t.value).toString(),
    method: t.to ? methodName(t.input) : 'contract creation',
    nonce: num(t.nonce),
    gasUsed,
    gasPrice: price,
    feeWei: gasUsed != null && price != null ? (BigInt(gasUsed) * BigInt(price)).toString() : null,
    logs: receipt?.logs?.length ?? 0,
    transfers: transfers.slice(0, 50),
    inputSize: (t.input.length - 2) / 2,
  };
}

export async function lookup(net, q) {
  q = q.trim();
  if (/^\d+$/.test(q)) return { type: 'block', id: Number(q) };
  if (HASH.test(q)) {
    // A 32-byte hash is usually a tx; fall back to block hash.
    const t = await rpc(net, 'eth_getTransactionByHash', [q]).catch((err) => {
      if (err.status === 502) throw err;
      return null;
    });
    if (t) return { type: 'tx', id: q };
    const b = await rpc(net, 'eth_getBlockByHash', [q, false]).catch(() => null);
    if (b) return { type: 'block', id: num(b.number) };
    throw httpErr('nothing found for that hash', 404);
  }
  if (ADDR.test(q)) return { type: 'address', id: q };
  throw httpErr('Enter a block number, transaction hash, or address', 400);
}
