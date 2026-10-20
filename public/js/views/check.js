import { state, netApi, net, on, esc, icon, fmtUsd, fmtNum, fmtInt, fromWei, weiToEth, ago, addrLink, txLink, link, short, toast, verifyLink, share, $ } from '../core.js';
import { reveal } from '../fx.js';
import { sendCall } from '../wallet.js';

const pad = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export function render(main, [addrParam]) {
  let dispose = mount(main, addrParam);
  const offs = [
    on('network', () => {
      dispose();
      dispose = mount(main, addrParam);
      reveal(main);
    }),
    // Connecting or disconnecting only changes the optional buttons.
    on('wallet', () => {
      dispose();
      dispose = mount(main, addrParam);
      reveal(main);
    }),
  ];
  return () => {
    offs.forEach((o) => o());
    dispose();
  };
}

function mount(main, addrParam) {
  const addr = addrParam && /^0x[0-9a-fA-F]{40}$/.test(addrParam) ? addrParam : null;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">${esc(net().name)} · Wallet check</div><h1>Wallet check</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Stock holdings, copycat tokens and risky approvals for any address. No wallet connection needed: paste any address.</span>
    </div>
    <form class="search-xl reveal" id="ckForm">
      <input id="ckAddr" placeholder="0x address to check" value="${esc(addr || '')}" spellcheck="false" aria-label="Address to check">
      ${state.wallet ? '<button class="btn" type="button" id="ckMine">My wallet</button>' : ''}
      <button class="btn btn-primary" type="submit">Check</button>
    </form>
    <div id="ckBody" class="mt">${addr ? '' : '<div class="box"><div class="empty">Paste any Robinhood Chain address. No wallet connection needed.</div></div>'}</div>`;

  $('#ckForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#ckAddr', main).value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return toast('Enter a valid 0x address', 'err');
    location.hash = `#/check/${v}`;
  });
  $('#ckMine', main)?.addEventListener('click', () => (location.hash = `#/check/${state.wallet.address}`));
  if (!addr) return () => {};
  const own = Boolean(state.wallet) && state.wallet.address.toLowerCase() === addr.toLowerCase();

  const body = $('#ckBody', main);
  body.innerHTML = `
    <section class="grid g-4">
      ${metric('cEth', 'ETH balance')}
      ${metric('cStocks', 'Official stock tokens')}
      ${metric('cCopy', 'Copycat tokens')}
      ${metric('cAppr', 'Active approvals')}
    </section>
    <div class="row wrap mt" style="gap:8px"><a class="btn btn-sm" href="${link.address(addr)}">Open in explorer</a>${verifyLink('address', addr, '<span class="btn btn-sm">Verify on Blockscout ↗</span>')}<button class="btn btn-sm" id="ckShare">Share</button>${own ? '<span class="tag solid">YOUR CONNECTED WALLET</span>' : ''}</div>
    <section class="grid g-main mt">
      <div class="box reveal"><div class="box-head">Stock holdings<span class="right dim">official ERC-8056 tokens</span></div><div class="table-wrap" id="ckHold"><div class="empty">Loading…</div></div></div>
      <div class="box reveal"><div class="box-head">Copycat tokens</div><div id="ckFake"><div class="empty">Loading…</div></div></div>
    </section>
    <div class="box reveal mt"><div class="box-head">Token approvals<span class="right dim" id="ckApprInfo">scanning recent transactions…</span></div><div class="table-wrap" id="ckApprovals"><div class="empty">Scanning…</div></div>
      <div class="box-foot">An approval lets a contract move your tokens. Unlimited approvals to unverified contracts are the most common way wallets get drained. ${own ? 'Press Revoke to set an allowance back to zero; you confirm it in your wallet.' : 'The owner can revoke here after connecting their wallet (optional), or set the allowance to zero in their wallet app.'}</div></div>
    <div class="box reveal mt"><div class="box-head">Other tokens<span class="right dim" id="ckOtherInfo"></span></div><div class="table-wrap" id="ckOther"><div class="empty">Loading…</div></div></div>`;
  $('#ckShare', body).addEventListener('click', () => share('address', addr, 'Wallet check · Aeon Network'));
  const $m = (id) => $(`#${id} .metric-val`, body);
  const $s = (id) => $(`#${id} .metric-sub`, body);

  netApi(`/portfolio/${addr}`)
    .then((p) => {
      $m('cEth').textContent = p.ethWei != null ? `${fromWei(p.ethWei, 18, 5)} ETH` : '—';
      $s('cEth').textContent = p.ethWei != null && state.ethUsd ? `≈ ${fmtUsd(weiToEth(p.ethWei) * state.ethUsd)}` : 'RPC';
      $m('cStocks').textContent = fmtUsd(p.stocksValueUsd);
      $s('cStocks').textContent = `${p.holdings.length} token${p.holdings.length === 1 ? '' : 's'} held`;
      $m('cCopy').textContent = fmtInt(p.copycats.length);
      $s('cCopy').textContent = p.copycats.length ? '⚠ not official — see below' : 'None found';
      $('#ckHold', body).innerHTML = p.holdings.length
        ? `<table class="tbl"><thead><tr><th>Token</th><th class="num">Amount</th><th class="num">Price</th><th class="num">Value</th></tr></thead><tbody>${p.holdings
            .map((h) => `<tr><td><div class="row" style="gap:10px">${h.icon ? `<img class="logo" src="${esc(icon(h.icon))}" data-sym="${esc(h.symbol)}" alt="" style="border-radius:50%">` : ''}<a href="${link.token(h.address)}"><b style="font-weight:500">${esc(h.symbol)}</b> <span class="dim">${esc(h.name)}</span></a></div></td><td class="num">${fmtNum(h.amount, 6)}</td><td class="num">${fmtUsd(h.price)}</td><td class="num">${fmtUsd(h.valueUsd)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<div class="empty">No official Robinhood stock tokens in this wallet.</div>';
      $('#ckFake', body).innerHTML = p.copycats.length
        ? p.copycats
            .map((c) => `<div class="feed-row"><div class="cube">⚠</div><div class="main"><a href="${link.token(c.address)}"><b style="font-family:var(--font);font-weight:500">${esc(c.name)}</b></a><span>${esc(c.symbol)} · ${esc(c.type)} · ${fmtNum(c.amount, 4)} held · not the official contract</span></div><span class="tag">NOT OFFICIAL</span></div>`)
            .join('')
        : '<div class="empty">No look-alike stock tokens found.</div>';
      $('#ckOtherInfo', body).textContent = `${p.othersCount} tokens${p.othersValueUsd ? ` · ≈ ${fmtUsd(p.othersValueUsd)} with known prices` : ''}`;
      $('#ckOther', body).innerHTML = p.others.length
        ? `<table class="tbl"><thead><tr><th>Token</th><th>Type</th><th class="num">Amount</th><th class="num">Value</th></tr></thead><tbody>${p.others
            .slice(0, 20)
            .map((o) => `<tr><td><a href="${o.type === 'ERC-20' || o.type === 'ERC-8056' ? link.token(o.address) : link.address(o.address)}"><b style="font-weight:500">${esc(o.symbol || '?')}</b> <span class="dim">${esc(o.name || '')}</span></a>${o.scam ? ' <span class="tag">SCAM FLAG</span>' : ''}</td><td><span class="tag">${esc(o.type)}</span></td><td class="num">${fmtNum(o.amount, 4)}</td><td class="num">${o.valueUsd != null ? fmtUsd(o.valueUsd) : '—'}</td></tr>`)
            .join('')}</tbody></table>`
        : '<div class="empty">No other tokens.</div>';
    })
    .catch((err) => ['#ckHold', '#ckFake', '#ckOther'].forEach((s) => ($(s, body).innerHTML = `<div class="empty">${esc(err.message)}</div>`)));

  const paintApprovals = (r) => {
    const active = r.approvals.filter((a) => a.active);
    const risky = active.filter((a) => a.risk === 'high');
    $m('cAppr').textContent = r.liveAllowances ? fmtInt(active.length) : '—';
    $s('cAppr').textContent = r.liveAllowances ? (risky.length ? `⚠ ${risky.length} high risk` : 'No high-risk approvals') : 'Current state unavailable';
    $('#ckApprInfo', body).textContent = `${r.scanned} recent transactions scanned${r.since ? ` · back to ${new Date(r.since).toLocaleDateString('en-US')}` : ''}`;
    $('#ckApprovals', body).innerHTML = r.approvals.length
      ? `<table class="tbl"><thead><tr><th>Token</th><th>Spender</th><th>Allowance</th><th>Risk</th><th>Granted</th><th></th></tr></thead><tbody>${r.approvals
          .map((a, i) => {
            const amount = a.allowance == null ? '<span class="dim">unknown</span>' : !a.active ? '<span class="dim">revoked / used</span>' : a.kind === 'nft' ? 'All NFTs' : a.unlimited ? '<b>Unlimited</b>' : fromWei(a.allowance, a.decimals ?? 18, 4);
            const spender = `${a.spenderName ? esc(a.spenderName) + ' ' : ''}${addrLink(a.spender, 6)}${a.spenderVerified ? ' <span class="tag">VERIFIED</span>' : ''}${a.spenderScam ? ' <span class="tag">SCAM</span>' : ''}`;
            const risk = a.active ? `<span class="tag ${a.risk === 'high' ? 'solid' : ''}">${a.risk.toUpperCase()}</span>` : '<span class="dim">—</span>';
            return `<tr><td><a href="${link.token(a.token)}">${esc(a.symbol || a.tokenName || short(a.token))}</a></td><td>${spender}</td><td>${amount}</td><td>${risk}</td><td>${a.tx ? txLink(a.tx, 6) : ''} <span class="dim">${a.time ? ago(a.time) : ''}</span></td><td>${own && a.active ? `<button class="btn btn-sm" data-revoke="${i}">Revoke</button>` : ''}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<div class="empty">No approvals found in the scanned transactions.</div>';
    // Revoke = approve(spender, 0) / setApprovalForAll(operator, false), signed by the owner.
    $('#ckApprovals', body).onclick = async (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      const a = r.approvals[+b.dataset.revoke];
      const data = (a.kind === 'nft' ? '0xa22cb465' : '0x095ea7b3') + pad(a.spender) + pad('0x0');
      try {
        b.disabled = true;
        const hash = await sendCall(a.token, data);
        toast('Revoke sent. It will show as revoked after the next check.');
        b.outerHTML = txLink(hash, 6);
      } catch (err) {
        b.disabled = false;
        toast(err.code === 4001 ? 'Rejected in wallet' : err.message, 'err');
      }
    };
  };
  netApi(`/approvals/${addr}`)
    .then(paintApprovals)
    .catch((err) => {
      $('#ckApprovals', body).innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      $s('cAppr').textContent = 'Unavailable';
    });
  return () => {};
}

function metric(id, title) {
  return `<div class="box metric reveal" id="${id}"><div class="box-head">${title}</div><div class="box-body"><div class="metric-val">—</div><div class="metric-sub">Loading…</div></div></div>`;
}
