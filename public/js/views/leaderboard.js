// Holder leaderboard: the largest tokenized-stock portfolios on Robinhood Chain.
import { state, netApi, net, on, esc, fmtUsd, fmtNum, ago, short, link, $ } from '../core.js';
import { reveal } from '../fx.js';

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

const move = (r, ranked) => {
  if (!ranked) return '';
  if (r.prevRank == null) return '<span class="lb-move new">NEW</span>';
  const d = r.prevRank - r.rank;
  return d > 0 ? `<span class="lb-move up">▲ ${d}</span>` : d < 0 ? `<span class="lb-move down">▼ ${-d}</span>` : '<span class="lb-move">–</span>';
};

function mount(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Leaderboard</div><h1>Top holders</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">The largest tokenized-stock portfolios on Robinhood Chain, ranked by live value. Tap a wallet to open its portfolio.</span>
    </div>
    <div id="lbBody"></div>`;
  const body = $('#lbBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">Stock tokens live on mainnet. Switch network to see the leaderboard.</div></div>';
    return () => {};
  }
  let alive = true;
  const load = () =>
    netApi('/leaderboard')
      .then((d) => {
        if (!alive) return;
        if (!d.rows?.length) {
          body.innerHTML = `<div class="box"><div class="empty">${esc(d.note)}</div></div>`;
          return;
        }
        const [first, second, third] = d.rows;
        const ranked = d.rows.some((r) => r.prevRank != null); // first build: nothing to compare yet
        const podium = (r, place) => `
          <a class="box lb-pod lb-p${place} reveal" href="#/portfolio/${r.address}">
            <div class="lb-place">#${place}</div>
            <div class="lb-addr mono">${esc(r.name || short(r.address, 6))}</div>
            <div class="lb-val mono">${fmtUsd(r.valueUsd)}</div>
            <div class="dim">${r.positions ?? '?'} stocks${r.top ? ` · biggest ${esc(r.top.symbol)} ${(r.top.weight * 100).toFixed(0)}%` : ''}</div>
          </a>`;
        body.innerHTML = `
          <section class="grid g-4 reveal">
            <div class="box metric"><div class="box-head">Top 50 hold</div><div class="box-body"><div class="metric-val">${fmtUsd(d.totalUsd)}</div><div class="metric-sub">in official stock tokens</div></div></div>
            <div class="box metric"><div class="box-head">Wallets checked</div><div class="box-body"><div class="metric-val">${fmtNum(d.wallets, 0)}</div><div class="metric-sub">individual holders</div></div></div>
            <div class="box metric"><div class="box-head">Stocks scanned</div><div class="box-body"><div class="metric-val">${fmtNum(d.tokens, 0)}</div><div class="metric-sub">official ERC-8056 tokens</div></div></div>
            <div class="box metric"><div class="box-head">Updated</div><div class="box-body"><div class="metric-val" data-time="${d.at}">${ago(d.at)}</div><div class="metric-sub">refreshes every 6 hours</div></div></div>
          </section>
          <section class="lb-podium mt">${[second, first, third].filter(Boolean).map((r) => podium(r, r.rank)).join('')}</section>
          <section class="box reveal mt">
            <div class="box-head">Ranking<span class="right dim">tap a row to open the portfolio</span></div>
            <div class="tbl-wrap"><table class="tbl lb-tbl">
              <thead><tr><th>#</th><th></th><th>Wallet</th><th class="num">Portfolio</th><th class="num">Stocks</th><th>Top holdings</th></tr></thead>
              <tbody>${d.rows
                .map(
                  (r) => `<tr data-href="#/portfolio/${r.address}">
                    <td class="mono">${r.rank}</td>
                    <td>${move(r, ranked)}</td>
                    <td><a class="mono link" href="#/portfolio/${r.address}">${esc(r.name || short(r.address, 8))}</a>${r.copycats ? ` <span class="tag" title="Also holds copycat tokens">+${r.copycats} copycat</span>` : ''}</td>
                    <td class="num"><b>${fmtUsd(r.valueUsd)}</b></td>
                    <td class="num">${r.positions ?? '—'}</td>
                    <td class="lb-syms">${r.symbols.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table></div>
          </section>
          <p class="dim mt" style="font-size:12px">${esc(d.note)}</p>`;
        body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
        reveal(body);
      })
      .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  body.innerHTML = '<div class="box"><div class="empty">Loading the ranking…</div></div>';
  load();
  const timers = [setInterval(load, 5 * 60_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    timers.forEach(clearInterval);
  };
}
