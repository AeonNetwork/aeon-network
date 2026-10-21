// Token Safety Scanner: paste any token on Robinhood Chain, get plain checks with evidence.
import { state, netApi, net, on, prefs, esc, fmtUsd, fmtNum, ago, short, addrLink, link, toast, $ } from '../core.js';
import { reveal } from '../fx.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AE = '0xb4fc414ac279bb3136e3cf7ec5084846af3bb459';
const recent = () => prefs.get('scan-recent', []);
const remember = (t) => prefs.set('scan-recent', [t, ...recent().filter((x) => x.address !== t.address)].slice(0, 6));
const MARK = { pass: '✓', info: 'i', warn: '!', fail: '✕' };

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

function mount(main, addrParam) {
  const addr = addrParam && ADDR.test(addrParam) ? addrParam : null;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Token Safety Scanner</div><h1>Is this token safe?</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Reads the contract and its whole history from the chain: admin powers, owner, a live transfer test, holder spread and liquidity. Every flag shows its evidence.</span>
    </div>
    <form class="search-xl reveal" id="scForm">
      <input id="scAddr" placeholder="Token address (0x…)" value="${esc(addr || '')}" spellcheck="false" aria-label="Token address">
      <button class="btn btn-primary" type="submit">Scan token</button>
    </form>
    <div id="scBody" class="mt"></div>`;

  $('#scForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#scAddr', main).value.trim();
    if (!ADDR.test(v)) return toast('Paste a token contract address (42 characters, starts with 0x).', 'err');
    location.hash = `#/scan/${v}`;
  });

  const body = $('#scBody', main);
  if (!addr) {
    const r = recent();
    body.innerHTML = `
      <div class="grid g-2 reveal">
        <div class="box"><div class="box-head">What it checks</div><div class="box-body sc-list">
          <div><b>Admin powers</b><span>Mint, pause, blacklist, tax and limit switches found in the bytecode, including behind a proxy.</span></div>
          <div><b>Owner</b><span>Who controls the contract, or whether ownership is renounced.</span></div>
          <div><b>Honeypot test</b><span>Simulates a real holder sending the token. If it reverts, you'd be stuck too.</span></div>
          <div><b>Holder spread</b><span>Rebuilt from every transfer the token ever made. Pools and curves are separated from wallets.</span></div>
          <div><b>Liquidity &amp; age</b><span>DEX pools from DEX Screener and the token's first transfer.</span></div>
          <div><b>Copycats</b><span>Flags tokens that borrow an official Robinhood stock ticker or name.</span></div>
        </div></div>
        <div class="box"><div class="box-head">Try one</div><div class="box-body sc-try">
          <button class="chip" data-a="${AE}">AE · Aeon</button>
          ${r.map((t) => `<button class="chip" data-a="${esc(t.address)}">${esc(t.symbol || short(t.address))} · ${esc(t.grade)}</button>`).join('')}
          <p class="dim">Works for any ERC-20 on ${esc(net().name)}. Results are cached for 10 minutes.</p>
        </div></div>
      </div>`;
    body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/scan/${b.dataset.a}`)));
    return () => {};
  }

  body.innerHTML = `<div class="box"><div class="empty">Reading the contract and its history…</div></div>`;
  let alive = true;
  netApi(`/scan/${addr}`)
    .then((s) => {
      if (!alive) return;
      remember({ address: s.token.address, symbol: s.token.symbol, grade: s.grade });
      const counts = ['fail', 'warn', 'pass'].map((l) => s.checks.filter((c) => c.level === l).length);
      const h = s.holders;
      const shareText = `${s.token.symbol} scored ${s.score}/100 (${s.grade}) on the Aeon Token Safety Scanner. ${s.verdict}`;
      body.innerHTML = `
        <section class="box sc-hero reveal">
          <div class="sc-grade sc-${s.grade}" aria-label="Grade ${s.grade}">${s.grade}</div>
          <div class="sc-main">
            <div class="kicker">${s.official ? '<span class="tag solid">OFFICIAL ROBINHOOD TOKEN</span> ' : ''}${esc(s.token.name)} · <a class="mono link" href="${link.token ? link.token(s.token.address) : '#/token/' + s.token.address}">${esc(short(s.token.address, 8))}</a></div>
            <h2 class="sc-title">${esc(s.token.symbol)} <span class="dim">${s.score}/100</span></h2>
            <p class="sc-verdict">${esc(s.verdict)}</p>
            <div class="row wrap" style="gap:8px">
              <span class="tag">${counts[0]} flags</span><span class="tag">${counts[1]} warnings</span><span class="tag">${counts[2]} passed</span>
              <span class="dim" style="font-size:11.5px">scanned <span data-time="${s.at}">${ago(s.at)}</span>${s.stale ? ' · refreshing' : ''}</span>
            </div>
            <div class="row wrap" style="gap:8px">
              <a class="btn btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(shareText + '\n\nvia @getaeon_network')}&url=${encodeURIComponent(location.origin + '/scan')}">Share on X</a>
              <button class="btn btn-sm" id="scCopy">Copy result</button>
              <a class="btn btn-sm" href="#/ai" id="scAsk">Ask the AI about it</a>
              ${s.dex?.url ? `<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(s.dex.url)}">Chart ↗</a>` : ''}
            </div>
          </div>
        </section>

        <section class="box reveal mt">
          <div class="box-head">Checks<span class="right dim">worst first</span></div>
          <div class="sc-checks">${s.checks.map((c) => `<div class="sc-check sc-${c.level}"><span class="sc-mark">${MARK[c.level]}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p></div>${c.penalty ? `<span class="mono dim">−${c.penalty}</span>` : ''}</div>`).join('')}</div>
        </section>

        <section class="grid g-4 reveal mt">
          ${metric('Holders', h?.count != null ? fmtNum(h.count, 0) : '—', h ? h.source : 'not measured')}
          ${metric('Top 10 wallets', h ? fmtNum(h.top10WalletsPct, 1) + '%' : '—', h ? `largest wallet ${fmtNum(h.largestWalletPct, 1)}%` : '—')}
          ${metric('DEX liquidity', s.dex ? fmtUsd(s.dex.liquidityUsd) : '—', s.dex ? `${s.dex.pairs} pool(s) · vol 24h ${fmtUsd(s.dex.volume24h)}` : 'DEX Screener')}
          ${metric('Transfers', s.activity?.transfers != null ? fmtNum(s.activity.transfers, 0) : '—', s.activity?.transfers24h != null ? `${fmtNum(s.activity.transfers24h, 0)} in the last 24h` : s.activity?.firstTransfer ? `since ${new Date(s.activity.firstTransfer).toISOString().slice(0, 10)}` : '—')}
        </section>

        ${
          h?.top?.length
            ? `<section class="box reveal mt"><div class="box-head">Largest holders<span class="right dim">${esc(h.source)}</span></div><div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Holder</th><th>Kind</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${h.top
                .map((r, i) => `<tr><td class="dim">${i + 1}</td><td>${addrLink(r.address, 8)}</td><td>${r.burn ? '<span class="tag">BURN</span>' : r.isContract ? '<span class="tag">CONTRACT</span>' : '<span class="dim">wallet</span>'}</td><td class="num mono">${fmtNum(r.amount, 0)}</td><td class="num mono">${r.pct != null ? fmtNum(r.pct, 2) + '%' : '—'}</td></tr>`)
                .join('')}</tbody></table></div></section>`
            : ''
        }

        <section class="box reveal mt">
          <div class="box-head">Contract</div>
          <div class="box-body"><dl class="kv">
            <dt>Owner</dt><dd>${s.contract.owner ? `${addrLink(s.contract.owner, 10)}${s.contract.renounced ? ' <span class="tag">RENOUNCED</span>' : ''}` : '<span class="dim">no owner()</span>'}</dd>
            <dt>Proxy</dt><dd>${s.contract.proxy ? `implementation ${addrLink(s.contract.proxy.implementation, 10)}` : 'No'}</dd>
            <dt>Paused</dt><dd>${s.contract.paused == null ? '<span class="dim">no paused()</span>' : s.contract.paused ? 'Yes' : 'No'}</dd>
            <dt>Admin functions</dt><dd>${Object.values(s.contract.powers).flat().map((f) => `<span class="tag">${esc(f)}</span>`).join(' ') || '<span class="dim">none found</span>'}</dd>
            <dt>Supply</dt><dd class="mono">${s.token.supply != null ? fmtNum(s.token.supply, 0) : '—'} ${esc(s.token.symbol)}</dd>
            <dt>Bytecode</dt><dd class="mono">${fmtNum(s.contract.codeBytes, 0)} bytes</dd>
          </dl></div>
        </section>
        <p class="dim mt" style="font-size:12px">${esc(s.note)} Contract reads via Robinhood Chain RPC, history via Alchemy, liquidity via DEX Screener.</p>`;
      $('#scCopy', body).addEventListener('click', () => navigator.clipboard.writeText(`${shareText}\n${location.origin}/#/scan/${s.token.address}`).then(() => toast('Copied')));
      $('#scAsk', body).addEventListener('click', () => (state.aiPrompt = `Scan the token ${s.token.address} and explain the risks in plain language.`));
      reveal(body);
    })
    .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  const t = setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000);
  return () => {
    alive = false;
    clearInterval(t);
  };
}

const metric = (k, v, sub) => `<div class="box metric"><div class="box-head">${k}</div><div class="box-body"><div class="metric-val">${v}</div><div class="metric-sub">${esc(sub)}</div></div></div>`;
