// Network Pulse: Robinhood Chain today, in one report. Every figure comes from a live source
// (RPC + Aeon's indexer, DefiLlama, Alchemy-fed whale scan) and carries day-over-day change
// where the source provides it. None of it needs Blockscout credits.
import { NETWORKS } from '../config.js';
import { cached } from '../lib/cache.js';
import * as chain from './chain.js';
import * as eco from './ecosystem.js';
import * as indexer from './indexer.js';
import * as whales from './whales.js';

const NET = 'mainnet';
const val = (r) => (r.status === 'fulfilled' ? r.value?.value ?? r.value : null);
const dayChange = (series) => {
  // series: [{ t, v }] daily; change of the last full day vs the one before
  if (!Array.isArray(series) || series.length < 2) return { now: null, change: null };
  const a = series.at(-2).v, b = series.at(-1).v;
  return { now: b, change: a ? (b - a) / a : null };
};

export function pulse() {
  return cached('pulse:mainnet', 60_000, async () => {
    const [bn, gas, price, summary, tvl, dex, fees, stables, stocks] = await Promise.allSettled([
      chain.blockNumber(NET),
      chain.gasPrice(NET),
      eco.ethPrice(),
      eco.chainSummary(NET),
      eco.tvlHistory(NET),
      eco.dexVolume(NET),
      eco.fees(NET),
      eco.stablecoins(NET),
      eco.stockTokens(NET),
    ]);
    const ix = indexer.summary(NET) || {};
    const gasWei = val(gas);
    const ethUsd = val(price)?.usd ?? null;
    const transferUsd = gasWei && ethUsd ? (Number(gasWei) * 21_000 * ethUsd) / 1e18 : null;
    const tv = dayChange(val(tvl));
    const st = dayChange(val(stables));
    const dx = val(dex), fe = val(fees), sm = val(summary);
    const stockList = val(stocks) || [];
    const wh = whales.whales({ min: 10_000 });
    const out = {
      at: Date.now(),
      chainId: NETWORKS[NET].chainId,
      network: {
        block: val(bn)?.value ?? val(bn) ?? ix.lastBlock ?? null,
        blockTimeMs: ix.blockTime ? ix.blockTime * 1000 : null,
        tps: ix.tps ?? null,
        txsHour: ix.hour?.txs ?? null,
        // A 24 h total is only stated once the indexer has watched a full day.
        txsDay: (ix.coverageHours ?? 0) >= 23 ? ix.day?.txs ?? null : null,
        coverageHours: ix.coverageHours ?? null,
        gasGwei: gasWei ? Number(gasWei) / 1e9 : null,
        transferUsd,
        ethUsd,
      },
      economy: {
        tvl: sm?.tvl ?? tv.now,
        tvlChange: tv.change,
        rank: sm?.rank ?? null,
        chains: sm?.chains ?? null,
        dex24h: dx?.total24h ?? null,
        dexChange: dx?.change1d != null ? dx.change1d / 100 : null,
        fees24h: fe?.total24h ?? null,
        feesChange: fe?.change1d != null ? fe.change1d / 100 : null,
        stablecoins: st.now,
        stablecoinsChange: st.change,
      },
      stocks: {
        tokens: stockList.length,
        volume24h: stockList.reduce((s, x) => s + (x.volume24h || 0), 0),
        holders: stockList.reduce((s, x) => s + (x.holders || 0), 0),
        mostHeld: stockList.filter((x) => x.holders).sort((a, b) => b.holders - a.holders).slice(0, 3).map((x) => ({ symbol: x.symbol, holders: x.holders })),
        whaleTrades24h: wh.summary.trades24h,
        whaleBought24h: wh.summary.buyUsd24h,
        whaleSold24h: wh.summary.sellUsd24h,
        biggestWhale: wh.summary.biggest ? { side: wh.summary.biggest.side, symbol: wh.summary.biggest.symbol, usd: wh.summary.biggest.usd, t: wh.summary.biggest.t } : null,
      },
    };
    out.headline = headline(out);
    return out;
  });
}

const money = (n) => (n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const pct = (c) => (c == null ? '' : ` (${c >= 0 ? '+' : ''}${(c * 100).toFixed(1)}%)`);
function headline(p) {
  const parts = [];
  if (p.network.txsDay) parts.push(`about ${(p.network.txsDay / 1e6).toFixed(1)}M transactions in the last 24 hours`);
  if (p.economy.dex24h) parts.push(`${money(p.economy.dex24h)} in DEX volume${pct(p.economy.dexChange)}`);
  if (p.economy.tvl) parts.push(`${money(p.economy.tvl)} locked${p.economy.rank ? ` (#${p.economy.rank} of ${p.economy.chains} chains)` : ''}`);
  return parts.length ? `Robinhood Chain today: ${parts.join(', ')}.` : 'Robinhood Chain today.';
}
