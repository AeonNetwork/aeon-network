import { state, prefs, net, on, esc, toast, short, $ } from '../core.js';
import { markdown } from '../markdown.js';
import { getPass } from './ae.js';
import { startOrb } from '../orb.js';

const PROMPTS = [
  'Which new tokens are hot on Pons today? Scan the top one.',
  'Scan the AE token for risks and explain what you find.',
  'What are the whales buying and selling today? Open the biggest wallet.',
  'Give me today\'s network pulse in five bullets.',
  'Who holds the largest stock portfolio, and what is in it?',
  'What is happening on Robinhood Chain right now?',
  'Explain Robinhood Chain to a beginner: what it is and how it differs from Ethereum.',
  'How do I know a TSLA token is the official Robinhood one?',
];

const TOOL_NAMES = { get_network_overview: 'network state', get_block: 'block', get_transaction: 'transaction', get_address: 'address', get_ecosystem: 'ecosystem', get_stock_tokens: 'stock tokens', verify_token: 'token check', scan_token: 'safety scan', get_whales: 'whales', get_portfolio: 'portfolio', get_leaderboard: 'leaderboard', get_network_pulse: 'network pulse', get_aeon_token: 'AE token', get_new_tokens: 'token radar' };
// Where a step's result lives on the site, so the user can open it.
const STEP_PAGE = {
  scan_token: (i) => `#/scan/${i.address}`,
  get_portfolio: (i) => `#/portfolio/${i.address}`,
  get_whales: () => '#/whales',
  get_leaderboard: () => '#/leaderboard',
  get_network_pulse: () => '#/pulse',
  get_aeon_token: () => '#/ae',
  get_new_tokens: () => '#/radar',
  get_transaction: (i) => `#/explorer/tx/${i.hash}`,
  get_address: (i) => `#/explorer/address/${i.address}`,
  get_block: (i) => (i.block === 'latest' ? null : `#/explorer/block/${i.block}`),
};
const target = (i = {}) => (i.hash ? ' ' + short(i.hash, 8) : i.address ? ' ' + short(i.address, 6) : i.block ? ' #' + i.block : i.query ? ' ' + i.query : i.symbol ? ' ' + i.symbol : '');
const MARK = { run: '<span class="ag-spin"></span>', ok: '✓', err: '✕' };
const steps = (list) =>
  list.length
    ? `<div class="agent"><div class="agent-head">Agent · ${list.length} step${list.length > 1 ? 's' : ''}</div>${list
        .map((st) => {
          const href = STEP_PAGE[st.name]?.(st.input || {});
          return `<div class="ag-step ag-${st.state || 'ok'}"><span class="ag-mark">${MARK[st.state || 'ok']}</span><span class="ag-name">${esc(st.label || TOOL_NAMES[st.name] || st.name)}${esc(target(st.input))}</span><span class="ag-sum">${esc(st.summary || (st.state === 'run' ? 'working…' : ''))}</span><span class="ag-meta">${st.ms >= 100 ? (st.ms / 1000).toFixed(1) + 's' : ''}${href && st.state === 'ok' ? ` <a class="link" href="${esc(href)}">open ↗</a>` : ''}</span></div>`;
        })
        .join('')}</div>`
    : '';
const chip = (t) => {
  const i = t.input || {};
  const target = i.hash ? ' ' + short(i.hash, 8) : i.address ? ' ' + short(i.address, 6) : i.block ? ' #' + i.block : i.query ? ' ' + i.query : '';
  return `<span class="tag">read ${esc(TOOL_NAMES[t.name] || t.name)}${esc(target)}</span>`;
};

