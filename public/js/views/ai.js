import { state, prefs, net, on, esc, toast, short, $ } from '../core.js';
import { markdown } from '../markdown.js';
import { getPass } from './ae.js';
import { startOrb } from '../orb.js';

const PROMPTS = [
  'What is happening on Robinhood Chain right now?',
  'Explain Robinhood Chain to a beginner: what it is and how it differs from Ethereum.',
  'Which protocols hold the most value on Robinhood Chain?',
  'Which tokenized stocks have the most holders on Robinhood Chain?',
  'How do I know a TSLA token is the official Robinhood one?',
  'How much does a transaction cost right now?',
];

const TOOL_NAMES = { get_network_overview: 'network state', get_block: 'block', get_transaction: 'transaction', get_address: 'address', get_ecosystem: 'ecosystem', get_stock_tokens: 'stock tokens', verify_token: 'token check' };
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
  <div class="page-head"><div><div class="kicker">${esc(net().name)} · Network AI</div><h1>Ask the network</h1></div><span class="dim" style="font-size:12px">${state.config.ai.providers.length ? 'Models: ' + state.config.ai.providers.map((p) => esc(p.name)).join(' → ') : 'Reads blocks, transactions, addresses and ecosystem data live'}</span></div>
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
      <h3>${enabled ? 'Ask anything about Robinhood Chain' : 'Network AI is not enabled yet'}</h3>
      <p>${enabled ? 'Paste a transaction hash, an address or a block number and the AI will look it up on-chain and explain it in plain language.' : 'Set <code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in the server’s <code>.env</code> file and restart the server.'}</p></div>`;

  const bubble = (m) =>
    m.role === 'user'
      ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg bot"><div class="av"></div><div>${m.tools?.length ? `<div class="tools-used">${m.tools.map(chip).join('')}</div>` : ''}<div class="md">${markdown(m.content)}</div>${m.by ? `<div class="dim" style="font-size:11px;margin-top:6px">answered by ${esc(m.by)}</div>` : ''}${m.sources?.length ? `<div class="sources">${m.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">↗ ${esc(s.title)}</a>`).join('')}</div>` : ''}</div></div>`;
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
          else if (ev.type === 'tool') {
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
      history.push({ role: 'assistant', content: full.trim(), sources, tools, by });
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
      if (full.trim()) history.push({ role: 'assistant', content: full.trim() + (err.name === 'AbortError' ? '\n\n_(stopped)_' : ''), sources, tools });
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
