// Original hype soundtrack for the AEON × PONS video (128 BPM, A minor), synthesized
// from scratch: no samples, nothing third-party, free to publish. Timed to brand/hype.html.
//   node brand/hype-sound.mjs out.wav
import { writeFileSync } from 'node:fs';

export const BPM = 128;
const B = 60 / BPM; // one beat
const BAR = 4 * B;
const SR = 48_000;
const DUR = 13 * BAR + 0.15; // ≈ 24.5 s
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 128;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * Math.min(fc, SR * 0.45)) / SR);
const add = (t, l, r = l) => {
  const i = Math.floor(t * SR);
  if (i >= 0 && i < N) (L[i] += l), (R[i] += r);
};
const bar = (n) => n * BAR;

// Sidechain: the music breathes around every kick.
const kicks = [];
const duck = (t) => {
  let g = 1;
  for (let k = kicks.length - 1; k >= 0; k--) {
    const d = t - kicks[k];
    if (d >= 0 && d < 0.28) g = Math.min(g, 0.25 + 0.75 * (d / 0.28) ** 0.7);
  }
  return g;
};

// ---------- instruments ----------
function kick(at, gain = 1) {
  kicks.push(at);
  let ph = 0;
  for (let i = 0; i < SR * 0.55; i++) {
    const t = i / SR;
    ph += (TAU * (45 + 190 * Math.exp(-t / 0.028))) / SR;
    const body = Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-t / 0.2);
    const click = noise() * Math.exp(-t / 0.0025) * 0.5;
    add(at + t, (body + click) * gain);
  }
}
function bass808(at, midi, len, slideTo = null, gain = 0.55) {
  let ph = 0;
  for (let i = 0; i < SR * (len + 0.06); i++) {
    const t = i / SR;
    let m = midi;
    if (slideTo != null && t > len * 0.55) m = midi + (slideTo - midi) * Math.min(1, (t - len * 0.55) / (len * 0.35));
    const f = hz(m) * (1 + 1.5 * Math.exp(-t / 0.012));
    ph += (TAU * f) / SR;
    const e = (t < len ? 1 : Math.exp(-(t - len) / 0.02)) * Math.min(1, t / 0.003);
    const s = Math.tanh((Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * 2.6) * e;
    add(at + t, s * gain);
  }
}
function clap(at, gain = 0.5) {
  let bp = 0, lp = 0;
  for (let i = 0; i < SR * 0.25; i++) {
    const t = i / SR;
    const bursts = [0, 0.009, 0.018].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) / (o === 0.018 ? 0.08 : 0.006)) : 0), 0);
    const x = noise();
    lp += lpA(2600) * (x - lp);
    bp = x - lp; // high-passed noise
    add(at + t, bp * bursts * gain, bp * bursts * gain * 0.9);
  }
}
function hat(at, gain = 0.12, len = 0.035) {
  let prev = 0, hp = 0;
  for (let i = 0; i < SR * len * 3; i++) {
    const x = noise();
    hp = 0.92 * (hp + x - prev);
    prev = x;
    add(at + i / SR, hp * Math.exp(-i / SR / len) * gain, hp * Math.exp(-i / SR / len) * gain * 0.85);
  }
}
function snare(at, gain = 0.35) {
  let lp = 0, ph = 0;
  for (let i = 0; i < SR * 0.18; i++) {
    const t = i / SR;
    ph += (TAU * (185 + 60 * Math.exp(-t / 0.01))) / SR;
    const x = noise();
    lp += lpA(5200) * (x - lp);
    add(at + t, (lp * Math.exp(-t / 0.05) * 0.9 + Math.sin(ph) * Math.exp(-t / 0.04) * 0.5) * gain);
  }
}
function boom(at, gain = 1, len = 2.6) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    ph += (TAU * (28 + 70 * Math.exp(-t / 0.09))) / SR;
    lp += lpA(4000 * Math.exp(-t / 0.3) + 120) * (noise() - lp);
    const s = Math.tanh(Math.sin(ph) * 2) * Math.exp(-t / (len / 3.2)) + lp * Math.exp(-t / 0.6) * 0.55;
    add(at + t, s * gain, (Math.tanh(Math.sin(ph) * 2) * Math.exp(-t / (len / 3.2)) + lp * Math.exp(-t / 0.65) * 0.5) * gain);
  }
}
function riser(from, to, gain = 0.4) {
  let lpL = 0, lpR = 0, ph = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    const fc = 200 + 9000 * k ** 2;
    lpL += lpA(fc) * (noise() - lpL);
    lpR += lpA(fc) * (noise() - lpR);
    ph += (TAU * (180 + 1400 * k ** 2)) / SR;
    const g = k ** 1.6 * gain;
    add(from + i / SR, (lpL + Math.sin(ph) * 0.35) * g, (lpR + Math.sin(ph) * 0.35) * g);
  }
}
function reverseSwell(from, to, gain = 0.4) {
  let lp = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    lp += lpA(800 + 7000 * k) * (noise() - lp);
    add(from + i / SR, lp * k ** 3 * gain, -lp * k ** 3 * gain * 0.8);
  }
}
// Supersaw stab: seven detuned saws per note, low-passed, sidechained.
function stab(at, notes, len, gain = 0.07, cutoff = 2400) {
  const voices = notes.flatMap((m) => [-0.12, -0.07, -0.03, 0, 0.03, 0.07, 0.12].map((d) => hz(m + d)));
  const ph = voices.map((_, i) => (i * 0.137) % 1);
  let lpL = 0, lpR = 0;
  for (let i = 0; i < SR * (len + 0.08); i++) {
    const t = i / SR;
    let l = 0, r = 0;
    voices.forEach((f, v) => {
      ph[v] = (ph[v] + f / SR) % 1;
      (v % 2 ? (r += ph[v] * 2 - 1) : (l += ph[v] * 2 - 1));
    });
    const fc = cutoff * (0.4 + 0.6 * Math.exp(-t / 0.12));
    lpL += lpA(fc) * (l - lpL);
    lpR += lpA(fc) * (r - lpR);
    const e = Math.min(1, t / 0.004) * (t < len ? 1 : Math.exp(-(t - len) / 0.03)) * duck(at + t);
    add(at + t, lpL * e * gain, lpR * e * gain);
  }
}
function drone(from, to, midi, gain = 0.2) {
  const f = hz(midi);
  for (let i = 0; i < SR * (to - from); i++) {
    const t = from + i / SR;
    const e = Math.min(1, (t - from) / 0.8) * Math.min(1, (to - t) / 0.4);
    add(t, Math.tanh(Math.sin(TAU * f * t) * 1.5) * e * gain * duck(t));
  }
}