export function render(main) {
  const enabled = state.config.ai.enabled;
  let history = prefs.get('ai-net-history', []);
  const prefill = state.aiPrompt || '';
  state.aiPrompt = null;
  let ctrl = null;
  let orb = null;

  main.innerHTML = `
  <div class="page-head"><div><div class="kicker">${esc(net().name)} · AI Agent</div><h1>Aeon AI Agent</h1></div><span class="dim" style="font-size:12px">${state.config.ai.providers.length ? 'Models: ' + state.config.ai.providers.map((p) => esc(p.name)).join(' → ') : 'Scans tokens, follows whales, opens wallets and reads the chain live'}</span></div>
  <div class="ai">
    <div class="box ai-side reveal">
      <div class="box-head">Try asking</div>
      ${PROMPTS.map((p) => `<button class="prompt-btn" data-p="${esc(p)}">${esc(p)}</button>`).join('')}
    </div>
    <div class="box chat reveal">
      <div class="box-head">Conversation<span class="right"><button class="btn btn-sm" id="clear">Reset</button></span></div>
      <div class="chat-log" id="log"></div>
      <div class="chat-input">
        <textarea class="input" id="msg" rows="1" placeholder="${enabled ? 'Ask anything, or paste a tx hash / address / block number…' : 'AI is not enabled'}" ${enabled ? '' : 'disabled'}></textarea>
        <button class="btn btn-primary" id="send" ${enabled ? '' : 'disabled'}>Send</button>
      </div>
    </div>
  </div>`;

  const log = $('#log', main), input = $('#msg', main), send = $('#send', main);

  const empty = () => `
    <div class="empty-ai">
      ${enabled ? '<div class="orb" aria-hidden="true"></div>' : ''}
      <h3>${enabled ? 'An agent that works the chain for you' : 'Network AI is not enabled yet'}</h3>
      <p>${enabled ? 'Ask it to scan a token, follow the whales, open a wallet or explain a transaction. It runs the checks itself, step by step, and shows its work.' : 'Set <code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in the server’s <code>.env</code> file and restart the server.'}</p></div>`;

  const bubble = (m) =>
    m.role === 'user'
      ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg bot"><div class="av"></div><div>${m.steps?.length ? steps(m.steps) : m.tools?.length ? `<div class="tools-used">${m.tools.map(chip).join('')}</div>` : ''}<div class="md">${markdown(m.content)}</div>${m.by ? `<div class="dim" style="font-size:11px;margin-top:6px">answered by ${esc(m.by)}</div>` : ''}${m.sources?.length ? `<div class="sources">${m.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">↗ ${esc(s.title)}</a>`).join('')}</div>` : ''}</div></div>`;
  const paint = () => {
    orb?.destroy();
    orb = null;
    log.innerHTML = history.length ? history.map(bubble).join('') : empty();
    const el = log.querySelector('.orb');
    if (el) orb = startOrb(el);
    log.scrollTop = log.scrollHeight;
  };
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(160, input.scrollHeight) + 'px';
  };

  async function ask(text) {
    text = text.trim();
    if (!text || ctrl || !enabled) return;
    ctrl = new AbortController();
    if (orb) {
      await orb.collapse();
      orb.destroy();
      orb = null;
    }
    history.push({ role: 'user', content: text });
    if (log.querySelector('.empty-ai')) log.innerHTML = '';
    log.insertAdjacentHTML('beforeend', bubble(history.at(-1)));
    const bot = document.createElement('div');
    bot.className = 'msg bot thinking';
    bot.innerHTML = '<div class="av"></div><div><div class="tools-used"></div><div class="ai-status">Thinking…</div><div class="md"></div></div>';
    log.append(bot);
    log.scrollTop = log.scrollHeight;
    input.value = '';
    autosize();
    send.textContent = 'Stop';

    let full = '';
    const sources = [];
    const tools = [];
    const agentSteps = [];
    let by = '';
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(getPass() ? { 'x-aeon-pass': getPass().pass } : {}) },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), network: state.network }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const md = bot.querySelector('.md'), status = bot.querySelector('.ai-status'), chips = bot.querySelector('.tools-used');
      let raf = 0;
      const repaint = () => {
        raf = 0;
        md.innerHTML = markdown(full.trim()) + '<span class="caret"></span>';
        if (log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const part = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!part.startsWith('data: ')) continue;
          const ev = JSON.parse(part.slice(6));
          if (ev.type === 'text') {
            full += ev.text;
            if (full.trim()) {
              status.textContent = '';
              bot.classList.remove('thinking');
            }
            raf ||= requestAnimationFrame(repaint);
          } else if (ev.type === 'status') status.textContent = ev.text;
          else if (ev.type === 'step') {
            const i = agentSteps.findIndex((x) => x.id === ev.id);
            const st = { id: ev.id, name: ev.name, input: ev.input, label: ev.label, state: ev.state, ms: ev.ms, summary: ev.summary };
            if (i >= 0) agentSteps[i] = st;
            else agentSteps.push(st);
            chips.innerHTML = steps(agentSteps);
            if (log.scrollHeight - log.scrollTop - log.clientHeight < 200) log.scrollTop = log.scrollHeight;
          } else if (ev.type === 'tool') {
            tools.push({ name: ev.name, input: ev.input });
            chips.innerHTML = tools.map(chip).join('');
          } else if (ev.type === 'provider') {
            status.textContent = `Asking ${ev.name}…`;
          } else if (ev.type === 'done') {
            by = `${ev.provider} · ${ev.model}`;
          } else if (ev.type === 'sources') {
            for (const s of ev.items) if (!sources.some((x) => x.url === s.url)) sources.push(s);
          } else if (ev.type === 'error') throw new Error(ev.error);
        }
      }
      if (!full.trim()) throw new Error('No response.');
      history.push({ role: 'assistant', content: full.trim(), sources, tools, steps: agentSteps, by });
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
      if (full.trim()) history.push({ role: 'assistant', content: full.trim() + (err.name === 'AbortError' ? '\n\n_(stopped)_' : ''), sources, tools, steps: agentSteps });
      else history.pop();
    } finally {
      ctrl = null;
      send.textContent = 'Send';
      history = history.slice(-30);
      prefs.set('ai-net-history', history);
      paint();
    }
  }

  send.addEventListener('click', () => (ctrl ? ctrl.abort() : ask(input.value)));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener('input', () => (autosize(), orb?.key()));
  const off = on('block', ({ network }) => network === state.network && orb?.block());
  main.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.p)));
  $('#clear', main).addEventListener('click', () => {
    ctrl?.abort();
    history = [];
    prefs.set('ai-net-history', []);
    paint();
  });

  paint();
  if (prefill && enabled) {
    input.value = prefill;
    autosize();
    input.focus();
  }
  return () => {
    ctrl?.abort();
    orb?.destroy();
    off();
  };
}
