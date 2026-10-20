import { state, netApi, net, on, esc, icon, fmtUsd, fmtInt, fmtNum, fmtPct, fmtCompact, fromWei, ago, addrLink, txLink, link, short, toast, verifyUrl, share, $, $$ } from '../core.js';
import { reveal } from '../fx.js';
import { timeChart } from '../charts.js';
import { watchTokenInWallet } from '../wallet.js';

export function render(main, [addr]) {
  let dispose = mount(main, addr);
  const off = on('network', () => {
    dispose();
    dispose = mount(main, addr);
    reveal(main);
  });
  return () => {
    off();
    dispose();
  };
}

const usd = (v) => (v == null ? '—' : fmtUsd(v, Math.abs(v) < 1 ? 6 : 2));
const supplyStr = (raw, decimals) => {
  if (raw == null) return '—';
  const v = Number(BigInt(raw) / 10n ** BigInt(Math.max(0, decimals - 2))) / 100;
  return v >= 1e15 ? v.toExponential(2) : fromWei(raw, decimals, 2);
};

function mount(main, addr) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr || '')) {
    main.innerHTML = '<div class="box"><div class="empty">Invalid token address.</div></div>';
    return () => {};
  }
  main.innerHTML = `
    <div class="page-head"><div class="row" style="gap:14px" id="tkHead"><div><div class="kicker">${esc(net().name)} · Token</div><h1>Loading…</h1></div></div></div>
    <div id="tkBody"><div class="box"><div class="empty">Loading token profile…</div></div></div>`;
  const charts = [];

  netApi(`/token/${addr}/profile`)
    .then((t) => {
      const badges = [
        `<span class="tag">${esc(t.type || 'TOKEN')}</span>`,
        t.official ? '<span class="tag solid">✓ OFFICIAL ROBINHOOD STOCK TOKEN</span>' : '',
        t.looksLikeStock ? '<span class="tag">⚠ NOT AN OFFICIAL ROBINHOOD TOKEN</span>' : '',
        t.contract?.verified ? '<span class="tag">VERIFIED CONTRACT</span>' : t.contract ? '<span class="tag">UNVERIFIED CONTRACT</span>' : '',
        t.contract?.scam || t.reputation === 'scam' ? '<span class="tag">⚠ FLAGGED AS SCAM</span>' : '',
      ].join(' ');
      $('#tkHead', main).innerHTML = `
        ${t.icon ? `<img class="logo" src="${esc(icon(t.icon))}" data-sym="${esc(t.symbol || '?')}" alt="" style="width:52px;height:52px;border-radius:50%">` : `<span class="logo ph" style="width:52px;height:52px;font-size:14px">${esc((t.symbol || '?').slice(0, 3))}</span>`}
        <div><div class="kicker">${esc(net().name)} · Token profile</div><h1>${esc(t.symbol || '?')} <span class="dim" style="font-weight:400">${esc(t.official && t.stock ? t.stock.name : t.name || '')}</span></h1><div class="row wrap" style="gap:6px;margin-top:8px">${badges}</div></div>`;
      document.title = `${t.symbol || 'Token'} · Aeon Network`;

      const body = $('#tkBody', main);
      body.innerHTML = `
        ${t.looksLikeStock ? `<div class="notice" style="margin-bottom:12px;border-style:solid"><b>⚠ This is not an official Robinhood stock token.</b> It uses a Robinhood-like name but is not the official ERC-8056 contract. <a class="link" href="#/stocks">Find the official ${esc(t.symbol || '')}</a></div>` : ''}
        <section class="grid g-4">
          ${metric('tPrice', 'Price', usd(t.price), 'Loading 30-day change…')}
          ${metric('tCap', 'Market cap', t.marketCap ? fmtUsd(t.marketCap) : '—', t.official ? 'On-chain, not the company' : 'Circulating supply × price')}
          ${metric('tHolders', 'Holders', fmtInt(t.holders), t.top10Pct ? `Top 10 hold ${fmtNum(t.top10Pct, 1)}%` : 'Blockscout')}
          ${metric('tTransfers', 'Transfers', t.transfers != null ? fmtCompact(t.transfers) : '—', t.transfers != null ? fmtInt(t.transfers) + ' all time' : 'Blockscout')}
        </section>
        <section class="grid g-main mt">
          <div class="box reveal"><div class="box-head">Price<span class="right"><span class="chips" id="tkRanges">${[7, 30, 90, 365].map((d) => `<button class="chip ${d === 30 ? 'active' : ''}" data-days="${d}">${d === 365 ? '1Y' : d + 'D'}</button>`).join('')}</span></span></div><div class="box-body"><div class="chart tall" id="tkChart"></div></div><div class="box-foot" id="tkChartSrc">Source: CoinGecko</div></div>
          <div class="grid" style="align-content:start">
            <div class="box reveal"><div class="box-head">Token</div><dl class="kv">
              <dt>Contract</dt><dd>${esc(t.address)}</dd>
              <dt>Standard</dt><dd>${esc(t.type || '—')}</dd>
              <dt>Decimals</dt><dd>${t.decimals}</dd>
              <dt>Total supply</dt><dd>${supplyStr(t.totalSupply, t.decimals)} ${esc(t.symbol || '')}</dd>
              <dt>Volume 24h</dt><dd>${t.volume24h ? fmtUsd(t.volume24h) : '—'}</dd>
            </dl></div>
            <div class="box reveal"><div class="box-head">Actions</div><div class="box-body grid" style="gap:8px">
              <a class="btn btn-primary" href="#/ai" id="tkAi">Ask the AI about ${esc(t.symbol || 'this token')}</a>
              <button class="btn" id="tkAdd">Add to wallet</button>
              <button class="btn" id="tkCopy">Copy contract address</button>
              <button class="btn" id="tkShare">Share profile</button>
              <a class="btn" href="${esc(verifyUrl('token', t.address))}" target="_blank" rel="noopener noreferrer">Verify on Blockscout ↗</a>
            </div></div>
          </div>
        </section>
        <section class="grid g-2 mt">
          <div class="box reveal"><div class="box-head">Top holders<span class="right dim">${t.top10Pct ? `top 10 = ${fmtNum(t.top10Pct, 1)}% of supply` : ''}</span></div><div class="table-wrap">${holdersTable(t)}</div></div>
          <div class="box reveal"><div class="box-head">Contract</div><dl class="kv">
            <dt>Name</dt><dd>${esc(t.contract?.name || '—')}</dd>
            <dt>Verified</dt><dd>${t.contract ? (t.contract.verified ? '✓ Source code verified' : 'Not verified') : '—'}</dd>
            <dt>Proxy</dt><dd>${t.contract?.proxy ? esc(t.contract.proxy) : 'No'}</dd>
            ${t.contract?.implementation ? `<dt>Implementation</dt><dd>${esc(t.contract.implementation.name || '')} ${addrLink(t.contract.implementation.address, 8)}</dd>` : ''}
            <dt>Creator</dt><dd>${t.contract?.creator ? addrLink(t.contract.creator, 10) : '—'}</dd>
            <dt>Created in</dt><dd>${t.contract?.creationTx ? txLink(t.contract.creationTx, 12) : '—'}</dd>
          </dl>
          <div id="tkCopycats"></div></div>
        </section>
        <div class="box reveal mt"><div class="box-head">Recent transfers<span class="right dim">live from Blockscout</span></div><div class="table-wrap">${transfersTable(t)}</div></div>`;
      reveal(body);

      // ---------- price chart ----------
      let chart = null;
      const loadPrice = (days) =>
        netApi(`/token/${addr}/price?days=${days}`)
          .then((p) => {
            if (!p.points.length) {
              $('#tkChart', body).innerHTML = '<div class="empty">CoinGecko doesn\'t track a price for this token.</div>';
              $('#tkChartSrc', body).textContent = 'Source: CoinGecko · not listed';
              $(`#tPrice .metric-sub`, body).textContent = t.price != null ? 'Blockscout reference price' : 'No price available';
              return;
            }
            chart?.destroy();
            chart = timeChart($('#tkChart', body), p.points, { format: (v) => usd(v), label: `${t.symbol} price, last ${days} days` });
            charts.push(chart);
            const first = p.points[0].v, last = p.points.at(-1).v;
            const ch = ((last - first) / first) * 100;
            $('#tPrice .metric-val', body).textContent = usd(last);
            $('#tPrice .metric-sub', body).textContent = `${fmtPct(ch)} over ${days === 365 ? '1 year' : days + ' days'}`;
            $('#tkChartSrc', body).innerHTML = `Source: CoinGecko · <a class="link" href="https://www.coingecko.com/en/coins/${esc(p.id)}" target="_blank" rel="noopener noreferrer">${esc(p.id)} ↗</a>`;
          })
          .catch((err) => ($('#tkChart', body).innerHTML = `<div class="empty">${esc(err.message)}</div>`));
      loadPrice(30);
      $('#tkRanges', body).addEventListener('click', (e) => {
        const b = e.target.closest('[data-days]');
        if (!b) return;
        $$('#tkRanges .chip', body).forEach((c) => c.classList.toggle('active', c === b));
        loadPrice(Number(b.dataset.days));
      });

      // ---------- copycats sharing this ticker (mainnet) ----------
      if (state.network === 'mainnet' && t.symbol) {
        netApi(`/verify?q=${encodeURIComponent(t.symbol)}`)
          .then((v) => {
            const others = [...v.official, ...v.lookalikes].filter((x) => x.address.toLowerCase() !== t.address.toLowerCase() && (x.symbol || '').toUpperCase() === t.symbol.toUpperCase());
            const official = v.official.find((x) => x.address.toLowerCase() !== t.address.toLowerCase());
            $('#tkCopycats', body).innerHTML = others.length
              ? `<div class="box-foot" style="font-size:12.5px;color:var(--ink-2)">${others.length} other token${others.length > 1 ? 's use' : ' uses'} the ticker <b>${esc(t.symbol)}</b>.${official ? ` The official one is <a class="link" href="${link.token(official.address)}">${esc(short(official.address, 8))}</a>.` : t.official ? ' This is the official one; the others are look-alikes.' : ''}</div>`
              : '';
          })
          .catch(() => {});
      }

      // ---------- actions ----------
      $('#tkAi', body).addEventListener('click', () => (state.aiPrompt = `Give me a profile of the ${t.symbol} token (${t.address}) on Robinhood Chain ${state.network}: is it official, who holds it, how active it is, and any risks.`));
      $('#tkAdd', body).addEventListener('click', () => watchTokenInWallet({ address: t.address, symbol: t.symbol, decimals: t.decimals }));
      $('#tkCopy', body).addEventListener('click', () => navigator.clipboard.writeText(t.address).then(() => toast('Contract address copied')));
      $('#tkShare', body).addEventListener('click', () => share('token', t.address, `${t.symbol} · Aeon Network`));
    })
    .catch((err) => {
      $('#tkHead', main).innerHTML = `<div><div class="kicker">${esc(net().name)} · Token</div><h1>Token not found</h1></div>`;
      $('#tkBody', main).innerHTML = `<div class="box"><div class="empty">${esc(err.message)}<br><a class="link" href="${link.address(addr)}">Open this address in the explorer</a></div></div>`;
    });
  return () => charts.forEach((c) => c.destroy());
}

