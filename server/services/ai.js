// Aeon Network AI. One set of chain-reading tools, several model providers:
//   anthropic  - Claude via the official SDK (adds web search)
//   gemini     - Google Gemini via its OpenAI-compatible endpoint
//   openrouter - OpenRouter (free models available)
// Providers are tried in AI_PROVIDERS order; one that is rate-limited, out of
// quota or down before it has answered hands the question to the next.

import Anthropic from '@anthropic-ai/sdk';
import { AI, NETWORKS } from '../config.js';
import * as chain from './chain.js';
import * as indexer from './indexer.js';
import * as eco from './ecosystem.js';

const SYSTEM = `You are Aeon, the network analyst inside Aeon Network (getaeon.network), a hub for Robinhood Chain: an Ethereum Layer 2 built on Arbitrum Orbit (chain ID 4663, testnet 46630), gas paid in ETH, designed for tokenized real-world assets such as stocks.

You help builders and power users who want precise on-chain answers, and newcomers who want to understand what they are looking at. Reply in English unless the user writes in another language; match their level.

How you work:
- You have tools that read Robinhood Chain live. Use them whenever a question involves a block, transaction, address, contract, token, network activity, or the ecosystem. Never guess on-chain facts; if a tool fails, say what you could not check.
- When the user pastes a transaction hash, address, or block number, look it up first, then explain it in plain language: who did what, which tokens moved, what it cost, and whether it succeeded.
- Network totals (transactions, addresses, block time) come from Blockscout. Live rates from Aeon's indexer may be estimates from sampled blocks; say so when you quote them.
- Ecosystem figures (TVL, protocols, DEX volume, fees) come from DefiLlama.
- Be precise with units: wei vs ETH (1 ETH = 1e18 wei), gwei for gas, token decimals for token amounts.
- Keep it scannable: short paragraphs, bullets, bold for the key facts.`;

const NET = { type: 'string', enum: ['mainnet', 'testnet'], description: 'Which Robinhood Chain network' };
const TOOLS = [
  {
    name: 'get_network_overview',
    description: 'Live state of a Robinhood Chain network: latest block, gas price, block time, TPS, all-time and today transaction totals, total addresses, and the most-called contracts.',
    input_schema: { type: 'object', properties: { network: NET }, required: ['network'], additionalProperties: false },
  },
  {
    name: 'get_block',
    description: 'A block by number (or "latest") with its transactions.',
    input_schema: { type: 'object', properties: { network: NET, block: { type: 'string', description: 'Block number as digits, or "latest"' } }, required: ['network', 'block'], additionalProperties: false },
  },
  {
    name: 'get_transaction',
    description: 'A transaction by hash: status, sender, recipient, value, method, fee, and decoded ERC-20 token transfers.',
    input_schema: { type: 'object', properties: { network: NET, hash: { type: 'string', description: '0x-prefixed 32-byte transaction hash' } }, required: ['network', 'hash'], additionalProperties: false },
  },
  {
    name: 'get_address',
    description: 'An address: ETH balance, nonce, whether it is a contract, ERC-20 metadata if it is a token, balances of major tokens, and recent transactions.',
    input_schema: { type: 'object', properties: { network: NET, address: { type: 'string', description: '0x-prefixed 20-byte address' } }, required: ['network', 'address'], additionalProperties: false },
  },
  {
    name: 'get_ecosystem',
    description: 'Robinhood Chain mainnet ecosystem: total TVL and rank (DefiLlama), largest protocols, DEX volume, fees, and top tokens by holders (Blockscout).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_stock_tokens',
    description: 'Official Robinhood tokenized stocks and ETFs on Robinhood Chain mainnet (ERC-8056 "• Robinhood Token"): symbol, company, price, on-chain market cap, holders, 24h volume, contract address.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'verify_token',
    description: 'Check whether a token is the official Robinhood stock token or a look-alike. Give a ticker or company name; returns the official contract(s) and look-alike tokens with a risk flag.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ticker or company name, e.g. TSLA or Tesla' } }, required: ['query'], additionalProperties: false },
  },
];
const TOOL_LABEL = { get_network_overview: 'Reading network state', get_block: 'Opening block', get_transaction: 'Decoding transaction', get_address: 'Inspecting address', get_ecosystem: 'Loading ecosystem data', get_stock_tokens: 'Loading tokenized stocks', verify_token: 'Verifying token' };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

