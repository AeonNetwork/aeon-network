// Dev Checker: the track record of a token creator on Pons. Every launch by the wallet (from the
// factory's launch events since Pons went live), each token's bonding curve today, and what the
// creator did with their own tokens: bought, sold back into the curve, burned, or moved to other
// wallets. Flags come with the evidence behind them.
import { cached } from '../lib/cache.js';
import * as chain from './chain.js';
import * as alc from './alchemy.js';
import { PONS, ponsRpc, decodeString, toEth, curveOf } from './radar.js';

const NET = 'mainnet';
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
const DETAIL = 60; // tokens read in full, newest first
const DAY = 86_400_000;
const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const topicAddr = (t) => '0x' + t.slice(26);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Every launch by this wallet, oldest first (the RPC allows 10M blocks per query).
async function launchesBy(dev) {
  const head = Number(await ponsRpc('eth_blockNumber', []));
  const out = [];
  for (let from = PONS.FIRST_BLOCK; from <= head; from += 10_000_000) {
    const logs = await ponsRpc('eth_getLogs', [{ address: PONS.FACTORY, topics: [PONS.LAUNCH, null, null, pad(dev)], fromBlock: '0x' + from.toString(16), toBlock: '0x' + Math.min(head, from + 9_999_999).toString(16) }]);
    for (const l of logs) out.push({ token: topicAddr(l.topics[1]), curve: topicAddr(l.topics[2]), block: Number(l.blockNumber), tx: l.transactionHash });
  }
  return out;
}

// Curve state and names, through the keyed RPC in small batches.
async function readTokens(list, dev) {
  const S = PONS.SEL;
  const plan = [];
  for (const t of list) {
    for (const k of ['realQuote', 'threshold', 'graduated', 'launchedAt', 'native', 'pair', 'launchSupply']) plan.push([t, k, t.curve, S[k]]);
    plan.push([t, 'name', t.token, S.name], [t, 'symbol', t.token, S.symbol], [t, 'balance', t.token, '0x70a08231' + pad(dev).slice(2)]);
  }
  // Small batches, retried: the keyed RPC caps compute per second.
  const batch = async (part) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await chain.rpcBatch(NET, part.map(([, , to, data]) => ['eth_call', [{ to, data }, 'latest']])).catch(() => null);
      if (res && res.filter((r) => r instanceof Error).length < part.length / 2) return res;
      await wait(1500 * (attempt + 1));
    }
    return part.map(() => null);
  };
  for (let i = 0; i < plan.length; i += 20) {
    const part = plan.slice(i, i + 20);
    const res = await batch(part);
    part.forEach(([t, k], j) => {
      const r = res[j];
      if (!r || r instanceof Error || r === '0x') return;
      if (k === 'realQuote') t.raised = toEth(r);
      else if (k === 'threshold') t.threshold = toEth(r);
      else if (k === 'graduated') t.graduated = BigInt(r) === 1n;
      else if (k === 'launchedAt') t.launchedAt = Number(BigInt(r)) * 1000;
      else if (k === 'native') t.native = BigInt(r) === 1n;
      else if (k === 'pair') t.pair = '0x' + r.slice(26);
      else if (k === 'launchSupply') t.supply = toEth(r);
      else if (k === 'name') t.name = decodeString(r);
      else if (k === 'symbol') t.symbol = decodeString(r);
      else if (k === 'balance') t.holds = toEth(r);
    });
    if (i + 20 < plan.length) await wait(350);
  }
}

// What the creator did with their own tokens.
// Curves paid in another token: that token's symbol and decimals.
async function quoteTokens(list) {
  for (const t of list.filter((x) => x.native === false && x.pair)) {
    const m = await chain.tokenMeta(NET, t.pair).catch(() => null);
    if (m) (t.quoteSymbol = m.symbol || 'tokens'), (t.quoteDecimals = m.decimals ?? 18);
  }
}

