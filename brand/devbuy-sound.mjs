// 3-second DEV BUY sting: two huge hits and a count-up. Synthesized from scratch, no samples.
//   node brand/devbuy-sound.mjs out.wav
import { writeFileSync } from 'node:fs';

const SR = 48_000, DUR = 3.2, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const RL = new Float32Array(N), RR = new Float32Array(N); // reverb send
const TAU = Math.PI * 2;
let seed = 2026;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-TAU * Math.min(fc, SR * 0.45)) / SR);
const put = (t, l, r, send = 0) => {
  const i = Math.floor(t * SR);
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r;
  if (send) (RL[i] += l * send), (RR[i] += r * send);
};
// Duck the ostinato and pads under the big hits.
const hits = [];
const duck = (t) => hits.reduce((g, [h, d]) => (t >= h && t < h + d ? Math.min(g, 0.35 + 0.65 * ((t - h) / d) ** 1.5) : g), 1);

// ---------- instruments ----------
// BRAAM: detuned saws on A, octave-stacked, through a filter that blooms then closes, plus a sub.
function braam(at, gain = 1, len = 3.8, root = 33) {
  hits.push([at, 1.2]);
  const notes = [root, root + 12, root + 19, root + 24];
  const voices = notes.flatMap((m) => [-0.08, -0.03, 0.02, 0.07].map((d) => hz(m + d)));
  const ph = voices.map((_, i) => (i * 0.21) % 1);
  let lpL = 0, lpR = 0, lp2L = 0, lp2R = 0, sub = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    voices.forEach((f, v) => {
      ph[v] = (ph[v] + f / SR) % 1;
      (v % 2 ? (r += ph[v] * 2 - 1) : (l += ph[v] * 2 - 1));
    });
    const fc = 140 + 2200 * Math.exp(-t / 0.35) * Math.min(1, t / 0.03) + 260;
    lpL += lpA(fc) * (l - lpL); lpR += lpA(fc) * (r - lpR);
    lp2L += lpA(fc) * (lpL - lp2L); lp2R += lpA(fc) * (lpR - lp2R);
    sub += (TAU * hz(root - 12)) / SR;
    const e = Math.min(1, t / 0.015) * Math.exp(-t / (len / 3.4));
    const s = Math.sin(sub) * Math.exp(-t / (len / 2.5)) * 0.9;
    put(at + t, Math.tanh((lp2L * 0.12 + s) * 1.6) * e * gain, Math.tanh((lp2R * 0.12 + s) * 1.6) * e * gain, 0.35);
  }
}
// Cinematic impact: sub drop + noise body.
function boom(at, gain = 1, len = 3) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    ph += (TAU * (24 + 60 * Math.exp(-t / 0.12))) / SR;
    lp += lpA(2500 * Math.exp(-t / 0.25) + 90) * (noise() - lp);
    const s = Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-t / (len / 3)) + lp * Math.exp(-t / 0.5) * 0.5;
    put(at + t, s * gain, s * gain, 0.25);
  }
}
// Taiko: big low drum with skin noise and a long room.
function taiko(at, gain = 0.8) {
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 0.9; i++) {
    const t = i / SR;
    ph += (TAU * (58 + 70 * Math.exp(-t / 0.03))) / SR;
    lp += lpA(900) * (noise() - lp);
    const s = Math.sin(ph) * Math.exp(-t / 0.28) + lp * Math.exp(-t / 0.05) * 0.8;
    put(at + t, s * gain, s * gain * 0.95, 0.45);
  }
}
// Clock tick for tension.
function tick(at, gain = 0.12) {
  let prev = 0, hp = 0;
  for (let i = 0; i < SR * 0.02; i++) {
    const x = noise();
    hp = 0.9 * (hp + x - prev); prev = x;
    put(at + i / SR, hp * Math.exp(-i / SR / 0.003) * gain, hp * Math.exp(-i / SR / 0.003) * gain * 0.8, 0.2);
  }
}
// Staccato bass ostinato note: saw + sub, short, filtered.
function ost(at, midi, gain = 0.32) {
  const f = hz(midi);
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 0.16; i++) {
    const t = i / SR;
    ph = (ph + f / SR) % 1;
    lp += lpA(260 + 1500 * Math.exp(-t / 0.03)) * (ph * 2 - 1 - lp);
    const s = (lp * 0.8 + Math.sin(TAU * f * 0.5 * t) * 0.7) * Math.exp(-t / 0.07) * Math.min(1, t / 0.002);
    const d = duck(at + t);
    put(at + t, s * gain * d, s * gain * d, 0.1);
  }
}
// Pad / low strings: detuned saws with slow attack.
function pad(from, to, notes, gain = 0.045) {
  const voices = notes.flatMap((m) => [-0.06, 0, 0.06].map((d) => hz(m + d)));
  const ph = voices.map((_, i) => (i * 0.17) % 1);
  let lpL = 0, lpR = 0;
  for (let i = 0; i < SR * (to - from + 1.5); i++) {
    const t = i / SR, abs = from + t;
    let l = 0, r = 0;
    voices.forEach((f, v) => {
      ph[v] = (ph[v] + f / SR) % 1;
      (v % 2 ? (r += ph[v] * 2 - 1) : (l += ph[v] * 2 - 1));
    });
    lpL += lpA(900 + 400 * Math.sin(abs * 0.7)) * (l - lpL);
    lpR += lpA(900 + 400 * Math.sin(abs * 0.7)) * (r - lpR);
    const e = Math.min(1, t / 1.2) * (abs > to ? Math.exp(-(abs - to) / 0.5) : 1) * duck(abs);
    put(abs, lpL * e * gain, lpR * e * gain, 0.5);
  }
}
// Shepard riser: octave-spaced sines gliding up, faded at the edges so it never "arrives".
function shepard(from, to, gain = 0.07) {
  const len = to - from;
  const phs = [0, 0, 0, 0, 0];
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR, k = t / len;
    let s = 0;
    for (let o = 0; o < 5; o++) {
      const pos = (o + k * 1.5) % 5; // 0..5 octaves
      const f = 55 * 2 ** pos;
      phs[o] += (TAU * f) / SR;
      s += Math.sin(phs[o]) * Math.sin((Math.PI * pos) / 5) ** 2;
    }
    put(from + t, s * gain * k, s * gain * k, 0.3);
  }
}
function swell(from, to, gain = 0.4) {
  let lp = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    lp += lpA(500 + 8000 * k * k) * (noise() - lp);
    put(from + i / SR, lp * k ** 3 * gain, -lp * k ** 3 * gain * 0.85, 0.3);
  }
}
function drone(from, to, midi, gain = 0.14) {
  const f = hz(midi);
  for (let i = 0; i < SR * (to - from); i++) {
    const t = from + i / SR;
    const e = Math.min(1, (t - from) / 1.8) * Math.min(1, (to - t) / 0.6);
    const s = (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.5 * t) * (0.5 + 0.5 * Math.sin(t * 0.8))) * e * gain;
    put(t, s, s, 0.3);
  }
}
function bell(at, midi, gain = 0.1) {
  const f = hz(midi);
  for (let i = 0; i < SR * 3; i++) {
    const t = i / SR, e = Math.exp(-t / 0.9) * Math.min(1, t / 0.002);
    put(at + t, (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2.76 * t)) * e * gain, (Math.sin(TAU * f * 1.002 * t) + 0.35 * Math.sin(TAU * f * 2.74 * t)) * e * gain, 0.6);
  }
}