// Validate every tool input ourselves: the model's arguments are untrusted.
function validate(name, input) {
  if (!input || typeof input !== 'object') return 'input must be an object';
  if (!TOOL_LABEL[name]) return 'unknown tool';
  if (!['get_ecosystem', 'get_stock_tokens', 'verify_token'].includes(name) && !NETWORKS[input.network]) return 'network must be "mainnet" or "testnet"';
  if (name === 'verify_token' && !(typeof input.query === 'string' && input.query.trim() && input.query.length <= 40)) return 'query must be a short ticker or name';
  if (name === 'get_block' && !(input.block === 'latest' || /^\d+$/.test(String(input.block)))) return 'block must be digits or "latest"';
  if (name === 'get_transaction' && !HASH.test(input.hash || '')) return 'hash must be 0x + 64 hex chars';
  if (name === 'get_address' && !ADDR.test(input.address || '')) return 'address must be 0x + 40 hex chars';
  return null;
}

const val = (r) => (r.status === 'fulfilled' ? r.value : null);

async function runTool(name, input) {
  switch (name) {
    case 'get_network_overview': {
      const net = input.network;
      const [bn, gas, stats, price] = await Promise.allSettled([chain.blockNumber(net), chain.gasPrice(net), eco.explorerStats(net), eco.ethPrice()]);
      const top = indexer.indexing(net) ? indexer.topContracts(net, 24, 10) : [];
      for (const c of top) c.token = await chain.tokenMeta(net, c.address).then((m) => m.symbol).catch(() => null);
      // Pre-computed so the model quotes the fee instead of doing unit conversions itself.
      const gasWei = val(gas)?.value;
      const ethUsd = val(price)?.value?.usd ?? null;
      const transferEth = gasWei ? (gasWei * 21_000) / 1e18 : null;
      return {
        network: NETWORKS[net].name,
        chainId: NETWORKS[net].chainId,
        latestBlock: val(bn)?.value ?? indexer.summary(net)?.lastBlock ?? 'unavailable',
        gasPriceGwei: gasWei ? gasWei / 1e9 : val(stats)?.gasPrices ?? 'unavailable',
        ethUsd,
        ethTransferCost: transferEth == null ? 'unavailable' : { gas: 21_000, eth: transferEth, usd: ethUsd ? transferEth * ethUsd : null, note: 'Plain ETH transfer at the current gas price. Quote these numbers directly.' },
        blockscout: val(stats) ?? 'unavailable',
        indexer: indexer.summary(net),
        mostCalledContractsSampled: top,
      };
    }
    case 'get_block': {
      const id = input.block === 'latest' ? 'latest' : Number(input.block);
      const b = await orBlockscout(input.network, () => chain.block(input.network, id), async () => eco.blockDetail(input.network, id === 'latest' ? (await eco.latest(input.network)).blocks[0].number : id));
      return { ...b, transactions: b.transactions.slice(0, 40), transactionsShown: Math.min(40, b.transactions.length) };
    }
    case 'get_transaction':
      return orBlockscout(input.network, () => chain.tx(input.network, input.hash), () => eco.txDetail(input.network, input.hash));
    case 'get_address': {
      const history = await eco.addressHistory(input.network, input.address);
      const a = await orBlockscout(
        input.network,
        async () => {
          const r = await chain.address(input.network, input.address);
          const tokens = await tokenUniverse(input.network);
          return { ...r, tokenBalances: await chain.tokenBalances(input.network, input.address, tokens).catch(() => []) };
        },
        () => eco.addressDetail(input.network, input.address),
      );
      return { ...a, recentTransactions: history ?? 'explorer API unavailable' };
    }
    case 'get_stock_tokens': {
      const { value } = await eco.stockTokens('mainnet');
      return { count: value.length, note: 'Market cap and holders are on-chain figures for the tokenized version, not the company.', tokens: value.slice(0, 60) };
    }
    case 'verify_token': {
      const { value } = await eco.verifyToken('mainnet', input.query);
      return { ...value, lookalikes: value.lookalikes.slice(0, 15) };
    }
    case 'get_ecosystem': {
      const [sum, prots, dex, fee, toks] = await Promise.allSettled([eco.chainSummary('mainnet'), eco.protocols('mainnet'), eco.dexVolume('mainnet'), eco.fees('mainnet'), eco.topTokens('mainnet')]);
      const v = (r) => val(r)?.value ?? (Array.isArray(val(r)) ? val(r) : null);
      const p = v(prots), d = v(dex), f = v(fee), t = val(toks);
      return {
        chain: v(sum) ?? 'unavailable',
        protocolCount: p?.length ?? 'unavailable',
        topProtocols: p ? p.slice(0, 20).map(({ name, category, chainTvl, url }) => ({ name, category, chainTvl, url })) : 'unavailable',
        dex: d ? { total24h: d.total24h, total7d: d.total7d, change1d: d.change1d, top: d.protocols.slice(0, 5) } : 'unavailable',
        fees: f ? { total24h: f.total24h, total7d: f.total7d } : 'unavailable',
        topTokensByHolders: t ? t.slice(0, 15).map(({ name, symbol, holders, marketCap, address }) => ({ name, symbol, holders, marketCap, address })) : 'unavailable',
      };
    }
  }
}

