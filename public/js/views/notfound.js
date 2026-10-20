import { esc } from '../core.js';

export function render(main) {
  main.innerHTML = `
    <section class="box reveal" style="margin-top:24px">
      <div class="box-body" style="padding:48px 28px;display:grid;gap:14px;justify-items:start">
        <div class="kicker">Error 404</div>
        <div class="hero-block">Not found</div>
        <p class="muted" style="margin:0;max-width:520px">There is no page at <span class="mono">${esc(location.hash || '/')}</span>. It may have moved, or the link is mistyped. To look up a transaction, address or block, use the Explorer.</p>
        <div class="row wrap" style="gap:8px"><a class="btn btn-primary" href="#/">Back to Network</a><a class="btn" href="#/explorer">Open Explorer</a></div>
      </div>
    </section>`;
}