async function devFlows(list, dev) {
  const byToken = new Map(list.map((t) => [t.token, t]));
  for (const t of list) Object.assign(t, { bought: 0, sold: 0, burned: 0, moved: 0, received: 0 });
  const tokens = list.map((t) => t.token);
  for (let i = 0; i < tokens.length; i += 100) {
    const contracts = tokens.slice(i, i + 100);
    const [ins, outs] = await Promise.all([alc.transfers(NET, { contracts, toAddress: dev, max: 3000 }), alc.transfers(NET, { contracts, fromAddress: dev, max: 3000 })]);
    for (const x of ins) {
      const t = byToken.get(x.rawContract?.address?.toLowerCase());
      if (!t) continue;
      const v = Number(x.value) || 0;
      if (x.from?.toLowerCase() === t.curve) t.bought += v;
      else t.received += v;
    }
    for (const x of outs) {
      const t = byToken.get(x.rawContract?.address?.toLowerCase());
      if (!t) continue;
      const v = Number(x.value) || 0, to = x.to?.toLowerCase();
      if (to === t.curve) t.sold += v;
      else if (BURN.has(to)) t.burned += v;
      else t.moved += v;
    }
  }
}

export function devCheck(addr) {
  if (!ADDR.test(addr || '')) throw Object.assign(new Error('Paste a wallet address (0x + 40 hex characters)'), { status: 400 });
  const dev = addr.toLowerCase();
  return cached(`dev:${dev}`, 5 * 60_000, () => run(dev), { maxStaleMs: 3600_000 }).then((r) => ({ ...r.value, stale: r.stale }));
}

