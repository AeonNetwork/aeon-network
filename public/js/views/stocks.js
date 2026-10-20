import { state, netApi, on, emit, esc, icon, fmtInt, fmtUsd, fmtCompact, addrLink, link, short, toast, $, $$ } from '../core.js';
import { reveal } from '../fx.js';
import { treemap } from '../charts.js';

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

const usd = (v) => fmtUsd(v, v != null && Math.abs(v) < 1 ? 4 : 2);

function mount(main) {
  if (state.network !== 'mainnet') {
    main.innerHTML = `
      <div class="page-head"><div><div class="kicker">Robinhood Chain Testnet · Stocks</div><h1>Tokenized stocks</h1></div></div>
      <div class="box reveal"><div class="box-head">Testnet</div><div class="box-body"><p class="muted" style="margin:0 0 12px">Official Robinhood stock tokens live on Robinhood Chain mainnet.</p><button class="btn btn-primary" id="toMain">Switch to mainnet</button></div></div>`;
    $('#toMain', main).addEventListener('click', () => emit('set-network', 'mainnet'));
    return () => {};
  }

  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">Robinhood Chain · Tokenized stocks</div><h1>Stocks on-chain</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Official Robinhood stock tokens (ERC-8056). Figures describe the tokens on Robinhood Chain, not the companies. Source: Blockscout.</span>
    </div>

    <section class="grid g-4">
      ${metric('sCount', 'Stock tokens')}
      ${metric('sCap', 'On-chain market cap')}
      ${metric('sHolders', 'Holder positions')}
      ${metric('sVol', 'Volume · 24h')}
    </section>

    <section class="grid g-main mt">
      <div class="box reveal"><div class="box-head">Market cap map<span class="right dim">tile size = on-chain market cap · click to open</span></div><div class="box-body"><div class="chart" id="map" style="height:380px"></div></div></div>
      <div class="grid" style="align-content:start">
        <div class="box reveal">
          <div class="box-head">Is it the real one?</div>
          <div class="box-body">
            <p class="muted" style="margin:0 0 10px;font-size:13px">Copycat tokens reuse tickers like TSLA or NVDA. Check a ticker or name against the official Robinhood contract.</p>
            <form class="row" id="vForm"><input class="input mono" id="vq" placeholder="TSLA, Tesla, NVDA…" autocomplete="off" aria-label="Ticker or company"><button class="btn btn-primary" type="submit">Check</button></form>
          </div>
          <div id="vOut"></div>
        </div>
        <div class="box reveal"><div class="box-head">Your holdings</div><div class="box-body"><p class="muted" style="margin:0 0 10px;font-size:13px">See which official stock tokens a wallet holds, their value, and any copycats hiding in it.</p><a class="btn btn-primary" href="#/check">Run a wallet check</a></div></div>
        <div class="box reveal"><div class="box-head">Most held</div><div class="table-wrap" id="mostHeld"><div class="empty">Loading…</div></div></div>
      </div>
    </section>

    <section class="box reveal mt">
      <div class="box-head">All stock tokens<span class="right"><input class="input" id="sq" placeholder="Search" style="height:30px;width:200px" aria-label="Search stocks"></span></div>
      <div class="box-body" style="padding-bottom:0"><div class="row between wrap">
        <div class="chips" id="kinds"><button class="chip active" data-kind="All">All</button><button class="chip" data-kind="Stock">Stocks</button><button class="chip" data-kind="ETF">ETFs & funds</button></div>
        <div class="chips" id="sorts"><span class="dim" style="font-size:12px;align-self:center">Sort</span><button class="chip active" data-sort="marketCap">Market cap</button><button class="chip" data-sort="holders">Holders</button><button class="chip" data-sort="volume24h">Volume</button><button class="chip" data-sort="price">Price</button></div>
      </div></div>
      <div class="table-wrap mt" id="table"><div class="empty">Loading stock tokens…</div></div>
    </section>`;

  const charts = [];
  let all = [];
  let kind = 'All';
  let sort = 'marketCap';
  let q = '';
  const $m = (id) => $(`#${id} .metric-val`, main);
  const $s = (id) => $(`#${id} .metric-sub`, main);

  const paintTable = () => {
    const rows = all
      .filter((s) => (kind === 'All' || s.kind === kind) && (!q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)))
      .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
    const max = Math.max(1, ...rows.map((r) => r[sort] || 0));
    $('#table', main).innerHTML = rows.length
      ? `<table class="tbl"><thead><tr><th>#</th><th>Token</th><th>Type</th><th class="num">Price</th><th class="num">Market cap</th><th class="num">Holders</th><th class="num">Volume 24h</th><th>Contract</th></tr></thead><tbody>${rows
          .map(
            (s, i) => `<tr data-open="${s.address}" style="cursor:pointer">
              <td class="dim mono">${i + 1}</td>
              <td><div class="row" style="gap:10px">${s.icon ? `<img class="logo" src="${esc(icon(s.icon))}" data-sym="${esc(s.symbol)}" alt="" loading="lazy" style="border-radius:50%">` : `<span class="logo ph">${esc(s.symbol.slice(0, 2))}</span>`}<span><b style="font-weight:500">${esc(s.symbol)}</b> <span class="dim">${esc(s.name)}</span></span></div></td>
              <td><span class="tag">${s.kind}</span></td>
              <td class="num">${usd(s.price)}</td>
              <td class="num ${sort === 'marketCap' ? 'bar-cell' : ''}">${sort === 'marketCap' ? `<i style="width:${((s.marketCap || 0) / max) * 100}%"></i>` : ''}${fmtUsd(s.marketCap)}</td>
              <td class="num ${sort === 'holders' ? 'bar-cell' : ''}">${sort === 'holders' ? `<i style="width:${((s.holders || 0) / max) * 100}%"></i>` : ''}${fmtInt(s.holders)}</td>
              <td class="num ${sort === 'volume24h' ? 'bar-cell' : ''}">${sort === 'volume24h' ? `<i style="width:${((s.volume24h || 0) / max) * 100}%"></i>` : ''}${s.volume24h ? fmtUsd(s.volume24h) : '—'}</td>
              <td>${addrLink(s.address, 6)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<div class="empty">No stock tokens match.</div>';
  };

  netApi('/stocks')
    .then((list) => {
      all = list;
      const etfs = list.filter((s) => s.kind === 'ETF').length;
      $m('sCount').textContent = fmtInt(list.length);
      $s('sCount').textContent = `${list.length - etfs} stocks · ${etfs} ETFs & funds`;
      $m('sCap').textContent = fmtUsd(list.reduce((a, s) => a + (s.marketCap || 0), 0));
      $s('sCap').textContent = `Top: ${list[0]?.symbol ?? '—'} ${fmtUsd(list[0]?.marketCap)}`;
      const holders = list.reduce((a, s) => a + (s.holders || 0), 0);
      const topHeld = [...list].sort((a, b) => (b.holders || 0) - (a.holders || 0));
      $m('sHolders').textContent = fmtCompact(holders);
      $s('sHolders').textContent = `Sum across tokens · most held ${topHeld[0]?.symbol ?? '—'}`;
      $m('sVol').textContent = fmtUsd(list.reduce((a, s) => a + (s.volume24h || 0), 0));
      $s('sVol').textContent = 'All stock tokens · Blockscout';
      charts.push(
        treemap($('#map', main), list.map((s) => ({ id: s.address, label: s.symbol, sub: s.name, value: s.marketCap || 0, icon: icon(s.icon) })), {
          format: (v) => fmtUsd(v),
          onClick: (d) => (location.hash = link.token(d.id)),
          label: 'Tokenized stocks by on-chain market cap',
        }),
      );
      $('#mostHeld', main).innerHTML = `<table class="tbl"><tbody>${topHeld
        .slice(0, 6)
        .map((s) => `<tr data-open="${s.address}" style="cursor:pointer"><td><b style="font-weight:500">${esc(s.symbol)}</b> <span class="dim">${esc(s.name)}</span></td><td class="num">${fmtInt(s.holders)}</td></tr>`)
        .join('')}</tbody></table>`;
      paintTable();
    })
    .catch((err) => {
      $('#table', main).innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      $('#map', main).innerHTML = '<div class="empty">Unavailable</div>';
    });

  // ---------- controls ----------
  main.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      kind = k.dataset.kind;
      $$('#kinds .chip', main).forEach((c) => c.classList.toggle('active', c === k));
      return paintTable();
    }
    const so = e.target.closest('[data-sort]');
    if (so) {
      sort = so.dataset.sort;
      $$('#sorts .chip', main).forEach((c) => c.classList.toggle('active', c === so));
      return paintTable();
    }
    const row = e.target.closest('[data-open]');
    if (row && !e.target.closest('a')) location.hash = link.token(row.dataset.open);
  });
  $('#sq', main).addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    paintTable();
  });

  // ---------- official vs look-alike ----------
  $('#vForm', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = $('#vq', main).value.trim();
    if (!query) return;
    const out = $('#vOut', main);
    out.innerHTML = '<div class="empty">Checking…</div>';
    try {
      const r = await netApi('/verify?q=' + encodeURIComponent(query));
      const risky = r.lookalikes.filter((l) => l.risk === 'high');
      out.innerHTML = `
        <div class="box-foot" style="font-size:12px">OFFICIAL</div>
        ${r.official.length ? r.official.map((t) => verifyRow(t, '<span class="tag solid">✓ OFFICIAL</span>')).join('') : '<div class="empty">No official Robinhood stock token matches.</div>'}
        <div class="box-foot" style="font-size:12px">${risky.length ? `${risky.length} LOOK-ALIKE${risky.length > 1 ? 'S' : ''} — DO NOT CONFUSE` : 'NO RISKY LOOK-ALIKES FOUND'}</div>
        ${risky.slice(0, 6).map((t) => verifyRow(t, '<span class="tag">⚠ NOT OFFICIAL</span>')).join('')}`;
    } catch (err) {
      out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  });

  return () => charts.forEach((c) => c.destroy());
}

function verifyRow(t, badge) {
  return `<div class="feed-row"><div class="cube">${esc((t.symbol || '?').slice(0, 4))}</div><div class="main"><b style="font-family:var(--font);font-weight:500">${esc(t.name || '')}</b><span>${esc(t.type || '')} · <a class="link mono" href="${link.token(t.address)}">${esc(short(t.address, 8))}</a></span></div>${badge}</div>`;
}

function metric(id, title) {
  return `<div class="box metric reveal" id="${id}"><div class="box-head">${title}</div><div class="box-body"><div class="metric-val">—</div><div class="metric-sub">Blockscout</div></div></div>`;
}
