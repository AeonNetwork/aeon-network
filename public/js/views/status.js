import { api, esc, ago, fmtInt, fmtNum, $ } from '../core.js';

export function render(main) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="kicker">Aeon Network · Transparency</div><h1>System status</h1></div>
      <span class="dim" style="font-size:12px" id="stUpdated">Loading…</span>
    </div>
    <div class="box reveal" id="stBanner"><div class="box-body"><div class="metric-val" style="font-size:20px">Checking…</div></div></div>
    <div class="box reveal mt"><div class="box-head">Data sources<span class="right dim">bars = last 60 minutes, one probe per minute</span></div><div id="stChecks"><div class="empty">Loading…</div></div></div>
    <section class="grid g-2 mt">
      <div class="box reveal"><div class="box-head">Indexer</div><div id="stIndexer"><div class="empty">Loading…</div></div></div>
      <div class="box reveal"><div class="box-head">Network AI providers</div><div id="stAi"><div class="empty">Loading…</div></div></div>
    </section>
    <div class="box reveal mt"><div class="box-head">How to verify Aeon's data yourself</div><div class="box-body prose" style="padding:0 14px 14px">
      <ul>
        <li>Every block, transaction and address page has a <b>Cross-check</b> panel: the same object is read from the Robinhood Chain RPC and from Blockscout, and each field is compared.</li>
        <li>Every on-chain item links to <b>Blockscout</b>, an independent explorer, so you can open the same record there.</li>
        <li>The raw JSON behind every page is public: see the <a href="#/docs/api">API reference</a>. Responses carry <code>x-data-at</code> and <code>x-data-stale</code> headers.</li>
        <li>Numbers that are estimates (TPS, transactions per minute) are labelled as estimates.</li>
      </ul></div></div>`;

  const bars = (h) => {
    const cells = Array.from({ length: 60 }, (_, i) => h[h.length - 60 + i]);
    return `<div style="display:flex;gap:2px;height:22px;align-items:stretch">${cells.map((v) => `<i style="flex:1;min-width:2px;background:${v === 1 ? 'var(--ink)' : v === 0 ? 'transparent' : 'rgba(255,255,255,0.08)'};${v === 0 ? 'border:1px solid var(--ink-2)' : ''}" title="${v === 1 ? 'up' : v === 0 ? 'down' : 'no data'}"></i>`).join('')}</div>`;
  };
  const state = (ok) => (ok === true ? '<span class="tag solid">OPERATIONAL</span>' : ok === false ? '<span class="tag">⚠ DOWN</span>' : '<span class="tag">NO DATA YET</span>');

  const load = async () => {
    let s;
    try {
      s = await api('/status');
    } catch (err) {
      $('#stBanner', main).innerHTML = `<div class="box-body"><div class="metric-val" style="font-size:20px">Status unavailable</div><div class="metric-sub">${esc(err.message)}</div></div>`;
      return;
    }
    const down = s.checks.filter((c) => c.ok === false);
    $('#stBanner', main).innerHTML = `<div class="box-body row between wrap"><div><div class="metric-val" style="font-size:22px">${down.length ? `${down.length} source${down.length > 1 ? 's' : ''} degraded` : 'All systems operational'}</div><div class="metric-sub">${down.length ? 'Pages fall back to other sources or show “unavailable” instead of guessing.' : 'Every data source answered its last check.'}</div></div><div class="mono dim" style="font-size:12px">Server up ${fmtNum(s.server.uptimeSec / 3600, 1)} h · ${esc(s.server.node)}</div></div>`;
    $('#stChecks', main).innerHTML = s.checks
      .map(
        (c) => `<div style="padding:14px;border-bottom:1px solid var(--line)">
          <div class="row between wrap" style="margin-bottom:10px"><div><b style="font-weight:500">${esc(c.label)}</b> <span class="dim" style="font-size:12px">· ${esc(c.kind)}</span></div>
          <div class="row" style="gap:10px">${c.latencyMs != null ? `<span class="mono dim" style="font-size:12px">${fmtInt(c.latencyMs)} ms</span>` : ''}${c.uptime != null ? `<span class="mono dim" style="font-size:12px">${fmtNum(c.uptime * 100, 1)}% up</span>` : ''}${state(c.ok)}</div></div>
          ${c.history.length ? bars(c.history) : ''}
          <div class="dim" style="font-size:12px;margin-top:8px">Last success: ${c.lastOk ? ago(c.lastOk) : '—'}${c.lastError ? ` · Last error ${ago(c.lastError.at)}: ${esc(c.lastError.message)}` : ''}</div>
        </div>`,
      )
      .join('');
    $('#stIndexer', main).innerHTML = `<dl class="kv">${Object.entries(s.indexer)
      .map(([n, i]) => `<dt>${esc(n)}</dt><dd>${i.source ? esc(i.source.toUpperCase()) : '—'} · ${esc(i.mode)} mode · ${fmtInt(i.blocksIndexed)} blocks read · latest block ${i.lagSec != null ? `${fmtNum(i.lagSec, 1)} s old` : '—'}</dd>`)
      .join('')}${Object.entries(s.rpcEndpoints)
      .map(([n, h]) => `<dt>RPC ${esc(n)}</dt><dd>${h.ok ? `${esc(h.endpoint)} · ${h.latency} ms` : esc(h.error || 'not checked yet')}</dd>`)
      .join('')}</dl>`;
    $('#stAi', main).innerHTML = s.ai.length
      ? `<dl class="kv">${s.ai.map((p) => `<dt>${esc(p.name)}</dt><dd>${esc(p.model)}<br><span class="dim" style="font-family:var(--font);font-size:12px">${p.lastOk ? `answered ${ago(p.lastOk)}` : 'no answers since restart'}${p.lastError ? ` · last error ${ago(p.lastError.at)}: ${esc(p.lastError.message)}` : ''}</span></dd>`).join('')}</dl>`
      : '<div class="empty">No AI provider configured.</div>';
    $('#stUpdated', main).textContent = `Updated ${new Date(s.now).toLocaleTimeString('en-US')} · refreshes every 15 s`;
  };
  load();
  const t = setInterval(load, 15_000);
  return () => clearInterval(t);
}
