// Dev Checker: a token creator's track record on Pons, read from the chain.
import { state, netApi, net, on, prefs, esc, fmtNum, ago, short, addrLink, toast, $ } from '../core.js';
import { reveal } from '../fx.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const MARK = { pass: '✓', info: 'i', warn: '!', fail: '✕' };
const ACTION = { sold: 'SOLD', burned: 'BURNED', moved: 'MOVED OUT', holds: 'HOLDS', mixed: 'MIXED', none: '—' };
const recent = () => prefs.get('dev-recent', []);
const remember = (a, risk) => prefs.set('dev-recent', [{ a, risk }, ...recent().filter((x) => x.a !== a)].slice(0, 6));

export function render(main, [addrParam]) {
  let dispose = mount(main, addrParam);
  const off = on('network', () => {
    dispose();
    dispose = mount(main, addrParam);
    reveal(main);
  });
  return () => {
    off();
    dispose();
  };
}

const metric = (k, v, sub) => `<div class="box metric"><div class="box-head">${k}</div><div class="box-body"><div class="metric-val">${v}</div><div class="metric-sub">${sub}</div></div></div>`;
const pct = (v) => (v == null || v < 0.01 ? '—' : fmtNum(v, v < 1 ? 2 : 1) + '%');

function mount(main, addrParam) {
  const addr = addrParam && ADDR.test(addrParam) ? addrParam : null;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Dev Checker</div><h1>Check the dev</h1></div>
      <span class="dim" style="font-size:12px;max-width:460px;text-align:right">Paste the wallet that launched a token. See every token it launched on Pons, how they did, and what the dev did with their own tokens.</span>
    </div>
    <form class="search-xl reveal" id="dvForm">
      <input id="dvAddr" placeholder="Creator wallet (0x…)" value="${esc(addr || '')}" spellcheck="false" aria-label="Creator wallet">
      <button class="btn btn-primary" type="submit">Check dev</button>
    </form>
    <div id="dvBody" class="mt"></div>`;
  $('#dvForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#dvAddr', main).value.trim();
    if (!ADDR.test(v)) return toast('Paste a wallet address (42 characters, starts with 0x).', 'err');
    location.hash = `#/dev/${v}`;
  });
  const body = $('#dvBody', main);
  if (state.network !== 'mainnet') {
    body.innerHTML = '<div class="box"><div class="empty">The Dev Checker covers mainnet. Switch network to use it.</div></div>';
    return () => {};
  }
  if (!addr) {
    const r = recent();
    body.innerHTML = `
      <div class="grid g-2 reveal">
        <div class="box"><div class="box-head">What it shows</div><div class="box-body sc-list">
          <div><b>Every launch</b><span>All tokens this wallet created on Pons, from the factory's own records.</span></div>
          <div><b>How they did</b><span>Graduated, still on the curve, or died within a day.</span></div>
          <div><b>What the dev did</b><span>Bought, sold back into the curve, burned, or moved their tokens to other wallets.</span></div>
          <div><b>Red flags</b><span>Serial launching, selling into buyers and hidden wallets, each with the evidence.</span></div>
        </div></div>
        <div class="box"><div class="box-head">Where to find the dev</div><div class="box-body sc-try">
          <p class="dim" style="margin:0 0 6px">Every row on the <a class="link" href="#/radar">Token radar</a> links its creator here, and the <a class="link" href="#/scan">scanner</a> shows the creator of any Pons token.</p>
          ${r.map((x) => `<button class="chip" data-a="${esc(x.a)}">${esc(short(x.a, 6))} · ${esc(x.risk)}</button>`).join('')}
        </div></div>
      </div>`;
    body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/dev/${b.dataset.a}`)));
    return () => {};
  }

  body.innerHTML = '<div class="box"><div class="empty">Reading every launch by this wallet and what it did with its tokens…</div></div>';
  let alive = true;
  netApi(`/dev/${addr}`)
    .then((d) => {
      if (!alive) return;
      remember(d.address, d.risk);
      const s = d.stats;
      const shareText = `Dev check on Aeon: ${s.launches} Pons launches, ${s.graduated} graduated. ${d.verdict}`;
      body.innerHTML = `
        <section class="box sc-hero reveal">
          <div class="sc-grade dv-risk dv-${d.risk}">${{ high: '✕', caution: '!', low: '✓', none: '·' }[d.risk]}</div>
          <div class="sc-main">
            <div class="kicker">Creator · ${addrLink(d.address, 10)}</div>
            <h2 class="sc-title">${{ high: 'High risk', caution: 'Caution', low: 'Low risk', none: 'No launches' }[d.risk]}</h2>
            <p class="sc-verdict">${esc(d.verdict)}</p>
            <div class="row wrap" style="gap:8px">
              <a class="btn btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(shareText + '\n\nvia @getaeon_network')}&url=${encodeURIComponent(location.origin + '/dev')}">Share on X</a>
              <button class="btn btn-sm" id="dvCopy">Copy result</button>
              <a class="btn btn-sm" href="#/explorer/address/${esc(d.address)}">Open wallet</a>
              <span class="dim" style="font-size:11.5px">checked <span data-time="${d.at}">${ago(d.at)}</span></span>
            </div>
          </div>
        </section>

        <section class="grid g-4 reveal mt">
          ${metric('Tokens launched', fmtNum(s.launches, 0), `${fmtNum(s.launches24h, 0)} today · ${fmtNum(s.launches7d, 0)} this week`)}
          ${metric('Graduated', fmtNum(s.graduated, 0), s.detailed ? `of the last ${s.detailed} · ${fmtNum(s.dead, 0)} died` : '—')}
          ${metric('Dev sold into buyers', fmtNum(s.devSold, 0), `of ${fmtNum(s.devTraded, 0)} tokens they traded`)}
          ${metric('Moved to other wallets', fmtNum(s.devMoved, 0), `${fmtNum(s.devBurned, 0)} burned instead`)}
        </section>

        <section class="box reveal mt">
          <div class="box-head">Findings<span class="right dim">worst first</span></div>
          <div class="sc-checks">${
            d.flags.length
              ? [...d.flags].sort((a, b) => ['fail', 'warn', 'info', 'pass'].indexOf(a.level) - ['fail', 'warn', 'info', 'pass'].indexOf(b.level)).map((f) => `<div class="sc-check sc-${f.level}"><span class="sc-mark">${MARK[f.level]}</span><div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p></div></div>`).join('')
              : '<div class="empty">Nothing to flag.</div>'
          }</div>
        </section>

        ${
          d.rows.length
            ? `<section class="box reveal mt"><div class="box-head">Launches<span class="right dim">newest ${d.rows.length}</span></div><div class="table-wrap"><table class="tbl dv-table">
            <thead><tr><th>Token</th><th>Launched</th><th>Curve</th><th>Status</th><th class="num">Dev got</th><th>Dev did</th></tr></thead>
            <tbody>${d.rows
              .map(
                (r, i) => `<tr data-href="#/scan/${r.token}"${i >= 15 ? ' hidden' : ''}>
                <td><b class="mono">${esc(r.symbol || short(r.token, 6))}</b><small>${esc(r.name || '')}</small></td>
                <td class="mono dim">${r.launchedAt ? ago(r.launchedAt) : '—'}</td>
                <td>${r.graduated ? '<span class="dim">filled</span>' : `<span class="rd-bar"><i style="width:${r.progress == null ? 0 : Math.max(2, r.progress * 100)}%"></i></span><small class="mono">${r.raised == null ? '—' : `${fmtNum(r.raised, r.quote === 'ETH' ? 3 : 0)} / ${fmtNum(r.threshold, r.quote === 'ETH' ? 1 : 0)} ${esc(r.quote)}`}</small>`}</td>
                <td>${r.status === 'graduated' ? '<span class="tag solid">GRADUATED</span>' : r.status === 'dead' ? '<span class="tag">DEAD</span>' : '<span class="dim">live</span>'}</td>
                <td class="num mono">${pct((r.dev.boughtPct || 0) + (r.dev.receivedPct || 0))}</td>
                <td>${r.dev.action === 'none' ? '<span class="dim">—</span>' : `<span class="tag${r.dev.action === 'sold' ? ' solid' : ''}">${ACTION[r.dev.action]}</span>`}</td>
              </tr>`,
              )
              .join('')}</tbody></table></div>
            ${d.rows.length > 15 ? `<button class="btn btn-sm pf-more" id="dvMore">Show all ${d.rows.length} launches</button>` : ''}
            <div class="box-foot">Dev got = tokens the creator bought or received, as % of launch supply. Tap a token for its safety scan.</div></section>`
            : ''
        }
        <p class="dim mt" style="font-size:12px">${esc(d.note)}</p>`;
      $('#dvCopy', body).addEventListener('click', () => navigator.clipboard.writeText(`${shareText}\n${location.origin}/#/dev/${d.address}`).then(() => toast('Copied')));
      $('#dvMore', body)?.addEventListener('click', (e) => {
        body.querySelectorAll('.dv-table tr[hidden]').forEach((tr) => (tr.hidden = false));
        e.target.remove();
      });
      body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
      reveal(body);
    })
    .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  const t = setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000);
  return () => {
    alive = false;
    clearInterval(t);
  };
}