// ---------- arrangement ----------
const CH = { Am: [57, 60, 64], F: [53, 57, 60], C: [55, 60, 64], G: [55, 59, 62] };
const prog = ['Am', 'F', 'C', 'G'];
const line = [ // 808 per bar: [beat, midi, length in beats, slide target]
  [[0, 33, 1.4], [1.5, 33, 0.4], [2, 36, 1.3, 31], [3.5, 33, 0.45]],
  [[0, 29, 1.4], [1.5, 29, 0.4], [2, 31, 1.3], [3.5, 33, 0.45]],
  [[0, 36, 1.4], [1.5, 36, 0.4], [2, 31, 1.3, 33], [3.5, 31, 0.45]],
  [[0, 31, 1.4], [1.5, 31, 0.4], [2, 33, 1.0], [3, 36, 0.9, 33]],
];

// Intro (bars 0–1): heartbeat.
drone(0, bar(2), 33, 0.16);
for (let b = 0; b < 2; b++) for (const o of [0, 0.75, 2, 2.75]) kick(bar(b) + o * B, o % 2 ? 0.55 : 0.8);
reverseSwell(bar(1.5), bar(2), 0.35);

// Build (bars 2–3): kicks on every beat, accelerating snare roll, riser, filter opening.
for (let t = bar(2); t < bar(4) - B; t += B) kick(t, 0.85);
for (let t = bar(2); t < bar(3); t += B / 2) snare(t, 0.22);
for (let t = bar(3); t < bar(3.5); t += B / 4) snare(t, 0.26);
for (let t = bar(3.5); t < bar(4) - B / 2; t += B / 8) snare(t, 0.3);
riser(bar(2), bar(4) - B / 2, 0.42);
for (let b = 2; b < 4; b++) for (let s = 0; s < 4; s++) stab(bar(b) + s * B + B / 2, CH[prog[(b * 2 + (s >> 1)) % 4]], B * 0.4, 0.05, 600 + 2600 * ((b - 2) * 4 + s) / 8);

// Drops: bars 4–7 and 9–11.
function drop(fromBar, bars, extra) {
  for (let b = fromBar; b < fromBar + bars; b++) {
    const t0 = bar(b);
    for (let s = 0; s < 4; s++) kick(t0 + s * B, 1);
    clap(t0 + B, 0.5);
    clap(t0 + 3 * B, 0.5);
    for (let s = 0; s < 8; s++) hat(t0 + s * (B / 2) + B / 2 * (s % 2 ? 0 : 0.5), s % 2 ? 0.13 : 0.06);
    if (extra || b === fromBar + bars - 1) for (let s = 0; s < 16; s++) hat(t0 + (s * B) / 4, 0.05, 0.02);
    for (const [beat, m, len, slide] of line[(b - fromBar) % 4]) bass808(t0 + beat * B, m, len * B, slide ?? null, 0.5);
    const chord = CH[prog[(b - fromBar) % 4]];
    for (const o of [0.5, 1.5, 2.5, 3.5]) stab(t0 + o * B, chord, B * 0.35, 0.065, extra ? 4200 : 3200);
  }
}
boom(bar(4), 1.1);
drop(4, 4, false);
boom(bar(6), 0.55, 1.6); // the Pons logo arrives
// Breakdown (bar 8): drums out, the "×" holds.
drone(bar(8), bar(9), 33, 0.22);
stab(bar(8), CH.Am.map((m) => m - 12), BAR * 0.9, 0.06, 900);
reverseSwell(bar(8) + B, bar(9) - B / 4, 0.5);
for (let s = 0; s < 4; s++) kick(bar(8) + s * B, 0.35);
// Drop 2 (bars 9–11), bigger.
boom(bar(9), 1.25, 3);
drop(9, 3, true);
// Outro (bar 12).
boom(bar(12), 1.2, 3.2);
stab(bar(12), [45, 52, 57, 60, 64], BAR * 0.9, 0.05, 1600);
drone(bar(12), DUR, 33, 0.18);

// ---------- master: tilt toward bass, saturate, limit, normalize ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * 0.5));
  L[i] = Math.tanh(L[i] * 1.35) * fade;
  R[i] = Math.tanh(R[i] * 1.35) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.7 / peak; // headroom so AAC never clips
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2] || 'hype.wav', buf);
console.log('wrote', process.argv[2] || 'hype.wav', DUR.toFixed(2) + 's');
