// Robinhood Chain ecosystem data (all free, no key):
//   DefiLlama  - chain TVL, TVL history, protocols, stablecoins, DEX volume, fees
//   Blockscout - optional enrichment (address history, token holders)
//   CoinGecko  - ETH/USD only, to show fees and balances in dollars
//   Cointelegraph RSS - news, filtered to Robinhood

import { NETWORKS, BLOCKSCOUT, COINGECKO } from '../config.js';
import { cached } from '../lib/cache.js';

export const upstream = {};
const mark = (name, ok, error = '') => (upstream[name] = { ok, at: Date.now(), error });

async function getJSON(name, url, { headers = {}, timeout = 20_000 } = {}) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'aeon-network/1.0', ...headers }, signal: AbortSignal.timeout(timeout) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('json')) throw Object.assign(new Error(`${res.status}${type.includes('html') ? ' (blocked by challenge page)' : ''}`), { httpStatus: res.status });
    const data = await res.json();
    mark(name, true);
    return data;
  } catch (err) {
    mark(name, false, err.message);
    throw Object.assign(new Error(`${name}: ${err.message}`), { status: 502, httpStatus: err.httpStatus });
  }
}

const llamaChain = (net) => {
  const c = NETWORKS[net]?.llamaChain;
  if (!c) throw Object.assign(new Error('Ecosystem data is only tracked for mainnet'), { status: 404 });
  return c;
};
const enc = encodeURIComponent;
const daily = (rows) => rows.map(([t, v]) => ({ t: t * 1000, v }));

// ---------------- DefiLlama ----------------

export function chainSummary(net) {
  const chain = llamaChain(net);
  return cached(`llama:chain:${chain}`, 15 * 60_000, async () => {
    const all = await getJSON('defillama', 'https://api.llama.fi/v2/chains');
    const c = all.find((x) => x.name === chain);
    if (!c) throw Object.assign(new Error('chain not listed on DefiLlama'), { status: 404 });
    const rank = [...all].sort((a, b) => b.tvl - a.tvl).findIndex((x) => x.name === chain) + 1;
    return { name: c.name, chainId: c.chainId, tvl: c.tvl, rank, chains: all.length };
  });
}

export function tvlHistory(net) {
  const chain = llamaChain(net);
  return cached(`llama:tvlh:${chain}`, 60 * 60_000, async () => {
    const rows = await getJSON('defillama', `https://api.llama.fi/v2/historicalChainTvl/${enc(chain)}`);
    // Trim the leading zero period before the chain had any TVL.
    const firstLive = rows.findIndex((r) => r.tvl > 0);
    return rows.slice(Math.max(0, firstLive)).map((r) => ({ t: r.date * 1000, v: r.tvl }));
  });
}

export function protocols(net) {
  const chain = llamaChain(net);
  return cached(`llama:protocols:${chain}`, 30 * 60_000, async () => {
    const all = await getJSON('defillama', 'https://api.llama.fi/protocols', { timeout: 40_000 });
    return all
      .filter((p) => (p.chains || []).includes(chain))
      .map((p) => {
        const tvl = p.chainTvls?.[chain] ?? null;
        return {
          name: p.name,
          slug: p.slug,
          category: p.category || 'Other',
          logo: p.logo,
          url: p.url,
          twitter: p.twitter,
          description: (p.description || '').slice(0, 220),
          chainTvl: typeof tvl === 'number' ? tvl : null,
          chains: (p.chains || []).length,
          change1d: p.change_1d ?? null,
          listedAt: p.listedAt ? p.listedAt * 1000 : null,
        };
      })
      .sort((a, b) => (b.chainTvl ?? -1) - (a.chainTvl ?? -1));
  });
}

export function stablecoins(net) {
  const chain = llamaChain(net);
  return cached(`llama:stables:${chain}`, 60 * 60_000, async () => {
    const rows = await getJSON('defillama', `https://stablecoins.llama.fi/stablecoincharts/${enc(chain)}`);
    return rows.map((r) => ({ t: Number(r.date) * 1000, v: r.totalCirculatingUSD?.peggedUSD ?? 0 }));
  });
}

