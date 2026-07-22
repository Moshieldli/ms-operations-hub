/**
 * Synthesize the /tv/sales bell sounds (rev 60) — ORIGINAL audio, no licensed
 * samples. Writes 16-bit mono 44.1kHz WAVs to public/sounds/; swap any file to
 * change a sound later, the app just plays the path.
 *
 *   sale.wav          (~2.6s) bright bell strike → short sparkly rise
 *   milestone-10.wav  (~4.2s) double bell + bigger flourish + chord
 *   milestone-25.wav  (~6.2s) full fanfare (triad hits → sustained major chord)
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/make-sounds.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SR = 44100;

type Voice = (t: number) => number;

/** Render seconds of audio by summing scheduled voices; soft-clip + normalize. */
function render(seconds: number, voices: Array<{ at: number; v: Voice }>): Int16Array {
  const n = Math.round(seconds * SR);
  const buf = new Float64Array(n);
  for (const { at, v } of voices) {
    const start = Math.round(at * SR);
    for (let i = start; i < n; i++) {
      buf[i] += v((i - start) / SR);
    }
  }
  // Gentle master fade at the very end so nothing clicks.
  const fade = Math.round(0.08 * SR);
  for (let i = 0; i < fade; i++) buf[n - 1 - i] *= i / fade;
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.82 / peak : 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.tanh(buf[i] * gain * 1.1); // soft clip keeps transients friendly
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
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
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

/** Bell strike: inharmonic partials (glockenspiel-ish), bright and clean. */
const bell =
  (freq: number, vol = 1, dur = 1.6): Voice =>
  (t) => {
    if (t < 0 || t > dur + 0.5) return 0;
    const partials: Array<[number, number, number]> = [
      [1, 1.0, 0.9], // [ratio, amp, decay]
      [2.76, 0.55, 0.45],
      [5.4, 0.28, 0.22],
      [8.93, 0.12, 0.12],
    ];
    let s = 0;
    for (const [r, a, d] of partials) {
      s += a * Math.sin(2 * Math.PI * freq * r * t) * env(t, 0.003, d);
    }
    return vol * 0.5 * s;
  };

/** Short sparkly ping (sine + octave shimmer) for the celebratory rise. */
const ping =
  (freq: number, vol = 1): Voice =>
  (t) => {
    if (t < 0 || t > 0.7) return 0;
    const e = env(t, 0.004, 0.16);
    return (
      vol *
      0.4 *
      (Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(2 * Math.PI * freq * 2.005 * t)) *
      e
    );
  };

/** Brassy sustained tone (few sawtooth-ish harmonics + slow vibrato). */
const brass =
  (freq: number, vol = 1, dur = 1.0): Voice =>
  (t) => {
    if (t < 0 || t > dur + 0.3) return 0;
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t);
    const e = t < 0.04 ? t / 0.04 : t < dur ? 1 - 0.25 * ((t - 0.04) / dur) : Math.exp(-(t - dur) / 0.12);
    let s = 0;
    for (let h = 1; h <= 6; h++) {
      s += Math.sin(2 * Math.PI * freq * h * vib * t) / h;
    }
    return vol * 0.28 * s * e;
  };

// Note frequencies.
const N = {
  C5: 523.25, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, C7: 2093, E7: 2637,
};

const outDir = join(process.cwd(), "public", "sounds");
mkdirSync(outDir, { recursive: true });

// ---- sale.wav — bell strike, then a quick sparkly rise. Friendly on repeat. ----
{
  const rise = [N.C6, N.E6, N.G6, N.C7, N.E7];
  const voices: Array<{ at: number; v: Voice }> = [
    { at: 0, v: bell(N.E6, 1.0) },
    { at: 0.05, v: bell(N.E6 * 0.5, 0.35) }, // soft lower body under the strike
    ...rise.map((f, i) => ({ at: 0.45 + i * 0.09, v: ping(f, 0.8 - i * 0.06) })),
    { at: 0.95, v: bell(N.C7, 0.5, 1.2) },
  ];
  writeFileSync(join(outDir, "sale.wav"), wav(render(2.6, voices)));
  console.log("sale.wav written (2.6s)");
}

// ---- milestone-10.wav — double bell + bigger flourish + short chord. ----
{
  const run1 = [N.C6, N.D6, N.E6, N.G6, N.C7];
  const run2 = [N.E6, N.G6, N.C7, N.E7];
  const voices: Array<{ at: number; v: Voice }> = [
    { at: 0, v: bell(N.E6, 1.0) },
    { at: 0.22, v: bell(N.G6, 0.9) },
    ...run1.map((f, i) => ({ at: 0.55 + i * 0.08, v: ping(f, 0.75) })),
    ...run2.map((f, i) => ({ at: 1.15 + i * 0.08, v: ping(f, 0.8) })),
    { at: 1.7, v: brass(N.C5, 0.8, 1.6) },
    { at: 1.7, v: brass(N.E5, 0.65, 1.6) },
    { at: 1.7, v: brass(N.G5, 0.65, 1.6) },
    { at: 1.75, v: bell(N.C7, 0.7, 1.6) },
  ];
  writeFileSync(join(outDir, "milestone-10.wav"), wav(render(4.2, voices)));
  console.log("milestone-10.wav written (4.2s)");
}

// ---- milestone-25.wav — the big fanfare: triad hits marching to a held chord. ----
{
  const hit = (at: number, root: number, third: number, fifth: number, dur: number, vol = 0.75) => [
    { at, v: brass(root, vol, dur) },
    { at, v: brass(third, vol * 0.8, dur) },
    { at, v: brass(fifth, vol * 0.8, dur) },
  ];
  const sparkleTimes = [2.3, 2.5, 2.7, 2.9, 3.1, 3.4, 3.7, 4.0];
  const sparkleNotes = [N.C6, N.E6, N.G6, N.C7, N.E7, N.G6, N.C7, N.E7];
  const voices: Array<{ at: number; v: Voice }> = [
    { at: 0, v: bell(N.E6, 0.9) },
    ...hit(0.15, N.C5, N.E5, N.G5, 0.45),
    ...hit(0.75, N.F5, N.A5, N.C6, 0.45),
    ...hit(1.35, N.G5, 987.77, N.D6, 0.5),
    // Final C-major held chord, one octave up on top.
    ...hit(2.05, N.C5, N.E5, N.G5, 2.6, 0.9),
    { at: 2.05, v: brass(N.C6, 0.6, 2.6) },
    { at: 2.1, v: bell(N.C7, 0.8, 2.2) },
    ...sparkleTimes.map((at, i) => ({ at, v: ping(sparkleNotes[i], 0.5) })),
    { at: 4.6, v: bell(N.C7, 0.5, 1.4) },
  ];
  writeFileSync(join(outDir, "milestone-25.wav"), wav(render(6.2, voices)));
  console.log("milestone-25.wav written (6.2s)");
}
