import { state, api, on, esc, icon, fmtUsd, fmtPct, fmtInt, ago, $, $$ } from '../core.js';
import { reveal } from '../fx.js';
import { timeChart } from '../charts.js';

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
  if (state.network !== 'mainnet') {
    main.innerHTML = `
      <div class="page-head"><div><div class="kicker">Robinhood Chain Testnet · Ecosystem</div><h1>Ecosystem</h1></div></div>
      <div class="box reveal"><div class="box-head">Testnet</div><div class="box-body"><p class="muted" style="margin:0 0 12px">Ecosystem data (protocols, TVL, DEX volume, fees) is tracked for Robinhood Chain mainnet, where real value lives.</p><button class="btn btn-primary" id="toMain">Switch to mainnet</button></div></div>`;
    $('#toMain', main).addEventListener('click', () => import('../core.js').then(({ emit }) => emit('set-network', 'mainnet')));
    return () => {};
  }
  const E = '/ecosystem/mainnet';
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">Robinhood Chain · Ecosystem</div><h1>Ecosystem</h1></div>
      <span class="dim" style="font-size:12px">Source: DefiLlama · refreshed every 15–60 min</span>
    </div>

    <section class="grid g-4">
      ${metric('eTvl', 'Total value locked')}
      ${metric('eProt', 'Protocols live')}
      ${metric('eStable', 'Stablecoin supply')}
      ${metric('eDex', 'DEX volume · 24h')}
    </section>

    <section class="grid g-2 mt">
      <div class="box reveal"><div class="box-head">TVL on Robinhood Chain<span class="right dim">daily</span></div><div class="box-body"><div class="chart tall" id="cTvl"></div></div></div>
      <div class="box reveal"><div class="box-head">Stablecoin supply<span class="right dim">daily</span></div><div class="box-body"><div class="chart tall" id="cStable"></div></div></div>
      <div class="box reveal"><div class="box-head">DEX volume<span class="right dim">daily · last 90 days</span></div><div class="box-body"><div class="chart" id="cDex"></div></div></div>
      <div class="box reveal"><div class="box-head">Fees paid<span class="right dim">daily · last 90 days</span></div><div class="box-body"><div class="chart" id="cFees"></div></div></div>
    </section>

    <section class="grid g-2 mt">
      <div class="box reveal"><div class="box-head">Top DEXs · 24h volume</div><div class="table-wrap" id="topDex"><div class="empty">Loading…</div></div></div>
      <div class="box reveal"><div class="box-head">Top fee earners · 24h</div><div class="table-wrap" id="topFees"><div class="empty">Loading…</div></div></div>
    </section>

    <section class="box reveal mt">
      <div class="box-head">Protocol directory<span class="right"><input class="input" id="pq" placeholder="Search protocols" style="height:30px;width:220px" aria-label="Search protocols"></span></div>
      <div class="box-body" style="padding-bottom:0"><div class="chips" id="cats"></div></div>
      <div class="table-wrap mt" id="protocols"><div class="empty">Loading protocols…</div></div>
    </section>

    <section class="box reveal mt">
      <div class="box-head">Robinhood Chain in the news<span class="right dim">Cointelegraph · filtered</span></div>
      <div class="feed" id="news"><div class="empty">Loading…</div></div>
    </section>`;

  const $m = (id) => $(`#${id} .metric-val`, main);
  const $s = (id) => $(`#${id} .metric-sub`, main);
  const charts = [];
  const usdAxis = (v) => fmtUsd(v, 0);

  api(`${E}/summary`).then((c) => {
    $m('eTvl').textContent = fmtUsd(c.tvl);
    $s('eTvl').textContent = `Rank #${c.rank} of ${c.chains} chains`;
  }).catch(() => ($s('eTvl').textContent = 'Unavailable'));

  api(`${E}/tvl`).then((rows) => {
    charts.push(timeChart($('#cTvl', main), rows, { format: usdAxis, label: 'Total value locked over time' }));
    const first = rows.find((r) => r.v > 0);
    if (first) $s('eTvl').textContent += ` · tracked since ${new Date(first.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }).catch(() => ($('#cTvl', main).innerHTML = '<div class="empty">Unavailable</div>'));

  api(`${E}/stablecoins`).then((rows) => {
    charts.push(timeChart($('#cStable', main), rows, { format: usdAxis, label: 'Stablecoin supply over time' }));
    const last = rows.at(-1), weekAgo = rows.at(-8);
    $m('eStable').textContent = fmtUsd(last?.v);
    $s('eStable').textContent = weekAgo?.v ? `${fmtPct((last.v / weekAgo.v - 1) * 100)} over 7 days` : 'USD-pegged';
  }).catch(() => ($s('eStable').textContent = 'Unavailable'));

  const ranking = (el, rows, total) => {
    if (!rows.length) return (el.innerHTML = '<div class="empty">No data.</div>');
    el.innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Protocol</th><th class="num">24h</th><th class="num">Share</th><th class="num">1d</th></tr></thead><tbody>${rows
      .map((p, i) => `<tr><td class="dim mono">${i + 1}</td><td><div class="row" style="gap:8px">${p.logo ? `<img class="logo" src="${esc(icon(p.logo))}" data-sym="${esc(p.name)}" alt="" loading="lazy">` : ''}${esc(p.name)}</div></td><td class="num">${fmtUsd(p.total24h)}</td><td class="num bar-cell"><i style="width:${total ? (p.total24h / total) * 100 : 0}%"></i>${total ? ((p.total24h / total) * 100).toFixed(1) + '%' : '—'}</td><td class="num">${fmtPct(p.change1d, 1)}</td></tr>`)
      .join('')}</tbody></table>`;
  };
  api(`${E}/dex`).then((d) => {
    $m('eDex').textContent = fmtUsd(d.total24h);
    $s('eDex').textContent = `${fmtPct(d.change1d)} vs yesterday · 7d ${fmtUsd(d.total7d)}`;
    charts.push(timeChart($('#cDex', main), d.chart.slice(-90), { type: 'bar', format: usdAxis, label: 'Daily DEX volume' }));
    ranking($('#topDex', main), d.protocols, d.total24h);
  }).catch(() => ($s('eDex').textContent = 'Unavailable'));
  api(`${E}/fees`).then((d) => {
    charts.push(timeChart($('#cFees', main), d.chart.slice(-90), { type: 'bar', format: usdAxis, label: 'Daily fees' }));
    ranking($('#topFees', main), d.protocols, d.total24h);
  }).catch(() => ($('#topFees', main).innerHTML = '<div class="empty">Unavailable</div>'));

  // ---------- protocol directory ----------
  let all = [];
  let cat = 'All';
  let q = '';
  const paintProtocols = () => {
    const rows = all.filter((p) => (cat === 'All' || p.category === cat) && (!q || p.name.toLowerCase().includes(q)));
    const max = Math.max(1, ...rows.map((p) => p.chainTvl || 0));
    $('#protocols', main).innerHTML = rows.length
      ? `<table class="tbl"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL on Robinhood Chain</th><th class="num">1d</th><th class="num">Chains</th><th></th></tr></thead><tbody>${rows
          .slice(0, 150)
          .map(
            (p, i) => `<tr><td class="dim mono">${i + 1}</td><td><div class="row" style="gap:10px">${p.logo ? `<img class="logo" src="${esc(icon(p.logo))}" data-sym="${esc(p.name)}" alt="" loading="lazy">` : ''}<div><b style="font-weight:500">${esc(p.name)}</b>${p.description ? `<div class="dim" style="font-size:12px;max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(p.description)}</div>` : ''}</div></div></td>
            <td><span class="tag">${esc(p.category)}</span></td>
            <td class="num bar-cell"><i style="width:${((p.chainTvl || 0) / max) * 100}%"></i>${p.chainTvl ? fmtUsd(p.chainTvl) : '—'}</td>
            <td class="num">${fmtPct(p.change1d, 1)}</td><td class="num">${p.chains}</td>
            <td>${p.url ? `<a class="btn btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Visit ↗</a>` : ''}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<div class="empty">No protocols match.</div>';
  };
  api(`${E}/protocols`).then((list) => {
    all = list;
    $m('eProt').textContent = fmtInt(list.length);
    const withTvl = list.filter((p) => p.chainTvl > 0).length;
    $s('eProt').textContent = `${withTvl} with TVL on the chain`;
    const counts = {};
    for (const p of list) counts[p.category] = (counts[p.category] || 0) + 1;
    const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14);
    $('#cats', main).innerHTML = [['All', list.length], ...cats].map(([c, nn]) => `<button class="chip ${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)} <span class="dim">${nn}</span></button>`).join('');
    paintProtocols();
  }).catch((err) => ($('#protocols', main).innerHTML = `<div class="empty">${esc(err.message)}</div>`));
  $('#cats', main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    $$('#cats .chip', main).forEach((c) => c.classList.toggle('active', c === b));
    paintProtocols();
  });
  let st;
  $('#pq', main).addEventListener('input', (e) => {
    clearTimeout(st);
    st = setTimeout(() => {
      q = e.target.value.trim().toLowerCase();
      paintProtocols();
    }, 120);
  });

  // ---------- news ----------
  api('/news').then((items) => {
    $('#news', main).innerHTML = items.length
      ? items.slice(0, 8).map((n) => `<a class="feed-row" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><div class="cube">NEWS</div><div class="main"><b style="font-family:var(--font);font-weight:500;white-space:normal">${esc(n.title)}</b><span>${esc(n.summary)}</span></div><span class="dim mono">${ago(n.date)}</span></a>`).join('')
      : '<div class="empty">No Robinhood Chain stories in the latest headlines.</div>';
  }).catch(() => ($('#news', main).innerHTML = '<div class="empty">News unavailable.</div>'));

  return () => charts.forEach((c) => c.destroy());
}

function metric(id, title) {
  return `<div class="box metric reveal" id="${id}"><div class="box-head">${title}</div><div class="box-body"><div class="metric-val">—</div><div class="metric-sub">DefiLlama</div></div></div>`;
}