function overview(kind, net) {
  const chain = llamaChain(net);
  return cached(`llama:${kind}:${chain}`, 30 * 60_000, async () => {
    const d = await getJSON('defillama', `https://api.llama.fi/overview/${kind}/${enc(chain)}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`);
    return {
      total24h: d.total24h ?? null,
      total7d: d.total7d ?? null,
      total30d: d.total30d ?? null,
      change1d: d.change_1d ?? null,
      chart: daily(d.totalDataChart || []),
      protocols: (d.protocols || [])
        .filter((p) => p.total24h)
        .sort((a, b) => b.total24h - a.total24h)
        .slice(0, 10)
        .map((p) => ({ name: p.displayName || p.name, logo: p.logo, total24h: p.total24h, change1d: p.change_1d ?? null, category: p.category })),
    };
  });
}
export const dexVolume = (net) => overview('dexs', net);
export const fees = (net) => overview('fees', net);

// ---------------- Blockscout ----------------
// Hosted PRO API (api.blockscout.com/{chainId}) when a proapi_ key is set,
// otherwise the network's own explorer. Budget: ~5 req/s, so every call is
// cached and shared by all visitors.

const usesPro = (net) => BLOCKSCOUT.pro && NETWORKS[net].blockscoutPro;
function blockscoutBase(net) {
  if (usesPro(net)) return `https://api.blockscout.com/${NETWORKS[net].chainId}/api/v2`;
  // Networks the PRO API doesn't cover (e.g. testnet) use their own explorer API, keyless.
  return NETWORKS[net].explorer.replace(/\/$/, '') + '/api/v2';
}
// Trip only after repeated failures, so one slow request can't disable the fallback.
const bsFails = {};
const bsDown = (net) => {
  const f = bsFails[net];
  return f?.count >= 3 && Date.now() - f.at < 2 * 60_000;
};
export const blockscoutAvailable = (net) => BLOCKSCOUT.enabled && !bsDown(net);

// Spaces out calls to one upstream so bursts (e.g. a token profile's 6 calls)
// stay under its per-second limit instead of tripping 429s.
function pacer(perSecond) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + 1000 / perSecond;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  };
}
const bsPace = pacer(4); // Blockscout PRO free tier: 5 requests/second

export async function bs(net, path, ttl) {
  if (!BLOCKSCOUT.enabled) throw Object.assign(new Error('Blockscout disabled'), { status: 404 });
  if (bsDown(net)) throw Object.assign(new Error('Blockscout temporarily unavailable'), { status: 503 });
  const sep = path.includes('?') ? '&' : '?';
  const url = `${blockscoutBase(net)}${path}${usesPro(net) ? `${sep}apikey=${enc(BLOCKSCOUT.key)}` : ''}`;
  return cached(`bs:${net}:${path}`, ttl, async () => {
    let data;
    try {
      await bsPace();
      data = await getJSON(`blockscout:${net}`, url, { timeout: 20_000 });
    } catch (err) {
      // Sporadic upstream 500s and per-second rate limits (429): retry once after a pause.
      if (err.httpStatus >= 500 || err.httpStatus === 429) {
        await new Promise((r) => setTimeout(r, err.httpStatus === 429 ? 1200 : 700));
        try {
          await bsPace();
          data = await getJSON(`blockscout:${net}`, url, { timeout: 20_000 });
        } catch (err2) {
          err = err2;
        }
      }
      if (!data) {
        // A 4xx/500 on one path is that path's problem; only outages count toward the breaker.
        if (!(err.httpStatus >= 400 && err.httpStatus <= 500)) {
          const f = (bsFails[net] ??= { count: 0, at: 0 });
          f.count += 1;
          f.at = Date.now();
        }
        throw err;
      }
    }
    bsFails[net] = { count: 0, at: Date.now() };
    return data;
  });
}