// RPC first; Blockscout when the RPC is unreachable.
async function orBlockscout(net, viaRpc, viaBlockscout) {
  try {
    return await viaRpc();
  } catch (err) {
    if (err.status !== 502 || !eco.blockscoutAvailable(net)) throw err;
    return viaBlockscout();
  }
}

// Tokens worth checking balances for: most-held (Blockscout) + most-active (indexer).
export async function tokenUniverse(net) {
  const out = new Set();
  try {
    for (const t of (await eco.topTokens(net)).slice(0, 30)) out.add(t.address.toLowerCase());
  } catch {
    /* Blockscout unavailable */
  }
  if (indexer.indexing(net)) for (const t of indexer.activeTokens(net, 24, 30)) out.add(t.address);
  return [...out].slice(0, 50);
}

async function execute(call, emit) {
  const bad = validate(call.name, call.input);
  if (bad) return { error: true, content: `Invalid input: ${bad}` };
  emit('status', { text: `${TOOL_LABEL[call.name]}…` });
  try {
    const out = await runTool(call.name, call.input);
    emit('tool', { name: call.name, input: call.input });
    return { error: false, content: JSON.stringify(out).slice(0, 60_000) };
  } catch (err) {
    return { error: true, content: err.message };
  }
}

// ---------------- Anthropic (Claude) ----------------

let anthropicClient;
async function runAnthropic(provider, messages, emit, signal) {
  anthropicClient ??= new Anthropic({ apiKey: provider.key });
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  const tools = [...TOOLS.map((t) => ({ ...t, eager_input_streaming: true })), ...(AI.webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] : [])];
  let jsonRetries = 0;
  for (let round = 0; round < 8 && !signal.aborted; round++) {
    const stream = anthropicClient.beta.messages.stream({
      model: provider.model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: AI.effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools,
      messages: msgs,
    });
    signal.addEventListener('abort', () => stream.abort(), { once: true });
    stream.on('text', (delta) => emit('text', { text: delta }));
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_start') return;
      const b = event.content_block;
      if (b.type === 'server_tool_use') emit('status', { text: 'Searching the web…' });
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) emit('sources', { items: b.content.filter((r) => r.type === 'web_search_result').slice(0, 6).map((r) => ({ title: r.title, url: r.url })) });
    });
    let final;
    try {
      final = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable tool input is retried; API errors propagate.
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }
    if (final.stop_reason === 'refusal') throw Object.assign(new Error('This request could not be answered. Try rephrasing it.'), { final: true });
    if (final.stop_reason === 'pause_turn') {
      msgs.push({ role: 'assistant', content: final.content });
      continue;
    }
    const uses = final.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return final.model;
    // A tool input cut off at max_tokens can still parse; never run it.
    if (final.stop_reason === 'max_tokens') throw Object.assign(new Error('The answer ran too long. Try a narrower question.'), { final: true });
    msgs.push({ role: 'assistant', content: final.content });
    const results = await Promise.all(uses.map(async (u) => ({ u, r: await execute({ name: u.name, input: u.input }, emit) })));
    // All results for one assistant turn go back in a single user message.
    msgs.push({ role: 'user', content: results.map(({ u, r }) => ({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.error ? { is_error: true } : {}) })) });
    emit('text', { text: '\n\n' });
  }
  return provider.model;
}

// ---------------- OpenAI-compatible (Gemini, OpenRouter) ----------------

const OPENAI_TOOLS = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

