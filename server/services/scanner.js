// Token Safety Scanner: reads a token's contract and history straight from the chain and turns
// what it finds into plain checks. Bytecode (and the implementation behind a proxy) is searched
// for admin functions, the owner is read, a transfer is simulated from a real holder, holders are
// rebuilt from the full transfer history, and liquidity comes from DEX Screener. Every check
// carries its evidence; none of it needs Blockscout.
import { toFunctionSelector } from 'viem';
import { NETWORKS } from '../config.js';
import { cached } from '../lib/cache.js';
import * as chain from './chain.js';
import * as eco from './ecosystem.js';
import * as alc from './alchemy.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const BURN = new Set([ZERO, '0x000000000000000000000000000000000000dead']);
const SLOT_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'; // EIP-1967
const SLOT_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const PROBE = '0x00000000000000000000000000000000000a3011'; // recipient for the transfer simulation

// Admin powers worth knowing about, found by their selectors in the bytecode.
const POWERS = {
  mint: { label: 'Can mint new tokens', sigs: ['mint(address,uint256)', 'mint(uint256)', 'mintTo(address,uint256)', 'issue(address,uint256)'] },
  pause: { label: 'Can pause transfers', sigs: ['pause()', 'setPaused(bool)', 'pauseTransfers()'] },
  blacklist: { label: 'Can block wallets', sigs: ['blacklist(address)', 'addToBlacklist(address)', 'setBlacklist(address,bool)', 'addBlacklist(address)', 'blacklistAddress(address,bool)', 'setBlacklisted(address,bool)', 'freeze(address)', 'freezeAccount(address)', 'setBots(address[],bool)', 'blockBots(address[])'] },
  fees: { label: 'Can change buy/sell tax', sigs: ['setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxFeePercent(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)', 'setTax(uint256)', 'setTaxes(uint256,uint256)', 'updateFees(uint256,uint256)', 'updateBuyFees(uint256,uint256,uint256)', 'updateSellFees(uint256,uint256,uint256)', 'setBuyTax(uint256)', 'setSellTax(uint256)'] },
  limits: { label: 'Can limit trade or wallet size', sigs: ['setMaxTxAmount(uint256)', 'setMaxWalletSize(uint256)', 'setMaxTxPercent(uint256)', 'setMaxWallet(uint256)', 'setMaxWalletAmount(uint256)', 'updateMaxTxnAmount(uint256)', 'updateMaxWalletAmount(uint256)'] },
  trading: { label: 'Owner switches trading on', sigs: ['enableTrading()', 'openTrading()', 'setTradingEnabled(bool)', 'setTrading(bool)'] },
  roles: { label: 'Role-based admin', sigs: ['grantRole(bytes32,address)'] },
  upgrade: { label: 'Upgradeable code', sigs: ['upgradeTo(address)', 'upgradeToAndCall(address,bytes)'] },
};
for (const p of Object.values(POWERS)) p.selectors = p.sigs.map((s) => [s, toFunctionSelector(s).slice(2)]);
const SEL = { owner: '0x8da5cb5b', paused: '0x5c975abb', balanceOf: '0x70a08231', transfer: '0xa9059cbb' };

const word = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const addrFrom = (w) => (w && w.length >= 66 ? '0x' + w.slice(-40) : null);
// PUSH4 <selector>, at a byte boundary (the string starts with 0x, so byte offsets are even).
const hasPush4 = (code, sel) => {
  for (let i = code.indexOf('63' + sel); i >= 0; i = code.indexOf('63' + sel, i + 1)) if (i % 2 === 0) return true;
  return false;
};

async function safe(p) {
  try {
    return await p;
  } catch {
    return null;
  }
}

