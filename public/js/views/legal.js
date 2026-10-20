// Disclaimer, privacy and terms. Plain statements of what the app actually does.

const UPDATED = 'October 19, 2026';

const SECTIONS = {
  disclaimer: {
    title: 'Disclaimer',
    body: `
      <p><b>Aeon Network is an independent project. It is not affiliated with, endorsed by or operated by Robinhood Markets, Inc. or any of its subsidiaries.</b> "Robinhood" and related names are trademarks of their respective owners and are used here only to describe the network this site reads from.</p>
      <p><b>Nothing on this site is financial, investment, legal or tax advice.</b> Prices, holder counts, volumes, rankings and AI answers are information, not recommendations to buy, sell or hold any asset, including tokenized stocks.</p>
      <p>Data comes from public sources: Robinhood Chain RPC nodes, Blockscout, DefiLlama and CoinGecko. It is shown as received and can be delayed, incomplete or wrong when a source is. Where the site estimates something (for example, activity from sampled blocks), it says so. Always verify important figures with the linked source before acting on them.</p>
      <p>The Network AI can make mistakes. It looks data up on-chain, but its explanations are generated text. Check anything that matters.</p>
      <p>A token labelled "official" matches Robinhood's published ERC-8056 stock tokens. Any other token, even with a familiar name or ticker, may be a copy. Holding a tokenized stock may not give the same rights as owning the underlying share.</p>`,
  },
  privacy: {
    title: 'Privacy',
    body: `
      <p><b>No accounts, no sign-up, no tracking cookies.</b> You can use every feature without connecting a wallet.</p>
      <h3>Stored in your browser</h3>
      <p>Your watchlist, chosen network and similar preferences are kept in your browser's local storage. They never leave your device, and clearing your browser data removes them.</p>
      <h3>Wallet connection (optional)</h3>
      <p>If you connect a wallet, the site reads your public address to show balances and approvals. Aeon never sees your private keys or seed phrase and cannot move your funds. Any transaction, such as revoking an approval, is created by you and must be confirmed in your own wallet.</p>
      <h3>What the server sees</h3>
      <p>Like any website, the server receives your IP address with each request. It is held in memory only to apply rate limits and is not stored in a database or sold. Addresses, hashes and block numbers you look up are public blockchain data and are fetched from the providers listed in the disclaimer.</p>
      <h3>Network AI</h3>
      <p>Messages you send to the Network AI are forwarded to an AI provider (Google Gemini, OpenRouter or Anthropic, depending on availability) to generate an answer. Do not paste private keys, seed phrases or personal information into the chat.</p>
      <h3>Notifications</h3>
      <p>Watchlist alerts use your browser's notification permission. You can turn it off at any time in your browser settings.</p>`,
  },
  terms: {
    title: 'Terms of use',
    body: `
      <p>By using Aeon Network you agree to these terms.</p>
      <ol>
        <li><b>As is.</b> The site and its data are provided "as is" and "as available", without warranties of any kind. Uptime and accuracy are not guaranteed.</li>
        <li><b>Your decisions.</b> You are solely responsible for any decision or transaction you make. Aeon Network is not liable for losses arising from use of the site, its data or its AI.</li>
        <li><b>Your wallet.</b> You are responsible for the security of your wallet and for reviewing every transaction before you sign it.</li>
        <li><b>Fair use.</b> Do not attempt to overload, scrape at scale or disrupt the site, its API or the Aeon RPC. Requests are rate-limited, and abusive traffic may be blocked.</li>
        <li><b>Third parties.</b> Links and data from third parties (explorers, protocols, data providers) are governed by their own terms.</li>
        <li><b>Changes.</b> These terms may be updated; the date at the top of this page shows the latest version.</li>
      </ol>`,
  },
};

export function render(main, [section] = []) {
  main.innerHTML = `
    <div class="page-head"><div><div class="kicker">Aeon Network · Legal</div><h1>Disclaimer, privacy &amp; terms</h1></div><span class="dim mono" style="font-size:12px">Updated ${UPDATED}</span></div>
    <div class="legal">
      ${Object.entries(SECTIONS)
        .map(([id, s]) => `<section class="box reveal mt" id="legal-${id}"><div class="box-head">${s.title}</div><div class="prose">${s.body}</div></section>`)
        .join('')}
    </div>`;
  if (SECTIONS[section]) requestAnimationFrame(() => document.getElementById('legal-' + section)?.scrollIntoView({ block: 'start' }));
}
