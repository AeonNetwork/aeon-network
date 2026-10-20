// Renders brand/aeon-intro.mp4. Needs the server on :3000 plus dev tools that are not app
// dependencies: npm i puppeteer-core ffmpeg-static (in a scratch folder), Edge or Chrome installed.
// Env: REUSE=1 reuses intro-data.json, SEED picks the ring layout, PROBE=1 scores a seed.
import { fileURLToPath } from 'node:url';
// Renders brand/intro.html frame by frame with a virtual clock, then muxes the soundtrack.
import puppeteer from 'puppeteer-core';
import ffmpeg from 'ffmpeg-static';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const FPS = 30, DUR = 31.5, FRAMES = Math.round(FPS * DUR);
const OUT_DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const j = (p) => fetch(BASE + p).then((r) => r.json());

// ---------- real data ----------
import { existsSync, writeFileSync } from 'node:fs';
let DATA;
if (process.env.REUSE && existsSync('intro-data.json')) DATA = JSON.parse(readFileSync('intro-data.json', 'utf8'));
else {
const [ov, recent, stocks, eco, contracts] = await Promise.all([j('/api/network/mainnet/overview'), j('/api/network/mainnet/recent'), j('/api/network/mainnet/stocks'), j('/api/ecosystem/mainnet/summary'), j('/api/network/mainnet/contracts')]);
const question = 'What is happening on Robinhood Chain right now?';
let answer = '';
for (let attempt = 0; attempt < 3 && !answer; attempt++) {
  const res = await fetch(BASE + '/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: question + '\n\nAnswer in two short sentences with the key live numbers.' }], network: 'mainnet' }) });
  const text = await res.text();
  for (const part of text.split('\n\n')) if (part.startsWith('data: ')) {
    const e = JSON.parse(part.slice(6));
    if (e.type === 'text') answer += e.text;
  }
  answer = answer.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}
if (!answer) throw new Error('AI did not answer');
const top = stocks.filter((s) => s.holders).sort((a, b) => b.holders - a.holders).slice(0, 6);
DATA = {
  capturedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  block: ov.block,
  recent: recent.blocks.map((b) => ({ number: b.number, txs: b.txs })).sort((a, b) => a.number - b.number).slice(-17),
  stocks: top.map((s) => ({ symbol: s.symbol, name: s.name, holders: s.holders, price: s.price, icon: s.icon })),
  anchors: [...top.slice(0, 2).map((s) => [`${s.symbol} · ${s.holders.toLocaleString('en-US')} holders`, 0.3]), ...contracts.slice(0, 1).map((c) => [`${c.token?.symbol || c.address.slice(0, 6) + '…' + c.address.slice(-4)} · ${(c.share * 100).toFixed(1)}% of calls`, 0.4])],
  question,
  answer,
  totalTx: ov.explorerStats.totalTransactions,
  addresses: ov.explorerStats.totalAddresses,
  txToday: ov.explorerStats.transactionsToday,
  tvl: eco.tvl,
  tvlRank: eco.rank,
  chains: eco.chains,
};
writeFileSync('intro-data.json', JSON.stringify(DATA));
}
console.log('data ok · block', DATA.block, '· answer:', DATA.answer.slice(0, 140));

// ---------- page with a virtual clock ----------
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, userDataDir: './edge-intro', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.setRequestInterception(true);
page.on('request', (r) => (r.url() === BASE + '/__intro.html' ? r.respond({ status: 200, contentType: 'text/html', body: readFileSync(OUT_DIR + '/intro.html', 'utf8') }) : r.continue()));
const SEED = Number(process.env.SEED || 16);
await page.evaluateOnNewDocument((data, seed) => {
  window.DATA = data;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let vt = 0, rid = 0, tid = 0;
  const raf = new Map(), timers = [];
  const start = Date.now();
  performance.now = () => vt;
  Date.now = () => start + vt;
  window.requestAnimationFrame = (cb) => (raf.set(++rid, cb), rid);
  window.cancelAnimationFrame = (id) => raf.delete(id);
  window.setTimeout = (cb, ms = 0, ...a) => (timers.push({ id: ++tid, at: vt + ms, cb: () => cb(...a) }), tid);
  window.clearTimeout = (id) => {
    const i = timers.findIndex((x) => x.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  window.__tick = (ms) => {
    vt = ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > vt) break;
      timers.shift().cb();
    }
  };
  window.__raf = () => {
    const cbs = [...raf.values()];
    raf.clear();
    cbs.forEach((cb) => cb(vt));
  };
}, DATA, SEED);
await page.goto(BASE + '/__intro.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true && document.fonts.status === "loaded"');
await new Promise((r) => setTimeout(r, 1500)); // logos

if (process.env.PROBE) {
  let seen = 0;
  for (let f = 0; f < 315; f++) {
    const t = f / FPS;
    const v = await page.evaluate((t) => { window.__tick(t * 1000); window.__frame(t); window.__raf(); return [...document.querySelectorAll('.ring-label.is-block')].filter((e) => +e.style.opacity > 0.5).length; }, t);
    if (t > 4.5) seen += v;
  }
  console.log('SEED', SEED, 'label-frames', seen);
  await browser.close();
  process.exit(0);
}
// ---------- frames -> h264 ----------
const silent = OUT_DIR + '/.intro-silent.mp4';
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  const t = f / FPS;
  await page.evaluate((t) => {
    window.__tick(t * 1000);
    window.__frame(t);
    window.__raf();
  }, t);
  const shot = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!enc.stdin.write(shot)) await new Promise((r) => enc.stdin.once('drain', r));
  if (f % 90 === 0) console.log(`frame ${f}/${FRAMES} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if ([45, 200, 380, 560, 610, 700, 740, 900].includes(f)) await page.screenshot({ path: `frame-${f}.png` });
}
enc.stdin.end();
await new Promise((r) => enc.on('close', r));
await browser.close();

// ---------- soundtrack + mux ----------
execFileSync(process.execPath, [OUT_DIR + '/intro-sound.mjs', OUT_DIR + '/.intro.wav'], { stdio: 'inherit' });
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', silent, '-i', OUT_DIR + '/.intro.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', OUT_DIR + '/aeon-intro.mp4']);
console.log('done ->', OUT_DIR + '/aeon-intro.mp4');
