// Score for the Whale Tracker film (30 s, A minor). Deep and slow: sonar pings, a low
// whale-song glide, sub drones, one braam on the title, a heartbeat pulse under the data,
// a rising pad into the end card. Synthesized from scratch; no samples.
//   node brand/whale-sound.mjs out.wav
import { writeFileSync } from 'node:fs';

const SR = 48_000, DUR = 30.2, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N), SL = new Float32Array(N), SRb = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 2048;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * Math.min(fc, SR * 0.45)) / SR);
const put = (t, l, r, send = 0) => {
  const i = Math.floor(t * SR);
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r;
  if (send) (SL[i] += l * send), (SRb[i] += r * send);
};

function drone(from, to, midi, gain) {
  const f = hz(midi);
  for (let i = 0; i < SR * (to - from); i++) {
    const t = from + i / SR;
    const e = Math.min(1, (t - from) / 2) * Math.min(1, (to - t) / 1.2);
    const s = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2 * t + Math.sin(t * 0.3))) * e * gain;
    put(t, s, s * 0.97, 0.4);
  }
}
function ping(at, midi, gain = 0.18, pan = 0) { // sonar: pure tone, long tail into the room
  const f = hz(midi);
  for (let i = 0; i < SR * 2.2; i++) {
    const t = i / SR, e = Math.exp(-t / 0.5) * Math.min(1, t / 0.003);
    const s = (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2.01 * t)) * e * gain;
    put(at + t, s * (1 - pan * 0.5), s * (1 + pan * 0.5), 0.8);
  }
}
function song(from, len, m0, m1, gain = 0.07) { // whale song: slow pitch glide with vibrato
  let ph = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR, k = t / len;
    const m = m0 + (m1 - m0) * Math.sin((Math.PI * k) / 2) + 0.15 * Math.sin(t * 5);
    ph += (TAU * hz(m)) / SR;
    const e = Math.sin(Math.PI * k) ** 1.5;
    const s = (Math.sin(ph) + 0.3 * Math.sin(ph * 2)) * e * gain;
    put(from + t, s, s, 0.9);
  }
}
function braam(at, gain, len, root = 33) {
  const v = [root, root + 12, root + 19].flatMap((m) => [-0.07, 0, 0.07].map((d) => hz(m + d)));
  const ph = v.map((_, i) => (i * 0.2) % 1);
  let a = 0, b = 0, sub = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    v.forEach((f, k) => { ph[k] = (ph[k] + f / SR) % 1; (k % 2 ? (r += ph[k] * 2 - 1) : (l += ph[k] * 2 - 1)); });
    const fc = 180 + 1800 * Math.exp(-t / 0.35) * Math.min(1, t / 0.02);
    a += lpA(fc) * (l - a); b += lpA(fc) * (r - b);
    sub += (TAU * hz(root - 12)) / SR;
    const e = Math.min(1, t / 0.02) * Math.exp(-t / (len / 3));
    put(at + t, Math.tanh((a * 0.15 + Math.sin(sub) * 0.85) * 1.5) * e * gain, Math.tanh((b * 0.15 + Math.sin(sub) * 0.85) * 1.5) * e * gain, 0.35);
  }
}
function boom(at, gain, len) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    ph += (TAU * (26 + 60 * Math.exp(-t / 0.12))) / SR;
    lp += lpA(2200 * Math.exp(-t / 0.25) + 80) * (noise() - lp);
    const s = Math.tanh(Math.sin(ph) * 2) * Math.exp(-t / (len / 3)) + lp * Math.exp(-t / 0.5) * 0.4;
    put(at + t, s * gain, s * gain, 0.3);
  }
}
function heart(at, gain = 0.5) { // low double pulse
  for (const [o, g] of [[0, 1], [0.22, 0.6]]) {
    let ph = 0;
    for (let i = 0; i < SR * 0.4; i++) {
      const t = i / SR;
      ph += (TAU * (48 + 40 * Math.exp(-t / 0.03))) / SR;
      put(at + o + t, Math.sin(ph) * Math.exp(-t / 0.13) * gain * g, Math.sin(ph) * Math.exp(-t / 0.13) * gain * g, 0.2);
    }
  }
}
function swell(from, to, gain) {
  let lp = 0;
  for (let i = 0; i < SR * (to - from); i++) {
    const k = i / (SR * (to - from));
    lp += lpA(300 + 5000 * k * k) * (noise() - lp);
    put(from + i / SR, lp * k ** 2.5 * gain, -lp * k ** 2.5 * gain * 0.8, 0.4);
  }
}
function pad(from, to, notes, gain) {
  const v = notes.flatMap((m) => [-0.06, 0, 0.06].map((d) => hz(m + d)));
  const ph = v.map((_, i) => (i * 0.29) % 1);
  let a = 0, b = 0;
  for (let i = 0; i < SR * (to - from + 1.5); i++) {
    const t = i / SR, abs = from + t;
    let l = 0, r = 0;
    v.forEach((f, k) => { ph[k] = (ph[k] + f / SR) % 1; (k % 2 ? (r += ph[k] * 2 - 1) : (l += ph[k] * 2 - 1)); });
    const fc = 500 + 900 * Math.min(1, t / (to - from));
    a += lpA(fc) * (l - a); b += lpA(fc) * (r - b);
    const e = Math.min(1, t / 1.5) * (abs > to ? Math.exp(-(abs - to) / 0.6) : 1);
    put(abs, a * e * gain, b * e * gain, 0.5);
  }
}

