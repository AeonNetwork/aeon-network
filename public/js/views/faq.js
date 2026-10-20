import { esc } from '../core.js';
import { FAQ } from '../faq-data.js';

export function render(main) {
  main.innerHTML = `
    <div class="page-head"><div><div class="kicker">Aeon Network · Help</div><h1>Frequently asked questions</h1></div><a class="btn btn-sm" href="#/docs">Read the docs</a></div>
    <div class="box faq reveal">${FAQ.map((f, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(f.q)}</summary><div class="answer">${f.a}</div></details>`).join('')}</div>
    <div class="box reveal mt"><div class="box-body row between wrap"><span class="muted">Still have a question? The Network AI can look things up on the chain for you.</span><a class="btn btn-primary" href="#/ai">Ask the AI</a></div></div>`;
}