// ---------- score ----------
const BEAT = 0.5, BAR = 2; // 120 BPM
const PAT = { Am: [33, 33, 45, 33], F: [29, 29, 41, 29], C: [36, 36, 48, 36], G: [31, 31, 43, 31] };
const CHORD = { Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60], C: [36, 48, 55, 60, 64], G: [43, 50, 55, 59, 62] };
const ostinato = (from, to, prog) => {
  for (let t = from, n = 0; t < to - 0.01; t += BEAT / 4, n++) {
    const ch = prog[Math.floor((t - from) / BAR) % prog.length];
    ost(t, PAT[ch][n % 4], n % 4 === 0 ? 0.36 : 0.26);
  }
};

// Scan ping: short bright sine blip.
function ping(at, midi, gain = 0.08) {
  const f = hz(midi);
  for (let i = 0; i < SR * 0.5; i++) {
    const t = i / SR, e = Math.exp(-t / 0.09) * Math.min(1, t / 0.001);
    put(at + t, Math.sin(TAU * f * t) * e * gain, Math.sin(TAU * f * 1.003 * t) * e * gain, 0.5);
  }
}
// Beam sweep: filtered noise gliding across the stereo field.
function sweep(from, to, gain = 0.16) {
  let lp = 0, bp = 0;
  const len = to - from;
  for (let i = 0; i < SR * len; i++) {
    const k = i / (SR * len);
    lp += lpA(600 + 3000 * Math.sin(Math.PI * k)) * (noise() - lp);
    bp += lpA(300) * (lp - bp);
    const v = (lp - bp) * gain * Math.sin(Math.PI * k);
    put(from + i / SR, v * (1 - k), v * k, 0.3);
  }
}

