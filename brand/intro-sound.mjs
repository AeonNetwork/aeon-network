// Original soundtrack for the intro video, synthesized from scratch (no samples, no
// third-party audio, so it is free to publish anywhere). Timed to brand/intro.html:
// bass kicks land on every block the ring grows, typing ticks follow the AI prompt.
//   node brand/intro-sound.mjs out.wav
import { writeFileSync } from 'node:fs';

const SR = 48_000;
const DUR = 31.5;
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 4663;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * fc) / SR);
const add = (i, l, r = l) => {
  if (i >= 0 && i < N) (L[i] += l), (R[i] += r);
};
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));

// Sidechain: everything melodic ducks under the kicks.
const kicks = [];
const duck = (t) => {
  let g = 1;
  for (const k of kicks) if (t >= k && t < k + 0.3) g = Math.min(g, 0.45 + 0.55 * ((t - k) / 0.3) ** 0.6);
  return g;
};

// ---- kick: pitch-dropping sine with a click ----
function kick(at, gain = 1) {
  kicks.push(at);
  let ph = 0;
  for (let i = 0; i < SR * 0.6; i++) {
    const t = i / SR;
    const f = 42 + 120 * Math.exp(-t / 0.035);
    ph += (TAU * f) / SR;
    const s = Math.sin(ph) * env(t, 0.002, 0.22) * gain + noise() * env(t, 0.0005, 0.004) * 0.25 * gain;
    add(Math.floor((at + t) * SR), s * 0.9);
  }
}
// ---- impact: long sub boom + noise burst ----
function boom(at, gain = 1, len = 2.2) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    ph += (TAU * (30 + 55 * Math.exp(-t / 0.12))) / SR;
    lp += lpA(1800 * Math.exp(-t / 0.15) + 80) * (noise() - lp);
    const s = Math.sin(ph) * env(t, 0.004, len / 3) * 1.1 + lp * env(t, 0.001, 0.25) * 0.6;
    add(Math.floor((at + t) * SR), s * gain);
  }
}
// ---- riser / whoosh: filtered noise sweeping up ----
function riser(from, to, gain = 0.35, reverse = false) {
  let lpL = 0, lpR = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    const shape = reverse ? k ** 3 : Math.sin(Math.PI * k) ** 1.5;
    const fc = 300 + 7000 * k * k;
    lpL += lpA(fc) * (noise() - lpL);
    lpR += lpA(fc) * (noise() - lpR);
    add(Math.floor((from + i / SR) * SR), lpL * shape * gain, lpR * shape * gain);
  }
}
// ---- typing tick ----
function tick(at, gain = 0.18) {
  let hp = 0, prev = 0;
  for (let i = 0; i < SR * 0.03; i++) {
    const x = noise();
    hp = 0.85 * (hp + x - prev);
    prev = x;
    add(Math.floor((at + i / SR) * SR), hp * env(i / SR, 0.0005, 0.006) * gain);
  }
}
// ---- bell: two sines, slight stereo detune ----
function bell(at, midi, gain = 0.12) {
  const f = hz(midi);
  for (let i = 0; i < SR * 1.6; i++) {
    const t = i / SR, e = env(t, 0.003, 0.45);
    add(Math.floor((at + t) * SR), (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 3.01 * t)) * e * gain, (Math.sin(TAU * f * 1.003 * t) + 0.3 * Math.sin(TAU * f * 2.99 * t)) * e * gain);
  }
}
// ---- bass pluck: saw through a closing low-pass ----
function bass(at, midi, len = 0.4, gain = 0.32) {
  const f = hz(midi);
  let ph = 0, lp = 0, lp2 = 0;
  for (let i = 0; i < SR * (len + 0.15); i++) {
    const t = i / SR;
    ph = (ph + f / SR) % 1;
    const saw = ph * 2 - 1, sub = Math.sin(TAU * f * 0.5 * t);
    lp += lpA(120 + 1400 * Math.exp(-t / 0.08)) * (saw - lp);
    lp2 += lpA(900) * (lp - lp2);
    const g = (t < len ? env(t, 0.004, 0.5) : env(len, 0.004, 0.5) * Math.exp(-(t - len) / 0.04)) * gain;
    add(Math.floor((at + t) * SR), (lp2 * 0.8 + sub * 0.55) * g);
  }
}
// ---- pad: detuned saws, slow attack, filtered ----
function pad(from, to, chord, gain = 0.05) {
  const voices = chord.flatMap((m) => [hz(m) * 0.997, hz(m) * 1.004]);
  const ph = voices.map(() => Math.random());
  let lpL = 0, lpR = 0;
  for (let i = 0; i < SR * (to - from + 1.2); i++) {
    const t = i / SR, abs = from + t;
    let l = 0, r = 0;
    voices.forEach((f, v) => {
      ph[v] = (ph[v] + f / SR) % 1;
      (v % 2 ? (r += ph[v] * 2 - 1) : (l += ph[v] * 2 - 1));
    });
    const fc = 700 + 500 * Math.sin(TAU * 0.08 * abs);
    lpL += lpA(fc) * (l - lpL);
    lpR += lpA(fc) * (r - lpR);
    const e = Math.min(1, t / 1.0) * (t > to - from ? Math.exp(-(t - (to - from)) / 0.4) : 1);
    add(Math.floor(abs * SR), lpL * e * gain * duck(abs), lpR * e * gain * duck(abs));
  }
}
// ---- drone: sub sine under everything ----
function drone(from, to, midi, gain = 0.16) {
  const f = hz(midi);
  for (let i = 0; i < SR * (to - from); i++) {
    const t = i / SR, abs = from + t;
    const e = Math.min(1, t / 1.5) * Math.min(1, (to - abs) / 1.5);
    add(Math.floor(abs * SR), Math.sin(TAU * f * abs) * (0.8 + 0.2 * Math.sin(TAU * 0.25 * abs)) * e * gain * duck(abs));
  }
}