// Full balances from the token's whole transfer history (oldest first), when it fits in 10 pages.
async function holdersFromHistory(net, token, decimals, { ageOnly = false } = {}) {
  if (!alc.alchemyEnabled(net)) return null;
  const rows = await alc.transfers(net, { contracts: [token], fromBlock: 0, order: 'asc', max: ageOnly ? 1 : 10_000, pages: ageOnly ? 1 : 10 });
  const first = rows[0]?.metadata?.blockTimestamp ? Date.parse(rows[0].metadata.blockTimestamp) : null;
  const dayAgo = Date.now() - 86_400_000;
  if (!rows.complete) return { complete: false, firstTransfer: first, transfers: null };
  const bal = new Map();
  let day = 0;
  for (const t of rows) {
    const v = BigInt(t.rawContract?.value || '0x0');
    const f = t.from?.toLowerCase(), to = t.to?.toLowerCase();
    if (f) bal.set(f, (bal.get(f) ?? 0n) - v);
    if (to) bal.set(to, (bal.get(to) ?? 0n) + v);
    if (t.metadata?.blockTimestamp && Date.parse(t.metadata.blockTimestamp) > dayAgo) day++;
  }
  bal.delete(ZERO); // the mint side
  const list = [...bal].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  return { complete: true, firstTransfer: first, transfers: rows.length, transfers24h: day, holders: list.length, list: list.map(([address, raw]) => ({ address, raw, amount: alc.units('0x' + raw.toString(16), decimals) })) };
}

async function dexLiquidity(net, token) {
  if (net !== 'mainnet') return null;
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`DEX Screener HTTP ${r.status}`);
  const pairs = ((await r.json()).pairs || []).filter((p) => p.chainId === 'robinhood');
  return {
    pairs: pairs.length,
    liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd || 0), 0),
    volume24h: pairs.reduce((s, p) => s + (p.volume?.h24 || 0), 0),
    priceUsd: pairs[0]?.priceUsd ? Number(pairs[0].priceUsd) : null,
    marketCap: pairs[0]?.marketCap ?? pairs[0]?.fdv ?? null,
    top: pairs.slice(0, 3).map((p) => ({ dex: p.dexId, pair: p.pairAddress, url: p.url, liquidityUsd: p.liquidity?.usd ?? 0, quote: p.quoteToken?.symbol })),
    url: pairs[0]?.url || null,
  };
}

// The token's Pons bonding curve, if it has one: known from the radar, or found among the largest
// contract holders (a Pons curve answers token() with the token's address).
async function ponsCurve(net, token, holders) {
  if (net !== 'mainnet') return null;
  const { curveOf } = await import('./radar.js');
  const candidates = [curveOf(token)?.curve, ...(holders?.top || []).filter((h) => h.isContract).slice(0, 2).map((h) => h.address)].filter(Boolean);
  for (const c of [...new Set(candidates)]) {
    const r = await safe(chain.rpcBatch(net, [['eth_call', [{ to: c, data: '0xfc0c546a' }, 'latest']], ['eth_call', [{ to: c, data: '0x4f1f58fd' }, 'latest']], ['eth_call', [{ to: c, data: '0x8b0bc501' }, 'latest']], ['eth_call', [{ to: c, data: '0xe7c2b772' }, 'latest']], ['eth_call', [{ to: c, data: '0xd5f39488' }, 'latest']]]));
    if (!r || r.slice(0, 4).some((x) => x instanceof Error || !x || x === '0x')) continue;
    if (addrFrom(r[0]) !== token) continue;
    return { address: c, raised: Number(BigInt(r[1])) / 1e18, threshold: Number(BigInt(r[2])) / 1e18, graduated: BigInt(r[3]) === 1n, creator: r[4] && !(r[4] instanceof Error) && r[4] !== '0x' ? addrFrom(r[4]) : null };
  }
  return null;
}

export function scan(net, token) {
  if (!NETWORKS[net]) throw Object.assign(new Error('unknown network'), { status: 400 });
  if (!ADDR.test(token || '')) throw Object.assign(new Error('Enter a token contract address (0x + 40 hex characters)'), { status: 400 });
  return cached(`scan:${net}:${token.toLowerCase()}`, 10 * 60_000, () => run(net, token.toLowerCase()), { maxStaleMs: 3600_000 }).then((r) => ({ ...r.value, stale: r.stale }));
}