async function runCompatible(provider, messages, emit, signal) {
  const msgs = [{ role: 'system', content: SYSTEM }, ...messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map((c) => c.text).join('\n\n') : m.content }))];
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` };
  if (provider.name === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://getaeon.network', 'X-Title': 'Aeon Network' });
  for (let round = 0; round < 8 && !signal.aborted; round++) {
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: provider.model, messages: msgs, tools: OPENAI_TOOLS, tool_choice: 'auto' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const e = data.error || {};
      throw Object.assign(new Error(`${provider.label}: ${e.message || `HTTP ${res.status}`}`), { status: res.status >= 400 ? res.status : Number(e.code) || 502 });
    }
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw Object.assign(new Error(`${provider.label}: empty response`), { status: 502 });
    const text = Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : msg.content || '';
    if (msg.tool_calls?.length) {
      if (text.trim()) emit('text', { text: text + '\n\n' });
      // Push the assistant message back unchanged: Gemini attaches thought
      // signatures to tool calls that must be returned with the results.
      msgs.push(msg);
      for (const call of msg.tool_calls) {
        let input;
        try {
          input = JSON.parse(call.function?.arguments || '{}');
        } catch {
          msgs.push({ role: 'tool', tool_call_id: call.id, content: 'Invalid input: arguments were not valid JSON' });
          continue;
        }
        const r = await execute({ name: call.function.name, input }, emit);
        msgs.push({ role: 'tool', tool_call_id: call.id, content: r.content });
      }
      continue;
    }
    if (!text.trim()) throw Object.assign(new Error(`${provider.label}: no answer`), { status: 502 });
    emit('text', { text });
    if (choice.finish_reason === 'length') emit('status', { text: 'The answer was cut off because it ran too long.' });
    return data.model || provider.model;
  }
  return provider.model;
}

// Last outcome per provider, for the status page.
const providerHealth = {};
export const aiHealth = () => AI.providers.map((p) => ({ name: p.label, model: p.model, ...(providerHealth[p.name] || { lastOk: null, lastError: null }) }));
const markAi = (name, ok, error) => {
  const h = (providerHealth[name] ??= { lastOk: null, lastError: null });
  if (ok) h.lastOk = Date.now();
  else h.lastError = { at: Date.now(), message: String(error).slice(0, 200) };
};

// ---------------- HTTP handler ----------------

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const out = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const retryable = (err) => {
  if (err.final || err.name === 'AbortError') return false;
  const s = err.status ?? (err instanceof Anthropic.APIConnectionError ? 503 : 0);
  return !s || s === 401 || s === 402 || s === 403 || s === 404 || s === 408 || s === 429 || s >= 500;
};

export async function chat(req, res) {
  if (!AI.enabled) return res.status(503).json({ error: 'AI is not enabled: set GEMINI_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env and restart the server.' });
  const history = sanitizeHistory(req.body?.messages);
  if (!history.length || history.at(-1).role !== 'user') return res.status(400).json({ error: 'empty message' });
  const network = NETWORKS[req.body?.network] ? req.body.network : 'mainnet';
  const last = history.pop();
  const messages = [
    ...history,
    {
      role: 'user',
      content: [
        { type: 'text', text: `<context>The user is viewing ${NETWORKS[network].name} (${network}). Current time ${new Date().toISOString()}.</context>` },
        { type: 'text', text: last.content },
      ],
    },
  ];

  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  let answered = false;
  const emit = (type, data = {}) => {
    if (type === 'text' && data.text.trim()) answered = true;
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());

  let lastErr;
  providers: for (const provider of AI.providers) {
    // An overloaded provider (5xx) usually recovers within seconds: retry it once before failing over.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (ctrl.signal.aborted) break providers;
      try {
        emit('provider', { name: provider.label, model: provider.model });
        const model = provider.name === 'anthropic' ? await runAnthropic(provider, messages, emit, ctrl.signal) : await runCompatible(provider, messages, emit, ctrl.signal);
        markAi(provider.name, true);
        emit('done', { provider: provider.label, model });
        return res.end();
      } catch (err) {
        lastErr = err;
        if (err.name !== 'AbortError') markAi(provider.name, false, err.message);
        console.error(`[ai:${provider.name}]`, err.status || '', err.message);
        // Switching providers mid-answer would garble the reply; only retry or fail over before any text.
        if (answered || !retryable(err)) break providers;
        if (attempt === 0 && err.status >= 500) {
          emit('status', { text: `${provider.label} is busy, retrying…` });
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        emit('status', { text: `${provider.label} unavailable, trying another model…` });
        break;
      }
    }
  }
  if (!ctrl.signal.aborted) {
    let msg = lastErr?.final ? lastErr.message : 'AI is temporarily unavailable, please try again shortly.';
    if (lastErr?.status === 429) msg = 'All AI providers are rate-limited right now. Try again in a minute.';
    emit('error', { error: msg });
  }
  res.end();
}