const num = (v) => (v == null || v === '' ? null : Number(v));

export async function explorerStats(net) {
  const { value: s } = await bs(net, '/stats', 60_000);
  return {
    totalTransactions: num(s.total_transactions),
    transactionsToday: num(s.transactions_today),
    totalAddresses: num(s.total_addresses),
    totalBlocks: num(s.total_blocks),
    averageBlockTimeMs: num(s.average_block_time),
    gasPrices: s.gas_prices || null,
    gasUsedToday: num(s.gas_used_today),
  };
}

export async function txHistory(net) {
  const { value } = await bs(net, '/stats/charts/transactions', 60 * 60_000);
  return (value.chart_data || []).map((d) => ({ t: Date.parse(d.date), v: d.transactions_count ?? d.transaction_count ?? 0 })).sort((a, b) => a.t - b.t);
}

export async function topTokens(net) {
  const { value } = await bs(net, '/tokens?type=ERC-20', 10 * 60_000);
  return (value.items || []).map((t) => ({
    address: t.address_hash,
    name: t.name,
    symbol: t.symbol,
    decimals: num(t.decimals),
    holders: num(t.holders_count ?? t.holders),
    totalSupply: t.total_supply,
    price: num(t.exchange_rate),
    marketCap: num(t.circulating_market_cap),
    volume24h: num(t.volume_24h),
    icon: t.icon_url,
    reputation: t.reputation || null,
  }));
}

const bsBlock = (b) => ({
  number: b.height,
  hash: b.hash,
  time: Date.parse(b.timestamp),
  txs: b.transactions_count ?? b.transaction_count ?? 0,
  gasUsed: num(b.gas_used),
  gasLimit: num(b.gas_limit),
  baseFee: num(b.base_fee_per_gas),
  size: b.size ?? null,
});
const bsTx = (t) => ({
  hash: t.hash,
  from: t.from?.hash,
  to: t.to?.hash || null,
  valueWei: t.value || '0',
  method: t.method || (t.to ? 'call' : 'contract creation'),
  block: t.block_number ?? t.block,
  time: t.timestamp ? Date.parse(t.timestamp) : null,
  status: t.status === 'ok' ? 'success' : t.status === 'error' ? 'failed' : t.status,
});

// Latest blocks + transactions, used as the live feed when the RPC is unreachable.
export async function latest(net) {
  const [blocks, txs] = await Promise.all([bs(net, '/main-page/blocks', BLOCKSCOUT.feedIntervalMs - 1000), bs(net, '/main-page/transactions', BLOCKSCOUT.feedIntervalMs - 1000)]);
  return { blocks: blocks.value.map(bsBlock), txs: txs.value.map(bsTx) };
}

export async function addressHistory(net, addr) {
  if (!blockscoutAvailable(net)) return null;
  try {
    const { value } = await bs(net, `/addresses/${addr}/transactions`, 30_000);
    return (value.items || []).slice(0, 25).map(bsTx);
  } catch {
    return null;
  }
}

export async function chainStats(net) {
  if (!blockscoutAvailable(net)) return null;
  try {
    return await explorerStats(net);
  } catch {
    return null;
  }
}

// ---- Explorer detail pages from Blockscout (used when the RPC is unreachable).
// Same shapes as services/chain.js so the frontend doesn't care which source answered.

const status = (t) => (t.result === 'success' || t.status === 'ok' ? 'success' : t.status === 'error' || (t.result && t.result !== 'success' && t.result !== 'pending') ? 'failed' : 'pending');

export async function blockDetail(net, id) {
  const [{ value: b }, { value: list }] = await Promise.all([bs(net, `/blocks/${id}`, 3600_000), bs(net, `/blocks/${id}/transactions`, 3600_000)]);
  return {
    ...bsBlock(b),
    parentHash: b.parent_hash,
    miner: b.miner?.hash,
    transactions: (list.items || []).map(bsTx),
    source: 'blockscout',
  };
}

