// Smart Money: wallets that keep getting into Pons tokens early, before they graduate, and what
// they are buying right now.
import { state, netApi, net, on, esc, fmtNum, ago, short, toast, $ } from '../core.js';
import { reveal } from '../fx.js';
import { addWatch, getWatch } from '../watch.js';

const bar = (p) => `<span class="rd-bar"><i style="width:${p == null ? 0 : Math.max(2, p * 100)}%"></i></span>`;
const watched = (a) => getWatch().some((w) => w.address.toLowerCase() === a.toLowerCase());

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
      <div><div class="kicker">${esc(net().name)} · Smart Money</div><h1>Follow the early buyers</h1></div>
      <span class="dim" style="font-size:12px;max-width:460px;text-align:right">Wallets that keep buying Pons tokens among the first, before those tokens graduate. And what they are buying right now. Read from the chain.</span>
    </div>
    <div id="smBody"><div class="box"><div class="empty">Reading graduations and early buyers…</div></div></div>`;
  const body = $('#smBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">Smart Money covers mainnet. Switch network to see it.</div></div>';
    return () => {};
  }
  let alive = true;
  const load = () =>
    netApi('/smart')
      .then((d) => alive && paint(d))
      .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));

  function paint(d) {
    if (d.building) {
      body.innerHTML = '<div class="box"><div class="empty">Smart Money is reading the last ten days of graduations from the chain. This takes a few minutes the first time.</div></div>';
      return;
    }
    const w = d.window || {};
    body.innerHTML = `
      <section class="grid g-4 reveal">
        <div class="box metric"><div class="box-head">Graduated · ~10 days</div><div class="box-body"><div class="metric-val">${fmtNum(w.total ?? w.graduated ?? 0, 0)}</div><div class="metric-sub">${fmtNum(w.graduated ?? 0, 0)} traced to their first buyers</div></div></div>
        <div class="box metric"><div class="box-head">Smart wallets</div><div class="box-body"><div class="metric-val">${fmtNum(d.wallets.length, 0)}</div><div class="metric-sub">early in 2+ graduated tokens</div></div></div>
        <div class="box metric"><div class="box-head">Their buys · last 4h</div><div class="box-body"><div class="metric-val">${fmtNum(d.buyingNow.length, 0)}</div><div class="metric-sub">on Pons bonding curves</div></div></div>
        <div class="box metric"><div class="box-head">Bought together</div><div class="box-body"><div class="metric-val">${fmtNum(d.together.length, 0)}</div><div class="metric-sub">tokens 2+ smart wallets bought</div></div></div>
      </section>

      ${
        d.together.length
          ? `<section class="box reveal mt"><div class="box-head">Bought together · right now<span class="right dim">tap for its safety scan</span></div><div class="sm-together">${d.together
              .map((c) => `<a href="#/scan/${c.token}"><b class="mono">${esc(c.symbol || short(c.token, 6))}</b><small>${esc(c.name || '')}</small><span class="sm-n mono">${c.wallets} smart wallets · ${fmtNum(c.eth, 3)} ETH</span>${c.graduated ? '<span class="tag solid">GRADUATED</span>' : bar(c.progress)}</a>`)
              .join('')}</div></section>`
          : ''
      }

      <div class="grid g-main mt">
        <section class="box reveal">
          <div class="box-head">Smart wallets<span class="right dim">early = first 25 buyers</span></div>
          <div class="table-wrap"><table class="tbl sm-table">
            <thead><tr><th>#</th><th>Wallet</th><th class="num">Early in</th><th class="num">Avg entry</th><th>Recent early buys</th><th></th></tr></thead>
            <tbody>${d.wallets
              .map(
                (x, i) => `<tr${i >= 15 ? ' hidden' : ''}>
                <td class="dim mono">${i + 1}</td>
                <td><a class="mono link" href="#/explorer/address/${x.address}">${esc(short(x.address, 8))}</a>${x.sniper ? ' <span class="tag" title="Often buys in the very first trading block">SNIPER</span>' : ''}</td>
                <td class="num mono"><b>${x.hits}</b> <span class="dim">graduated</span></td>
                <td class="num mono">#${x.avgRank.toFixed(0)}</td>
                <td><span class="sm-chips">${x.tokens.slice(0, 4).map((t) => `<a class="chip" href="#/scan/${t.token}" title="Buyer #${t.rank}">${esc(t.symbol || short(t.token, 4))}</a>`).join('')}</span></td>
                <td>${watched(x.address) ? '<span class="dim mono" style="font-size:11px">watching</span>' : `<button class="btn btn-sm" data-watch="${x.address}">Watch</button>`}</td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>
          ${d.wallets.length > 15 ? `<button class="btn btn-sm pf-more" id="smMore">Show all ${d.wallets.length} wallets</button>` : ''}
        </section>
        <section class="box reveal">
          <div class="box-head">Buying now<span class="right dim">last ~4 hours</span></div>
          <div class="cc-list">${
            d.buyingNow.length
              ? d.buyingNow
                  .slice(0, 16)
                  .map((b) => `<a class="cc-row" href="#/scan/${b.token}"><span><b class="mono">${esc(b.symbol || short(b.token, 6))}</b><small class="mono">${esc(short(b.wallet, 6))}</small></span><span>${b.graduated ? '<span class="tag solid">GRAD</span>' : bar(b.progress)}</span><span class="num mono">${fmtNum(b.eth, 3)} ETH<small data-time="${b.time}">${ago(b.time)}</small></span></a>`)
                  .join('')
              : '<div class="empty">No buys from smart wallets in the last few hours.</div>'
          }</div>
        </section>
      </div>
      <p class="dim mt" style="font-size:12px">${esc(d.note)} Updated <span data-time="${d.at}">${ago(d.at)}</span>; rebuilt every 20 minutes.</p>`;
    $('#smMore', body)?.addEventListener('click', (e) => {
      body.querySelectorAll('.sm-table tr[hidden]').forEach((tr) => (tr.hidden = false));
      e.target.remove();
    });
    body.querySelectorAll('[data-watch]').forEach((btn) =>
      btn.addEventListener('click', () => {
        try {
          addWatch('mainnet', btn.dataset.watch, 'Smart wallet');
          toast('Added to your watchlist. You get an alert when it moves.');
          btn.outerHTML = '<span class="dim mono" style="font-size:11px">watching</span>';
        } catch (err) {
          toast(err.message, 'err');
        }
      }),
    );
    reveal(body);
  }

  load();
  const timers = [setInterval(load, 60_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    timers.forEach(clearInterval);
  };
}
