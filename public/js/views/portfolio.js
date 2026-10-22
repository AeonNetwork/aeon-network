// Portfolio: a brokerage-style view of the tokenized stocks held by any address.
// Read-only; paste an address or use the connected wallet. Nothing is signed.
import { state, netApi, net, on, prefs, esc, fmtUsd, fmtPct, fmtNum, ago, short, txLink, addrLink, link, toast, COLORS, $ } from '../core.js';
import { reveal, fitCanvas } from '../fx.js';
import { timeChart } from '../charts.js';
import { addWatch } from '../watch.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const recent = () => prefs.get('pf-recent', []);
const remember = (a) => prefs.set('pf-recent', [a, ...recent().filter((x) => x.toLowerCase() !== a.toLowerCase())].slice(0, 5));

export function render(main, [addrParam]) {
  let dispose = mount(main, addrParam);
  const offs = ['network', 'wallet'].map((ev) =>
    on(ev, () => {
      dispose();
      dispose = mount(main, addrParam);
      reveal(main);
    }),
  );
  return () => {
    offs.forEach((o) => o());
    dispose();
  };
}

function mount(main, addrParam) {
  const addr = addrParam && ADDR.test(addrParam) ? addrParam : null;
  const isMain = state.network === 'mainnet';
  let chart = null;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Portfolio</div><h1>Your stocks, on-chain</h1></div>
      <span class="dim" style="font-size:12px;max-width:420px;text-align:right">Every tokenized stock an address holds, valued live. Read-only: paste any address, no wallet connection needed.</span>
    </div>
    <form class="search-xl reveal" id="pfForm">
      <input id="pfAddr" placeholder="0x address" value="${esc(addr || '')}" spellcheck="false" aria-label="Address">
      ${state.wallet ? '<button class="btn" type="button" id="pfMine">My wallet</button>' : ''}
      <button class="btn btn-primary" type="submit">Open portfolio</button>
    </form>
    <div id="pfBody" class="mt"></div>`;

  const go = (a) => (location.hash = `#/portfolio/${a}`);
  $('#pfForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#pfAddr', main).value.trim();
    if (!ADDR.test(v)) return toast('Enter a 0x address (42 characters).', 'err');
    go(v);
  });
  $('#pfMine', main)?.addEventListener('click', () => go(state.wallet.address));

  const body = $('#pfBody', main);
  if (!addr) {
    body.innerHTML = `
      <div class="box reveal">
        <div class="box-body pf-intro">
          <div>
            <h2>Track tokenized stocks like a brokerage app</h2>
            <ul>
              <li>Total value and today's gain or loss, position by position</li>
              <li>What your current positions were worth over the past 7 days</li>
              <li>Every buy and sell of your stock tokens, linked to the chain</li>
              <li>Fake copies of real stock tokens are flagged, not counted</li>
            </ul>
          </div>
          <div class="pf-intro-side">
            ${isMain ? '<button class="btn btn-primary" id="pfExample">Try a real portfolio</button><span class="dim" style="font-size:12px">The largest individual holder of the most-held stock token, live.</span>' : '<span class="dim">Tokenized stocks live on mainnet. Switch network to track them.</span>'}
            ${recent().length ? `<div class="pf-recent"><span class="dim">Recent</span>${recent().map((a) => `<a class="chip" href="#/portfolio/${a}">${esc(short(a, 6))}</a>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>`;
    $('#pfExample', main)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Finding one…';
      try {
        go((await netApi('/portfolio-example')).address);
      } catch (err) {
        toast(err.message, 'err');
        e.target.disabled = false;
        e.target.textContent = 'Try a real portfolio';
      }
    });
    return () => {};
  }

  remember(addr);
  body.innerHTML = '<div class="box"><div class="empty">Reading balances, prices and transfers…</div></div>';
  let alive = true;
  netApi(`/portfolio/${addr}/detail`)
    .then((p) => {
      if (!alive) return;
      const eth = p.ethWei ? Number(BigInt(p.ethWei)) / 1e18 : 0;
      const ethUsd = state.ethUsd ? eth * state.ethUsd : null;
      const up = (p.change24hUsd ?? 0) >= 0;
      const hs = p.holdings;
      const total = p.stocksValueUsd || 0;
      body.innerHTML = `
        <section class="box pf-hero reveal">
          <div class="pf-hero-main">
            <div class="kicker">Portfolio value · ${addrLink(addr, 6)}</div>
            <div class="pf-total">${fmtUsd(total)}</div>
            <div class="pf-change ${up ? 'up' : 'down'}">${p.change24hUsd == null ? '<span class="dim">Today: price change unavailable</span>' : `${up ? '▲' : '▼'} ${fmtUsd(Math.abs(p.change24hUsd))} (${fmtPct(p.change24hPct * 100)}) <span class="dim">today</span>`}</div>
            <div class="pf-facts">
              <div><span>Positions</span><b>${hs.length}</b></div>
              <div><span>ETH</span><b>${fmtNum(eth, 4)}</b>${ethUsd != null ? `<i>${fmtUsd(ethUsd)}</i>` : ''}</div>
              <div><span>Other tokens</span><b>${p.othersCount}</b></div>
            </div>
          </div>
          <div class="pf-hero-chart">
            <div class="box-head">Current positions · 7 days</div>
            <div class="chart" id="pfChart"></div>
          </div>
        </section>

        ${hs.length ? `
        <section class="box reveal mt">
          <div class="box-head">Allocation</div>
          <div class="box-body">
            <div class="pf-alloc">${hs.map((h, i) => `<i style="width:${((h.valueUsd || 0) / total) * 100}%;opacity:${1 - Math.min(0.75, i * 0.13)}" title="${esc(h.symbol)} ${(((h.valueUsd || 0) / total) * 100).toFixed(1)}%"></i>`).join('')}</div>
            <div class="pf-legend">${hs.slice(0, 8).map((h, i) => `<span><i style="opacity:${1 - Math.min(0.75, i * 0.13)}"></i>${esc(h.symbol)} ${(((h.valueUsd || 0) / total) * 100).toFixed(1)}%</span>`).join('')}</div>
          </div>
        </section>

        <section class="box reveal mt">
          <div class="box-head">Positions<span class="right dim">tap a row for the token profile</span></div>
          <div class="tbl-wrap"><table class="tbl pf-tbl">
            <thead><tr><th>Asset</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Today</th><th>7 days</th><th class="num">Value</th><th class="num">Weight</th></tr></thead>
            <tbody>${hs
              .map(
                (h, i) => `<tr data-href="${link.token(h.address)}">
                  <td><div class="pf-asset"><span class="pf-ph">${esc(h.symbol.slice(0, 2))}</span><div><b>${esc(h.symbol)}</b><span>${esc(h.name)}</span></div><span class="tag">✓ official</span></div></td>
                  <td class="num">${fmtNum(h.amount, 4)}</td>
                  <td class="num">${fmtUsd(h.price)}</td>
                  <td class="num ${h.change24h == null ? 'dim' : h.change24h >= 0 ? 'up' : 'down'}">${h.change24h == null ? '—' : fmtPct(h.change24h * 100)}</td>
                  <td><canvas class="pf-spark" data-i="${i}"></canvas></td>
                  <td class="num"><b>${fmtUsd(h.valueUsd)}</b></td>
                  <td class="num">${(((h.valueUsd || 0) / total) * 100).toFixed(1)}%</td>
                </tr>`,
              )
              .join('')}</tbody>
          </table></div>
        </section>` : `<div class="box mt"><div class="empty">This address holds no official stock tokens${isMain ? '' : ' on testnet'}.</div></div>`}

        ${p.copycats.length ? `
        <section class="box reveal mt pf-warn">
          <div class="box-head">⚠ Not counted: ${p.copycats.length} copycat token${p.copycats.length > 1 ? 's' : ''}</div>
          <div class="box-body">
            <p class="dim" style="margin:0 0 10px">These use a real stock's name or ticker but are not Robinhood's official ERC-8056 tokens. They are excluded from the value above.</p>
            ${p.copycats.map((c) => `<div class="pf-copy"><a href="${link.token(c.address)}"><b>${esc(c.symbol || '?')}</b> <span class="${c.phishing ? 'dim' : ''}">${esc(c.name || '')}</span></a><span class="mono dim">${fmtNum(c.amount, 4)}</span></div>`).join('')}
          </div>
        </section>` : ''}

        <section class="box reveal mt">
          <div class="box-head">Recent activity<span class="right dim">stock-token transfers</span></div>
          ${p.activity.length ? `<div class="pf-acts" id="pfActs">${p.activity
            .map(
              (a, i) => `<div class="pf-act" ${i >= 8 ? 'hidden' : ''}>
                <span class="tag ${a.dir === 'in' ? 'solid' : ''}">${a.dir === 'in' ? 'IN' : 'OUT'}</span>
                <div class="main"><b>${a.dir === 'in' ? '+' : '−'}${fmtNum(a.amount, 4)} ${esc(a.symbol)}</b><span>${a.dir === 'in' ? 'from' : 'to'} ${a.counterpartyName ? esc(a.counterpartyName) : addrLink(a.counterparty, 6)}${a.method ? ` · ${esc(a.method)}` : ''}</span></div>
                <span class="mono dim pf-val">${a.valueNowUsd != null ? '≈ ' + fmtUsd(a.valueNowUsd) + ' now' : ''}</span>
                <span class="mono dim pf-ago" title="${new Date(a.t).toLocaleString()}">${ago(a.t)}</span>
                ${txLink(a.tx, 8)}
              </div>`,
            )
            .join('')}</div>${p.activity.length > 8 ? `<button class="btn btn-sm pf-more" id="pfMore">Show all ${p.activity.length} transfers</button>` : ''}` : '<div class="empty">No stock-token transfers found for the largest positions.</div>'}
        </section>

        <div class="row wrap between mt pf-actions">
          <span class="dim" style="font-size:12px;max-width:640px">${esc(p.note)}</span>
          <div class="row wrap" style="gap:8px">
            <button class="btn btn-sm btn-primary" id="pfCard">Share card</button>
            <button class="btn btn-sm" id="pfCopy">Copy link</button>
            <button class="btn btn-sm" id="pfWatch">Watch this address</button>
            <a class="btn btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`Tracking a Robinhood Chain stock portfolio on @getaeon_network`)}&url=${encodeURIComponent(location.origin + '/#/portfolio/' + addr)}">Share on X</a>
          </div>
        </div>`;

      $('#pfCard', body)?.addEventListener('click', () => import('../sharecard.js').then((m) => m.openPortfolioCard(p)));
      if (p.history.length > 1) chart = timeChart($('#pfChart', body), p.history, { format: (v) => fmtUsd(v), label: 'Value of current positions over 7 days' });
      else $('#pfChart', body).innerHTML = '<div class="empty">Price history unavailable right now.</div>';

      body.querySelectorAll('.pf-spark').forEach((c) => drawSpark(c, hs[+c.dataset.i].spark));
      body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
      $('#pfMore', body)?.addEventListener('click', (e) => {
        body.querySelectorAll('#pfActs [hidden]').forEach((r) => (r.hidden = false));
        e.target.remove();
      });
      $('#pfCopy', body).addEventListener('click', () => navigator.clipboard.writeText(location.origin + '/#/portfolio/' + addr).then(() => toast('Link copied')));
      $('#pfWatch', body).addEventListener('click', () => {
        addWatch(state.network, addr, 'Portfolio');
        toast('Added to your watchlist');
      });
      reveal(body);
    })
    .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));

  return () => {
    alive = false;
    chart?.destroy();
  };
}

// 7-day sparkline: a single line, brighter end point.
function drawSpark(canvas, values) {
  if (!values || values.length < 2) return;
  const { ctx, w, h } = fitCanvas(canvas);
  const min = Math.min(...values), max = Math.max(...values);
  const X = (i) => 2 + (i / (values.length - 1)) * (w - 4);
  const Y = (v) => (max === min ? h / 2 : 3 + (1 - (v - min) / (max - min)) * (h - 6));
  ctx.strokeStyle = values.at(-1) >= values[0] ? COLORS.ink : COLORS.ink3;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(X(values.length - 1) - 1.5, Y(values.at(-1)) - 1.5, 3, 3);
}
