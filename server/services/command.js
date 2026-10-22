// Command Center: the whole of Robinhood Chain on one screen, in one call. Chain vitals, the stock
// tokens moving most today, the meme radar (hot and brand-new Pons launches) and the whale feed.
// Every part comes from a service that already reads the chain; this only assembles them.
import { cached } from '../lib/cache.js';
import * as eco from './ecosystem.js';
import * as indexer from './indexer.js';
import * as chain from './chain.js';
import { whales } from './whales.js';
import { radar } from './radar.js';

const NET = 'mainnet';
const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

export function command() {
  return cached('command:mainnet', 15_000, async () => {
    const [bn, gas, price, stocks, markets, hot, fresh] = await Promise.allSettled([
      chain.blockNumber(NET),
      chain.gasPrice(NET),
      eco.ethPrice(),
      eco.stockTokens(NET),
      eco.stockMarkets(NET),
      radar({ tab: 'hot', limit: 8 }),
      radar({ tab: 'new', limit: 8 }),
    ]);
    const ix = indexer.summary(NET) || {};
    const ethUsd = settled(price)?.value?.usd ?? null;
    const gasWei = settled(gas)?.value ?? settled(gas);
    const m = settled(markets)?.value || {};
    const list = (settled(stocks)?.value || []).map((s) => {
      const k = m[s.address.toLowerCase()];
      return { address: s.address, symbol: s.symbol, name: s.name, icon: s.icon, price: k?.price ?? s.price, change24h: k?.change24h ?? null, volume24h: s.volume24h ?? null, holders: s.holders ?? null };
    });
    const moved = list.filter((s) => s.change24h != null);
    const w = whales({ min: 10_000, limit: 40 });
    const h = settled(hot), f = settled(fresh);
    const slim = (r) => ({ token: r.token, symbol: r.symbol, name: r.name, time: r.time, progress: r.progress, raisedEth: r.raisedEth, thresholdEth: r.thresholdEth, quote: r.quote, mcapUsd: r.mcapUsd, graduated: r.graduated, creator: r.creator, serial: r.creatorLaunches24h >= 5, scan: r.scan });
    return {
      at: Date.now(),
      chain: {
        block: settled(bn)?.value ?? settled(bn) ?? ix.lastBlock ?? null,
        blockTimeMs: ix.blockTime ? ix.blockTime * 1000 : null,
        tps: ix.tps ?? null,
        gasGwei: gasWei ? Number(gasWei) / 1e9 : null,
        transferUsd: gasWei && ethUsd ? (Number(gasWei) * 21_000 * ethUsd) / 1e18 : null,
        ethUsd,
      },
      stocks: {
        count: list.length,
        gainers: [...moved].sort((a, b) => b.change24h - a.change24h).slice(0, 6),
        losers: [...moved].sort((a, b) => a.change24h - b.change24h).slice(0, 6),
        mostTraded: [...list].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 6),
      },
      radar: h ? { stats: h.stats, hot: h.rows.map(slim), fresh: (f?.rows || []).map(slim) } : null,
      whales: { summary: { trades24h: w.summary.trades24h, buyUsd24h: w.summary.buyUsd24h, sellUsd24h: w.summary.sellUsd24h }, feed: (w.items || []).filter((x) => x.side !== 'transfer').slice(0, 10).map((x) => ({ id: x.id, t: x.t, side: x.side, symbol: x.symbol, usd: x.usd, shares: x.shares, wallet: x.wallet, tx: x.tx })) },
    };
  }).then((r) => r.value);
}