function holdersTable(t) {
  if (!t.topHolders.length) return '<div class="empty">No holder data.</div>';
  const max = Math.max(...t.topHolders.map((h) => h.sharePct || 0), 0.0001);
  return `<table class="tbl"><thead><tr><th>#</th><th>Holder</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${t.topHolders
    .map(
      (h, i) => `<tr><td class="dim mono">${i + 1}</td><td>${h.name ? `<b style="font-weight:500">${esc(h.name)}</b> ` : ''}${addrLink(h.address, 6)}${h.isContract ? ' <span class="tag">CONTRACT</span>' : ''}</td>
      <td class="num">${fromWei(h.value || '0', t.decimals, 2)}</td><td class="num bar-cell"><i style="width:${((h.sharePct || 0) / max) * 100}%"></i>${h.sharePct != null ? fmtNum(h.sharePct, 2) + '%' : '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function transfersTable(t) {
  if (!t.recentTransfers.length) return '<div class="empty">No recent transfers.</div>';
  const who = (a, name) => (name ? `<b style="font-weight:500">${esc(name)}</b> ` : '') + addrLink(a, 6);
  return `<table class="tbl"><thead><tr><th>Age</th><th>From</th><th>To</th><th class="num">Amount</th><th>Transaction</th></tr></thead><tbody>${t.recentTransfers
    .map((x) => `<tr><td class="dim">${x.time ? ago(x.time) : '—'}</td><td>${x.from && /^0x0{40}$/i.test(x.from) ? '<span class="tag">MINT</span>' : who(x.from, x.fromName)}</td><td>${x.to && /^0x0{40}$/i.test(x.to) ? '<span class="tag">BURN</span>' : who(x.to, x.toName)}</td><td class="num">${x.amount != null ? fromWei(x.amount, x.decimals, 4) : '—'}</td><td>${txLink(x.tx, 8)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function metric(id, title, value, sub) {
  return `<div class="box metric reveal" id="${id}"><div class="box-head">${title}</div><div class="box-body"><div class="metric-val">${value}</div><div class="metric-sub">${sub}</div></div></div>`;
}
