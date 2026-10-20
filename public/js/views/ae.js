// The Aeon community token: transparency (live from the chain) and holder perks.
import { state, api, esc, fmtNum, short, toast, prefs, $ } from '../core.js';
import { reveal } from '../fx.js';
import { chooseWallet } from '../wallet.js';

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
const pct = (n) => (n == null ? '—' : n < 0.01 && n > 0 ? '<0.01%' : n.toFixed(2) + '%');

export const getPass = () => {
  const p = prefs.get('aeon-pass', null);
  return p && p.expires > Date.now() ? p : null;
};

export function render(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">Aeon Network · Community token</div><h1>The Aeon token</h1></div>
      <span class="dim" style="font-size:12px;max-width:440px;text-align:right">Everything about the token, read live from Robinhood Chain. Nothing here is financial advice.</span>
    </div>
    <div id="aeBody"><div class="box"><div class="empty">Reading the token from the chain…</div></div></div>`;
  const body = $('#aeBody', main);
  let alive = true;

  api('/aeon/token')
    .then((t) => {
      if (!alive) return;
      const pass = getPass();
      body.innerHTML = `
        <section class="box reveal ae-ca">
          <div class="box-body">
            <div class="kicker">Official contract · ${esc(t.name)} · Robinhood Chain · launched on ${esc(t.launchedOn)}</div>
            <div class="ae-ca-row"><b class="mono">${esc(t.address)}</b><button class="btn btn-sm" data-copy="${esc(t.address)}">Copy</button><a class="btn btn-sm" href="${EXPLORER}/token/${t.address}" target="_blank" rel="noopener">Explorer ↗</a></div>
            <p class="dim">Only this address is official. It is also shown at the bottom of every page and posted by @getaeon_network.</p>
          </div>
        </section>

        <section class="grid g-4 mt reveal">
          <div class="box metric"><div class="box-head">Total supply</div><div class="box-body"><div class="metric-val">${fmtNum(t.supply, 0)}</div><div class="metric-sub">fixed at launch</div></div></div>
          <div class="box metric"><div class="box-head">Holders</div><div class="box-body"><div class="metric-val">${fmtNum(t.holders, 0)}</div><div class="metric-sub">live from Blockscout</div></div></div>
          <div class="box metric"><div class="box-head">Team holdings</div><div class="box-body"><div class="metric-val">${pct(t.team.pct)}</div><div class="metric-sub">${t.team.declared ? `${t.team.declared} disclosed wallet(s) + creator` : 'creator wallet · no other team wallets'}</div></div></div>
          <div class="box metric"><div class="box-head">Burned</div><div class="box-body"><div class="metric-val">${pct(t.burnedPct)}</div><div class="metric-sub">held by 0x…dEaD</div></div></div>
        </section>

        <div class="grid g-main mt">
          <section class="box reveal">
            <div class="box-head">Transparency<span class="right dim">verifiable on-chain</span></div>
            <div class="box-body ae-facts">
              <div><span class="tag solid">Creator wallet</span><p><a class="mono link" href="${EXPLORER}/address/${t.creator.address}" target="_blank" rel="noopener">${esc(short(t.creator.address, 8))}</a> launched the token on Pons. It now holds <b>${t.creator.balance == null ? '—' : fmtNum(t.creator.balance, 0) + ' AE'}</b>.</p></div>
              <div><span class="tag solid">Launch buy burned</span><p>The creator's launch buy was sent straight to the burn address. <a class="link" href="${EXPLORER}/tx/${t.creator.buyTx}" target="_blank" rel="noopener">Buy tx ↗</a> · <a class="link" href="${EXPLORER}/tx/${t.creator.burnTx}" target="_blank" rel="noopener">Burn tx ↗</a></p></div>
              <div><span class="tag solid">Team wallets</span><p>${t.team.declared ? t.team.wallets.map((w) => `<a class="mono link" href="${EXPLORER}/address/${w.address}" target="_blank" rel="noopener">${esc(short(w.address, 8))}</a> holds ${w.balance == null ? '—' : fmtNum(w.balance, 0) + ' AE'}`).join('<br>') : 'None. The team holds no other wallets with AE. Any future team wallet will be listed here first.'}</p></div>
              <div><span class="tag">Product</span><p>Aeon Network is live, open source and free to use without the token. The token adds holder perks; it is not required.</p></div>
            </div>
          </section>

          <section class="box reveal" id="aePerks">
            <div class="box-head">Holder perks</div>
            <div class="box-body ae-perk">
              <p>Hold at least <b>${fmtNum(t.perks.min, 0)} AE</b> in a wallet and verify it here:</p>
              <ul>
                <li><b>${t.perks.aiMultiplier}× Network AI</b> allowance</li>
                <li><b>Holder</b> badge across the site</li>
              </ul>
              <div id="aeStatus"></div>
              <p class="dim" style="font-size:12px">Verifying asks your wallet to sign a short message. It is free, sends no transaction and can't move funds. The pass lasts 24 hours.</p>
            </div>
          </section>
        </div>

        <section class="box reveal mt">
          <div class="box-head">Top holders<span class="right dim">live</span></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>#</th><th>Wallet</th><th>Label</th><th class="num">AE</th><th class="num">Share</th></tr></thead>
            <tbody>${t.top
              .map((h, i) => `<tr><td class="mono">${i + 1}</td><td><a class="mono link" href="${EXPLORER}/address/${h.address}" target="_blank" rel="noopener">${esc(short(h.address, 8))}</a></td><td>${h.label ? `<span class="tag">${esc(h.label)}</span>` : h.isContract ? '<span class="dim">contract</span>' : ''}</td><td class="num">${fmtNum(h.amount, 0)}</td><td class="num">${pct(h.pct)}</td></tr>`)
              .join('')}</tbody>
          </table></div>
        </section>`;
      paintStatus(body, t, pass);
      reveal(body);
    })
    .catch((err) => alive && (body.innerHTML = `<div class="box"><div class="empty">${esc(err.message)}</div></div>`));
  return () => (alive = false);
}

function paintStatus(body, t, pass) {
  const el = $('#aeStatus', body);
  if (pass) {
    el.innerHTML = `<div class="ae-ok"><span class="tag solid">HOLDER</span> <span class="mono">${esc(short(pass.address, 6))}</span> · ${fmtNum(pass.balance, 0)} AE · active for ${Math.max(1, Math.round((pass.expires - Date.now()) / 3600_000))} h</div>
      <button class="btn btn-sm mt" id="aeForget">Remove pass</button>`;
    $('#aeForget', body).addEventListener('click', () => {
      prefs.set('aeon-pass', null);
      window.dispatchEvent(new Event('aeon-pass'));
      paintStatus(body, t, null);
    });
    return;
  }
  el.innerHTML = '<button class="btn btn-primary" id="aeVerify">Verify my wallet</button>';
  $('#aeVerify', body).addEventListener('click', async (e) => {
    const btn = e.target;
    try {
      if (!state.wallet) await chooseWallet();
      if (!state.wallet) return;
      btn.disabled = true;
      btn.textContent = 'Check your wallet…';
      const address = state.wallet.address;
      const c = await post('/aeon/challenge', { address });
      const signature = await state.wallet.provider.request({ method: 'personal_sign', params: [c.message, address] });
      btn.textContent = 'Reading your balance…';
      const r = await post('/aeon/verify', { address, nonce: c.nonce, signature });
      if (r.holder) {
        prefs.set('aeon-pass', { pass: r.pass, address: r.address, balance: r.balance, expires: r.expires });
        toast('Verified. Holder perks are on.');
        window.dispatchEvent(new Event('aeon-pass'));
        paintStatus(body, t, getPass());
      } else {
        el.innerHTML = `<p>This wallet holds <b>${fmtNum(r.balance, 0)} AE</b>. Perks start at ${fmtNum(r.min, 0)} AE.</p>`;
      }
    } catch (err) {
      toast(err.message || 'Verification cancelled', 'err');
      btn.disabled = false;
      btn.textContent = 'Verify my wallet';
    }
  });
}
