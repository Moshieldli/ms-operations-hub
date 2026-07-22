/**
 * Synthesize the /finance cash-register "CHA-CHING" (rev 63) — the OLD-STYLE
 * MECHANICAL register: double bell strike + lever clunk + drawer slide + coin
 * rattle + drawer-stop thock. ~1.7s, normalized hot (0.95 peak, tanh-limited —
 * noticeably louder than the old in-browser chime, no clipping). ORIGINAL
 * synthesis, no licensed audio. Writes public/sounds/register.wav; swap the
 * file to change the sound.
 *
 * ⚠️ /tv/sales sale-bell sounds live in make-sounds.ts — deliberately separate;
 * this script only ever writes register.wav.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/make-register-sound.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SR = 44100;

type Voice = (t: number) => number;

/** Deterministic noise (LCG) so the file is reproducible byte-for-byte. */
function makeNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function render(seconds: number, voices: Array<{ at: number; v: Voice }>): Int16Array {
  const n = Math.round(seconds * SR);
  const buf = new Float64Array(n);
  for (const { at, v } of voices) {
    const start = Math.round(at * SR);
    for (let i = start; i < n; i++) buf[i] += v((i - start) / SR);
  }
  const fade = Math.round(0.06 * SR);
  for (let i = 0; i < fade; i++) buf[n - 1 - i] *= i / fade;
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.95 / peak : 1; // HOT — the old chime sat at ~0.2
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.tanh(buf[i] * gain * 1.15);
    out[i] = Math.max(-32767, Math.min(32767, Math.round(s * 32767)));
  }
  return out;
}

function wav(samples: Int16Array): Buffer {
  const dataLen = samples.length * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2);
  return b;
}

const env = (t: number, a: number, d: number) =>
  t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);

/** The register BELL — small, bright, inharmonic (a real counter-bell rings ~2kHz). */
const bell =
  (freq: number, vol: number, dur = 1.1): Voice =>
  (t) => {
    if (t < 0 || t > dur + 0.4) return 0;
    const partials: Array<[number, number, number]> = [
      [1, 1.0, 0.5],
      [2.71, 0.6, 0.28],
      [4.95, 0.35, 0.16],
      [7.4, 0.15, 0.09],
    ];
    let s = 0;
    for (const [r, a, d] of partials) s += a * Math.sin(2 * Math.PI * freq * r * t) * env(t, 0.002, d);
    return vol * 0.5 * s;
  };

/** Lever CLUNK: low thump + a hard mid knock — the key-press before the bell. */
const clunk =
  (vol: number): Voice =>
  (t) => {
    if (t < 0 || t > 0.25) return 0;
    const thump = Math.sin(2 * Math.PI * 105 * t) * env(t, 0.002, 0.05);
    const knock = Math.sin(2 * Math.PI * 420 * t) * env(t, 0.001, 0.02);
    return vol * (0.9 * thump + 0.5 * knock);
  };

/** Drawer SLIDE: shaped noise with a rolling flutter — metal drawer on rails. */
const slide = (vol: number, dur: number, seed: number): Voice => {
  const noise = makeNoise(seed);
  let lp = 0;
  return (t) => {
    if (t < 0 || t > dur) return 0;
    // Low-passed noise (one-pole) + amplitude flutter = rumbling slide.
    lp = lp * 0.86 + noise() * 0.14;
    const shape = Math.sin((Math.PI * t) / dur); // swells then dies
    const flutter = 0.7 + 0.3 * Math.sin(2 * Math.PI * 27 * t);
    return vol * lp * shape * flutter * 2.2;
  };
};

/** Drawer-stop THOCK: the drawer hitting the end — deep and satisfying. */
const thock =
  (vol: number): Voice =>
  (t) => {
    if (t < 0 || t > 0.3) return 0;
    const deep = Math.sin(2 * Math.PI * 78 * t) * env(t, 0.002, 0.07);
    const body = Math.sin(2 * Math.PI * 190 * t) * env(t, 0.001, 0.035);
    return vol * (1.0 * deep + 0.45 * body);
  };

/** Coin RATTLE: a burst of tiny detuned metallic pings. */
function coinPings(at: number, seed: number): Array<{ at: number; v: Voice }> {
  const rnd = makeNoise(seed);
  const out: Array<{ at: number; v: Voice }> = [];
  for (let i = 0; i < 7; i++) {
    const dt = at + i * 0.035 + Math.abs(rnd()) * 0.02;
    const f = 2900 + Math.abs(rnd()) * 2600;
    out.push({
      at: dt,
      v: (t) => {
        if (t < 0 || t > 0.12) return 0;
        return 0.16 * Math.sin(2 * Math.PI * f * t) * env(t, 0.001, 0.03);
      },
    });
  }
  return out;
}

const outDir = join(process.cwd(), "public", "sounds");
mkdirSync(outDir, { recursive: true });

const BELL_F = 2093; // C7 — small counter-bell territory
const voices: Array<{ at: number; v: Voice }> = [
  { at: 0.0, v: clunk(1.0) }, // lever press
  { at: 0.06, v: bell(BELL_F, 1.0) }, // CHA —
  { at: 0.21, v: bell(BELL_F * 1.002, 1.15, 1.3) }, // — CHING (second strike rings out)
  { at: 0.3, v: slide(0.55, 0.42, 12345) }, // drawer flies open
  ...coinPings(0.42, 67890), // coins jump
  { at: 0.72, v: thock(1.0) }, // drawer hits the stop
  { at: 0.74, v: slide(0.18, 0.12, 24680) }, // tiny settle
];
writeFileSync(join(outDir, "register.wav"), wav(render(1.7, voices)));
console.log("register.wav written (1.7s, mechanical cha-ching)");