// 1 · the deep (0–7)
drone(0, 7.2, 21, 0.2);
ping(1.0, 81, 0.12, -0.4); ping(3.9, 81, 0.16, 0.3); ping(4.45, 76, 0.1, 0.5);
song(1.6, 4.5, 50, 57, 0.06);
swell(6.0, 6.95, 0.5);
// 2 · title (7–11)
braam(7, 1.0, 4.2); boom(7, 0.8, 3);
ping(7.0, 69, 0.16); ping(7.55, 76, 0.1, 0.4);
// 3 · the page (11–19): a heartbeat under the numbers
drone(11, 19.3, 33, 0.12);
pad(11, 19, [45, 52, 57, 60, 64], 0.035);
for (let t = 11.2; t < 19; t += 1.2) heart(t, 0.45);
[12.6, 12.9, 13.2].forEach((t, i) => ping(t, 84 + i * 3, 0.06));
// 4 · trades (19–25): a ping as each trade surfaces
drone(19, 25.3, 29, 0.12);
pad(19, 25, [41, 48, 53, 57, 60], 0.04);
for (let t = 19.2; t < 25; t += 0.6) heart(t, 0.35);
for (let i = 0; i < 5; i++) ping(19.8 + i * 0.55, [76, 79, 81, 84, 88][i], 0.09, i % 2 ? 0.4 : -0.4);
swell(24.3, 25.2, 0.5);
// 5 · end (25–30)
boom(25.2, 1.0, 4); braam(25.2, 0.55, 4.5);
pad(25.2, 29.4, [33, 45, 52, 57, 64], 0.04);
ping(25.4, 69, 0.13); song(26.2, 3.4, 45, 52, 0.05);

// room
function room(inp, outp, ds) {
  const cs = ds.map((d) => ({ b: new Float32Array(Math.floor(d * SR)), i: 0, lp: 0 }));
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of cs) { const y = c.b[c.i]; c.lp += 0.28 * (y - c.lp); c.b[c.i] = inp[n] + c.lp * 0.87; c.i = (c.i + 1) % c.b.length; s += y; }
    outp[n] += s * 0.13;
  }
}
room(SL, L, [0.0297, 0.0371, 0.0411, 0.0437, 0.051]);
room(SRb, R, [0.0301, 0.0353, 0.0423, 0.0449, 0.0533]);
let peak = 0;
for (let i = 0; i < N; i++) {
  const f = Math.min(1, (N - i) / (SR * 1.2));
  L[i] = Math.tanh(L[i] * 1.15) * f; R[i] = Math.tanh(R[i] * 1.15) * f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.92 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2] || 'whale.wav', buf);
console.log('wrote', DUR + 's');