// Blockscout decodes calldata against verified ABIs; keep it compact.
function decodeInput(t) {
  const d = t.decoded_input;
  if (!d) return null;
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 400);
  return { method: d.method_call?.split('(')[0] || t.method || null, signature: d.method_call || null, params: (d.parameters || []).slice(0, 12).map((p) => ({ name: p.name, type: p.type, value: show(p.value) })) };
}

export async function txDetail(net, hash) {
  const { value: t } = await bs(net, `/transactions/${hash}`, 15_000);
  const gasUsed = num(t.gas_used);
  return {
    hash: t.hash,
    status: status(t),
    block: t.block_number ?? null,
    time: t.timestamp ? Date.parse(t.timestamp) : null,
    from: t.from?.hash,
    to: t.to?.hash || null,
    contractCreated: t.created_contract?.hash || null,
    valueWei: t.value || '0',
    method: t.method || (t.to ? 'call' : 'contract creation'),
    nonce: t.nonce,
    gasUsed,
    gasPrice: num(t.gas_price),
    feeWei: t.fee?.value ?? null,
    logs: null,
    inputSize: t.raw_input ? (t.raw_input.length - 2) / 2 : 0,
    revertReason: t.revert_reason?.raw ? String(t.revert_reason.raw).slice(0, 200) : null,
    toName: t.to?.name || null,
    toVerified: Boolean(t.to?.is_verified),
    decoded: decodeInput(t),
    transfers: (t.token_transfers || []).slice(0, 50).map((x) => ({
      token: x.token?.address_hash || x.token?.address,
      symbol: x.token?.symbol || '',
      decimals: num(x.total?.decimals ?? x.token?.decimals) ?? 18,
      from: x.from?.hash,
      to: x.to?.hash,
      amount: x.total?.value ?? '0',
    })),
    source: 'blockscout',
  };
}

export async function addressDetail(net, addr) {
  const [{ value: a }, counters, balances] = await Promise.all([
    bs(net, `/addresses/${addr}`, 15_000).catch(async (err) => {
      const t = await bs(net, `/tokens/${addr}`, 5 * 60_000).catch(() => null);
      if (!t) throw err;
      return { value: { hash: addr, coin_balance: null, is_contract: true, token: t.value, name: null } };
    }),
    bs(net, `/addresses/${addr}/counters`, 60_000).catch(() => null),
    bs(net, `/addresses/${addr}/token-balances`, 30_000).catch(() => null),
  ]);
  const tk = a.token;
  return {
    address: a.hash,
    balanceWei: a.coin_balance ?? null,
    nonce: counters?.value?.transactions_count != null ? Number(counters.value.transactions_count) : null,
    isContract: Boolean(a.is_contract),
    codeSize: 0,
    name: a.name || null,
    verified: Boolean(a.is_verified),
    scam: Boolean(a.is_scam),
    token: tk ? { address: a.hash, name: tk.name, symbol: tk.symbol, decimals: num(tk.decimals) ?? 18, totalSupply: tk.total_supply, type: tk.type, official: isOfficial(tk) } : null,
    tokenBalances: (balances?.value || [])
      .filter((b) => b.token?.type === 'ERC-20' && b.value && b.value !== '0' && b.token?.reputation !== 'scam')
      .slice(0, 40)
      .map((b) => ({ address: b.token.address_hash, name: b.token.name, symbol: b.token.symbol, decimals: num(b.token.decimals) ?? 18, totalSupply: b.token.total_supply, balance: b.value })),
    source: 'blockscout',
  };
}

// ---- Tokenized stocks: official Robinhood stock tokens use the ERC-8056
// standard and are named "<Company> • Robinhood Token".
const isOfficial = (t) => t.type === 'ERC-8056' && /•\s*Robinhood Token$/i.test(t.name || '');
// Funds/ETFs by name; "Ordinary Shares" / "Common Stock" are companies.
const isFund = (name) => /\b(ETF|ETN|Trust|Fund)\b|\b(SPDR|iShares|Invesco|Vanguard|Roundhill)\b/i.test(name || '');