async function run(net, token) {
  const code = await chain.rpc(net, 'eth_getCode', [token, 'latest']);
  if (!code || code === '0x') throw Object.assign(new Error('No contract at this address. Paste the token contract, not a wallet.'), { status: 404 });
  const meta = await chain.tokenMeta(net, token);

  // Proxy? Then the code that runs is the implementation's.
  const [implW, beaconW] = await Promise.all([safe(chain.rpc(net, 'eth_getStorageAt', [token, SLOT_IMPL, 'latest'])), safe(chain.rpc(net, 'eth_getStorageAt', [token, SLOT_BEACON, 'latest']))]);
  let impl = addrFrom(implW);
  if (impl === ZERO) impl = null;
  const beacon = addrFrom(beaconW) !== ZERO ? addrFrom(beaconW) : null;
  if (!impl && beacon) impl = addrFrom(await safe(chain.rpc(net, 'eth_call', [{ to: beacon, data: '0x5c60da1b' }, 'latest'])));
  const implCode = impl ? (await safe(chain.rpc(net, 'eth_getCode', [impl, 'latest']))) || '' : '';
  const body = (code + implCode).toLowerCase();

  const stocks = NETWORKS[net].blockscoutPro ? await eco.stockTokens(net).then((r) => r.value).catch(() => []) : [];
  const isStock = stocks.some((s) => s.address.toLowerCase() === token);
  const [ownerW, pausedW, history, dex] = await Promise.all([
    safe(chain.rpc(net, 'eth_call', [{ to: token, data: SEL.owner }, 'latest'])),
    safe(chain.rpc(net, 'eth_call', [{ to: token, data: SEL.paused }, 'latest'])),
    // Official stocks have millions of transfers: only their first one is read (for age).
    safe(holdersFromHistory(net, token, meta.decimals, { ageOnly: isStock })),
    safe(dexLiquidity(net, token)),
  ]);
  const owner = ownerW && ownerW !== '0x' ? addrFrom(ownerW) : null;
  const renounced = owner === ZERO || owner === '0x000000000000000000000000000000000000dead';
  const paused = pausedW && pausedW !== '0x' ? BigInt(pausedW) === 1n : null;

  const official = stocks.find((s) => s.address.toLowerCase() === token) || null;
  const twin = !official && stocks.find((s) => (s.symbol || '').toUpperCase() === (meta.symbol || '').toUpperCase());
  const robinhoodName = !official && /robinhood/i.test(meta.name || '');

  const powers = {};
  for (const [k, p] of Object.entries(POWERS)) {
    const found = p.selectors.filter(([, s]) => hasPush4(body, s)).map(([sig]) => sig);
    if (found.length) powers[k] = found;
  }

  // Holders: full history when it fits; otherwise the last saved explorer list.
  let holders = null;
  if (history?.complete) {
    const supply = meta.totalSupply ? BigInt(meta.totalSupply) : history.list.reduce((s, h) => s + h.raw, 0n);
    const top = history.list.slice(0, 15);
    const flags = await Promise.all(top.map((h) => (BURN.has(h.address) ? true : safe(alc.isContract(net, h.address)))));
    const pct = (raw) => (supply > 0n ? Number((raw * 1_000_000n) / supply) / 10_000 : null);
    const rows = top.map((h, i) => ({ address: h.address, amount: h.amount, pct: pct(h.raw), isContract: Boolean(flags[i]) && !BURN.has(h.address), burn: BURN.has(h.address) }));
    const wallets = rows.filter((r) => !r.isContract && !r.burn);
    holders = { source: 'full transfer history (Alchemy)', count: history.holders, top: rows, top10WalletsPct: wallets.slice(0, 10).reduce((s, r) => s + (r.pct || 0), 0), largestWalletPct: wallets[0]?.pct ?? 0, contractsPct: rows.filter((r) => r.isContract).reduce((s, r) => s + (r.pct || 0), 0) };
  } else {
    const saved = await safe(eco.bs(net, `/tokens/${token}/holders`, 10 * 60_000));
    const items = saved?.value?.items || [];
    if (items.length) {
      const supply = meta.totalSupply ? BigInt(meta.totalSupply) : 0n;
      const pct = (v) => (supply > 0n ? Number((BigInt(v) * 1_000_000n) / supply) / 10_000 : null);
      const rows = items.slice(0, 15).map((h) => ({ address: h.address?.hash?.toLowerCase(), amount: alc.units('0x' + BigInt(h.value || 0).toString(16), meta.decimals), pct: pct(h.value || '0'), isContract: Boolean(h.address?.is_contract), burn: BURN.has(h.address?.hash?.toLowerCase()) }));
      const wallets = rows.filter((r) => !r.isContract && !r.burn);
      holders = { source: 'explorer holder list', count: official?.holders ?? null, top: rows, top10WalletsPct: wallets.slice(0, 10).reduce((s, r) => s + (r.pct || 0), 0), largestWalletPct: wallets[0]?.pct ?? 0, contractsPct: rows.filter((r) => r.isContract).reduce((s, r) => s + (r.pct || 0), 0) };
    }
  }

  // Can a real holder move the token? Simulate a 1-unit transfer from the largest wallet.
  let transferSim = null;
  const sender = holders?.top.find((h) => !h.isContract && !h.burn && h.amount > 0);
  if (sender) {
    const data = SEL.transfer + word(PROBE) + (1n).toString(16).padStart(64, '0');
    try {
      const r = await chain.rpc(net, 'eth_call', [{ from: sender.address, to: token, data }, 'latest']);
      transferSim = { ok: r === '0x' || BigInt(r) === 1n, from: sender.address };
    } catch (err) {
      transferSim = { ok: false, from: sender.address, reason: String(err.message).slice(0, 160) };
    }
  }

  // ---------- checks ----------
  const checks = [];
  const add = (id, level, title, detail, penalty = 0) => checks.push({ id, level, title, detail, penalty });
  const live = !renounced; // owner powers matter only while someone holds them
  const issuer = Boolean(official);

  if (official) add('official', 'pass', 'Official Robinhood stock token', `${official.name} (${official.symbol}), ERC-8056, issued by Robinhood.`);
  else if (twin) add('lookalike', 'fail', `Copies the ticker of an official stock`, `${meta.symbol} is not the official ${twin.symbol} token. The official contract is ${twin.address}.`, 40);
  else if (robinhoodName) add('lookalike', 'fail', 'Uses the Robinhood name without being official', `"${meta.name}" is not in Robinhood's list of official stock tokens.`, 35);

  if (paused === true) add('paused', 'fail', 'Transfers are paused right now', 'paused() returns true.', 30);
  if (transferSim) {
    if (transferSim.ok) add('transfer', 'pass', 'Holders can transfer', `A simulated transfer from ${transferSim.from} succeeded.`);
    else add('transfer', 'fail', 'Transfers revert', `A simulated transfer from a real holder (${transferSim.from}) failed${transferSim.reason ? `: ${transferSim.reason}` : ''}. Possible honeypot or blocked wallet.`, 35);
  } else add('transfer', 'info', 'Transfer not simulated', 'No individual holder was found to simulate from.');

  if (owner == null) add('owner', powers.roles ? 'warn' : 'info', powers.roles ? 'Admin by roles' : 'No owner() function', powers.roles ? 'Uses role-based access (grantRole): admins are not visible through owner().' : 'The contract does not expose a single owner.', powers.roles && !issuer ? 5 : 0);
  else if (renounced) add('owner', 'pass', 'Ownership renounced', 'owner() is the zero/dead address: owner-only functions can no longer be called.');
  else add('owner', issuer ? 'info' : 'warn', 'Owner can act', `owner() is ${owner}.`, issuer ? 0 : 5);

  if (impl || powers.upgrade) add('proxy', issuer ? 'info' : 'warn', 'Upgradeable contract', impl ? `Proxy pointing to ${impl}: the code can be replaced by its admin.` : 'Upgrade functions found in the bytecode.', issuer ? 0 : 15);
  else add('proxy', 'pass', 'Code cannot be upgraded', 'No proxy slot set and no upgrade functions found.');

  const POWER_PENALTY = { mint: 20, pause: 10, blacklist: 15, fees: 15, limits: 5, trading: 5 };
  for (const [k, pen] of Object.entries(POWER_PENALTY)) {
    if (!powers[k]) continue;
    const level = issuer ? 'info' : live ? (pen >= 15 ? 'fail' : 'warn') : 'info';
    add(k, level, POWERS[k].label, `${powers[k].join(', ')} found in the bytecode${!live ? ', but ownership is renounced' : ''}${issuer ? '; expected for a regulated issuer' : ''}.`, issuer || !live ? 0 : pen);
  }
  if (!['mint', 'pause', 'blacklist', 'fees'].some((k) => powers[k])) add('powers', 'pass', 'No mint, pause, blacklist or tax switches', 'None of the common admin functions were found in the bytecode.');

  if (holders) {
    const t = holders.top10WalletsPct, l = holders.largestWalletPct;
    const level = issuer ? 'info' : t > 50 || l > 20 ? 'fail' : t > 30 || l > 10 ? 'warn' : 'pass';
    add('holders', level, level === 'pass' ? 'Supply is spread out' : 'Supply is concentrated', `Top 10 wallets hold ${t.toFixed(1)}%, the largest ${l.toFixed(1)}%${holders.contractsPct ? `; contracts (pools, curves, vaults) hold ${holders.contractsPct.toFixed(1)}%` : ''}.`, issuer ? 0 : level === 'fail' ? 15 : level === 'warn' ? 7 : 0);
  } else add('holders', 'info', 'Holder spread not measured', 'History too long to rebuild here and no saved holder list.');

  // Launched on Pons and still on its bonding curve? Then the curve is the market, not a DEX pool.
  const curve = await ponsCurve(net, token, holders);
  if (curve && !curve.graduated) {
    add('liquidity', 'info', 'Trading on the Pons bonding curve', `${curve.raised.toFixed(3)} ETH raised of ${curve.threshold} ETH needed to graduate (${Math.round((curve.raised / curve.threshold) * 100)}%). Curve ${curve.address}.`);
  } else if (dex) {
    if (!dex.pairs) add('liquidity', issuer ? 'info' : 'warn', 'No DEX pool found', issuer ? 'Stock tokens trade through Robinhood rather than DEX pools.' : 'DEX Screener lists no pool. If it launched on a bonding curve (e.g. Pons), trading happens on the curve until it graduates.', issuer ? 0 : 8);
    else if (dex.liquidityUsd < 5000) add('liquidity', 'warn', 'Thin DEX liquidity', `$${dex.liquidityUsd.toFixed(2)} across ${dex.pairs} pool(s). Large sells will move the price a lot.${holders?.contractsPct > 50 ? ` A contract holds ${holders.contractsPct.toFixed(0)}% of supply: if that is a bonding curve (e.g. Pons), most trading happens there until it graduates.` : ''}`, issuer ? 0 : 8);
    else add('liquidity', 'pass', 'DEX liquidity', `$${Math.round(dex.liquidityUsd).toLocaleString('en-US')} across ${dex.pairs} pool(s).`);
  }

  const first = history?.firstTransfer;
  if (first) {
    const days = (Date.now() - first) / 86_400_000;
    const level = days < 1 ? 'warn' : days < 7 ? 'info' : 'pass';
    add('age', level, days < 1 ? 'Brand-new token' : `${Math.floor(days)} days old`, `First transfer ${new Date(first).toISOString().slice(0, 10)}.`, level === 'warn' && !issuer ? 8 : 0);
  }

  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  const fails = checks.filter((c) => c.level === 'fail');
  const verdict = fails.length ? `${fails.length} serious flag${fails.length > 1 ? 's' : ''}: ${fails.map((c) => c.title.toLowerCase()).join('; ')}.` : checks.some((c) => c.level === 'warn') ? 'No serious flags. A few things to keep in mind below.' : 'No red flags found in the contract or its holders.';

  return {
    at: Date.now(),
    network: net,
    token: { address: token, name: meta.name, symbol: meta.symbol, decimals: meta.decimals, totalSupply: meta.totalSupply, supply: meta.totalSupply ? alc.units('0x' + BigInt(meta.totalSupply).toString(16), meta.decimals) : null },
    score,
    grade,
    verdict,
    official: official ? { name: official.name, symbol: official.symbol } : null,
    contract: { codeBytes: (code.length - 2) / 2, proxy: impl ? { implementation: impl, beacon } : null, owner, renounced, paused, powers },
    pons: curve ? { curve: curve.address, creator: curve.creator, raised: curve.raised, threshold: curve.threshold, graduated: curve.graduated } : null,
    holders,
    activity: history ? { firstTransfer: history.firstTransfer, transfers: history.transfers, transfers24h: history.transfers24h ?? null } : null,
    dex,
    checks: checks.sort((a, b) => ['fail', 'warn', 'info', 'pass'].indexOf(a.level) - ['fail', 'warn', 'info', 'pass'].indexOf(b.level)),
    note: 'Automated on-chain checks. They find common risks but cannot prove a token is safe. Not financial advice.',
  };
}
