// 5-second sting for the "Should we pay DEX?" poll: a soft braam on the mark, a riser,
// one big hit on "PAY DEX?", a taiko + bell on "vote". Synthesized; no samples.
import { writeFileSync } from 'node:fs';
const SR = 48_000, DUR = 5, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * Math.min(fc, SR * 0.45)) / SR);
const put = (t, l, r = l) => { const i = Math.floor(t * SR); if (i >= 0 && i < N) (L[i] += l), (R[i] += r); };
function braam(at, gain, len, root = 33) {
  const v = [root, root + 12, root + 19].flatMap((m) => [-0.08, 0, 0.08].map((d) => hz(m + d)));
  const ph = v.map((_, i) => (i * 0.2) % 1);
  let a = 0, b = 0, sub = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    v.forEach((f, k) => { ph[k] = (ph[k] + f / SR) % 1; (k % 2 ? (r += ph[k] * 2 - 1) : (l += ph[k] * 2 - 1)); });
    const fc = 200 + 2000 * Math.exp(-t / 0.3) * Math.min(1, t / 0.02);
    a += lpA(fc) * (l - a); b += lpA(fc) * (r - b);
    sub += (TAU * hz(root - 12)) / SR;
    const e = Math.min(1, t / 0.015) * Math.exp(-t / (len / 3));
    put(at + t, Math.tanh((a * 0.15 + Math.sin(sub) * 0.8) * 1.6) * e * gain, Math.tanh((b * 0.15 + Math.sin(sub) * 0.8) * 1.6) * e * gain);
  }
}
function boom(at, gain, len) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    ph += (TAU * (26 + 70 * Math.exp(-t / 0.1))) / SR;
    lp += lpA(3000 * Math.exp(-t / 0.2) + 100) * (noise() - lp);
    put(at + t, (Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-t / (len / 3)) + lp * Math.exp(-t / 0.4) * 0.5) * gain);
  }
}
function riser(a, b, gain) {
  let lp = 0, ph = 0;
  for (let i = 0; i < SR * (b - a); i++) {
    const k = i / (SR * (b - a));
    lp += lpA(300 + 8000 * k * k) * (noise() - lp);
    ph += (TAU * (150 + 1200 * k * k)) / SR;
    put(a + i / SR, (lp + Math.sin(ph) * 0.3) * k ** 2 * gain, (lp - Math.sin(ph) * 0.3) * k ** 2 * gain);
  }
}
function taiko(at, gain) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 0.8; i++) {
    const t = i / SR;
    ph += (TAU * (60 + 70 * Math.exp(-t / 0.03))) / SR;
    lp += lpA(900) * (noise() - lp);
    put(at + t, (Math.sin(ph) * Math.exp(-t / 0.28) + lp * Math.exp(-t / 0.05) * 0.7) * gain);
  }
}
function bell(at, m, gain) {
  const f = hz(m);
  for (let i = 0; i < SR * 1.8; i++) { const t = i / SR, e = Math.exp(-t / 0.6); put(at + t, (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.76 * t)) * e * gain); }
}
braam(0.25, 0.5, 1.6);
riser(0.8, 1.42, 0.45);
braam(1.45, 1.0, 3.2); boom(1.45, 1.0, 3.2);
taiko(2.9, 0.6); taiko(3.4, 0.7); bell(3.4, 81, 0.06);
// simple echo for space
const D = Math.floor(SR * 0.27);
for (let i = D; i < N; i++) { L[i] += R[i - D] * 0.25; R[i] += L[i - D] * 0.25; }
let peak = 0;
for (let i = 0; i < N; i++) { const f = Math.min(1, (N - i) / (SR * 0.4)); L[i] = Math.tanh(L[i] * 1.2) * f; R[i] = Math.tanh(R[i] * 1.2) * f; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = 0.9 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4); }
writeFileSync(process.argv[2] || 'vote.wav', buf);
