// Whale tracker: large buys and sells of official stock tokens, live.
import { state, netApi, net, on, esc, fmtUsd, fmtNum, ago, short, txLink, link, prefs, $ } from '../core.js';
import { reveal } from '../fx.js';
import { getAlerts, setAlerts } from '../alerts.js';

const SIZES = [1_000, 10_000, 50_000, 100_000];
const SIDE = { buy: ['BUY', 'solid'], sell: ['SELL', ''], mint: ['MINT', 'solid'], redeem: ['REDEEM', ''], transfer: ['MOVE', 'ghost'] };
const wallet = (a) => `<a class="mono link" href="#/portfolio/${a}" title="Open this wallet's portfolio">${esc(short(a, 6))}</a>`;

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

// Whale alerts: notify on this device when a matching whale trade lands, on any page.
const ALERT_SIZES = [10_000, 50_000, 100_000, 500_000];
function paintAlerts() {
  const el = document.getElementById('whAlerts');
  if (!el) return;
  const a = getAlerts();
  el.innerHTML = `
    <div class="box-head">Whale alerts<span class="right"><button class="btn btn-sm${a.on ? ' btn-primary' : ''}" id="alOn">${a.on ? 'On · turn off' : 'Turn on'}</button></span></div>
    <div class="box-body wh-al">
      <div class="seg" id="alMin">${ALERT_SIZES.map((v) => `<button class="${v === a.min ? 'active' : ''}" data-v="${v}">≥ ${fmtUsd(v, 0)}</button>`).join('')}</div>
      <div class="seg" id="alSide">${[['trades', 'Buys & sells'], ['buys', 'Buys'], ['sells', 'Sells']].map(([k, l]) => `<button class="${k === a.side ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      <input class="input mono wh-al-sym" id="alSym" placeholder="All stocks, or e.g. TSLA, NVDA" value="${esc(a.symbols.join(', '))}" aria-label="Stocks to alert on">
      <p class="dim">${a.on ? 'Alerts are on. You get a notification for each matching trade while Aeon is open in a tab, on any page.' : 'Get a browser notification the moment a whale buys or sells. Saved on this device only; no sign-up.'}</p>
    </div>`;
  el.querySelector('#alOn').addEventListener('click', () => setAlerts({ on: !a.on }).then(paintAlerts));
  el.querySelectorAll('#alMin button').forEach((b) => b.addEventListener('click', () => setAlerts({ min: +b.dataset.v }).then(paintAlerts)));
  el.querySelectorAll('#alSide button').forEach((b) => b.addEventListener('click', () => setAlerts({ side: b.dataset.v }).then(paintAlerts)));
  el.querySelector('#alSym').addEventListener('change', (e) => setAlerts({ symbols: e.target.value.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z0-9.]{1,10}$/.test(x)).slice(0, 20) }).then(paintAlerts));
}

function mount(main) {
  const f = { min: prefs.get('wh-min', 10_000), symbol: '', side: '' };
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Whale tracker</div><h1>Whales, live</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Large buys and sells of official stock tokens, read from the chain every 90 seconds. Tap a wallet to open its portfolio.</span>
    </div>
    <div id="whBody"></div>`;
  const body = $('#whBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">Stock tokens trade on mainnet. Switch network to follow the whales.</div></div>';
    return () => {};
  }
  body.innerHTML = `
    <section class="grid g-4 reveal">
      <div class="box metric"><div class="box-head">Whale trades · 24h</div><div class="box-body"><div class="metric-val" id="mTrades">—</div><div class="metric-sub" id="mTradesSub"></div></div></div>
      <div class="box metric"><div class="box-head">Bought · 24h</div><div class="box-body"><div class="metric-val" id="mBuy">—</div><div class="metric-sub">Value of whale buys</div></div></div>
      <div class="box metric"><div class="box-head">Sold · 24h</div><div class="box-body"><div class="metric-val" id="mSell">—</div><div class="metric-sub">Value of whale sells</div></div></div>
      <div class="box metric"><div class="box-head">Biggest · 24h</div><div class="box-body"><div class="metric-val" id="mBig">—</div><div class="metric-sub" id="mBigSub"></div></div></div>
    </section>
    <section class="box mt reveal wh-alerts" id="whAlerts"></section>
    <div class="wh-filters mt reveal">
      <div class="seg" id="whMin">${SIZES.map((s) => `<button class="${s === f.min ? 'active' : ''}" data-min="${s}">≥ ${fmtUsd(s, 0)}</button>`).join('')}</div>
      <div class="seg" id="whSide"><button class="active" data-side="">All</button><button data-side="buy">Buys</button><button data-side="sell">Sells</button></div>
      <select class="input wh-select" id="whSym" aria-label="Stock"><option value="">All stocks</option></select>
      <span class="dim mono wh-upd" id="whUpd"></span>
    </div>
    <div class="grid g-main mt">
      <section class="box reveal"><div class="box-head">Live feed<span class="right dim" id="whCount"></span></div><div id="whFeed"><div class="empty">Reading the chain…</div></div></section>
      <section class="box reveal"><div class="box-head">Top whales · 24h</div><div id="whTop"><div class="empty">—</div></div></section>
    </div>
    <p class="dim mt" style="font-size:12px" id="whNote"></p>`;

  paintAlerts();
  let alive = true;
  const load = () =>
    netApi(`/whales?min=${f.min}${f.symbol ? '&symbol=' + encodeURIComponent(f.symbol) : ''}${f.side ? '&side=' + f.side : ''}`)
      .then((d) => {
        if (!alive) return;
        const s = d.summary;
        $('#mTrades', body).textContent = fmtNum(s.trades24h, 0);
        $('#mTradesSub', body).textContent = `trades ≥ ${fmtUsd(d.min, 0)}`;
        $('#mBuy', body).textContent = fmtUsd(s.buyUsd24h);
        $('#mSell', body).textContent = fmtUsd(s.sellUsd24h);
        $('#mBig', body).textContent = s.biggest ? fmtUsd(s.biggest.usd) : '—';
        $('#mBigSub', body).textContent = s.biggest ? `${SIDE[s.biggest.side][0]} ${s.biggest.symbol} · ${ago(s.biggest.t)}` : 'None yet';
        const sel = $('#whSym', body);
        if (sel.options.length <= 1) sel.insertAdjacentHTML('beforeend', d.symbols.map((x) => `<option>${esc(x)}</option>`).join(''));
        $('#whUpd', body).textContent = d.lastScan ? `updated ${ago(d.lastScan.at)}` : 'first scan running…';
        $('#whCount', body).textContent = `${d.items.length} shown`;
        $('#whNote', body).textContent = d.note;
        $('#whFeed', body).innerHTML = d.items.length
          ? d.items
              .map((w) => {
                const [label, cls] = SIDE[w.side] || [w.side.toUpperCase(), ''];
                return `<div class="wh-row">
                  <span class="tag ${cls}">${label}</span>
                  <div class="main"><b><a href="${link.token(w.token)}">${esc(w.symbol)}</a> · ${fmtNum(w.shares, w.shares < 10 ? 3 : 1)} shares</b><span>${w.side === 'transfer' && w.from ? `${wallet(w.from)} → ${wallet(w.wallet)}` : wallet(w.wallet)}${w.venue ? ` · via ${esc(w.venue)}` : ''}</span></div>
                  <b class="mono wh-usd">${fmtUsd(w.usd)}</b>
                  <span class="mono dim" data-time="${w.t}">${ago(w.t)}</span>
                  ${txLink(w.tx, 6)}
                </div>`;
              })
              .join('')
          : `<div class="empty">No whale trades ≥ ${fmtUsd(d.min, 0)} in the window yet. Try a smaller size.</div>`;
        $('#whTop', body).innerHTML = d.topWallets.length
          ? `<table class="tbl"><thead><tr><th>Wallet</th><th class="num">Bought</th><th class="num">Sold</th></tr></thead><tbody>${d.topWallets
              .map((t) => `<tr><td>${wallet(t.wallet)}<div class="dim" style="font-size:11px">${t.trades} trades · ${esc(t.symbols.join(', '))}</div></td><td class="num">${t.buyUsd ? fmtUsd(t.buyUsd) : "—"}</td><td class="num">${t.sellUsd ? fmtUsd(t.sellUsd) : "—"}</td></tr>`)
              .join('')}</tbody></table>`
          : '<div class="empty">No whales in the last 24 hours at this size.</div>';
        reveal(body);
      })
      .catch((err) => alive && ($('#whFeed', body).innerHTML = `<div class="empty">${esc(err.message)}</div>`));

  body.querySelectorAll('[data-min]').forEach((b) =>
    b.addEventListener('click', () => {
      f.min = +b.dataset.min;
      prefs.set('wh-min', f.min);
      body.querySelectorAll('[data-min]').forEach((x) => x.classList.toggle('active', x === b));
      load();
    }),
  );
  body.querySelectorAll('[data-side]').forEach((b) =>
    b.addEventListener('click', () => {
      f.side = b.dataset.side;
      body.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('active', x === b));
      load();
    }),
  );
  $('#whSym', body).addEventListener('change', (e) => {
    f.symbol = e.target.value;
    load();
  });
  load();
  const timers = [setInterval(load, 30_000), setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000)];
  return () => {
    alive = false;
    timers.forEach(clearInterval);
  };
}
