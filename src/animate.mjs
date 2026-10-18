/**
 * Lớp animation 2.5D cho video "Tri ân thầy cô 20/11".
 *
 * Ý tưởng: tách ảnh thành 2 lớp —
 *   - lớp nền (background): camera chuyển động chậm
 *   - lớp tiền cảnh (subject): có mặt nạ hình ellipse mềm, chuyển động mạnh hơn
 *     và lắc/lên xuống nhẹ  -> tạo cảm giác nhân vật đang chuyển động (parallax 2.5D)
 * Sau đó: motion blur bằng tmix + hạt bụi/cánh hoa rơi chồng lên.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ mặt nạ
/**
 * Sinh biểu thức geq cho một hình ellipse mềm, toạ độ chuẩn hoá (0..1)
 * theo ảnh gốc.
 */
export function ellipseMaskExpr({ cx, cy, rx, ry }, W = 1920, H = 1080, feather = 1.0) {
  const CX = (cx * W).toFixed(1);
  const CY = (cy * H).toFixed(1);
  const RX = Math.max(4, rx * W).toFixed(1);
  const RY = Math.max(4, ry * H).toFixed(1);
  return `255*pow(max(0,1-pow((X-${CX})/${RX},2)-pow((Y-${CY})/${RY},2)),${feather})`;
}

/** Render 1 mặt nạ thành file PNG (đen-trắng, 1920x1080). */
export function renderMaskPng(ffmpeg, { mask, out, W = 1920, H = 1080 }) {
  const expr = ellipseMaskExpr(mask, W, H);
  return new Promise((res, rej) => {
    const args = [
      '-y', '-f', 'lavfi',
      '-i', `color=c=black:s=${W}x${H}:r=1,format=gray,geq=lum='${expr}'`,
      '-frames:v', '1', '-pix_fmt', 'gray', out,
    ];
    const p = spawn(ffmpeg, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`mask lỗi: ${err.slice(-1500)}`))));
  });
}

// ------------------------------------------------------------------ hạt bụi
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

const PARTICLE_STYLES = {
  leaves: { count: 26, r: [5, 13], speed: [16, 46], alpha: [0.35, 0.8], colors: [[214, 74, 38], [232, 118, 48], [186, 48, 40]] },
  dust: { count: 46, r: [1.6, 4.2], speed: [4, 16], alpha: [0.2, 0.62], colors: [[255, 246, 226], [255, 232, 196]] },
  bokeh: { count: 20, r: [9, 22], speed: [3, 12], alpha: [0.16, 0.42], colors: [[255, 214, 150], [255, 238, 205], [246, 186, 96]] },
  spark: { count: 30, r: [2.5, 7], speed: [8, 26], alpha: [0.25, 0.7], colors: [[255, 226, 170], [255, 248, 230]] },
};

function drawSoftEllipse(buf, W, H, cx, cy, rx, ry, rot, [cr, cg, cb], peak) {
  const R = Math.max(rx, ry) + 1;
  const x0 = Math.max(0, Math.floor(cx - R));
  const x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(H - 1, Math.ceil(cy + R));
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * cos - dy * sin) / rx;
      const v = (dx * sin + dy * cos) / ry;
      const d = Math.sqrt(u * u + v * v);
      if (d >= 1) continue;
      const fall = (1 - d) * (1 - d);
      const a = fall * peak;
      if (a <= 0.002) continue;
      const i = (y * W + x) * 4;
      const sa = buf[i + 3] / 255;
      const outA = a + sa * (1 - a);
      if (outA <= 0) continue;
      buf[i] = Math.min(255, (cr * a + buf[i] * sa * (1 - a)) / outA);
      buf[i + 1] = Math.min(255, (cg * a + buf[i + 1] * sa * (1 - a)) / outA);
      buf[i + 2] = Math.min(255, (cb * a + buf[i + 2] * sa * (1 - a)) / outA);
      buf[i + 3] = Math.min(255, outA * 255);
    }
  }
}

/**
 * Tạo video hạt (cánh hoa rơi / bụi sáng / bokeh) dạng .mov qtrle (có alpha),
 * ghép được vào cảnh bằng filter overlay.
 */
