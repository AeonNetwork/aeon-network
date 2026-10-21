import { state, api, netApi, net, on, esc, verifyLink, fmtInt, fmtNum, fmtUsd, fmtCompact, fmtPct, gwei, ago, fromWei, addrLink, txLink, link, short, $ } from '../core.js';
import { odometer, flash, reveal } from '../fx.js';
import { timeChart } from '../charts.js';
import { addNetwork } from '../wallet.js';
import { FAQ } from '../faq-data.js';
import { startRing } from '../ring.js';

export function render(main) {
  let dispose = mount(main);
  const off = on('network', () => {
    dispose();
    main.innerHTML = '';
    dispose = mount(main);
    reveal(main);
  });
  return () => {
    off();
    dispose();
  };
}

function mount(main) {
  const n = net();
  const isMain = state.network === 'mainnet';
  main.innerHTML = `
  <section class="box hero reveal">
    <div class="hero-main">
      <div>
        <a class="whatsnew" href="#/scan"><span>NEW</span>Token Safety Scanner and the Aeon AI Agent · scan a token →</a>
        <div class="kicker">${esc(n.name)} · ${isMain ? 'Mainnet' : 'Testnet'} · Chain ID ${n.chainId}</div>
        <div class="hero-block mt" id="hBlock">#—</div>
        <p class="hero-title">The live hub for Robinhood Chain. Every block, transaction and protocol, as it happens.</p>
        <div class="hero-cta"><a class="btn btn-primary" href="#/portfolio">Track your stocks</a><a class="btn" href="#/whales">Follow the whales</a><a class="btn" href="#/ai">Ask the chain</a></div>
      </div>
      <div class="hero-stats">
        <div><span>Block time</span><b id="hBt">—</b></div>
        <div><span>TPS</span><b id="hTps">—</b></div>
        <div><span>Gas</span><b id="hGas">—</b></div>
        <div><span>Feed</span><b id="hSrc">—</b></div>
      </div>
    </div>
    <div class="hero-ring" id="ring" role="img" aria-label="Robinhood Chain as a ring: each new block grows a branch sized by its transactions"></div>
  </section>

  <section class="grid g-4 mt">
    ${metric('mTps', 'TPS', 'Transactions per second')}
    ${metric('mToday', 'Transactions · last day', 'Daily total · Blockscout')}
    ${metric('mTotal', 'Total transactions', 'All time · Blockscout')}
    ${metric('mAddr', 'Total addresses', 'All time · Blockscout')}
    ${metric('mGas', 'Gas price', 'Cost of an ETH transfer')}
    ${metric('mBlocks', 'Total blocks', 'All time · Blockscout')}
    ${metric('mTvl', 'Total value locked', isMain ? 'DefiLlama' : 'Mainnet only')}
    ${metric('mDex', 'DEX volume · 24h', isMain ? 'DefiLlama' : 'Mainnet only')}
  </section>
  <div class="dim mt" style="font-size:12px" id="coverage"></div>

  <section class="box reveal mt">
    <div class="box-head">How it works<span class="right"><a class="btn btn-sm" href="#/docs">Read the docs</a></span></div>
    <div class="steps">
      <div class="step"><div class="n">01 · READ</div><h3>Read the chain</h3><p>Aeon's indexer reads Robinhood Chain over RPC every few seconds: new blocks, transactions, gas and the contracts being called.</p><span class="arrow">→</span></div>
      <div class="step"><div class="n">02 · ENRICH</div><h3>Add the context</h3><p>Blockscout adds all-time totals, token and stock data; DefiLlama adds TVL, DEX volume and fees across the ecosystem.</p><span class="arrow">→</span></div>
      <div class="step"><div class="n">03 · STREAM</div><h3>Push it live</h3><p>One server serves everyone. Fresh blocks and transactions are pushed to your screen the moment they land, no refresh needed.</p><span class="arrow">→</span></div>
      <div class="step"><div class="n">04 · VERIFY</div><h3>Explain & verify</h3><p>Check whether a stock token is official, inspect any address, watch wallets, or ask the Network AI to explain a transaction.</p></div>
    </div>
    <div class="flow"><span class="tag">Robinhood Chain</span>→<span>RPC · Blockscout · DefiLlama</span>→<span class="tag">Aeon server</span><span>cache + indexer</span>→<span class="tag">You</span><span>live pages · Network AI · Aeon RPC</span></div>
  </section>

  <section class="grid g-2 mt">
    <div class="box reveal"><div class="box-head">Daily transactions<span class="right dim">Blockscout · last 30 days</span></div><div class="box-body"><div class="chart" id="cDaily"></div></div></div>
    <div class="box reveal"><div class="box-head">Transactions per minute<span class="right dim" id="cMinInfo">live · last 60 min</span></div><div class="box-body"><div class="chart" id="cMin"></div></div></div>
  </section>

  <section class="grid g-2 mt">
    <div class="box reveal"><div class="box-head"><span id="fbHead">Latest blocks</span><span class="right"><a class="btn btn-sm" href="#/explorer">Explorer</a></span></div><div class="feed" id="fBlocks"><div class="empty">Waiting for blocks…</div></div></div>
    <div class="box reveal"><div class="box-head"><span id="ftHead">Latest transactions</span><span class="right dim">live</span></div><div class="feed" id="fTxs"><div class="empty">Waiting for transactions…</div></div></div>
  </section>

  <section class="grid g-main mt">
    <div class="box reveal"><div class="box-head">Most called contracts<span class="right dim" id="contractsInfo">share of calls</span></div><div class="table-wrap" id="contracts"><div class="empty">Collecting activity…</div></div></div>
    <div class="grid" style="align-content:start">
    <div class="box reveal">
      <div class="box-head">Gas tracker<span class="right dim" id="gasInfo">Blockscout</span></div>
      <div class="grid g-3" style="gap:0" id="gasTiers"></div>
      <div class="table-wrap" id="gasCosts"><div class="empty">Loading…</div></div>
      <div class="box-foot">Estimates from typical gas usage. Arbitrum chains add an L1 data fee, so real costs can be slightly higher.</div>
    </div>
    <div class="box reveal">
      <div class="box-head">Network details</div>
      <dl class="kv">
        <dt>Network</dt><dd>${esc(n.name)}</dd>
        <dt>Chain ID</dt><dd>${n.chainId} · 0x${n.chainId.toString(16)}</dd>
        <dt>Stack</dt><dd>Arbitrum Orbit · Ethereum L2</dd>
        <dt>Gas token</dt><dd>${esc(n.currency.symbol)}</dd>
        <dt>Official RPC</dt><dd>${esc(n.rpc)}</dd>
        <dt>Aeon RPC</dt><dd>${esc(location.origin)}/rpc/${state.network} <span class="dim" style="font-family:var(--font)">· works where the official domain is blocked</span></dd>
        <dt>Explorer</dt><dd><a class="link" href="${esc(n.explorer)}" target="_blank" rel="noopener noreferrer">${esc(n.explorer.replace(/^https?:\/\//, ''))} ↗</a></dd>
      </dl>
      <div class="box-foot row wrap"><button class="btn btn-sm btn-primary" id="addNet">Add to wallet</button>${n.faucet ? `<a class="btn btn-sm" href="${esc(n.faucet)}" target="_blank" rel="noopener noreferrer">Testnet faucet ↗</a>` : ''}</div>
    </div>
    </div>
  </section>

  <section class="grid g-main mt">
    <div class="box faq reveal"><div class="box-head">Questions<span class="right"><a class="btn btn-sm" href="#/faq">All FAQ</a></span></div>${FAQ.filter((f) => f.top).map((f) => `<details><summary>${esc(f.q)}</summary><div class="answer">${f.a}</div></details>`).join('')}</div>
    <div class="box reveal"><div class="box-head">Start here</div><div class="box-body grid" style="gap:8px">
      <a class="btn btn-primary" href="#/stocks">Verify a stock token</a>
      <a class="btn" href="#/check">Run a wallet check</a>
      <a class="btn" href="#/status">See live system status</a>
      <a class="btn" href="#/explorer">Search the chain</a>
      <a class="btn" href="#/ai">Ask the Network AI</a>
      <a class="btn" href="#/docs/wallet">Add the network to your wallet</a>
    </div></div>
  </section>`;

  const timers = [];
  const offs = [];
  const charts = [];
  const $m = (id) => $(`#${id} .metric-val`, main);
  const $s = (id) => $(`#${id} .metric-sub`, main);
  const setMetric = (id, text) => {
    const el = $m(id);
    if (el.textContent !== text) {
      el.textContent = text;
      flash(el);
    }
  };
  $('#addNet', main).addEventListener('click', () => addNetwork(state.network));

  // ---------- live block-level numbers ----------
  let stats = null; // Blockscout totals
  let pulse = null; // indexer summary
  const paintRates = () => {
    const bt = pulse?.blockTime ?? (stats?.averageBlockTimeMs ? stats.averageBlockTimeMs / 1000 : null);
    $('#hBt', main).textContent = bt ? (bt < 1 ? `${(bt * 1000).toFixed(0)} ms` : `${bt.toFixed(2)} s`) : '—';
    // Live TPS from the indexer; otherwise today's average from Blockscout.
    let tps = pulse?.tps;
    let tpsNote = pulse?.source === 'blockscout' ? 'Live estimate from latest blocks' : pulse?.mode === 'sample' ? 'Live estimate from sampled blocks' : 'Live, last 2 minutes';
    if (tps == null && stats?.transactionsToday) {
      tps = stats.transactionsToday / 86400;
      tpsNote = 'Last day average · Blockscout';
    }
    $('#hTps', main).textContent = tps != null ? fmtNum(tps, 1) : '—';
    if (tps != null) setMetric('mTps', fmtNum(tps, 1));
    $s('mTps').textContent = tpsNote;
    const sampled = pulse?.mode === 'sample' || pulse?.source === 'blockscout';
    const every = pulse?.source === 'blockscout' ? '~15 s' : '~3 s';
    $('#fbHead', main).textContent = sampled ? `Latest blocks · sampled every ${every}` : 'Latest blocks';
    $('#ftHead', main).textContent = sampled ? 'Latest transactions · from sampled blocks' : 'Latest transactions';
    const src = pulse?.source;
    $('#hSrc', main).textContent = src === 'rpc' ? 'RPC' : src === 'blockscout' ? 'Blockscout' : '—';
    if (pulse) {
      $('#coverage', main).textContent =
        src === 'blockscout'
          ? 'Live feed from Blockscout (the RPC is unreachable from the server). Totals from Blockscout; ecosystem from DefiLlama.'
          : `Live rates from Aeon's indexer (${pulse.mode} mode): ${fmtInt(pulse.blocksIndexed)} blocks read since ${new Date(pulse.indexedSince).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Totals from Blockscout; ecosystem from DefiLlama.`;
    }
  };

  let gasSet = false;
  const paintGas = (wei, from) => {
    const fee = (21000 * wei) / 1e18;
    $('#hGas', main).textContent = `${gwei(wei)} gwei`;
    $m('mGas').textContent = `${gwei(wei)} gwei`;
    $s('mGas').textContent = `ETH transfer ≈ ${state.ethUsd ? fmtUsd(fee * state.ethUsd, 4) : fmtNum(fee, 8) + ' ETH'} · ${from}`;
  };

  // Typical gas units for common actions.
  const ACTIONS = [['Send ETH', 21_000], ['Transfer a token', 65_000], ['Approve a token', 46_000], ['Swap on a DEX', 180_000], ['Mint an NFT', 120_000], ['Deploy a contract', 1_500_000]];
  const paintGasTracker = (g) => {
    if (!g) return void ($('#gasCosts', main).innerHTML = '<div class="empty">Gas data unavailable.</div>');
    $('#gasTiers', main).innerHTML = [['Slow', g.slow], ['Standard', g.average], ['Fast', g.fast]]
      .map(([l, v], i) => `<div style="padding:12px 14px;${i ? 'border-left:1px solid var(--line);' : ''}border-bottom:1px solid var(--line)"><div class="kicker">${l}</div><div class="mono" style="font-size:18px;margin-top:4px">${v != null ? v : '—'}<span class="dim" style="font-size:11px"> gwei</span></div></div>`)
      .join('');
    const price = (g.average ?? g.fast ?? 0) * 1e9;
    $('#gasCosts', main).innerHTML = `<table class="tbl"><thead><tr><th>Action</th><th class="num">Gas</th><th class="num">Cost</th></tr></thead><tbody>${ACTIONS.map(([a, units]) => {
      const eth = (units * price) / 1e18;
      return `<tr><td>${a}</td><td class="num">${fmtCompact(units)}</td><td class="num">${state.ethUsd ? fmtUsd(eth * state.ethUsd, eth * state.ethUsd < 0.01 ? 5 : 3) : fmtNum(eth, 8) + ' ETH'}</td></tr>`;
    }).join('')}</tbody></table>`;
  };

  const loadStats = () =>
    netApi('/stats')
      .then((s) => {
        stats = s;
        setMetric('mToday', fmtInt(s.transactionsToday));
        $s('mToday').innerHTML = `Daily total · Blockscout · ${verifyLink('stats')}`;
        setMetric('mTotal', fmtCompact(s.totalTransactions));
        $s('mTotal').innerHTML = `${fmtInt(s.totalTransactions)} · Blockscout · ${verifyLink('stats')}`;
        setMetric('mAddr', fmtCompact(s.totalAddresses));
        $s('mAddr').innerHTML = `${fmtInt(s.totalAddresses)} · Blockscout · ${verifyLink('stats')}`;
        setMetric('mBlocks', fmtCompact(s.totalBlocks));
        $s('mBlocks').innerHTML = `${fmtInt(s.totalBlocks)} · Blockscout · ${verifyLink('blocks')}`;
        if (!gasSet && s.gasPrices?.average != null) paintGas(s.gasPrices.average * 1e9, 'Blockscout');
        paintGasTracker(s.gasPrices);
        paintRates();
      })
      .catch(() => ['mToday', 'mTotal', 'mAddr', 'mBlocks'].forEach((id) => ($s(id).textContent = 'Blockscout unavailable')));
  loadStats();
  timers.push(setInterval(loadStats, 60_000));

  const loadOverview = () =>
    netApi('/overview')
      .then((o) => {
        if (o.block) odometer($('#hBlock', main), '#' + o.block.toLocaleString('en-US'));
        if (o.gasPrice != null) {
          gasSet = true;
          paintGas(o.gasPrice, 'RPC');
        }
        if (o.indexer) {
          pulse = o.indexer;
          paintRates();
        }
      })
      .catch(() => {});
  loadOverview();
  timers.push(setInterval(loadOverview, 15_000));

  if (isMain) {
    api('/ecosystem/mainnet/summary').then((c) => {
      $m('mTvl').textContent = fmtUsd(c.tvl);
      $s('mTvl').innerHTML = `#${c.rank} of ${c.chains} chains · <a class="link" href="https://defillama.com/chain/Robinhood%20Chain" target="_blank" rel="noopener noreferrer">DefiLlama ↗</a>`;
    }).catch(() => ($s('mTvl').textContent = 'Unavailable'));
    api('/ecosystem/mainnet/dex').then((d) => {
      $m('mDex').textContent = fmtUsd(d.total24h);
      $s('mDex').innerHTML = `${fmtPct(d.change1d)} vs yesterday · <a class="link" href="https://defillama.com/chain/Robinhood%20Chain" target="_blank" rel="noopener noreferrer">DefiLlama ↗</a>`;
    }).catch(() => ($s('mDex').textContent = 'Unavailable'));
  }

  // ---------- charts ----------
  netApi('/tx-history')
    .then((rows) => charts.push(timeChart($('#cDaily', main), rows.slice(-30), { type: 'bar', format: (v) => fmtCompact(v), label: 'Daily transactions, last 30 days' })))
    .catch(() => ($('#cDaily', main).innerHTML = '<div class="empty">Blockscout unavailable</div>'));
  const cMin = timeChart($('#cMin', main), [], { type: 'bar', timeFormat: 'minute', format: (v) => fmtCompact(v), label: 'Transactions per minute' });
  charts.push(cMin);
  const loadActivity = () =>
    netApi('/activity?minutes=60')
      .then((rows) => {
        const seen = rows.filter((r) => r.blocks > 0);
        cMin.update(seen.map((r) => ({ t: r.t, v: r.txs })));
        $('#cMinInfo', main).textContent = !seen.length ? 'needs RPC access' : seen[0].estimated ? 'estimated from sampled blocks' : 'live · last 60 min';
      })
      .catch(() => {});
  loadActivity();
  timers.push(setInterval(loadActivity, 30_000));

  // ---------- live feeds ----------
  const ring = startRing($('#ring', main));
  const blockRow = (b, fresh) => `
    <div class="feed-row ${fresh ? 'new' : ''}">
      <div class="cube">${String(b.number).slice(-3)}</div>
      <div class="main"><a href="${link.block(b.number)}"><b>#${b.number.toLocaleString('en-US')}</b></a><span>${b.txs} txs · ${fmtCompact(b.gasUsed)} gas${b.baseFee != null ? ` · ${gwei(b.baseFee)} gwei` : ''}</span></div>
      <span class="dim mono" data-time="${b.time}">${ago(b.time)}</span>
    </div>`;
  const txRow = (t, fresh) => `
    <div class="feed-row ${fresh ? 'new' : ''}">
      <div class="cube">${t.status === 'failed' ? '✕' : 'TX'}</div>
      <div class="main">${txLink(t.hash, 12)}<span>${esc(short(t.from, 6))} → ${t.to ? esc(short(t.to, 6)) : 'new contract'} · ${esc(t.method)}</span></div>
      <span class="mono">${t.valueWei && t.valueWei !== '0' ? fromWei(t.valueWei, 18, 4) + ' ETH' : '<span class="dim">0 ETH</span>'}</span>
    </div>`;

  let blocks = [];
  let txs = [];
  const paintFeeds = (freshBlock, freshTxs = 0) => {
    $('#fBlocks', main).innerHTML = blocks.length ? blocks.slice(0, 8).map((b, i) => blockRow(b, freshBlock && i === 0)).join('') : '<div class="empty">Waiting for blocks…</div>';
    $('#fTxs', main).innerHTML = txs.length ? txs.slice(0, 8).map((t, i) => txRow(t, i < freshTxs)).join('') : '<div class="empty">Waiting for transactions…</div>';
  };
  netApi('/recent')
    .then((r) => {
      blocks = r.blocks;
      txs = r.txs;
      if (blocks[0]) odometer($('#hBlock', main), '#' + blocks[0].number.toLocaleString('en-US'));
      paintFeeds();
      // Seed the ring with the most recent blocks, oldest first.
      blocks.slice(0, 6).reverse().forEach((b, i) => timers.push(setTimeout(() => ring.block(b.number, b.txs), i * 260)));
    })
    .catch(() => {});

  // Long-lived labelled branches: real context from the chain itself.
  const anchors = [];
  netApi('/contracts')
    .then((rows) => rows.slice(0, 3).forEach((c) => anchors.push([`${c.token?.symbol || short(c.address, 4)} · ${(c.share * 100).toFixed(1)}% of calls`, c.share * 2])))
    .catch(() => {})
    .then(() => (isMain ? netApi('/stocks').catch(() => null) : null))
    .then((r) => {
      const list = (Array.isArray(r) ? r : r?.tokens || r?.stocks || []).filter((t) => t.holders).sort((a, b) => b.holders - a.holders);
      list.slice(0, 3).forEach((t) => anchors.push([`${t.symbol} · ${fmtInt(t.holders)} holders`, 0.3]));
      anchors.forEach(([label, wgt], i) => timers.push(setTimeout(() => ring.anchor(label, wgt), 900 + i * 500)));
    });

  offs.push(
    on('block', ({ network, block }) => {
      if (network !== state.network || blocks.some((b) => b.number === block.number)) return;
      blocks = [block, ...blocks].sort((a, b) => b.number - a.number).slice(0, 60);
      odometer($('#hBlock', main), '#' + blocks[0].number.toLocaleString('en-US'));
      paintFeeds(true);
      ring.block(block.number, block.txs);
    }),
    on('txs', ({ network, txs: fresh }) => {
      if (network !== state.network) return;
      txs = [...fresh.slice().reverse(), ...txs].slice(0, 40);
      paintFeeds(false, Math.min(fresh.length, 8));
    }),
    on('pulse', (p) => {
      if (p.network !== state.network) return;
      pulse = p;
      paintRates();
    }),
  );
  timers.push(setInterval(() => main.querySelectorAll('[data-time]').forEach((el) => (el.textContent = ago(+el.dataset.time))), 1000));

  // ---------- most called contracts (from blocks the indexer read) ----------
  const loadContracts = () =>
    netApi('/contracts')
      .then((rows) => {
        if (!rows.length) return ($('#contracts', main).innerHTML = '<div class="empty">Needs RPC access: the indexer ranks contracts from the blocks it reads.</div>');
        $('#contractsInfo', main).textContent = pulse?.mode === 'sample' ? 'share of calls · sampled blocks' : 'share of calls · indexed blocks';
        const max = rows[0].share;
        $('#contracts', main).innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Contract</th><th>Token</th><th class="num">Share</th></tr></thead><tbody>${rows
          .map(
            (c, i) => `<tr><td class="dim mono">${i + 1}</td><td>${addrLink(c.address, 10)}</td><td>${c.token ? `<span class="tag">${esc(c.token.symbol || c.token.name)}</span>` : '<span class="dim">—</span>'}</td>
            <td class="num bar-cell"><i style="width:${(c.share / max) * 100}%"></i>${(c.share * 100).toFixed(1)}%</td></tr>`,
          )
          .join('')}</tbody></table>`;
      })
      .catch(() => {});
  loadContracts();
  timers.push(setInterval(loadContracts, 60_000));

  return () => {
    timers.forEach(clearInterval);
    timers.forEach(clearTimeout);
    offs.forEach((o) => o());
    charts.forEach((c) => c.destroy());
    ring.destroy();
  };
}

function metric(id, title, sub) {
  return `<div class="box metric reveal" id="${id}"><div class="box-head">${title}</div><div class="box-body"><div class="metric-val">—</div><div class="metric-sub">${sub}</div></div></div>`;
}