const mapStock = (t) => ({
  address: t.address_hash,
  symbol: t.symbol,
  name: (t.name || '').replace(/\s*•\s*Robinhood Token$/i, ''),
  kind: isFund(t.name) ? 'ETF' : 'Stock',
  price: num(t.exchange_rate),
  marketCap: num(t.circulating_market_cap),
  holders: num(t.holders_count),
  volume24h: num(t.volume_24h),
  totalSupply: t.total_supply,
  decimals: num(t.decimals) ?? 18,
  icon: t.icon_url,
});

export function stockTokens(net) {
  return cached(`stocks:${net}`, 10 * 60_000, async () => {
    const out = [];
    let params = '';
    for (let page = 0; page < 16; page++) {
      let value;
      try {
        ({ value } = await bs(net, `/tokens?type=ERC-8056${params}`, 10 * 60_000));
      } catch (err) {
        if (!out.length) throw err;
        break;
      }
      // Blockscout pages can overlap, so de-duplicate by contract.
      const before = out.length;
      for (const t of value.items || []) if (isOfficial(t) && !out.some((o) => o.address === t.address_hash)) out.push(mapStock(t));
      const next = value.next_page_params;
      // Stop at the end, or when a page brings nothing new (pagination looping).
      if (!next || out.length === before) break;
      params = '&' + new URLSearchParams(Object.entries(next).filter(([, v]) => v != null)).toString();
    }
    return out.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  });
}

export async function stockDetail(net, addr) {
  const [{ value: t }, counters] = await Promise.all([bs(net, `/tokens/${addr}`, 5 * 60_000), bs(net, `/tokens/${addr}/counters`, 10 * 60_000).catch(() => null)]);
  return { ...mapStock(t), official: isOfficial(t), type: t.type, transfers: num(counters?.value?.transfers_count) };
}

// Is this address one of the official stock tokens? (cheap: uses the cached list)
export async function officialStock(net, addr) {
  try {
    const { value } = await stockTokens(net);
    return value.find((s) => s.address.toLowerCase() === addr.toLowerCase()) || null;
  } catch {
    return null;
  }
}

// Official token vs look-alikes for a ticker or company name.
export async function verifyToken(net, q) {
  q = q.trim().slice(0, 40);
  if (!q) throw Object.assign(new Error('Enter a ticker or name'), { status: 400 });
  const { value } = await bs(net, `/search?q=${enc(q)}`, 10 * 60_000);
  const tokens = (value.items || []).filter((i) => i.type === 'token');
  const rows = tokens.map((i) => ({
    address: i.address_hash || i.address,
    symbol: i.symbol,
    name: i.name,
    type: i.token_type,
    icon: i.icon_url || null,
    official: i.token_type === 'ERC-8056' && /•\s*Robinhood Token$/i.test(i.name || ''),
    verified: Boolean(i.is_smart_contract_verified),
  }));
  const official = rows.filter((r) => r.official);
  const symbols = new Set(official.map((r) => (r.symbol || '').toUpperCase()));
  const lookalikes = rows
    .filter((r) => !r.official)
    .map((r) => ({
      ...r,
      // Flag tokens that borrow an official ticker or the Robinhood name.
      risk: symbols.has((r.symbol || '').toUpperCase()) || /robinhood/i.test(r.name || '') ? 'high' : 'low',
    }));
  return { query: q, official, lookalikes };
}

// CoinGecko: keyless = a few calls per minute. Pace requests, and after a
// 429 stop asking for a minute instead of hammering it.
const cgPace = pacer(COINGECKO.key ? 0.4 : 0.15);
let cgBlockedUntil = 0;
async function cgJSON(url, opts) {
  const limited = () => Object.assign(new Error('CoinGecko rate limit reached, try again in a minute'), { status: 503 });
  if (Date.now() < cgBlockedUntil) throw limited();
  await cgPace();
  try {
    return await getJSON('coingecko', url, opts);
  } catch (err) {
    if (err.httpStatus === 429) {
      cgBlockedUntil = Date.now() + 60_000;
      throw limited();
    }
    throw err;
  }
}

