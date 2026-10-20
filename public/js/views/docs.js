import { state, esc, $, $$ } from '../core.js';

const SECTIONS = [
  ['start', 'Getting started'],
  ['pages', 'What each page does'],
  ['wallet', 'Add Robinhood Chain to a wallet'],
  ['stocks', 'Tokenized stocks & ERC-8056'],
  ['data', 'Data sources & freshness'],
  ['rpc', 'Aeon RPC'],
  ['api', 'API reference'],
  ['ai', 'Network AI'],
  ['faq', 'FAQ'],
];

export function render(main, [section]) {
  const origin = esc(location.origin);
  const nets = state.config.networks;
  main.innerHTML = `
    <div class="page-head"><div><div class="kicker">Aeon Network · Documentation</div><h1>Docs</h1></div><span class="dim" style="font-size:12px">Everything here describes how the site actually works today.</span></div>
    <div class="docs">
      <nav class="box toc" aria-label="Docs sections">${SECTIONS.map(([id, t]) => (id === 'faq' ? `<a href="#/faq">${t} →</a>` : `<a href="#/docs/${id}" data-id="${id}">${t}</a>`)).join('')}</nav>
      <article class="box prose">

      <section id="start">
        <h2>Getting started</h2>
        <p>Aeon Network is a live hub for <b>Robinhood Chain</b>, an Ethereum Layer 2 built on Arbitrum Orbit. You don't need an account. Open any page and the data is already live.</p>
        <ol>
          <li><b>Pick a network</b> with the Mainnet / Testnet switch in the top bar. Every page follows it.</li>
          <li><b>Watch the network</b> on the <a href="#/">Network</a> page: latest block, TPS, gas, and live blocks and transactions.</li>
          <li><b>Look anything up</b> in the <a href="#/explorer">Explorer</a> by block number, transaction hash or address.</li>
          <li><b>Check stock tokens</b> on <a href="#/stocks">Stocks</a> before you hold one, so you don't end up with a copycat.</li>
          <li><b>Watch addresses</b> on the <a href="#/wallet">Watchlist</a> to get alerts when they transact. No login or wallet connection needed. Connecting is optional and only adds shortcuts.</li>
          <li><b>Ask the AI</b> when you want something explained in plain language.</li>
        </ol>
      </section>

      <section id="pages">
        <h2>What each page does</h2>
        <table>
          <tr><th>Page</th><th>What you get</th></tr>
          <tr><td><a href="#/">Network</a></td><td>Live block height, block time, TPS, gas with dollar costs, totals (transactions, addresses, blocks), TVL, DEX volume, daily and per-minute activity charts, live feeds, most-called contracts, gas tracker.</td></tr>
          <tr><td><a href="#/stocks">Stocks</a></td><td>All official Robinhood stock tokens with price, on-chain market cap, holders and volume; a market cap map; the official-vs-copycat checker.</td></tr>
          <tr><td><a href="#/explorer">Explorer</a></td><td>Latest blocks, transactions and contract deployments. Detail pages for blocks, transactions (status, fee, decoded token transfers, revert reason) and addresses (balances, token holdings, history, verified/scam labels).</td></tr>
          <tr><td><a href="#/ecosystem">Ecosystem</a></td><td>TVL and chain rank, stablecoin supply, DEX volume, fees, top DEXs and fee earners, a searchable protocol directory, Robinhood news.</td></tr>
          <tr><td><a href="#/tokens">Tokens</a></td><td>Top ERC-20 tokens by holders and market cap, plus tokens moving right now.</td></tr>
          <tr><td><a href="#/wallet">Watchlist</a></td><td>Watch any address and get an alert when it transacts, quick wallet check, and one-click network setup for your wallet. Works without connecting; an optional connection adds “check my wallet” and approval revokes.</td></tr>
          <tr><td><a href="#/check">Wallet check</a></td><td>For any address: official stock holdings and their value, copycat tokens, other tokens, and token approvals with live allowance and a risk rating. The owner can revoke approvals after an optional wallet connection.</td></tr>
          <tr><td><a href="#/status">Status</a></td><td>Live health of every data source with a 60-minute uptime history, indexer lag and AI provider state.</td></tr>
          <tr><td><a href="#/ai">AI</a></td><td>A network analyst that reads the chain with tools and explains what it finds.</td></tr>
        </table>
      </section>

      <section id="wallet">
        <h2>Add Robinhood Chain to a wallet</h2>
        <p>Press <b>Add to wallet</b> on the Network or Wallet page. Or add it manually:</p>
        <table>
          <tr><th></th><th>Mainnet</th><th>Testnet</th></tr>
          <tr><td>Network name</td><td>${esc(nets.mainnet.name)}</td><td>${esc(nets.testnet.name)}</td></tr>
          <tr><td>Chain ID</td><td><code>${nets.mainnet.chainId}</code></td><td><code>${nets.testnet.chainId}</code></td></tr>
          <tr><td>RPC (Aeon)</td><td><code>${origin}/rpc/mainnet</code></td><td><code>${origin}/rpc/testnet</code></td></tr>
          <tr><td>RPC (official)</td><td><code>${esc(nets.mainnet.rpc)}</code></td><td><code>${esc(nets.testnet.rpc)}</code></td></tr>
          <tr><td>Currency</td><td>ETH</td><td>ETH</td></tr>
          <tr><td>Explorer</td><td><code>${esc(nets.mainnet.explorer)}</code></td><td><code>${esc(nets.testnet.explorer)}</code></td></tr>
        </table>
        <p>Testnet ETH is free from the <a href="${esc(nets.testnet.faucet || '#')}" target="_blank" rel="noopener noreferrer">testnet faucet</a>. Aeon Network never sees your private key; you approve every transaction in your wallet.</p>
      </section>

      <section id="stocks">
        <h2>Tokenized stocks & ERC-8056</h2>
        <p>Robinhood issues its stock and ETF tokens on Robinhood Chain using the <b>ERC-8056</b> token standard. Official tokens are named <code>&lt;Company&gt; • Robinhood Token</code>, for example <code>Tesla • Robinhood Token</code> with the ticker <code>TSLA</code>.</p>
        <h3>Spotting copycats</h3>
        <ul>
          <li>Anyone can deploy an ERC-20 token called “NVIDIA Robinhood Token” with the ticker NVDA. Many do.</li>
          <li>A token is official only if it is <b>ERC-8056</b> and carries the official name. Aeon Network checks both.</li>
          <li>Use the checker on the <a href="#/stocks">Stocks</a> page, or open the contract in the Explorer: official tokens show <b>✓ Official</b>, look-alikes show a warning.</li>
        </ul>
        <h3>About the numbers</h3>
        <p>Price, market cap, holders and volume describe the <b>token on Robinhood Chain</b>, not the company. Market cap is the token's circulating supply times its price.</p>
      </section>

      <section id="data">
        <h2>Data sources & freshness</h2>
        <table>
          <tr><th>Data</th><th>Source</th><th>Refresh</th></tr>
          <tr><td>Latest blocks, transactions, gas, TPS, most-called contracts</td><td>Robinhood Chain RPC, read by Aeon's indexer</td><td>Every few seconds</td></tr>
          <tr><td>Total transactions, addresses, blocks; daily transactions</td><td>Blockscout</td><td>1 minute (daily totals once a day)</td></tr>
          <tr><td>Block, transaction and address details</td><td>RPC, with Blockscout as a fallback</td><td>On request</td></tr>
          <tr><td>Stock tokens, top tokens, address history</td><td>Blockscout</td><td>10 minutes / 30 seconds</td></tr>
          <tr><td>TVL, protocols, stablecoins, DEX volume, fees</td><td>DefiLlama</td><td>15–60 minutes</td></tr>
          <tr><td>ETH/USD rate</td><td>CoinGecko</td><td>1 minute</td></tr>
          <tr><td>News</td><td>Cointelegraph, filtered to Robinhood stories</td><td>15 minutes</td></tr>
        </table>
        <h3>Why TPS is an estimate</h3>
        <p>Robinhood Chain produces about 10 blocks per second. Reading every block would exhaust free RPC plans in days, so the indexer reads the newest block every few seconds and estimates TPS and per-minute activity from those samples and the measured block time. Estimated figures are labelled on the page. With a paid RPC, the indexer can run in <code>full</code> mode and count every block.</p>
        <h3>Verify it yourself</h3>
        <p>Block, transaction and address pages include a <b>Cross-check</b> panel: the record is read from the RPC and from Blockscout independently, and each field is compared (✓ / ✕). Every record links to Blockscout, and the <a href="#/status">Status</a> page shows the health of each source.</p>
        <h3>When a source is down</h3>
        <p>Every response is cached and shared by all visitors. If a source stops answering, Aeon Network keeps serving the last real value, falls back to another source where one exists (for example Blockscout for the live feed and detail pages), and otherwise says the data is unavailable.</p>
      </section>

      <section id="rpc">
        <h2>Aeon RPC</h2>
        <p>Some networks block the <code>robinhood.com</code> domain at the DNS level (for example in Indonesia), so wallets cannot reach the official RPC. Aeon RPC is a public JSON-RPC endpoint that forwards standard wallet requests to Robinhood Chain.</p>
        <pre>POST ${origin}/rpc/mainnet
POST ${origin}/rpc/testnet</pre>
        <pre>curl -X POST ${origin}/rpc/mainnet \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'</pre>
        <h3>Allowed methods</h3>
        <p><code>eth_chainId</code> <code>net_version</code> <code>eth_blockNumber</code> <code>eth_getBalance</code> <code>eth_getTransactionCount</code> <code>eth_getCode</code> <code>eth_call</code> <code>eth_estimateGas</code> <code>eth_gasPrice</code> <code>eth_maxPriorityFeePerGas</code> <code>eth_feeHistory</code> <code>eth_getBlockByNumber</code> <code>eth_getBlockByHash</code> <code>eth_getTransactionByHash</code> <code>eth_getTransactionReceipt</code> <code>eth_sendRawTransaction</code> <code>eth_getLogs</code> <code>eth_getStorageAt</code> <code>web3_clientVersion</code> <code>eth_syncing</code></p>
        <h3>Limits</h3>
        <ul>
          <li>600 requests per 5 minutes per IP address.</li>
          <li>Batches of up to 20 calls.</li>
          <li>Other methods are rejected with error <code>-32601</code>.</li>
        </ul>
        <p>Signed transactions are relayed as-is. Aeon RPC never holds keys and cannot sign for you.</p>
      </section>

      <section id="api">
        <h2>API reference</h2>
        <p>The JSON endpoints behind the site are public. Replace <code>{net}</code> with <code>mainnet</code> or <code>testnet</code>. Responses include <code>x-data-at</code> (when the data was fetched) and <code>x-data-stale</code> headers. Please cache and keep request rates reasonable.</p>
        <table>
          <tr><th>Endpoint</th><th>Returns</th></tr>
          <tr><td><code>GET /api/network/{net}/overview</code></td><td>Latest block, gas price, RPC health, indexer summary</td></tr>
          <tr><td><code>GET /api/network/{net}/stats</code></td><td>Total transactions, addresses, blocks, average block time, gas tiers</td></tr>
          <tr><td><code>GET /api/network/{net}/tx-history</code></td><td>Daily transaction counts</td></tr>
          <tr><td><code>GET /api/network/{net}/activity?minutes=60</code></td><td>Per-minute activity from the indexer</td></tr>
          <tr><td><code>GET /api/network/{net}/recent</code></td><td>Latest blocks, transactions, deployments</td></tr>
          <tr><td><code>GET /api/network/{net}/contracts</code></td><td>Most-called contracts (share of calls)</td></tr>
          <tr><td><code>GET /api/network/{net}/top-tokens</code></td><td>Top ERC-20 tokens</td></tr>
          <tr><td><code>GET /api/network/{net}/stocks</code></td><td>Official stock tokens</td></tr>
          <tr><td><code>GET /api/network/{net}/stocks/{address}</code></td><td>One stock token with transfer count</td></tr>
          <tr><td><code>GET /api/network/{net}/verify?q=TSLA</code></td><td>Official token(s) and look-alikes for a ticker or name</td></tr>
          <tr><td><code>GET /api/network/{net}/block/{number|latest}</code></td><td>Block with transactions</td></tr>
          <tr><td><code>GET /api/network/{net}/tx/{hash}</code></td><td>Transaction with fee and token transfers</td></tr>
          <tr><td><code>GET /api/network/{net}/address/{address}</code></td><td>Balance, token balances, history, labels</td></tr>
          <tr><td><code>GET /api/network/{net}/lookup?q=…</code></td><td>Resolves a search to a block, tx or address</td></tr>
          <tr><td><code>GET /api/ecosystem/mainnet/{summary|protocols|tvl|stablecoins|dex|fees}</code></td><td>DefiLlama ecosystem data</td></tr>
          <tr><td><code>GET /api/network/{net}/portfolio/{address}</code></td><td>Official stock holdings, copycats, other tokens</td></tr>
          <tr><td><code>GET /api/network/{net}/approvals/{address}</code></td><td>Token approvals with live allowance and risk</td></tr>
          <tr><td><code>GET /api/network/{net}/crosscheck/{tx|block|address}/{id}</code></td><td>RPC vs Blockscout comparison</td></tr>
          <tr><td><code>GET /api/status</code></td><td>Health of every data source</td></tr>
          <tr><td><code>GET /s/{tx|address|block|stock}/{net}/{id}</code></td><td>Share page with link-preview tags</td></tr>
          <tr><td><code>GET /api/stream</code></td><td>Server-sent events: <code>block</code>, <code>txs</code>, <code>pulse</code>, <code>chain-health</code></td></tr>
        </table>
        <pre>const es = new EventSource('${origin}/api/stream');
es.addEventListener('block', (e) => console.log(JSON.parse(e.data)));</pre>
      </section>

      <section id="ai">
        <h2>Network AI</h2>
        <p>The AI page connects you to a language model that has tools for reading Robinhood Chain: network overview, blocks, transactions, addresses, the ecosystem, the stock token list and the official-token checker. It decides which tools to use, then answers in plain language. The tools it used are shown above each answer.</p>
        <ul>
          <li>Paste a transaction hash, address or block number and ask what happened.</li>
          <li>Ask about the network (“how busy is it right now?”) or the ecosystem (“which protocols hold the most value?”).</li>
          <li>Ask whether a token is official before you buy it.</li>
        </ul>
        <p>Models are tried in order${state.config.ai.providers.length ? ` (currently ${state.config.ai.providers.map((p) => esc(p.name)).join(' → ')})` : ''}; if one is unavailable, the next one answers. Each visitor can send 15 questions per 10 minutes. The AI can make mistakes and is not financial advice.</p>
      </section>
      </article>
    </div>`;

  // Deep links (#/docs/rpc) scroll to the section; the TOC tracks the one in view.
  const target = section && $(`#${CSS.escape(section)}`, main);
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  const links = $$('.toc a[data-id]', main);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.dataset.id === e.target.id));
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );
  $$('.prose section', main).forEach((s) => io.observe(s));
  return () => io.disconnect();
}
