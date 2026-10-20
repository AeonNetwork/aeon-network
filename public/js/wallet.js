// Optional wallet connection (EIP-6963 / EIP-1193). Nothing on Aeon Network
// requires it: every page works with a pasted address. Connecting only adds
// conveniences (check my wallet, revoke approvals, add tokens). It never pops
// up on its own; a previous connection is restored silently (no prompt).

import { state, emit, esc, toast, short, prefs } from './core.js';

const providers = new Map(); // uuid -> { info, provider }
window.addEventListener('eip6963:announceProvider', (e) => providers.set(e.detail.info.uuid, e.detail));
window.dispatchEvent(new Event('eip6963:requestProvider'));
const anyProvider = () => [...providers.values()][0]?.provider || window.ethereum || null;

const hex = (n) => '0x' + Number(n).toString(16);

export function networkParams(net) {
  const n = state.config.networks[net];
  return {
    chainId: hex(n.chainId),
    chainName: n.name,
    nativeCurrency: n.currency,
    // Aeon RPC first: it works where the official RPC domain is blocked.
    rpcUrls: [`${location.origin}/rpc/${net}`, n.rpc],
    blockExplorerUrls: [n.explorer],
  };
}

export function chooseWallet() {
  const modal = document.getElementById('modal');
  const list = [...providers.values()];
  if (!list.length && window.ethereum) list.push({ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: window.ethereum });
  modal.innerHTML = `
    <h3>Connect wallet (optional)</h3>
    <p>Everything on Aeon Network works without connecting. Connecting only shares your public address so you can check your own wallet and revoke approvals. Aeon Network never sees your private key.</p>
    ${list.length
      ? list.map((p) => `<button class="wallet-opt" data-id="${esc(p.info.uuid)}">${p.info.icon ? `<img src="${esc(p.info.icon)}" alt="">` : ''}${esc(p.info.name)}</button>`).join('')
      : `<p style="border-top:1px solid var(--line)">No wallet extension found. You can still use every feature by pasting an address.</p>`}
    <div class="modal-foot"><button class="btn btn-sm" data-close>Not now</button></div>`;
  modal.showModal();
  modal.onclick = async (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) return modal.close();
    const opt = e.target.closest('.wallet-opt');
    if (!opt) return;
    const p = list.find((x) => x.info.uuid === opt.dataset.id);
    modal.close();
    await connect(p);
  };
}

async function connect(p) {
  try {
    const accounts = await p.provider.request({ method: 'eth_requestAccounts' });
    const chainId = parseInt(await p.provider.request({ method: 'eth_chainId' }), 16);
    state.wallet = { address: accounts[0], chainId, provider: p.provider, info: p.info };
    prefs.set('wallet', p.info.uuid);
    attach(p.provider);
    emit('wallet', state.wallet);
    toast(`Connected ${short(accounts[0])}`);
  } catch (err) {
    toast(err.code === 4001 ? 'Connection cancelled' : err.message, 'err');
  }
}

// Silent restore: only if the user connected before, and without any prompt.
export async function restore() {
  const uuid = prefs.get('wallet');
  if (!uuid) return;
  await new Promise((r) => setTimeout(r, 300));
  const p = providers.get(uuid) || (uuid === 'injected' && window.ethereum ? { info: { uuid, name: 'Browser wallet' }, provider: window.ethereum } : null);
  if (!p) return;
  try {
    const accounts = await p.provider.request({ method: 'eth_accounts' });
    if (!accounts.length) return;
    const chainId = parseInt(await p.provider.request({ method: 'eth_chainId' }), 16);
    state.wallet = { address: accounts[0], chainId, provider: p.provider, info: p.info };
    attach(p.provider);
    emit('wallet', state.wallet);
  } catch {
    /* ignore */
  }
}

let attached;
function attach(provider) {
  if (attached === provider) return;
  attached = provider;
  provider.on?.('accountsChanged', (acc) => {
    if (!acc.length) return disconnect();
    state.wallet.address = acc[0];
    emit('wallet', state.wallet);
  });
  provider.on?.('chainChanged', (id) => {
    if (!state.wallet) return;
    state.wallet.chainId = parseInt(id, 16);
    emit('wallet', state.wallet);
  });
}

export function disconnect() {
  state.wallet = null;
  prefs.set('wallet', null);
  emit('wallet', null);
}

export const onRightChain = () => Boolean(state.wallet) && state.wallet.chainId === state.config.networks[state.network].chainId;

export async function switchNetwork(net) {
  const p = state.wallet?.provider;
  if (!p) return;
  const params = networkParams(net);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
  } catch (err) {
    if (err.code === 4902 || /unrecognized|not added|unknown chain/i.test(err.message)) await p.request({ method: 'wallet_addEthereumChain', params: [params] });
    else throw err;
  }
}

// Works with or without a connection: the wallet shows its own confirmation.
export async function addNetwork(net) {
  const p = state.wallet?.provider || anyProvider();
  if (!p) return toast('No wallet extension found. Add the network manually with the details on this page.', 'err');
  try {
    await p.request({ method: 'wallet_addEthereumChain', params: [networkParams(net)] });
    toast('Network added to your wallet');
  } catch (err) {
    toast(err.code === 4001 ? 'Cancelled in wallet' : err.message, 'err');
  }
}

export async function watchTokenInWallet(token) {
  const p = state.wallet?.provider || anyProvider();
  if (!p) return toast('No wallet extension found', 'err');
  try {
    await p.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: token.address, symbol: String(token.symbol).slice(0, 11), decimals: token.decimals } } });
  } catch (err) {
    toast(err.code === 4001 ? 'Cancelled in wallet' : err.message, 'err');
  }
}

// Contract call signed by the user's own wallet (used for revoking approvals).
export async function sendCall(to, data) {
  const w = state.wallet;
  if (!w) throw new Error('Connect a wallet first');
  if (!onRightChain()) await switchNetwork(state.network);
  return w.provider.request({ method: 'eth_sendTransaction', params: [{ from: w.address, to, data, value: '0x0' }] });
}