// ---- Token profile: everything about one token in a single response.
export async function tokenProfile(net, addr) {
  const safe = (p) => p.then((r) => r.value).catch(() => null);
  const [t, counters, contract, holders, transfers, stocks] = await Promise.all([
    bs(net, `/tokens/${addr}`, 5 * 60_000).then((r) => r.value),
    safe(bs(net, `/tokens/${addr}/counters`, 10 * 60_000)),
    safe(bs(net, `/addresses/${addr}`, 30 * 60_000)),
    safe(bs(net, `/tokens/${addr}/holders`, 5 * 60_000)),
    safe(bs(net, `/tokens/${addr}/transfers`, 60_000)),
    NETWORKS[net].blockscoutPro ? stockTokens(net).then((r) => r.value).catch(() => []) : [],
  ]);
  const decimals = num(t.decimals) ?? 18;
  const supply = t.total_supply ? BigInt(t.total_supply) : 0n;
  const share = (v) => (supply > 0n ? Number((BigInt(v) * 1_000_000n) / supply) / 10_000 : null); // percent
  const holderRows = (holders?.items || []).slice(0, 25).map((h) => ({
    address: h.address?.hash,
    name: h.address?.name || null,
    isContract: Boolean(h.address?.is_contract),
    value: h.value,
    sharePct: share(h.value || '0'),
  }));
  const stock = stocks.find((s) => s.address.toLowerCase() === addr.toLowerCase()) || null;
  return {
    address: t.address_hash,
    name: t.name,
    symbol: t.symbol,
    type: t.type,
    decimals,
    totalSupply: t.total_supply,
    price: num(t.exchange_rate),
    marketCap: num(t.circulating_market_cap),
    volume24h: num(t.volume_24h),
    holders: num(counters?.token_holders_count ?? t.holders_count),
    transfers: num(counters?.transfers_count),
    icon: t.icon_url,
    reputation: t.reputation || null,
    official: isOfficial(t),
    stock: stock ? { name: stock.name, kind: stock.kind } : null,
    looksLikeStock: !isOfficial(t) && /robinhood|•/i.test(t.name || ''),
    contract: contract
      ? {
          name: contract.name || null,
          verified: Boolean(contract.is_verified),
          scam: Boolean(contract.is_scam),
          proxy: contract.proxy_type || null,
          implementation: contract.implementations?.[0] ? { address: contract.implementations[0].address_hash || contract.implementations[0].address, name: contract.implementations[0].name || null } : null,
          creator: contract.creator_address_hash || null,
          creationTx: contract.creation_transaction_hash || null,
        }
      : null,
    topHolders: holderRows,
    top10Pct: holderRows.slice(0, 10).reduce((s, h) => s + (h.sharePct || 0), 0),
    recentTransfers: (transfers?.items || []).slice(0, 25).map((x) => ({
      tx: x.transaction_hash,
      from: x.from?.hash,
      fromName: x.from?.name || null,
      to: x.to?.hash,
      toName: x.to?.name || null,
      amount: x.total?.value ?? null,
      decimals: num(x.total?.decimals) ?? decimals,
      time: x.timestamp ? Date.parse(x.timestamp) : null,
      method: x.method || null,
    })),
  };
}

