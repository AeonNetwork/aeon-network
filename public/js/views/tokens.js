import { netApi, net, on, esc, icon, fmtInt, fmtUsd, fromWei, addrLink, link, $ } from '../core.js';
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

// Spam tokens often mint absurd supplies; keep the column readable.
function supply(raw, decimals) {
  if (raw == null) return '—';
  const v = Number(BigInt(raw) / 10n ** BigInt(Math.max(0, (decimals ?? 18) - 2))) / 100;
  return v >= 1e15 ? v.toExponential(2) : fromWei(raw, decimals ?? 18, 0);
}

function mount(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Tokens</div><h1>Tokens</h1></div>
      <input class="input" id="tq" placeholder="Filter by name, symbol or address" style="max-width:300px" aria-label="Filter tokens">
    </div>
    <div class="box reveal">
      <div class="box-head">Top ERC-20 tokens<span class="right dim" id="topInfo">Blockscout</span></div>
      <div class="table-wrap" id="top"><div class="empty">Loading…</div></div>
    </div>
    <div class="box reveal mt">
      <div class="box-head">Moving right now<span class="right dim">Aeon indexer</span></div>
      <div class="table-wrap" id="active"><div class="empty">Loading…</div></div>
      <div class="box-foot">Discovered automatically from ERC-20 <span class="mono">Transfer</span> events in the blocks Aeon reads (full indexer mode).</div>
    </div>`;

  let top = [];
  let active = [];
  let q = '';
  const match = (name, symbol, address) => !q || (address || '').toLowerCase().includes(q) || (symbol || '').toLowerCase().includes(q) || (name || '').toLowerCase().includes(q);

  const paintTop = () => {
    const list = top.filter((t) => match(t.name, t.symbol, t.address));
    $('#top', main).innerHTML = list.length
      ? `<table class="tbl"><thead><tr><th>#</th><th>Token</th><th>Contract</th><th class="num">Price</th><th class="num">Market cap</th><th class="num">Volume 24h</th><th class="num">Holders</th><th class="num">Supply</th></tr></thead><tbody>${list
          .map(
            (t, i) => `<tr><td class="dim mono">${i + 1}</td>
              <td><a class="row" style="gap:10px" href="${link.token(t.address)}">${t.icon ? `<img class="logo" src="${esc(icon(t.icon))}" data-sym="${esc(t.symbol || '?')}" alt="" loading="lazy">` : `<span class="logo ph">${esc((t.symbol || '?').slice(0, 2))}</span>`}<span><b style="font-weight:500">${esc(t.symbol || '?')}</b> <span class="dim">${esc(t.name || '')}</span></span></a></td>
              <td>${addrLink(t.address, 8)}</td>
              <td class="num">${t.price != null ? fmtUsd(t.price, t.price < 1 ? 6 : 2) : '—'}</td>
              <td class="num">${t.marketCap ? fmtUsd(t.marketCap) : '—'}</td>
              <td class="num">${t.volume24h ? fmtUsd(t.volume24h) : '—'}</td>
              <td class="num">${t.holders != null ? fmtInt(t.holders) : '—'}</td>
              <td class="num">${supply(t.totalSupply, t.decimals)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<div class="empty">${top.length ? 'No tokens match.' : 'No token data.'}</div>`;
  };

  const paintActive = () => {
    const list = active.filter((r) => match(r.meta.name, r.meta.symbol, r.address));
    const max = Math.max(1, ...list.map((r) => r.count));
    $('#active', main).innerHTML = list.length
      ? `<table class="tbl"><thead><tr><th>#</th><th>Token</th><th>Contract</th><th class="num">Transfers seen</th><th class="num">Total supply</th></tr></thead><tbody>${list
          .slice(0, 30)
          .map(
            (r, i) => `<tr><td class="dim mono">${i + 1}</td>
              <td><a href="${link.token(r.address)}"><b style="font-weight:500">${esc(r.meta.symbol || '?')}</b> <span class="dim">${esc(r.meta.name)}</span></a></td>
              <td>${addrLink(r.address, 10)}</td>
              <td class="num bar-cell"><i style="width:${(r.count / max) * 100}%"></i>${fmtInt(r.count)}</td>
              <td class="num">${supply(r.meta.totalSupply, r.meta.decimals)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<div class="empty">${active.length ? 'No tokens match.' : 'Nothing yet: this list fills when the indexer runs in full mode with RPC access.'}</div>`;
  };

  netApi('/top-tokens')
    .then((r) => {
      top = r;
      $('#topInfo', main).textContent = `${r.length} tokens · ranked by Blockscout`;
      paintTop();
    })
    .catch((err) => ($('#top', main).innerHTML = `<div class="empty">${esc(err.message)}</div>`));

  const loadActive = () =>
    netApi('/tokens')
      .then((r) => {
        active = r;
        paintActive();
      })
      .catch(() => paintActive());
  loadActive();
  const t = setInterval(loadActive, 60_000);
  $('#tq', main).addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    paintTop();
    paintActive();
  });
  return () => clearInterval(t);
}
