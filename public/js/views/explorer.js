import { state, netApi, net, on, esc, fmtInt, fmtNum, fmtUsd, fmtCompact, gwei, ago, fromWei, weiToEth, addrLink, txLink, link, short, toast, verifyUrl, share, $ } from '../core.js';
import { reveal } from '../fx.js';

export function render(main, params) {
  let dispose = mount(main, params);
  const off = on('network', () => {
    dispose();
    location.hash = '#/explorer';
  });
  return () => {
    off();
    dispose();
  };
}

function mount(main, [kind, id]) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Explorer</div><h1>${kind === 'block' ? 'Block' : kind === 'tx' ? 'Transaction' : kind === 'address' ? 'Address' : 'Explore the chain'}</h1></div>
    </div>
    <form class="search-xl reveal" id="search" role="search">
      <input id="q" placeholder="Search by block number, transaction hash, or address" autocomplete="off" spellcheck="false" aria-label="Search the chain" value="${esc(id || '')}">
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <div id="body" class="mt"></div>`;

  $('#search', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#q', main).value.trim();
    if (!q) return;
    try {
      const r = await netApi('/lookup?q=' + encodeURIComponent(q));
      location.hash = r.type === 'block' ? link.block(r.id) : r.type === 'tx' ? link.tx(r.id) : link.address(r.id);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  const body = $('#body', main);
  if (kind === 'block') return blockView(body, id);
  if (kind === 'tx') return txView(body, id);
  if (kind === 'address') return addressView(body, id);
  return homeView(body);
}

const box = (title, inner, right = '') => `<div class="box reveal"><div class="box-head">${title}${right ? `<span class="right">${right}</span>` : ''}</div>${inner}</div>`;
const loading = '<div class="empty">Loading…</div>';
const failed = (err) => `<div class="box"><div class="empty">${esc(err.message)}</div></div>`;

// ---------------- verification helpers ----------------
// Cross-check: the same object read from RPC and from Blockscout, compared field by field.
const crossBox = () => box('Cross-check · RPC vs Blockscout', '<div id="xcheck"><div class="empty">Comparing both sources…</div></div>', '<span class="dim">independent sources</span>');
function loadCross(body, kind, id) {
  netApi(`/crosscheck/${kind}/${id}`)
    .then((c) => {
      const el = $('#xcheck', body);
      if (!el) return;
      const val = (v) => (v == null ? '<span class="dim">—</span>' : esc(v.length > 26 ? short(v, 12) : v));
      el.innerHTML = `<div class="box-body" style="padding-bottom:6px"><div class="metric-val" style="font-size:18px">${c.compared ? (c.matched === c.compared ? `✓ ${c.matched}/${c.compared} fields match` : `${c.matched}/${c.compared} fields match`) : 'Could not compare'}</div>
        <div class="metric-sub">RPC: ${esc(c.rpc)} · Blockscout: ${esc(c.blockscout)}${c.note ? ' · ' + esc(c.note) : ''}</div></div>
        <table class="tbl"><thead><tr><th>Field</th><th>RPC</th><th>Blockscout</th><th></th></tr></thead><tbody>${c.rows
          .map((r) => `<tr><td>${esc(r.field)}</td><td class="mono" title="${esc(r.rpc ?? '')}">${val(r.rpc)}</td><td class="mono" title="${esc(r.blockscout ?? '')}">${val(r.blockscout)}</td><td>${r.match === true ? '✓' : r.match === false ? '<b>✕</b>' : '<span class="dim">n/a</span>'}</td></tr>`)
          .join('')}</tbody></table>`;
    })
    .catch((err) => {
      const el = $('#xcheck', body);
      if (el) el.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    });
}
const verifyBox = (kind, id, extra = '') => box('Verify & share', `<div class="box-body grid" style="gap:8px">${extra}<a class="btn" href="${esc(verifyUrl(kind, id))}" target="_blank" rel="noopener noreferrer">Open the same record on Blockscout ↗</a><button class="btn" id="shareBtn">Share link with preview</button></div>`);

// One sentence a newcomer can read.
function summarizeTx(t) {
  if (t.status === 'failed') return `This transaction <b>failed</b>${t.revertReason ? ` (${esc(t.revertReason)})` : ''}. Nothing moved, but the sender still paid the fee.`;
  const who = esc(short(t.from, 6));
  const target = t.to ? (t.toName ? `<b>${esc(t.toName)}</b>` : esc(short(t.to, 6))) : 'a new contract';
  const parts = [];
  if (!t.to) parts.push(`${who} deployed a new contract`);
  else if (t.method === 'ETH transfer') parts.push(`${who} sent <b>${fromWei(t.valueWei, 18, 6)} ETH</b> to ${target}`);
  else parts.push(`${who} called <b>${esc(t.method)}</b> on ${target}${t.valueWei && t.valueWei !== '0' ? ` with <b>${fromWei(t.valueWei, 18, 6)} ETH</b>` : ''}`);
  if (t.transfers?.length) {
    const moved = t.transfers.slice(0, 3).map((x) => `<b>${fromWei(x.amount, x.decimals, 4)} ${esc(x.symbol || 'tokens')}</b>`);
    parts.push(`moving ${moved.join(', ')}${t.transfers.length > 3 ? ` and ${t.transfers.length - 3} more transfer(s)` : ''}`);
  }
  const fee = t.feeWei ? weiToEth(t.feeWei) : null;
  return parts.join(', ') + '.' + (fee != null ? ` The fee was ${fmtNum(fee, 8)} ETH${state.ethUsd ? ` (${fmtUsd(fee * state.ethUsd, 4)})` : ''}.` : '');
}

// ---------------- latest activity ----------------
function homeView(body) {
  body.innerHTML = `
    <div class="grid g-2">
      ${box('Latest blocks', `<div class="table-wrap" id="tBlocks">${loading}</div>`, '<span class="dim">live</span>')}
      ${box('Latest transactions', `<div class="table-wrap" id="tTxs">${loading}</div>`, '<span class="dim">live</span>')}
    </div>
    <div class="mt">${box('Recent contract deployments', `<div class="table-wrap" id="tDeploys">${loading}</div>`, '<span class="dim">indexed</span>')}</div>`;
  reveal(body);
  let blocks = [], txs = [], deploys = [];
  const paint = () => {
    $('#tBlocks', body).innerHTML = blocks.length
      ? `<table class="tbl"><thead><tr><th>Block</th><th>Age</th><th class="num">Txs</th><th class="num">Gas used</th><th class="num">Base fee</th></tr></thead><tbody>${blocks
          .slice(0, 12)
          .map((b) => `<tr><td><a class="mono link" href="${link.block(b.number)}">${b.number.toLocaleString('en-US')}</a></td><td class="dim" data-time="${b.time}">${ago(b.time)}</td><td class="num">${b.txs}</td><td class="num">${fmtCompact(b.gasUsed)}</td><td class="num">${gwei(b.baseFee)}</td></tr>`)
          .join('')}</tbody></table>`
      : '<div class="empty">No blocks indexed yet. Is the RPC reachable?</div>';
    $('#tTxs', body).innerHTML = txs.length
      ? `<table class="tbl"><thead><tr><th>Hash</th><th>Method</th><th>From → To</th><th class="num">Value</th></tr></thead><tbody>${txs
          .slice(0, 12)
          .map((t) => `<tr><td>${txLink(t.hash, 10)}</td><td><span class="tag">${esc(t.method)}</span></td><td>${addrLink(t.from, 5)} → ${t.to ? addrLink(t.to, 5) : '<span class="dim">create</span>'}</td><td class="num">${fromWei(t.valueWei, 18, 4)}</td></tr>`)
          .join('')}</tbody></table>`
      : '<div class="empty">No transactions seen yet.</div>';
    $('#tDeploys', body).innerHTML = deploys.length
      ? `<table class="tbl"><thead><tr><th>Deploy tx</th><th>Deployer</th><th>Block</th><th>Age</th></tr></thead><tbody>${deploys
          .slice(0, 10)
          .map((d) => `<tr><td>${txLink(d.hash, 12)}</td><td>${addrLink(d.deployer, 8)}</td><td><a class="mono link" href="${link.block(d.block)}">${d.block.toLocaleString('en-US')}</a></td><td class="dim" data-time="${d.time}">${ago(d.time)}</td></tr>`)
          .join('')}</tbody></table>`
      : '<div class="empty">No contract deployments in the indexed window yet.</div>';
  };
  netApi('/recent')
    .then((r) => {
      ({ blocks, txs, deploys } = r);
      paint();
    })
    .catch((err) => ($('#tBlocks', body).innerHTML = `<div class="empty">${esc(err.message)}</div>`));
  const offs = [
    on('block', ({ network, block }) => {
      if (network !== state.network || blocks.some((b) => b.number === block.number)) return;
      blocks = [block, ...blocks].slice(0, 40);
      paint();
    }),
    on('txs', ({ network, txs: fresh }) => {
      if (network !== state.network) return;
      txs = [...fresh.slice().reverse(), ...txs].slice(0, 40);
      paint();
    }),
  ];
  const t = setInterval(() => body.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000);
  return () => {
    offs.forEach((o) => o());
    clearInterval(t);
  };
}

// ---------------- block ----------------
function blockView(body, id) {
  body.innerHTML = loading;
  netApi(`/block/${encodeURIComponent(id)}`)
    .then((b) => {
      body.innerHTML = `
        <div class="grid g-main">
          ${box(`Block #${b.number.toLocaleString('en-US')}`, `<dl class="kv">
            <dt>Time</dt><dd>${new Date(b.time).toLocaleString('en-US')} · ${ago(b.time)}</dd>
            <dt>Transactions</dt><dd>${b.txs}</dd>
            <dt>Gas used</dt><dd>${fmtInt(b.gasUsed)}</dd>
            <dt>Base fee</dt><dd>${gwei(b.baseFee)} gwei</dd>
            <dt>Size</dt><dd>${b.size ? fmtInt(b.size) + ' bytes' : '—'}</dd>
            <dt>Hash</dt><dd>${esc(b.hash)}</dd>
            <dt>Parent</dt><dd><a class="link" href="${link.block(b.number - 1)}">${esc(b.parentHash)}</a></dd>
          </dl>`)}
          ${box('Navigate', `<div class="box-body grid">
            <a class="btn" href="${link.block(b.number - 1)}">← Block ${(b.number - 1).toLocaleString('en-US')}</a>
            <a class="btn" href="${link.block(b.number + 1)}">Block ${(b.number + 1).toLocaleString('en-US')} →</a>
          </div>`)}
        </div>
        <section class="grid g-main mt">${crossBox()}${verifyBox('block', b.number)}</section>
        <div class="mt">${box(`Transactions (${b.transactions.length})`, b.transactions.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Hash</th><th>Method</th><th>From</th><th>To</th><th class="num">Value (ETH)</th></tr></thead><tbody>${b.transactions
          .map((t) => `<tr><td>${txLink(t.hash, 12)}</td><td><span class="tag">${esc(t.method)}</span></td><td>${addrLink(t.from, 8)}</td><td>${t.to ? addrLink(t.to, 8) : '<span class="dim">contract creation</span>'}</td><td class="num">${fromWei(t.valueWei, 18, 6)}</td></tr>`)
          .join('')}</tbody></table></div>` : '<div class="empty">No user transactions in this block.</div>')}</div>`;
      reveal(body);
      loadCross(body, 'block', b.number);
      $('#shareBtn', body).addEventListener('click', () => share('block', b.number, `Block #${b.number}`));
    })
    .catch((err) => (body.innerHTML = failed(err)));
  return () => {};
}