async function run(dev) {
  const all = await launchesBy(dev);
  const now = Date.now();
  const recent = all.slice(-DETAIL).reverse();
  // Tokens the radar already tracks give a head start on their state.
  for (const t of recent) {
    const k = curveOf(t.token);
    if (k) Object.assign(t, { name: k.name, symbol: k.symbol, launchedAt: k.launchedAt, threshold: k.threshold, native: k.native });
  }
  await readTokens(recent, dev);
  await quoteTokens(recent);
  await devFlows(recent, dev);

  const rows = recent.map((t) => {
    const age = t.launchedAt ? now - t.launchedAt : null;
    // Dead: a day old and under 2.5% of the way to graduating (0.1 of 4.2 ETH), whatever the quote.
    const progress = t.threshold ? (t.raised ?? 0) / t.threshold : null;
    const status = t.graduated ? 'graduated' : age != null && age > DAY && progress != null && progress < 0.025 ? 'dead' : 'live';
    const got = t.bought + t.received;
    const out = t.sold + t.burned + t.moved;
    const action = !got && !out ? 'none' : t.sold >= got * 0.5 && t.sold > 0 ? 'sold' : t.burned >= got * 0.5 && t.burned > 0 ? 'burned' : t.moved >= got * 0.5 && t.moved > 0 ? 'moved' : (t.holds ?? 0) > 0 ? 'holds' : out ? 'mixed' : 'none';
    const pct = (v) => (t.supply ? (v / t.supply) * 100 : null);
    return {
      token: t.token,
      symbol: t.symbol || null,
      name: t.name || null,
      curve: t.curve,
      tx: t.tx,
      launchedAt: t.launchedAt ?? null,
      // Curves paid in another token report amounts in that token (stored in 18-decimal units).
      quote: t.native === false ? t.quoteSymbol || 'tokens' : 'ETH',
      raised: t.raised == null ? null : t.native === false ? t.raised * 10 ** (18 - (t.quoteDecimals ?? 18)) : t.raised,
      threshold: t.threshold == null ? null : t.native === false ? t.threshold * 10 ** (18 - (t.quoteDecimals ?? 18)) : t.threshold,
      progress: t.threshold ? Math.min(1, (t.raised ?? 0) / t.threshold) : null,
      graduated: Boolean(t.graduated),
      status,
      dev: { boughtPct: pct(t.bought), receivedPct: pct(t.received), soldPct: pct(t.sold), burnedPct: pct(t.burned), movedPct: pct(t.moved), holdsPct: pct(t.holds ?? 0), action },
    };
  });

  const n = all.length;
  const day = rows.filter((r) => r.launchedAt && now - r.launchedAt < DAY).length;
  const week = rows.filter((r) => r.launchedAt && now - r.launchedAt < 7 * DAY).length;
  const graduated = rows.filter((r) => r.graduated).length;
  const dead = rows.filter((r) => r.status === 'dead').length;
  const traded = rows.filter((r) => r.dev.action !== 'none');
  const sold = rows.filter((r) => r.dev.action === 'sold');
  const burned = rows.filter((r) => r.dev.action === 'burned');
  const moved = rows.filter((r) => r.dev.action === 'moved' || (r.dev.movedPct ?? 0) > 1);
  const raised = rows.reduce((s, r) => s + (r.quote === 'ETH' ? r.raised || 0 : 0), 0);
  const best = [...rows].sort((a, b) => (b.graduated - a.graduated) || (b.raised ?? 0) - (a.raised ?? 0))[0] || null;

  const flags = [];
  const add = (level, title, detail) => flags.push({ level, title, detail });
  if (!n) add('info', 'No Pons launches', 'This wallet has not launched a token on Pons.');
  if (day >= 5 || n >= 20) add('warn', 'Serial launcher', `${n} launches in total${day ? `, ${day} in the last 24 hours` : ''}. Wallets that launch many tokens rarely stay with any of them.`);
  if (sold.length && sold.length >= Math.max(1, traded.length * 0.3)) add('fail', 'Sells into buyers', `Sold most of their own tokens back into the curve on ${sold.length} of ${traded.length} tokens they traded.`);
  else if (sold.length) add('warn', 'Has sold before', `Sold their own tokens into the curve on ${sold.length} token(s).`);
  if (moved.length >= 2) add('warn', 'Moves tokens to other wallets', `Sent their tokens to other wallets on ${moved.length} tokens. Those wallets can sell without showing up as the dev.`);
  if (burned.length) add('pass', 'Burned their own buys', `Burned most of their tokens on ${burned.length} launch(es).`);
  if (graduated) add('pass', `${graduated} graduated`, `${graduated} of the last ${rows.length} launches filled their bonding curve.`);
  else if (rows.length >= 5) add('warn', 'None graduated', `None of the last ${rows.length} launches filled its bonding curve.`);
  if (rows.length >= 5 && dead / rows.length >= 0.7) add('warn', 'Most launches died', `${dead} of the last ${rows.length} reached less than 2.5% of their graduation target after a day.`);
  const fails = flags.filter((f) => f.level === 'fail').length, warns = flags.filter((f) => f.level === 'warn').length;
  const verdict = !n ? 'No launches to judge.' : fails ? 'High risk: this creator has sold into their own buyers.' : warns >= 2 ? 'Caution: several warning signs in this creator\'s history.' : warns ? 'Mostly clean, with one thing to keep in mind.' : 'No red flags in this creator\'s Pons history.';

  return {
    at: now,
    address: dev,
    verdict,
    risk: !n ? 'none' : fails ? 'high' : warns >= 2 ? 'caution' : 'low',
    stats: { launches: n, launches24h: day, launches7d: week, detailed: rows.length, graduated, dead, devSold: sold.length, devBurned: burned.length, devMoved: moved.length, devTraded: traded.length, raisedEth: raised, firstLaunch: all[0]?.block ?? null },
    best: best && { token: best.token, symbol: best.symbol, raised: best.raised, graduated: best.graduated },
    flags,
    rows,
    note: `Launches from the Pons factory since it went live; the newest ${DETAIL} are read in full. Amounts are % of each token's launch supply. Not financial advice.`,
  };
}
