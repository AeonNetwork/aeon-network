// Network Pulse: Robinhood Chain today, one shareable report.
import { state, netApi, net, on, esc, fmtUsd, fmtNum, ago, link, $ } from '../core.js';
import { reveal } from '../fx.js';

const pct = (c) => (c == null ? '<span class="dim">—</span>' : `<span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(1)}%</span>`);
const card = (k, v, sub, change) => `<div class="box metric"><div class="box-head">${k}${change !== undefined ? `<span class="right">${pct(change)}</span>` : ''}</div><div class="box-body"><div class="metric-val">${v}</div><div class="metric-sub">${sub}</div></div></div>`;

export function render(main) {
  let dispose = mount(main);
  const off = on('network', () => {
    dispose();
    dispose = mount(main);
    reveal(main);
  });
  return () => {
    off();
    dispose();
  };
}

function mount(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Network Pulse</div><h1>Robinhood Chain today</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">The whole network in one report: activity, money, stocks and whales, with the change since yesterday.</span>
    </div>
    <div id="puBody"><div class="box"><div class="empty">Taking the network's pulse…</div></div></div>`;
  const body = $('#puBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">The pulse covers mainnet. Switch network to read it.</div></div>';
    return () => {};
  }
  let alive = true;
  const load = () =>
    netApi('/pulse')
      .then((p) => {
        if (!alive) return;
        const n = p.network, e = p.economy, s = p.stocks;
        body.innerHTML = `
          <section class="box pu-head reveal">
            <div class="box-body">
              <div class="kicker">${new Date(p.at).toUTCString().slice(0, 16)} · updated <span data-time="${p.at}">${ago(p.at)}</span></div>
              <p class="pu-headline">${esc(p.headline)}</p>
              <div class="row wrap" style="gap:8px"><button class="btn btn-sm" id="puCopy">Copy summary</button><a class="btn btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(p.headline + '\n\nvia @getaeon_network')}&url=${encodeURIComponent(location.origin + '/pulse')}">Share on X</a></div>
            </div>
          </section>

          <h2 class="pu-h">Network</h2>
          <section class="grid g-4 reveal">
            ${card('Latest block', '#' + fmtNum(n.block, 0), `${n.blockTimeMs ? n.blockTimeMs.toFixed(0) + ' ms' : '—'} block time`)}
            ${card('Throughput', n.tps ? fmtNum(n.tps, 1) + ' TPS' : '—', n.txsHour ? `≈ ${fmtNum(n.txsHour, 0)} tx in the last hour` : 'live estimate')}
            ${card('Transactions · 24h', n.txsDay ? '≈ ' + fmtNum(n.txsDay / 1e6, 2) + 'M' : '—', n.txsDay ? 'estimated from sampled blocks' : 'available after a full day of indexing')}
            ${card('Cost to send ETH', n.transferUsd != null ? '$' + n.transferUsd.toFixed(4) : '—', `${n.gasGwei != null ? n.gasGwei.toFixed(3) + ' gwei' : '—'} · ETH ${fmtUsd(n.ethUsd)}`)}
          </section>

          <h2 class="pu-h">Money</h2>
          <section class="grid g-4 reveal">
            ${card('Total value locked', fmtUsd(e.tvl), e.rank ? `#${e.rank} of ${e.chains} chains · DefiLlama` : 'DefiLlama', e.tvlChange)}
            ${card('DEX volume · 24h', fmtUsd(e.dex24h), 'all DEXs on the chain', e.dexChange)}
            ${card('Fees · 24h', fmtUsd(e.fees24h), 'paid by users', e.feesChange)}
            ${card('Stablecoins', fmtUsd(e.stablecoins), 'circulating on the chain', e.stablecoinsChange)}
          </section>

          <h2 class="pu-h">Stocks &amp; whales</h2>
          <section class="grid g-4 reveal">
            ${card('Stock tokens', fmtNum(s.tokens, 0), `${fmtNum(s.holders, 0)} holder positions`)}
            ${card('Stock volume · 24h', fmtUsd(s.volume24h), 'official tokens')}
            ${card('Whale trades · 24h', fmtNum(s.whaleTrades24h, 0), `${fmtUsd(s.whaleBought24h)} bought · ${fmtUsd(s.whaleSold24h)} sold`)}
            ${card('Biggest whale · 24h', s.biggestWhale ? fmtUsd(s.biggestWhale.usd) : '—', s.biggestWhale ? `${s.biggestWhale.side.toUpperCase()} ${esc(s.biggestWhale.symbol)} · ${ago(s.biggestWhale.t)}` : 'none yet')}
          </section>

          <section class="box reveal mt">
            <div class="box-head">Most-held stocks</div>
            <div class="box-body pu-held">${s.mostHeld.map((h, i) => `<div><span class="dim mono">${i + 1}</span><b class="mono">${esc(h.symbol)}</b><span class="mono">${fmtNum(h.holders, 0)} holders</span></div>`).join('')}</div>
          </section>
          <div class="row wrap mt" style="gap:8px"><a class="btn" href="#/whales">Follow the whales</a><a class="btn" href="#/leaderboard">Top holders</a><a class="btn" href="#/ecosystem">Ecosystem</a></div>
          <p class="dim mt" style="font-size:12px">Activity from Aeon's indexer (RPC); value, volume, fees and stablecoins from DefiLlama with change vs the previous day; whales from Aeon's on-chain scan.</p>`;
        $('#puCopy', body).addEventListener('click', () => navigator.clipboard.writeText(p.headline + '\n' + location.origin + '/pulse'));
        reveal(body);
      })
      .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  load();
  const timers = [setInterval(load, 60_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    timers.forEach(clearInterval);
  };
}