// 0.1: DEV BUY lands.
swell(0, 0.1, 0.5);
braam(0.1, 1.35, 2.6); boom(0.1, 1.25, 2.6);
taiko(0.1, 1); taiko(0.6, 0.6); taiko(0.85, 0.6); taiko(1.1, 0.7); taiko(1.3, 0.7);
ostinato(0.4, 1.55, ['Am']);
// 0.45–1.5: the amount counts up.
for (let t = 0.45, n = 0; t < 1.5; n++, t = 0.45 + 1.05 * (n / 22) ** 0.8) tick(t, 0.08 + 0.06 * ((t - 0.45) / 1.05));
swell(1.15, 1.54, 0.5);
// 1.55: the second hit, then the ring-out.
boom(1.55, 1.1, 1.7); braam(1.55, 0.9, 1.7, 36);
bell(1.55, 81, 0.07); bell(1.55, 88, 0.05); ping(1.8, 93, 0.05);
taiko(1.55, 0.9); taiko(2.05, 0.6);

// ---------- big room reverb on the send (Schroeder: 4 combs + 2 allpasses per side) ----------
function reverb(inp, out, delays, ap) {
  const combs = delays.map((d) => ({ buf: new Float32Array(Math.floor(d * SR)), i: 0, fb: 0.84, lp: 0 }));
  const alls = ap.map((d) => ({ buf: new Float32Array(Math.floor(d * SR)), i: 0 }));
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp += 0.3 * (y - c.lp);
      c.buf[c.i] = inp[n] + c.lp * c.fb;
      c.i = (c.i + 1) % c.buf.length;
      s += y;
    }
    s *= 0.25;
    for (const a of alls) {
      const y = a.buf[a.i];
      a.buf[a.i] = s + y * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      s = y - s * 0.5;
    }
    out[n] += s * 0.55;
  }
}
reverb(RL, L, [0.0297, 0.0371, 0.0411, 0.0437], [0.005, 0.0017]);
reverb(RR, R, [0.0301, 0.0353, 0.0423, 0.0449], [0.0051, 0.0018]);

// ---------- master ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * 0.4));
  L[i] = Math.tanh(L[i] * 1.15) * fade;
  R[i] = Math.tanh(R[i] * 1.15) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.7 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2] || 'devbuy.wav', buf);
console.log('wrote', process.argv[2] || 'devbuy.wav', DUR + 's');