// ================= arrangement (A minor) =================
const BEAT = 0.45; // one block every 0.45 s in the ring scene
// 1 · logo
riser(0.1, 1.95, 0.32);
boom(1.95, 0.9);
drone(0, 3.4, 33); // A1
// 2 · ring: a kick for every block, bass on the off-beats
const line = [33, 33, 36, 31, 33, 33, 38, 36]; // A A C G A A D C
for (let t = 3.0, n = 0; t < 10.4; t += BEAT, n++) {
  kick(t, n === 0 ? 1.1 : 0.85);
  bass(t + BEAT / 2, line[n % line.length], BEAT * 0.45);
  tick(t + BEAT / 2, 0.06);
}
pad(3.0, 10.5, [57, 60, 64, 67, 71], 0.045); // Am9
drone(3.0, 10.6, 33, 0.12);
riser(9.9, 10.55, 0.3);
// 3 · stocks: steady pulse, brighter chord
for (let t = 10.5, n = 0; t < 15.4; t += BEAT, n++) {
  kick(t, 0.8);
  bass(t + BEAT / 2, [29, 29, 31, 33][n % 4], BEAT * 0.4, 0.28);
  if (n % 2) tick(t + BEAT * 0.75, 0.05);
}
pad(10.5, 15.5, [53, 57, 60, 64], 0.045); // Fmaj7
riser(14.9, 15.55, 0.3);
// 4 · AI: the beat drops away, the room listens
pad(15.5, 22.5, [48, 55, 60, 64, 71], 0.04); // Cmaj7(9)
drone(15.5, 22.6, 36, 0.1); // C2
const q = 'What is happening on Robinhood Chain right now?';
for (let i = 0; i < q.length; i++) if (q[i] !== ' ') tick(16.2 + (i / q.length) * 2.2, 0.16);
riser(18.3, 18.75, 0.38, true); // the orb collapses
boom(18.75, 0.6, 1.4);
[76, 79, 83, 84, 88, 91].forEach((m, i) => bell(19.4 + i * 0.32, m, 0.07));
riser(21.9, 22.55, 0.3);
// 5 · numbers: the beat returns, double-time hats
for (let t = 22.5, n = 0; t < 26.7; t += BEAT, n++) {
  kick(t, 0.9);
  bass(t + BEAT / 2, line[n % line.length], BEAT * 0.45, 0.3);
  tick(t + BEAT / 4, 0.05);
  tick(t + (BEAT * 3) / 4, 0.07);
}
pad(22.5, 26.8, [55, 59, 62, 64, 67], 0.045); // G6
riser(26.0, 26.8, 0.36);
// 6 · end card
boom(26.8, 1.0, 3.5);
pad(26.8, 30.6, [45, 52, 57, 59, 60, 64], 0.05); // Am(add9), low
drone(26.8, 31.4, 33, 0.14);
bell(27.0, 81, 0.06);
bell(27.6, 76, 0.05);

// ---- ping-pong delay for space, then soft clip and normalize ----
const D = Math.floor(SR * 0.3375);
for (let i = D; i < N; i++) {
  L[i] += R[i - D] * 0.22;
  R[i] += L[i - D] * 0.22;
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const fadeOut = Math.min(1, (N - i) / (SR * 0.6));
  L[i] = Math.tanh(L[i] * 1.2) * fadeOut;
  R[i] = Math.tanh(R[i] * 1.2) * fadeOut;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.79 / peak; // about -2 dBFS, headroom for AAC

// ---- 16-bit stereo WAV ----
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
writeFileSync(process.argv[2] || 'intro.wav', buf);
console.log('wrote', process.argv[2] || 'intro.wav', DUR + 's');
