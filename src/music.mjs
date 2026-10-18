/**
 * Bộ tổng hợp nhạc nền (pad + arpeggio) bằng toán học thuần,
 * xuất ra file WAV stereo 44.1kHz — không cần thư viện ngoài.
 */
import { writeFileSync } from 'node:fs';

const SR = 44100;

// Hợp âm ở hợp âm La thứ nhấp — ấm và trong trẻo, hợp với chủ đề tri ân.
const CHORDS = [
  { notes: [110.0, 164.81, 220.0, 261.63], arp: [440.0, 523.25, 659.25, 880.0] }, // Am
  { notes: [87.31, 130.81, 174.61, 220.0], arp: [349.23, 440.0, 523.25, 698.46] }, // F
  { notes: [130.81, 196.0, 261.63, 329.63], arp: [392.0, 523.25, 659.25, 784.0] }, // C
  { notes: [98.0, 146.83, 196.0, 246.94], arp: [392.0, 493.88, 587.33, 784.0] }, // G
];

const CHORD_SEC = 4.0;
const ARP_STEP = 0.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vang phản xạ (Schroeder: 4 comb + 2 allpass) */
function makeReverb(size = 0.5) {
  const combDelays = [1116, 1188, 1277, 1356].map((d) => Math.round(d * size));
  const allpassDelays = [556, 441].map((d) => Math.round(d * size));
  const combs = combDelays.map((d) => ({ buf: new Float32Array(d), idx: 0, fb: 0.78, lp: 0 }));
  const aps = allpassDelays.map((d) => ({ buf: new Float32Array(d), idx: 0, g: 0.5 }));

  return (input) => {
    let out = 0;
    for (const c of combs) {
      const y = c.buf[c.idx];
      c.lp = y * 0.7 + c.lp * 0.3; // hạ thấp nhiễu trầm
      c.buf[c.idx] = input + c.lp * c.fb;
      c.idx = (c.idx + 1) % c.buf.length;
      out += y * 0.25;
    }
    let signal = out;
    for (const a of aps) {
      const y = a.buf[a.idx];
      const v = signal + y * a.g;
      a.buf[a.idx] = v;
      a.idx = (a.idx + 1) % a.buf.length;
      signal = y - v * a.g;
    }
    return signal;
  };
}

export function synthesizeMusic({ duration, outPath, seed = 20261120 }) {
  const total = Math.ceil(duration * SR);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const rand = mulberry32(seed);

  // --- Pad: tổng các sóng sine với độ lệch tần nhẹ, bao hình chậm ---
  for (let c = 0; c < CHORDS.length; c++) {
    const start = c * CHORD_SEC;
    const len = Math.min(CHORD_SEC * 1.6, duration - start);
    if (len <= 0) break;
    const n0 = Math.floor(start * SR);
    const n1 = Math.min(total, n0 + Math.floor(len * SR));
    const chord = CHORDS[c];
    const detunes = [0, 0.35, -0.4, 0.18].map(() => (rand() - 0.5) * 0.7);
    const phase = [0, 0, 0, 0].map(() => rand() * Math.PI * 2);
    for (let i = n0; i < n1; i++) {
      const t = (i - n0) / SR;
      const p = (i - n0) / (n1 - n0);
      // attack 1.6s -> sustain -> release 1.8s
      const env =
        Math.min(1, t / 1.6) * Math.min(1, Math.max(0, (len - t) / 1.8));
      let s = 0;
      for (let k = 0; k < chord.notes.length; k++) {
        const f = chord.notes[k] + detunes[k];
        s += Math.sin(2 * Math.PI * f * t + phase[k]) * (k === 0 ? 1 : 0.62);
      }
      s = (s / 3.0) * env * 0.5;
      const shimmer = 1 + 0.06 * Math.sin(2 * Math.PI * 0.07 * t);
      left[i] += s * shimmer;
      right[i] += s * (1 / shimmer);
    }
  }

  // --- Arpeggio: nốt "gảy" mềm, tổng hợp giai điệu ---
  const stepCount = Math.floor(duration / ARP_STEP);
  for (let s = 0; s < stepCount; s++) {
    const t0 = s * ARP_STEP;
    const chord = CHORDS[Math.floor(t0 / CHORD_SEC) % CHORDS.length];
    const pattern = [0, 1, 2, 3, 2, 1, 3, 2];
    const f = chord.arp[pattern[s % pattern.length]] * (s % 8 === 4 ? 2 : 1);
    const idx0 = Math.floor(t0 * SR);
    const dur = 1.5;
    const len = Math.floor(dur * SR);
    const pan = ((s % 4) - 1.5) * 0.12;
    for (let i = 0; i < len; i++) {
      const g = idx0 + i;
      if (g >= total) break;
      const t = i / SR;
      const env = Math.exp(-3.1 * t) * Math.min(1, t / 0.008);
      const s1 = Math.sin(2 * Math.PI * f * t);
      const s2 = Math.sin(2 * Math.PI * f * 2 * t) * 0.22;
      const s3 = Math.sin(2 * Math.PI * f * 3 * t) * 0.08;
      const v = (s1 + s2 + s3) * env * 0.17;
      left[g] += v * (0.5 - pan);
      right[g] += v * (0.5 + pan);
    }
  }

  // --- Vang phản ---
  const revL = makeReverb(0.6);
  const revR = makeReverb(0.62);
  const wetL = new Float32Array(total);
  const wetR = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    wetL[i] = revL(left[i]);
    wetR[i] = revR(right[i]);
  }

  // --- Master: soft clip + fade ---
  const fadeIn = Math.floor(2.5 * SR);
  const fadeOut = Math.floor(4 * SR);
  const outL = new Float32Array(total);
  const outR = new Float32Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    let l = left[i] * 0.8 + wetL[i] * 0.9;
    let r = right[i] * 0.8 + wetR[i] * 0.9;
    l = Math.tanh(l * 1.25);
    r = Math.tanh(r * 1.25);
    if (i < fadeIn) {
      const g = i / fadeIn;
      l *= g;
      r *= g;
    }
    if (i > total - fadeOut) {
      const g = Math.max(0, (total - i) / fadeOut);
      l *= g;
      r *= g;
    }
    outL[i] = l;
    outR[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const norm = peak > 0 ? 0.62 / peak : 1;

  // Ghi WAV 16-bit stereo
  const dataBytes = total * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < total; i++) {
    const l = Math.max(-1, Math.min(1, outL[i] * norm));
    const r = Math.max(-1, Math.min(1, outR[i] * norm));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  writeFileSync(outPath, buf);
  return { path: outPath, duration, seconds: total / SR };
}
