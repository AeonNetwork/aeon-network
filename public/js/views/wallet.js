import { state, net, on, esc, fromWei, ago, short, link, toast, $ } from '../core.js';
import { reveal } from '../fx.js';
import { addNetwork, chooseWallet, disconnect } from '../wallet.js';
import { getWatch, addWatch, removeWatch } from '../watch.js';

// Address tools that work without connecting a wallet: watchlist, wallet check, network setup.
export function render(main) {
  let dispose = mount(main);
  const offs = [
    on('network', () => {
      dispose();
      dispose = mount(main);
      reveal(main);
    }),
    on('watch', () => paintWatch(main)),
    on('wallet', () => {
      dispose();
      dispose = mount(main);
      reveal(main);
    }),
  ];
  return () => {
    offs.forEach((o) => o());
    dispose();
  };
}

function mount(main) {
  const n = net();
  main.innerHTML = `
    <div class="page-head"><div><div class="kicker">${esc(n.name)} · Watchlist</div><h1>Watch any address</h1></div><span class="dim" style="font-size:12px;max-width:420px;text-align:right">No wallet connection needed. Paste an address; Aeon Network only reads public on-chain data.</span></div>
    <div class="grid g-main" style="align-items:start">
      <div class="box reveal">
        <div class="box-head">Watchlist<span class="right dim">alerts on new transactions while this site is open</span></div>
        <form class="box-body row wrap" id="wlForm" style="gap:8px">
          <input class="input mono" id="wlAddr" placeholder="0x address to watch" spellcheck="false" aria-label="Address to watch" style="flex:2 1 260px">
          <input class="input" id="wlLabel" placeholder="Label (optional)" aria-label="Label" style="flex:1 1 140px">
          <button class="btn btn-primary" type="submit">Watch</button>
        </form>
        <div class="feed" id="wlList"></div>
        <div class="box-foot">Saved in this browser only. Up to 12 addresses, checked every minute.</div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="box reveal">
          <div class="box-head">Your wallet<span class="right dim">optional</span></div>
          ${state.wallet
            ? `<div class="box-body"><div class="mono" style="overflow-wrap:anywhere">${esc(state.wallet.address)}</div></div><div class="box-foot row wrap"><a class="btn btn-sm btn-primary" href="#/check/${esc(state.wallet.address)}">Check my wallet</a><button class="btn btn-sm" id="wWatch">Watch it</button><button class="btn btn-sm" id="wOff">Disconnect</button></div>`
            : `<div class="box-body"><p class="muted" style="margin:0 0 10px;font-size:13px">Not needed for anything here. Connecting just lets you check your own wallet in one click and revoke approvals.</p><button class="btn btn-sm" id="wConnect">Connect wallet</button></div>`}
        </div>
        <div class="box reveal">
          <div class="box-head">Wallet check</div>
          <form class="box-body grid" id="ckForm" style="gap:8px">
            <p class="muted" style="margin:0;font-size:13px">Stock holdings, copycat tokens and risky approvals for any address.</p>
            <input class="input mono" id="ckAddr" placeholder="0x address" spellcheck="false" aria-label="Address to check">
            <button class="btn btn-primary" type="submit">Check address</button>
          </form>
        </div>
        <div class="box reveal">
          <div class="box-head">Network setup</div>
          <dl class="kv"><dt>Network</dt><dd>${esc(n.name)}</dd><dt>Chain ID</dt><dd>${n.chainId}</dd><dt>Aeon RPC</dt><dd>${esc(location.origin)}/rpc/${state.network}</dd><dt>Official RPC</dt><dd>${esc(n.rpc)}</dd><dt>Currency</dt><dd>${esc(n.currency.symbol)}</dd><dt>Explorer</dt><dd>${esc(n.explorer)}</dd></dl>
          <div class="box-foot row wrap"><button class="btn btn-sm btn-primary" id="addNet">Add ${esc(n.name)} to my wallet</button>${n.faucet ? `<a class="btn btn-sm" href="${esc(n.faucet)}" target="_blank" rel="noopener noreferrer">Get testnet ETH ↗</a>` : ''}</div>
          <div class="box-foot">Adding the network only opens your wallet's own confirmation. It does not connect your wallet or share your accounts.</div>
        </div>
      </div>
    </div>`;

  $('#addNet', main).addEventListener('click', () => addNetwork(state.network));
  $('#wConnect', main)?.addEventListener('click', chooseWallet);
  $('#wOff', main)?.addEventListener('click', disconnect);
  $('#wWatch', main)?.addEventListener('click', () => {
    try {
      addWatch(state.network, state.wallet.address, 'My wallet');
      toast('Watching your wallet');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  $('#ckForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#ckAddr', main).value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return toast('Enter a valid 0x address', 'err');
    location.hash = `#/check/${v}`;
  });
  $('#wlForm', main).addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      addWatch(state.network, $('#wlAddr', main).value.trim(), $('#wlLabel', main).value);
      $('#wlAddr', main).value = $('#wlLabel', main).value = '';
      toast('Watching address');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  $('#wlList', main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-unwatch]');
    if (b) removeWatch(state.network, b.dataset.unwatch);
  });
  paintWatch(main);
  return () => {};
}

function paintWatch(main) {
  const el = main.querySelector('#wlList');
  if (!el) return;
  const list = getWatch().filter((w) => w.network === state.network);
  el.innerHTML = list.length
    ? list
        .map(
          (w) => `<div class="feed-row"><div class="cube">${w.lastTime && Date.now() - w.lastTime < 3600_000 ? '●' : '◦'}</div>
          <div class="main"><a href="${link.address(w.address)}"><b style="font-family:var(--font);font-weight:500">${esc(w.label || short(w.address, 8))}</b></a><span>${w.lastTime ? `last: ${esc(w.lastMethod || 'tx')} · ${ago(w.lastTime)}` : 'checking…'}${w.balanceWei ? ` · ${fromWei(w.balanceWei, 18, 4)} ETH` : ''}</span></div>
          <div class="row" style="gap:6px"><a class="btn btn-sm" href="#/check/${esc(w.address)}">Check</a><button class="btn btn-sm" data-unwatch="${esc(w.address)}" aria-label="Stop watching">✕</button></div></div>`,
        )
        .join('')
    : '<div class="empty">No addresses yet. Add a wallet, a whale or a contract to get alerts when it moves.</div>';
}
