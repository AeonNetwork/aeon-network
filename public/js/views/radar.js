// New Token Radar: every Pons launch on Robinhood Chain, read from the chain.
import { state, netApi, net, on, esc, fmtUsd, fmtNum, ago, short, addrLink, $ } from '../core.js';
import { reveal } from '../fx.js';

const TABS = [
  ['hot', 'Hot', 'Most ETH raised on the bonding curve'],
  ['new', 'New', 'Newest launches first'],
  ['near', 'Near graduation', '25% or more of the way to graduating'],
  ['graduated', 'Graduated', 'Filled their curve in the last 24 hours'],
];
let tab = 'hot';

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

const metric = (k, v, sub) => `<div class="box metric"><div class="box-head">${k}</div><div class="box-body"><div class="metric-val">${v}</div><div class="metric-sub">${sub}</div></div></div>`;
const bar = (p) => `<span class="rd-bar" title="${p == null ? '' : Math.round(p * 100) + '%'}"><i style="width:${p == null ? 0 : Math.max(2, p * 100)}%"></i></span>`;
const grade = (s) => (s ? `<span class="rd-grade rd-${s.grade}" title="${s.score}/100${s.flags ? ` · ${s.flags} serious flag(s)` : ''}">${s.grade}</span>` : '<span class="rd-grade rd-none" title="Not scanned yet">·</span>');

function mount(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · New Token Radar</div><h1>New tokens, live</h1></div>
      <span class="dim" style="font-size:12px;max-width:460px;text-align:right">Every token launched on Pons, read from the chain: bonding progress, market cap, who launched it and an automatic safety grade for the most active ones.</span>
    </div>
    <div id="rdBody"><div class="box"><div class="empty">Reading the latest launches…</div></div></div>`;
  const body = $('#rdBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">The radar covers mainnet. Switch network to see new tokens.</div></div>';
    return () => {};
  }
  let alive = true;
  const load = () =>
    netApi(`/radar?tab=${tab}&limit=60`)
      .then((d) => alive && paint(d))
      .catch((err) => alive && !body.querySelector('.rd-table') && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));

  function paint(d) {
    const s = d.stats;
    if (d.building && !d.rows.length) {
      body.innerHTML = '<div class="box"><div class="empty">The radar is reading the last 24 hours of launches from the chain. This takes a few minutes the first time.</div></div>';
      return;
    }
    // Market caps in one compact style: $8.6K, $52.4K, $1.20M.
    const usd = (e) => {
      if (e == null) return '—';
      if (!d.ethUsd) return fmtNum(e, 3) + ' ETH';
      const v = e * d.ethUsd;
      return v >= 1e3 && v < 1e4 ? '$' + (v / 1e3).toFixed(1) + 'K' : fmtUsd(v, 0);
    };
    body.innerHTML = `
      <section class="grid g-4 reveal">
        ${metric('Launches · 24h', fmtNum(s.launches24h, 0), `${fmtNum(s.launches1h, 0)} in the last hour`)}
        ${metric('Graduated · 24h', fmtNum(s.graduated24h, 0), s.launches24h ? `${((s.graduated24h / s.launches24h) * 100).toFixed(1)}% of launches` : '—')}
        ${metric('Raised on curves · 24h', fmtNum(s.raisedEth24h, 2) + ' ETH', d.ethUsd ? '≈ ' + fmtUsd(s.raisedEth24h * d.ethUsd) : 'ETH in bonding curves')}
        ${metric('Serial launchers', fmtNum(s.serialLaunchers, 0), s.topSerial ? `top wallet launched ${s.topSerial[1]} tokens today` : 'wallets with 5+ launches today')}
      </section>
      <section class="box reveal mt">
        <div class="box-head"><span class="rd-tabs">${TABS.map(([k, label]) => `<button class="chip${k === tab ? ' active' : ''}" data-tab="${k}">${label}</button>`).join('')}</span><span class="right dim rd-upd">updated <span data-time="${d.at || Date.now()}">${ago(d.at || Date.now())}</span></span></div>
        <div class="table-wrap"><table class="tbl rd-table">
          <thead><tr><th>Token</th><th>Age</th><th>Bonding curve</th><th class="num">Market cap</th><th>Creator</th><th class="num">Safety</th></tr></thead>
          <tbody>${
            d.rows.length
              ? d.rows
                  .map(
                    (r) => `<tr data-href="#/scan/${r.token}">
              <td><b class="mono">${esc(r.symbol || short(r.token, 6))}</b><small>${esc(r.name || '')}</small></td>
              <td class="mono dim" ${r.time ? `data-time="${r.time}"` : ''}>${r.time ? (r.exactTime ? '' : '≈ ') + ago(r.time) : '—'}</td>
              <td>${r.graduated ? '<span class="tag solid">GRADUATED</span>' : `${bar(r.progress)}<small class="mono">${r.quote ? (r.quote.raised == null ? 'reading…' : `${fmtNum(r.quote.raised, 0)} / ${fmtNum(r.quote.threshold, 0)} ${esc(r.quote.symbol)}`) : r.raisedEth == null ? 'reading…' : `${fmtNum(r.raisedEth, 3)} / ${r.thresholdEth ?? '?'} ETH`}</small>`}</td>
              <td class="num mono">${r.graduated ? '<span class="dim">on DEX</span>' : r.quote ? '<span class="dim">—</span>' : usd(r.mcapEth)}</td>
              <td>${addrLink(r.creator, 6)}${r.creatorLaunches24h >= 5 ? ` <span class="tag" title="This wallet launched ${r.creatorLaunches24h} tokens in 24 hours">SERIAL ×${r.creatorLaunches24h}</span>` : r.creatorLaunches24h > 1 ? ` <span class="dim mono">×${r.creatorLaunches24h}</span>` : ''}</td>
              <td class="num">${grade(r.scan)}</td>
            </tr>`,
                  )
                  .join('')
              : `<tr><td colspan="6"><div class="empty">${tab === 'graduated' ? 'No token graduated in the last 24 hours.' : 'Nothing here yet.'}</div></td></tr>`
          }</tbody>
        </table></div>
        <div class="box-foot">${esc(TABS.find((t) => t[0] === tab)[2])}. Tap a token for its full safety scan. Grades come from Aeon's scanner; a SERIAL tag marks wallets that launched 5+ tokens today.</div>
      </section>
      <p class="dim mt" style="font-size:12px">Source: ${esc(d.source)}. Market cap uses the curve's current price × launch supply. ${d.ethUsd ? `ETH ${fmtUsd(d.ethUsd)}.` : ''} Not financial advice.</p>`;
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab), load())));
    body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
    reveal(body);
  }

  load();
  const timers = [setInterval(load, 30_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = (el.textContent.startsWith('≈') ? '≈ ' : '') + ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    timers.forEach(clearInterval);
  };
}