export function makeParticleVideo({ ffmpeg, kind = 'dust', out, seconds = 4, fps = 30, W = 640, H = 360, seed = 7 }) {
  const style = PARTICLE_STYLES[kind] || PARTICLE_STYLES.dust;
  const rand = mulberry32(seed);
  const n = Math.round(seconds * fps);
  const particles = [];
  for (let i = 0; i < style.count; i++) {
    const down = kind === 'leaves';
    particles.push({
      x: rand() * W,
      y: rand() * H,
      r: style.r[0] + rand() * (style.r[1] - style.r[0]),
      vx: (rand() - 0.5) * style.speed[1] * (down ? 0.8 : 0.25),
      vy: down ? style.speed[0] + rand() * style.speed[1] : (rand() - 0.5) * style.speed[0] * 0.5,
      a: style.alpha[0] + rand() * (style.alpha[1] - style.alpha[0]),
      c: style.colors[Math.floor(rand() * style.colors.length)],
      ph: rand() * Math.PI * 2,
      sw: 0.6 + rand() * 1.6,
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 2.2,
    });
  }

  return new Promise((res, rej) => {
    const args = [
      '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'qtrle', '-pix_fmt', 'rgba', '-an', out,
    ];
    const p = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`hạt lỗi: ${err.slice(-1500)}`))));

    const buf = Buffer.alloc(W * H * 4);
    (async () => {
      for (let f = 0; f < n; f++) {
        buf.fill(0);
        const t = f / fps;
        for (const q of particles) {
          const x = (q.x + q.vx * t + Math.sin(t * q.sw + q.ph) * 9 + W * 100) % W;
          const y = (q.y + q.vy * t + W * 100) % H;
          const rot = q.rot + q.vr * t;
          const rx = q.r;
          const ry = q.r * (kind === 'leaves' ? 0.55 : 1);
          drawSoftEllipse(buf, W, H, x, y, rx, ry, rot, q.c, q.a);
        }
        if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
      }
      p.stdin.end();
    })().catch(rej);
  });
}

// ------------------------------------------------------------------ filter
/** Biểu thức zoompan cho một lớp. */
function motionExpr(m, N, fps) {
  const z = `${m.z0}+(${m.z1}-${m.z0})*on/${Math.max(1, N - 1)}`;
  const px = m.px ?? 0.5;
  const py = m.py ?? 0.5;
  const dp = m.dp ?? 0;
  const dy = m.dy ?? 0;
  const s = m.sway || {};
  const per = Math.max(1, Math.round((s.period ?? 3) * fps));
  const ax = s.ax ?? 0;
  const ay = s.ay ?? 0;
  const x = `(iw-iw/zoom)*(${px}+${dp}*on/${Math.max(1, N - 1)})+${ax}*sin(2*PI*on/${per})`;
  const y = `(ih-ih/zoom)*(${py}+${dy}*on/${Math.max(1, N - 1)})+${ay}*sin(2*PI*on/${per}+1.1)`;
  return { z, x, y };
}

/**
 * Dựng filtergraph cho một cảnh có chuyển động 2.5D.
 * @param seg       cảnh trong project.json
 * @param maskFiles danh sách file PNG mặt nạ (theo thứ tự lớp)
 * @param partFile  file .mov hạt (có thể null)
 */
export function sceneFiltergraph({ seg, maskFiles, partFile, W = 1920, H = 1080, fps = 30, dur }) {
  const N = Math.max(2, Math.round(dur * fps));
  const m = seg.motion || {};
  const bg = m.bg || { z0: 1, z1: 1.05, px: 0.5, py: 0.5 };
  const layers = m.layers || [];
  const CW = Math.round((W * 4) / 3);
  const CH = Math.round((H * 4) / 3);
  const base = `scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH}`;

  const parts = [];
  const n = layers.length + 1;
  parts.push(`[0:v]${base},split=${n}${Array.from({ length: n }, (_, i) => `[b${i}]`).join('')}`);

  const bgE = motionExpr(bg, N, fps);
  parts.push(`[b0]zoompan=z='${bgE.z}':x='${bgE.x}':y='${bgE.y}':d=1:s=${W}x${H}:fps=${fps}[bg]`);

  let cur = '[bg]';
  layers.forEach((L, i) => {
    const e = motionExpr(L, N, fps);
    const maskIn = i + 1;
    const partIn = maskFiles.length + 1; // chỉ dùng khi có particle
    parts.push(
      `[b${i + 1}]zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=1:s=${W}x${H}:fps=${fps}[fg${i}]`
    );
    parts.push(
      `[${maskIn}:v]${base},zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=1:s=${W}x${H}:fps=${fps}[msk${i}]`
    );
    parts.push(`[fg${i}][msk${i}]alphamerge[fgA${i}]`);
    parts.push(`${cur}[fgA${i}]overlay=format=auto[comp${i}]`);
    cur = `[comp${i}]`;
  });

  // motion blur: trộn vài frame liên tiếp -> cảm giác chuyển động thật
  parts.push(`${cur}tmix=frames=3:weights='0.25 0.35 0.40'[mb]`);

  if (partFile) {
    const pIn = maskFiles.length + 1;
    parts.push(
      `[${pIn}:v]scale=${W}:${H},fps=${fps},format=rgba,loop=loop=-1:size=0:start=0,setpts=N/(${fps}*TB)[part]`
    );
    parts.push(`[mb][part]overlay=format=auto[outv]`);
  } else {
    parts.push(`[mb]null[outv]`);
  }
  return { graph: parts.join(';'), partInputIndex: maskFiles.length + 1 };
}
