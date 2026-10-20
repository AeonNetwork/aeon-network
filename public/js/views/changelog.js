// What's new: user-facing release notes, newest first.
import { esc } from '../core.js';

export const RELEASES = [
  {
    date: 'Oct 20, 2026',
    tag: 'Update',
    title: 'Faster, steadier, easier to trust',
    items: [
      'Official community token address at the bottom of every page, with a copy button',
      'Scam tokens that hide phishing links in their name are now labelled, never shown as-is',
      'Network AI retries a busy model and falls back across three providers, so answers keep coming',
      'Fee answers are calculated by the server, so the AI quotes exact numbers',
      'Pages now show updates the moment they ship',
    ],
  },
  {
    date: 'Oct 20, 2026',
    tag: 'New',
    title: 'Portfolio for tokenized stocks',
    items: [
      'Any wallet, valued like a brokerage app: total value and today’s gain or loss',
      '7-day history of your current positions, allocation and per-stock sparklines',
      'Every buy and sell of your stock tokens, linked to the chain',
      'Copycat tokens are flagged and never counted',
    ],
    link: ['#/portfolio', 'Open Portfolio'],
  },
  {
    date: 'Oct 19, 2026',
    tag: 'Launch',
    title: 'Aeon Network goes live',
    items: [
      'Live network, explorer, tokenized stocks, ecosystem, watchlist and Network AI',
      'Wallet check with copycat detection and approval revoke',
      'Aeon RPC: a free public endpoint for Robinhood Chain',
      'Open source on GitHub; every number links to its source',
    ],
  },
];

export function render(main) {
  main.innerHTML = `
    <div class="page-head"><div><div class="kicker">Aeon Network · Changelog</div><h1>What's new</h1></div><a class="btn btn-sm" href="https://github.com/AeonNetwork/aeon-network/commits/main" target="_blank" rel="noopener">Every commit on GitHub ↗</a></div>
    <div class="changelog">
      ${RELEASES.map(
        (r) => `<section class="box reveal mt">
          <div class="box-head"><span>${esc(r.date)}</span><span class="right"><span class="tag ${r.tag === 'New' ? 'solid' : ''}">${esc(r.tag)}</span></span></div>
          <div class="box-body">
            <h2>${esc(r.title)}</h2>
            <ul>${r.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            ${r.link ? `<a class="btn btn-sm" href="${r.link[0]}">${esc(r.link[1])} →</a>` : ''}
          </div>
        </section>`,
      ).join('')}
    </div>`;
}