// ---------------- transaction ----------------
function txView(body, hash) {
  body.innerHTML = loading;
  netApi(`/tx/${encodeURIComponent(hash)}`)
    .then((t) => {
      const fee = t.feeWei ? weiToEth(t.feeWei) : null;
      const usd = (eth) => (state.ethUsd && eth != null ? ` · ${fmtUsd(eth * state.ethUsd, 4)}` : '');
      const status = t.status === 'success' ? '<span class="tag solid">✓ SUCCESS</span>' : t.status === 'failed' ? '<span class="tag">✕ FAILED</span>' : '<span class="tag">PENDING</span>';
      body.innerHTML = `
        <div class="notice" style="margin-bottom:12px;border-style:solid"><span class="kicker">In plain words</span><div style="margin-top:4px;color:var(--ink)">${summarizeTx(t)}</div></div>
        <div class="grid g-main">
          ${box('Overview', `<dl class="kv">
            <dt>Status</dt><dd>${status}</dd>
            <dt>Hash</dt><dd>${esc(t.hash)}</dd>
            <dt>Block</dt><dd>${t.block != null ? `<a class="link" href="${link.block(t.block)}">${t.block.toLocaleString('en-US')}</a>` : 'pending'}${t.time ? ` · ${new Date(t.time).toLocaleString('en-US')}` : ''}</dd>
            <dt>From</dt><dd>${addrLink(t.from, 42)}</dd>
            <dt>To</dt><dd>${t.toName ? `<b style="font-family:var(--font)">${esc(t.toName)}</b> · ` : ''}${t.to ? addrLink(t.to, 42) : t.contractCreated ? `Created ${addrLink(t.contractCreated, 42)}` : 'Contract creation'}</dd>
            <dt>Action</dt><dd><span class="tag">${esc(t.method)}</span></dd>
            <dt>Value</dt><dd>${fromWei(t.valueWei, 18, 8)} ETH${usd(weiToEth(t.valueWei))}</dd>
            <dt>Fee</dt><dd>${fee != null ? `${fmtNum(fee, 10)} ETH${usd(fee)}` : '—'}</dd>
            <dt>Gas</dt><dd>${t.gasUsed != null ? `${fmtInt(t.gasUsed)} used @ ${gwei(t.gasPrice)} gwei` : '—'}</dd>
            <dt>Nonce · Input</dt><dd>${t.nonce ?? '—'}${t.logs != null ? ` · ${t.logs} events` : ''} · ${fmtInt(t.inputSize)} bytes</dd>
            ${t.revertReason ? `<dt>Revert reason</dt><dd>${esc(t.revertReason)}</dd>` : ''}
          </dl>`)}
          <div class="grid" style="align-content:start">
            ${box('Ask the network AI', `<div class="box-body"><p class="muted" style="margin:0 0 12px">Get a plain-language explanation of what this transaction did.</p><a class="btn btn-primary" href="#/ai" id="explain">Explain this transaction</a></div>`)}
            ${verifyBox('tx', t.hash)}
          </div>
        </div>
        ${t.decoded ? `<div class="mt">${box('Decoded input', `<div class="box-body" style="padding-bottom:6px"><div class="mono" style="font-size:12.5px;overflow-wrap:anywhere">${esc(t.decoded.signature || t.decoded.method || '')}</div></div>${t.decoded.params.length ? `<table class="tbl"><thead><tr><th>Parameter</th><th>Type</th><th>Value</th></tr></thead><tbody>${t.decoded.params.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono dim">${esc(p.type)}</td><td class="mono" style="white-space:normal;overflow-wrap:anywhere">${/^0x[0-9a-fA-F]{40}$/.test(p.value) ? addrLink(p.value, 42) : esc(p.value)}</td></tr>`).join('')}</tbody></table>` : ''}`, '<span class="dim">verified ABI · Blockscout</span>')}</div>` : ''}
        <div class="mt">${crossBox()}</div>
        <div class="mt">${box(`Token transfers (${t.transfers.length})`, t.transfers.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Token</th><th>From</th><th>To</th><th class="num">Amount</th></tr></thead><tbody>${t.transfers
          .map((x) => `<tr><td><a class="link" href="${link.token(x.token)}">${esc(x.symbol || short(x.token))}</a></td><td>${addrLink(x.from, 8)}</td><td>${addrLink(x.to, 8)}</td><td class="num">${fromWei(x.amount, x.decimals, 6)}</td></tr>`)
          .join('')}</tbody></table></div>` : '<div class="empty">No ERC-20 transfers in this transaction.</div>')}</div>`;
      reveal(body);
      $('#explain', body).addEventListener('click', () => (state.aiPrompt = `Explain transaction ${t.hash} on ${state.network}.`));
      $('#shareBtn', body).addEventListener('click', () => share('tx', t.hash, `Transaction ${short(t.hash, 10)}`));
      loadCross(body, 'tx', t.hash);
    })
    .catch((err) => (body.innerHTML = failed(err)));
  return () => {};
}

// ---------------- address ----------------
function addressView(body, addr) {
  body.innerHTML = loading;
  netApi(`/address/${encodeURIComponent(addr)}`)
    .then((a) => {
      const eth = weiToEth(a.balanceWei);
      body.innerHTML = `
        ${a.stock || a.token?.official ? `<div class="notice" style="margin-bottom:12px;border-style:solid;border-color:var(--ink)"><b>✓ Official Robinhood stock token.</b> ${esc((a.stock?.name) || a.token.name)} (ERC-8056). <a class="link" href="#/stocks">See all stock tokens</a></div>` : a.token && /robinhood|•/i.test(a.token.name || '') ? `<div class="notice" style="margin-bottom:12px;border-style:solid"><b>⚠ Not an official Robinhood stock token.</b> This token uses a Robinhood-like name but is not the official ERC-8056 contract. <a class="link" href="#/stocks">Check the official one</a></div>` : ''}
        <div class="grid g-main">
          ${box(a.token ? `Token contract · ${esc(a.token.symbol)}` : a.isContract ? 'Contract' : 'Wallet', `<dl class="kv">
            <dt>Address</dt><dd>${esc(a.address)}</dd>
            ${a.name || a.verified || a.scam ? `<dt>Label</dt><dd>${a.name ? esc(a.name) + ' ' : ''}${a.verified ? '<span class="tag solid">VERIFIED</span> ' : ''}${a.scam ? '<span class="tag">⚠ FLAGGED AS SCAM</span>' : ''}</dd>` : ''}
            <dt>Type</dt><dd>${a.token ? 'ERC-20 token contract' : a.isContract ? `Contract${a.codeSize ? ` · ${fmtInt(a.codeSize)} bytes of code` : ''}` : 'Externally owned account (wallet)'}</dd>
            <dt>ETH balance</dt><dd>${a.balanceWei == null ? '—' : `${fromWei(a.balanceWei, 18, 8)} ETH${state.ethUsd ? ` · ${fmtUsd(eth * state.ethUsd)}` : ''}`}</dd>
            <dt>${a.source === 'blockscout' ? 'Transactions' : 'Nonce'}</dt><dd>${a.nonce != null ? fmtInt(a.nonce) : '—'}${a.source === 'blockscout' ? ' total' : a.isContract ? '' : ' transactions sent'}</dd>
            ${a.token ? `<dt>Token</dt><dd>${esc(a.token.name)} (${esc(a.token.symbol)}) · ${a.token.decimals} decimals</dd><dt>Total supply</dt><dd>${a.token.totalSupply ? fromWei(a.token.totalSupply, a.token.decimals, 2) : '—'}</dd>` : ''}
          </dl>`)}
          <div class="grid" style="align-content:start">
            ${box('Ask the network AI', `<div class="box-body"><p class="muted" style="margin:0 0 12px">Summarize what this address holds and does.</p><a class="btn btn-primary" href="#/ai" id="explain">Analyze this address</a></div>`)}
            ${verifyBox('address', a.address, a.token ? `<a class="btn btn-primary" href="${link.token(a.address)}">Open token profile</a>` : a.isContract ? '' : `<a class="btn btn-primary" href="#/check/${esc(a.address)}">Run wallet check</a>`)}
          </div>
        </div>
        <div class="grid g-2 mt">
          ${box(`Token balances (${a.tokenBalances.length})`, a.tokenBalances.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Token</th><th class="num">Balance</th></tr></thead><tbody>${a.tokenBalances
            .map((t) => `<tr><td><a class="link" href="${link.token(t.address)}">${esc(t.symbol || t.name)}</a> <span class="dim">${esc(t.name)}</span></td><td class="num">${fromWei(t.balance, t.decimals, 4)}</td></tr>`)
            .join('')}</tbody></table></div>` : '<div class="empty">No balances in the tokens Aeon has seen moving on this network.</div>', '<span class="dim">active tokens</span>')}
          ${box('Recent transactions', a.history ? (a.history.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Hash</th><th>Method</th><th>Age</th><th class="num">Value</th></tr></thead><tbody>${a.history
            .map((t) => `<tr><td>${txLink(t.hash, 10)}</td><td><span class="tag">${esc(t.method)}</span></td><td class="dim">${ago(t.time)}</td><td class="num">${fromWei(t.valueWei || '0', 18, 4)}</td></tr>`)
            .join('')}</tbody></table></div>` : '<div class="empty">No transactions.</div>') : `<div class="empty">History needs the Blockscout API, which is not reachable from this server right now.<br><a class="link" href="${esc(net().explorer)}/address/${esc(a.address)}" target="_blank" rel="noopener noreferrer">View on Blockscout ↗</a></div>`, '<span class="dim">Blockscout</span>')}
        </div>
        <div class="mt">${crossBox()}</div>`;
      reveal(body);
      loadCross(body, 'address', a.address);
      $('#shareBtn', body).addEventListener('click', () => share('address', a.address, `Address ${short(a.address, 8)}`));
      $('#explain', body).addEventListener('click', () => (state.aiPrompt = `Analyze address ${a.address} on ${state.network}: what is it, what does it hold, and what has it been doing?`));
    })
    .catch((err) => (body.innerHTML = failed(err)));
  return () => {};
}
