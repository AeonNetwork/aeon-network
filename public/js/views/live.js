// Command Center: Robinhood Chain on one screen. Chain vitals (the block ticks with the live
// stream), the stock tokens moving most today, the meme radar and the whale feed.
import { state, netApi, on, esc, fmtUsd, fmtNum, ago, short, $ } from '../core.js';
import { reveal } from '../fx.js';

let stockTab = 'gainers';
const pct = (c) => (c == null ? '<span class="dim">—</span>' : `<span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '+' : ''}${(c * 100).toFixed(2)}%</span>`);
const money = (n) => (n == null ? '—' : n >= 1e3 && n < 1e4 ? '$' + (n / 1e3).toFixed(1) + 'K' : fmtUsd(n, n < 1 ? 4 : 0));
const grade = (s) => (s ? `<span class="rd-grade rd-${s.grade}" title="${s.score}/100">${s.grade}</span>` : '<span class="rd-grade rd-none" title="Not scanned yet">·</span>');
const bar = (p) => `<span class="rd-bar cc-bar"><i style="width:${p == null ? 0 : Math.max(2, p * 100)}%"></i></span>`;

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
      <div><div class="kicker"><span class="cc-live"></span>Robinhood Chain · Command Center</div><h1>What's moving, live</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Stock tokens, the meme radar and the whales on one screen, read from the chain and refreshed every 15 seconds.</span>
    </div>
    <div id="ccBody"><div class="box"><div class="empty">Reading the chain…</div></div></div>`;
  const body = $('#ccBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">The command center covers mainnet. Switch network to see it.</div></div>';
    return () => {};
  }
  let alive = true, data = null;

  const vitals = (c) => `
    <div class="cc-vitals reveal">
      <div><span>Block</span><b class="mono" id="ccBlock">#${fmtNum(c.block, 0)}</b></div>
      <div><span>Block time</span><b class="mono">${c.blockTimeMs ? c.blockTimeMs.toFixed(0) + ' ms' : '—'}</b></div>
      <div><span>TPS</span><b class="mono">${c.tps ? fmtNum(c.tps, 1) : '—'}</b></div>
      <div><span>Gas</span><b class="mono">${c.gasGwei != null ? c.gasGwei.toFixed(3) + ' gwei' : '—'}</b></div>
      <div><span>Send ETH</span><b class="mono">${c.transferUsd != null ? '$' + c.transferUsd.toFixed(4) : '—'}</b></div>
      <div><span>ETH</span><b class="mono">${fmtUsd(c.ethUsd)}</b></div>
    </div>`;

  const stocksBox = (s) => {
    const rows = s[stockTab] || [];
    return `
      <div class="box-head">Stock tokens<span class="right cc-tabs">${[['gainers', 'Gainers'], ['losers', 'Losers'], ['mostTraded', 'Most traded']].map(([k, l]) => `<button class="chip${k === stockTab ? ' active' : ''}" data-st="${k}">${l}</button>`).join('')}</span></div>
      <div class="cc-list">${
        rows.length
          ? rows.map((r) => `<a class="cc-row" href="#/token/${r.address}"><span><b class="mono">${esc(r.symbol)}</b><small>${esc(r.name || '')}</small></span><span class="num mono">${fmtUsd(r.price)}</span><span class="num mono">${stockTab === 'mostTraded' ? `<span class="dim">${money(r.volume24h)}</span>` : pct(r.change24h)}</span></a>`).join('')
          : '<div class="empty">Price changes are loading.</div>'
      }</div>
      <div class="box-foot">${fmtNum(s.count, 0)} official stock tokens · <a class="link" href="#/stocks">all stocks →</a></div>`;
  };

  const radarBox = (r) =>
    !r
      ? '<div class="box-head">Meme radar</div><div class="empty">The radar is starting.</div>'
      : `
      <div class="box-head">Meme radar · hot on Pons<span class="right dim">${fmtNum(r.stats.launches1h, 0)} launches in the last hour</span></div>
      <div class="cc-list">${r.hot
        .slice(0, 7)
        .map(
          (t) => `<a class="cc-row" href="#/scan/${t.token}"><span><b class="mono">${esc(t.symbol || short(t.token, 6))}</b><small>${esc(t.name || '')}${t.serial ? ' · serial dev' : ''}</small></span><span>${bar(t.progress)}<small class="mono">${t.raisedEth != null ? fmtNum(t.raisedEth, 2) + ' / ' + (t.thresholdEth ?? '?') + ' ETH' : ''}</small></span><span class="num mono">${money(t.mcapUsd)}</span><span class="num">${grade(t.scan)}</span></a>`,
        )
        .join('')}</div>
      <div class="box-foot">${fmtNum(r.stats.launches24h, 0)} launches today · ${fmtNum(r.stats.graduated24h, 0)} graduated · ${fmtNum(r.stats.serialLaunchers, 0)} serial launchers · <a class="link" href="#/radar">full radar →</a></div>`;

  const whalesBox = (w) => `
      <div class="box-head">Whales<span class="right dim">${fmtNum(w.summary.trades24h, 0)} trades ≥ $10K today</span></div>
      <div class="cc-list">${
        w.feed.length
          ? w.feed
              .slice(0, 8)
              .map((x) => `<a class="cc-row" href="#/portfolio/${x.wallet}"><span><span class="tag${x.side === 'buy' || x.side === 'mint' ? ' solid' : ''}">${x.side.toUpperCase()}</span> <b class="mono">${esc(x.symbol)}</b><small class="mono">${esc(short(x.wallet, 6))}</small></span><span class="num mono">${money(x.usd)}</span><span class="num mono dim" data-time="${x.t}">${ago(x.t)}</span></a>`)
              .join('')
          : '<div class="empty">No whale trades yet.</div>'
      }</div>
      <div class="box-foot">${fmtUsd(w.summary.buyUsd24h)} bought · ${fmtUsd(w.summary.sellUsd24h)} sold · <a class="link" href="#/whales">alerts →</a></div>`;

  const freshStrip = (r) =>
    !r || !r.fresh.length
      ? ''
      : `<section class="box reveal mt"><div class="box-head">Just launched<span class="right dim">tap one for its safety scan</span></div><div class="cc-fresh">${r.fresh
          .map((t) => `<a href="#/scan/${t.token}"><b class="mono">${esc(t.symbol || short(t.token, 6))}</b><small class="dim" data-time="${t.time}">${ago(t.time)}</small>${bar(t.progress)}</a>`)
          .join('')}</div></section>`;

  function paint(first) {
    const d = data;
    if (first) {
      body.innerHTML = `
        ${vitals(d.chain)}
        <div class="cc-grid mt">
          <section class="box reveal" id="ccStocks"></section>
          <section class="box reveal" id="ccRadar"></section>
          <section class="box reveal" id="ccWhales"></section>
        </div>
        <div id="ccFresh"></div>
        <p class="dim mt" style="font-size:12px">Updated <span id="ccAt" data-time="${d.at}">${ago(d.at)}</span>. Stock moves from CoinGecko; the radar from Pons launch events and bonding curves; whales and vitals from Aeon's on-chain scan. Not financial advice.</p>`;
      reveal(body);
    } else {
      body.querySelector('.cc-vitals').outerHTML = vitals(d.chain);
      const at = $('#ccAt', body);
      at.dataset.time = d.at;
    }
    $('#ccStocks', body).innerHTML = stocksBox(d.stocks);
    $('#ccRadar', body).innerHTML = radarBox(d.radar);
    $('#ccWhales', body).innerHTML = whalesBox(d.whales);
    $('#ccFresh', body).innerHTML = freshStrip(d.radar);
    body.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => ((stockTab = b.dataset.st), ($('#ccStocks', body).innerHTML = stocksBox(data.stocks)), paint(false))));
    body.querySelector('.cc-vitals')?.classList.add('in');
  }

  const load = () =>
    netApi('/command')
      .then((d) => {
        if (!alive) return;
        const first = !data;
        data = d;
        paint(first);
      })
      .catch((err) => alive && !data && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  load();
  // The block number ticks with the live stream between refreshes.
  const off = on('block', ({ network, block }) => {
    const el = $('#ccBlock', body);
    if (network !== 'mainnet' || !el || !block?.number) return;
    el.textContent = '#' + fmtNum(block.number, 0);
    el.classList.remove('cc-tick');
    void el.offsetWidth;
    el.classList.add('cc-tick');
  });
  const timers = [setInterval(load, 15_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    off();
    timers.forEach(clearInterval);
  };
}
