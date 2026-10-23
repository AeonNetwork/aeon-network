// What's new: user-facing release notes, newest first.
import { esc } from '../core.js';

export const RELEASES = [
  {
    date: 'Oct 23, 2026',
    tag: 'New',
    title: 'Smart Money',
    items: [
      'The wallets that keep buying Pons tokens among the first 25, before those tokens graduate',
      'Built from the last ten days of Pons graduations and the first buys on each bonding curve, straight from the chain',
      'What those wallets bought in the last few hours, and the tokens several of them bought together',
      'Snipers that buy in the very first trading block are tagged',
      'Watch any smart wallet in one tap and get an alert when it moves',
      'The AI Agent can read smart money on its own',
    ],
    link: ['#/smart', 'Open Smart Money'],
  },
  {
    date: 'Oct 22, 2026',
    tag: 'New',
    title: 'Command Center',
    items: [
      'Robinhood Chain on one screen: stock tokens, the meme radar and the whales, refreshed every 15 seconds',
      'Stock tokens moving most today: top gainers, top losers and the most traded',
      'Meme radar: the hottest Pons launches with bonding progress, market cap and safety grades, plus the ones that just launched',
      'Whale feed with today’s buy and sell totals; chain vitals with a block counter that ticks live',
      'In the bottom bar on phones, as Live',
    ],
    link: ['#/live', 'Open the Command Center'],
  },
  {
    date: 'Oct 22, 2026',
    tag: 'Big update',
    title: 'Dev Checker, whale alerts and portfolio share cards',
    items: [
      'Dev Checker: paste a creator wallet and see every token it ever launched on Pons, from the factory’s own records',
      'How each launch did (graduated, live or dead) and what the dev did with their own tokens: bought, sold into buyers, burned or moved to other wallets',
      'Red flags with evidence: serial launching, selling into buyers, hidden wallets, launches that never take off',
      'Every creator on the Token Radar and every Pons token in the scanner now links straight to its dev check',
      'Whale alerts: pick a size, buys or sells and the stocks you care about, and get a browser notification the moment a whale trades',
      'Portfolio share cards: turn any wallet’s stock portfolio into an image ready to post',
      'The AI Agent can check a dev on its own',
      'Steadier servers: the site now loads its settings by itself after a restart',
    ],
    link: ['#/dev', 'Check a dev'],
  },
  {
    date: 'Oct 21, 2026',
    tag: 'Big update',
    title: 'New Token Radar',
    items: [
      'Every token launched on Pons, read straight from the chain as it launches',
      'Bonding progress for each one: ETH raised against the amount needed to graduate',
      'Market cap from the curve price, age, and the wallet that launched it',
      'Serial launchers flagged: wallets that launch 5 or more tokens in a day',
      'The most active new tokens get an automatic safety grade from the scanner',
      'Hot, New, Near graduation and Graduated views, refreshed every minute',
      'The scanner now reads Pons bonding curves, and the AI Agent can use the radar',
    ],
    link: ['#/radar', 'Open the radar'],
  },
  {
    date: 'Oct 22, 2026',
    tag: 'Major update',
    title: 'Token Safety Scanner and the Aeon AI Agent',
    items: [
      'Token Safety Scanner: paste any token on Robinhood Chain and get a 0-100 score and an A-F grade',
      'Finds mint, pause, blacklist, tax and limit switches in the bytecode, including behind a proxy',
      'Live honeypot test: simulates a real holder sending the token',
      'Holder spread rebuilt from every transfer the token ever made, with pools and curves kept apart from wallets',
      'Flags copycats of official Robinhood stock tokens; liquidity from DEX Screener',
      'Aeon AI is now an agent: it scans tokens, follows whales, opens wallets and reads the leaderboard, Pulse and AE on its own',
      'Every step the agent takes is shown live, with a link to open its result',
      'Pages keep working when an explorer provider is down: saved data plus on-chain fallbacks',
    ],
    link: ['#/scan', 'Open the scanner'],
  },
  {
    date: 'Oct 21, 2026',
    tag: 'Big update',
    title: 'Network Pulse, and a faster, sturdier engine',
    items: [
      'Network Pulse: Robinhood Chain today in one report, with the change since yesterday',
      'Activity, fees, DEX volume, value locked, stablecoins, stock tokens and whales on one page',
      'One-click summary to copy or share, with its own link preview: getaeon.network/pulse',
      'Whale Tracker now reads 40 stock tokens (was 24) straight from the chain, every 2 minutes',
      'Portfolio and whales keep working even when a data provider is down',
    ],
    link: ['#/pulse', 'Open Network Pulse'],
  },
  {
    date: 'Oct 21, 2026',
    tag: 'New',
    title: 'Aeon token: transparency and holder perks',
    items: [
      'A token page read live from the chain: supply, holders, burned share and the top 20 holders, labelled',
      'The creator wallet holds 0 AE; its launch buy was burned, with both transactions linked',
      'Holders of 1,000,000+ AE get 4x the Network AI allowance and a Holder badge',
      'Verify by signing a message in your wallet: free, no transaction, nothing can move',
    ],
    link: ['#/ae', 'Open the token page'],
  },
  {
    date: 'Oct 21, 2026',
    tag: 'Update 2',
    title: 'Holder leaderboard',
    items: [
      'The 50 largest tokenized-stock portfolios on Robinhood Chain, ranked by value',
      'Built from the top holders of every official stock token, then valued exactly from each wallet',
      'Individual wallets only: pools, vaults and contracts are left out',
      'Rank changes since the last update, a podium for the top three, every wallet opens its portfolio',
      'Clean share links with their own preview image: getaeon.network/whales, /portfolio, /leaderboard',
    ],
    link: ['#/leaderboard', 'Open Leaderboard'],
  },
  {
    date: 'Oct 21, 2026',
    tag: 'Big update',
    title: 'Whale tracker',
    items: [
      'Large buys and sells of official stock tokens, read from the chain every 90 seconds',
      'Filter by size (from $1K to $100K+), by stock and by buys or sells',
      '24-hour whale volume, the biggest trade and the top whale wallets',
      'Every whale links to its full portfolio and to the transaction on-chain',
      'Swaps routed through pools are netted per wallet, so a buy is a buy',
    ],
    link: ['#/whales', 'Open Whale tracker'],
  },
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
          <div class="box-head"><span>${esc(r.date)}</span><span class="right"><span class="tag ${['New', 'Big update', 'Update 2'].includes(r.tag) ? 'solid' : ''}">${esc(r.tag)}</span></span></div>
          <div class="box-body">
            <h2>${esc(r.title)}</h2>
            <ul>${r.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            ${r.link ? `<a class="btn btn-sm" href="${r.link[0]}">${esc(r.link[1])} →</a>` : ''}
          </div>
        </section>`,
      ).join('')}
    </div>`;
}