// Price history from CoinGecko (tokens it tracks on Robinhood Chain), mainnet only.
// Market data for every listed stock token in two CoinGecko calls per 10 minutes, no matter
// how many portfolios are open: the contract -> id map (daily) and one markets call per
// 100 ids with 24 h change and the hourly 7-day sparkline.
function robinhoodIds() {
  return cached('cg:rh-ids', 24 * 3600_000, async () => {
    const headers = COINGECKO.key ? { [COINGECKO.pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: COINGECKO.key } : {};
    const list = await cgJSON(`${COINGECKO.base}/coins/list?include_platform=true`, { headers, timeout: 30_000 });
    const map = {};
    for (const c of list) {
      const a = c.platforms?.robinhood;
      if (a) map[a.toLowerCase()] = c.id;
    }
    return map;
  });
}
export function stockMarkets(net) {
  if (!NETWORKS[net].llamaChain) return Promise.resolve({ value: {} });
  return cached(`cg:stock-markets:${net}`, 10 * 60_000, async () => {
    const headers = COINGECKO.key ? { [COINGECKO.pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: COINGECKO.key } : {};
    const [{ value: ids }, { value: stocks }] = await Promise.all([robinhoodIds(), stockTokens(net)]);
    const byId = new Map(stocks.map((s) => [ids[s.address.toLowerCase()], s.address]).filter(([id]) => id));
    const wanted = [...byId.keys()];
    const out = {};
    for (let i = 0; i < wanted.length; i += 100) {
      const rows = await cgJSON(`${COINGECKO.base}/coins/markets?vs_currency=usd&ids=${wanted.slice(i, i + 100).join(',')}&sparkline=true&price_change_percentage=24h&per_page=250`, { headers, timeout: 20_000 });
      for (const m of rows) {
        const prices = m.sparkline_in_7d?.price || [];
        const end = Date.parse(m.last_updated) || Date.now();
        out[byId.get(m.id).toLowerCase()] = {
          id: m.id,
          price: m.current_price,
          change24h: m.price_change_percentage_24h != null ? m.price_change_percentage_24h / 100 : null,
          points: prices.map((v, k) => ({ t: end - (prices.length - 1 - k) * 3_600_000, v })),
        };
      }
    }
    return out;
  });
}

export async function tokenPriceHistory(net, addr, days) {
  if (!NETWORKS[net].llamaChain) throw Object.assign(new Error('Price history is only tracked on mainnet'), { status: 404 });
  const headers = COINGECKO.key ? { [COINGECKO.pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: COINGECKO.key } : {};
  const { value: id } = await cached(`cg:id:${addr.toLowerCase()}`, 24 * 3600_000, async () => {
    try {
      const c = await cgJSON(`${COINGECKO.base}/coins/robinhood/contract/${addr.toLowerCase()}`, { headers, timeout: 15_000 });
      return c.id || null;
    } catch (err) {
      if (err.httpStatus === 404) return null; // not listed: remember that, too
      throw err;
    }
  });
  if (!id) return { id: null, points: [] };
  const { value } = await cached(`cg:chart:${id}:${days}`, 30 * 60_000, async () => {
    const d = await cgJSON(`${COINGECKO.base}/coins/${id}/market_chart?vs_currency=usd&days=${days}`, { headers, timeout: 20_000 });
    return (d.prices || []).map(([t, v]) => ({ t, v }));
  });
  return { id, points: value };
}

// ---------------- ETH price & news ----------------

export function ethPrice() {
  return cached('cg:eth', 60_000, async () => {
    const headers = COINGECKO.key ? { [COINGECKO.pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: COINGECKO.key } : {};
    const d = await cgJSON(`${COINGECKO.base}/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true`, { headers, timeout: 10_000 });
    return { usd: d.ethereum?.usd ?? null, ch24h: d.ethereum?.usd_24h_change ?? null };
  });
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .trim();

export function news() {
  return cached('news:robinhood', 15 * 60_000, async () => {
    const res = await fetch('https://cointelegraph.com/rss', { headers: { 'user-agent': 'aeon-network/1.0' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`news ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
      const tag = (name) => decode(body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] || '');
      return { title: tag('title'), link: tag('link'), date: new Date(tag('pubDate')).getTime() || null, summary: tag('description').slice(0, 240), source: 'Cointelegraph' };
    });
    // Only stories about Robinhood / its chain / tokenized stocks.
    return items.filter((i) => /robinhood|tokenized stock|stock token/i.test(i.title + ' ' + i.summary) && /^https?:/.test(i.link));
  });
}
