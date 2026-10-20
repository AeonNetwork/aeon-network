// Score for the feature explainer (36 s, 100 BPM, A minor): calm and wide, a soft pulse
// under each feature, a deep swell at every scene change. Synthesized; no samples.
//   node brand/explainer-sound.mjs out.wav
import { writeFileSync } from 'node:fs';

const SR = 48_000, DUR = 36.2, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N), SL = new Float32Array(N), SRb = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 99;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * Math.min(fc, SR * 0.45)) / SR);
const put = (t, l, r, send = 0) => {
  const i = Math.floor(t * SR);
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r;
  if (send) (SL[i] += l * send), (SRb[i] += r * send);
};

function pad(from, to, notes, gain = 0.04) {
  const v = notes.flatMap((m) => [-0.07, 0, 0.07].map((d) => hz(m + d)));
  const ph = v.map((_, i) => (i * 0.31) % 1);
  let a = 0, b = 0;
  for (let i = 0; i < SR * (to - from + 1.6); i++) {
    const t = i / SR, abs = from + t;
    let l = 0, r = 0;
    v.forEach((f, k) => { ph[k] = (ph[k] + f / SR) % 1; (k % 2 ? (r += ph[k] * 2 - 1) : (l += ph[k] * 2 - 1)); });
    a += lpA(1100) * (l - a); b += lpA(1100) * (r - b);
    const e = Math.min(1, t / 1.4) * (abs > to ? Math.exp(-(abs - to) / 0.6) : 1);
    put(abs, a * e * gain, b * e * gain, 0.5);
  }
}
function pulse(at, midi, gain = 0.26) { // soft plucked bass with sub
  const f = hz(midi);
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 0.4; i++) {
    const t = i / SR;
    ph = (ph + f / SR) % 1;
    lp += lpA(200 + 900 * Math.exp(-t / 0.05)) * (ph * 2 - 1 - lp);
    const s = (lp * 0.6 + Math.sin(TAU * f * 0.5 * t) * 0.8) * Math.exp(-t / 0.16) * Math.min(1, t / 0.004);
    put(at + t, s * gain, s * gain, 0.15);
  }
}
function swell(at, gain = 0.8) { // deep cinematic swell into a scene
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 3; i++) {
    const t = i / SR;
    ph += (TAU * (32 + 40 * Math.exp(-t / 0.2))) / SR;
    lp += lpA(1400 * Math.exp(-t / 0.4) + 100) * (noise() - lp);
    const s = Math.tanh(Math.sin(ph) * 1.8) * Math.exp(-t / 0.9) + lp * Math.exp(-t / 0.35) * 0.35;
    put(at + t, s * gain, s * gain, 0.3);
  }
}
function whoosh(from, to, gain = 0.3) {
  let lp = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    lp += lpA(400 + 5000 * k * k) * (noise() - lp);
    put(from + i / SR, lp * k ** 2.5 * gain, -lp * k ** 2.5 * gain * 0.8, 0.3);
  }
}
function bell(at, midi, gain = 0.06) {
  const f = hz(midi);
  for (let i = 0; i < SR * 2.5; i++) {
    const t = i / SR, e = Math.exp(-t / 0.8) * Math.min(1, t / 0.002);
    put(at + t, (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.76 * t)) * e * gain, (Math.sin(TAU * f * 1.003 * t) + 0.3 * Math.sin(TAU * f * 2.74 * t)) * e * gain, 0.6);
  }
}
function soft(at, gain = 0.4) { // low tom on scene starts
  let ph = 0;
  for (let i = 0; i < SR * 0.8; i++) {
    const t = i / SR;
    ph += (TAU * (62 + 50 * Math.exp(-t / 0.03))) / SR;
    put(at + t, Math.sin(ph) * Math.exp(-t / 0.3) * gain, Math.sin(ph) * Math.exp(-t / 0.3) * gain, 0.4);
  }
}

const B = 0.6; // 100 BPM
const CH = { Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60], C: [48, 52, 55, 60, 64], G: [43, 50, 55, 59, 62] };
const ROOT = { Am: 33, F: 29, C: 36, G: 31 };
const scenes = [[0, 4, 'Am'], [4, 11, 'F'], [11, 18, 'C'], [18, 25, 'G'], [25, 31, 'Am'], [31, 36, 'Am']];
swell(0.3, 0.7);
bell(1.0, 76, 0.05);
for (const [a, b, ch] of scenes) {
  pad(a, b, CH[ch], a === 31 ? 0.035 : 0.04);
  if (a > 0) { swell(a, a === 31 ? 0.9 : 0.6); soft(a, 0.45); whoosh(a - 0.7, a, 0.28); }
  if (a >= 4 && a < 31) for (let t = a + 0.6; t < b - 0.3; t += B / 2) pulse(t, ROOT[ch] + (Math.round((t - a) / (B / 2)) % 8 === 6 ? 12 : 0), 0.22);
  if (a >= 4 && a < 31) for (let t = a + 0.6; t < b - 0.3; t += B * 2) soft(t, 0.18);
}
[[4.6, 81], [11.6, 79], [18.6, 84], [25.6, 76], [26.0, 79], [26.25, 81], [26.5, 84], [26.75, 88]].forEach(([t, m]) => bell(t, m, 0.04));
bell(31.3, 69, 0.08); bell(31.3, 76, 0.05);

// room
function reverb(inp, outp, ds) {
  const combs = ds.map((d) => ({ b: new Float32Array(Math.floor(d * SR)), i: 0, lp: 0 }));
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; c.lp += 0.3 * (y - c.lp); c.b[c.i] = inp[n] + c.lp * 0.84; c.i = (c.i + 1) % c.b.length; s += y; }
    outp[n] += s * 0.14;
  }
}
reverb(SL, L, [0.0297, 0.0371, 0.0411, 0.0437]);
reverb(SRb, R, [0.0301, 0.0353, 0.0423, 0.0449]);
let peak = 0;
for (let i = 0; i < N; i++) {
  const f = Math.min(1, (N - i) / (SR * 1.2));
  L[i] = Math.tanh(L[i] * 1.1) * f; R[i] = Math.tanh(R[i] * 1.1) * f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.95 / peak; // loud enough to sit with the other films; the encoder limiter catches peaks
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2] || 'explainer.wav', buf);
console.log('wrote', process.argv[2] || 'explainer.wav', DUR + 's');
