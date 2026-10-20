// FAQ content, shared by the FAQ page and the landing page teaser.
// Answers are HTML; keep them factual and in sync with how the server works.

export const FAQ = [
  {
    q: 'What is Aeon Network?',
    a: `<p>Aeon Network is a live hub for Robinhood Chain. It shows what is happening on the network right now (blocks, transactions, gas, activity), lets you explore any block, transaction or address, lists the official tokenized stocks, maps the DeFi ecosystem, and includes an AI that can read the chain for you.</p>`,
    top: true,
  },
  {
    q: 'Is Aeon Network affiliated with Robinhood?',
    a: `<p>No. Aeon Network is an independent project built on public data from Robinhood Chain. It is not operated, endorsed or reviewed by Robinhood. Always confirm important details on Robinhood's own channels.</p>`,
    top: true,
  },
  {
    q: 'What is Robinhood Chain?',
    a: `<p>Robinhood Chain is an Ethereum Layer 2 built on Arbitrum Orbit (mainnet chain ID <code>4663</code>, testnet <code>46630</code>). Gas is paid in ETH, blocks arrive roughly every 0.1 seconds, and it is designed for tokenized real-world assets such as stocks and ETFs.</p>`,
  },
  {
    q: 'Is the data real?',
    a: `<p>Yes. Nothing on the site is simulated. Live blocks and transactions are read from the Robinhood Chain RPC; network totals, token lists and address history come from Blockscout; TVL, protocols, DEX volume and fees come from DefiLlama. If a source is unavailable, the page says so instead of showing a made-up number.</p>
        <p>Two figures are estimates and are labelled as such: TPS and transactions per minute are calculated from sampled blocks, because the chain produces about 10 blocks per second.</p>`,
    top: true,
  },
  {
    q: 'How can I check the numbers myself?',
    a: `<p>Every block, transaction and address page has a <b>Cross-check</b> panel that reads the same record from the Robinhood Chain RPC and from Blockscout and compares each field. Every item also links to the same record on Blockscout. The <a href="#/status">Status</a> page shows each data source live, with an uptime history.</p>`,
    top: true,
  },
  {
    q: 'What is a token approval, and why revoke it?',
    a: `<p>An approval lets a contract move a token from your wallet. Old unlimited approvals to unverified contracts are a common way wallets get drained. The <a href="#/check">Wallet check</a> lists the approvals found in an address's recent transactions with their current allowance, and flags risky ones. If you connect the wallet (optional), you can revoke them right there; you confirm each revoke in your wallet.</p>`,
  },
  {
    q: 'How do I know a stock token is the official one?',
    a: `<p>Official Robinhood stock tokens use the <b>ERC-8056</b> standard and are named <code>&lt;Company&gt; • Robinhood Token</code>. Many copycat tokens reuse the same ticker, and some even copy the exact name while being plain ERC-20 contracts.</p>
        <p>Use the <a href="#/stocks">“Is it the real one?”</a> checker on the Stocks page, or open the address in the Explorer: official tokens are marked <b>✓ Official</b>, look-alikes get a warning.</p>`,
    top: true,
  },
  {
    q: 'Can I buy or trade stocks on Aeon Network?',
    a: `<p>No. Aeon Network is for exploring and verifying. It does not offer trading, custody or brokerage. The only transaction it can prepare is revoking an approval, and only if you connect your wallet and confirm it yourself.</p>`,
  },
  {
    q: 'Do I need to connect a wallet?',
    a: `<p>No. There is no login and no account. Every page works by pasting a public address. Connecting a wallet is optional and only adds shortcuts: checking your own wallet in one click and revoking approvals. It shares your public address only; Aeon Network never sees your private key, and anything that changes your wallet must be confirmed by you in the wallet itself. Never type your seed phrase into any website.</p>`,
  },
  {
    q: 'How do I add Robinhood Chain to my wallet?',
    a: `<p>Press <b>Add to wallet</b> on the Network or Watchlist page. Your wallet shows its own confirmation; nothing else is shared. Aeon Network registers the chain with its Aeon RPC first and the official RPC as a backup. Details are in the <a href="#/docs/wallet">docs</a>.</p>`,
  },
  {
    q: 'What is Aeon RPC and why would I use it?',
    a: `<p>In some countries (for example Indonesia), the <code>robinhood.com</code> domain is blocked at the DNS level, so wallets cannot reach the official RPC. Aeon RPC is a JSON-RPC endpoint served by Aeon Network that forwards standard wallet requests to Robinhood Chain. It allows a safe list of methods and has a per-IP rate limit. See <a href="#/docs/rpc">Aeon RPC</a>.</p>`,
  },
  {
    q: 'How fresh is the data?',
    a: `<p>New blocks and transactions appear within seconds. Network totals refresh every minute, the stock token list every 10 minutes, and ecosystem figures from DefiLlama every 15–60 minutes. Daily numbers such as “transactions · last day” update once per day.</p>`,
  },
  {
    q: 'What can the Network AI do? Can it be wrong?',
    a: `<p>The AI can look up blocks, transactions, addresses, network activity, the ecosystem and stock tokens by itself, then explain them in plain language. Paste a transaction hash or address and ask what happened.</p>
        <p>It can still make mistakes. Treat it as a guide, check important details in the Explorer, and don't use it as financial advice.</p>`,
  },
  {
    q: 'What is the difference between mainnet and testnet?',
    a: `<p>Mainnet holds real value. Testnet is for developers and uses free test ETH from the faucet. Switch between them with the Mainnet / Testnet toggle in the top bar; every page follows the selected network. Ecosystem and stock data exist only on mainnet.</p>`,
  },
  {
    q: 'Is there an API I can use?',
    a: `<p>Yes. The same JSON endpoints that power the site are public, for example <code>/api/network/mainnet/stats</code> and <code>/api/network/mainnet/stocks</code>. Please cache responses and keep request rates reasonable. See the <a href="#/docs/api">API reference</a>.</p>`,
  },
  {
    q: 'Does it cost anything?',
    a: `<p>No. Aeon Network is free to use. Network fees for any transaction you send are paid to Robinhood Chain from your wallet, not to Aeon Network.</p>`,
  },
];
