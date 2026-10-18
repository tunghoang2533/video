/**
 * Pipeline tạo video "Tri ân thầy cô 20/11"
 *
 *   ảnh AI (Ken Burns)  +  giọng đọc TTS  +  nhạc nền tổng hợp  +  phụ đề ASS
 *        ->  out/tri-an-thanh-co-20-11.mp4
 *
 * Chạy:  node src/build.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeMusic } from './music.mjs';
import { buildAss, buildSrt, splitCues, scheduleCues } from './subtitles.mjs';
import { renderMaskPng, makeParticleVideo, sceneFiltergraph } from './animate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');
const OUT = join(ROOT, 'out');

// ---------------------------------------------------------------- helpers
function run(cmd, args, label) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolvePromise(err);
      else reject(new Error(`[${label}] ${cmd} thất bại (code ${code})\n${err.slice(-4000)}`));
    });
  });
}

function firstUsable(candidates) {
  const { execFileSync } = require('node:child_process');
  for (const c of candidates) {
    if (!c) continue;
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return null;
}

function resolveFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  // Ưu tiên bản ffmpeg mới (>= 4.3) vì cần filter xfade
  try {
    const { execFileSync } = require('node:child_process');
    const p = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'])
      .toString()
      .trim();
    candidates.push(p);
  } catch {}
  try {
    const inst = require(`${ROOT}/node_modules/@ffmpeg-installer/ffmpeg`);
    candidates.push(inst.path);
  } catch {}
  candidates.push('ffmpeg');
  const found = firstUsable(candidates);
  if (!found) throw new Error('Không tìm thấy ffmpeg. Cài ffmpeg hoặc đặt biến môi trường FFMPEG_PATH.');
  return found;
}

function resolveFfprobe() {
  const candidates = [];
  if (process.env.FFPROBE_PATH) candidates.push(process.env.FFPROBE_PATH);
  try {
    const inst = require(`${ROOT}/node_modules/ffprobe-installer`);
    candidates.push(inst.path);
  } catch {}
  try {
    const inst = require(`${ROOT}/node_modules/@ffprobe-installer/ffprobe`);
    candidates.push(inst.path);
  } catch {}
  candidates.push('ffprobe');
  return firstUsable(candidates);
}

const require = (await import('node:module')).createRequire(import.meta.url);
let FFMPEG;
let FFPROBE;

async function probeDuration(file) {
  if (FFPROBE) {
    try {
      const { stdout } = await new Promise((res, rej) => {
        const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
        let o = '';
        p.stdout.on('data', (d) => (o += d));
        p.on('error', rej);
        p.on('close', () => res({ stdout: o }));
      });
      const v = parseFloat(stdout.trim());
      if (Number.isFinite(v)) return v;
    } catch {}
  }
  // Dự phòng: đọc Duration từ stderr của ffmpeg
  const { stderr } = await new Promise((res) => {
    const p = spawn(FFMPEG, ['-i', file]);
    let e = '';
    p.stderr.on('data', (d) => (e += d));
    p.on('close', () => res({ stderr: e }));
  });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) throw new Error(`Không đọc được thời lượng của ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const fmt = (n) => n.toFixed(3);

// ---------------------------------------------------------------- main
async function main() {
  FFMPEG = resolveFfmpeg();
  FFPROBE = resolveFfprobe();
  console.log(`🛠  ffmpeg : ${FFMPEG}`);
  console.log(`🛠  ffprobe: ${FFPROBE || '(dùng ffmpeg)'}`);

  const cfg = JSON.parse(readFileSync(join(ROOT, 'src/project.json'), 'utf8'));
  const { width: W, height: H, fps } = cfg;

  const reuse = process.argv.includes('--reuse');
  if (!reuse) rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // 1) đo thời lượng lời dẫn
  const scenes = [];
  for (const sc of cfg.scenes) {
    const dur = await probeDuration(join(ROOT, sc.audio));
    scenes.push({ ...sc, audioDur: dur, clipDur: cfg.lead + dur + cfg.tail });
  }

  // 2) dựng timeline
  const XF = cfg.transition;
  const segments = [];
  let t = 0;
  const titleStart = 0;
  segments.push({ kind: 'title', ...cfg.titleCard, start: titleStart, dur: cfg.titleCard.duration });
  t = cfg.titleCard.duration;
  for (const sc of scenes) {
    t = t - XF; // chuyển đoạn chồng lấn 0.8s
    segments.push({ kind: 'scene', ...sc, start: t, dur: sc.clipDur });
    t = t + sc.clipDur;
  }
  t = t - XF;
  segments.push({ kind: 'closing', ...cfg.closingCard, start: t, dur: cfg.closingCard.duration });
  t = t + cfg.closingCard.duration;

  const totalDuration = t;
  console.log(`⏱  Tổng thời lượng video: ${fmt(totalDuration)}s`);

  // 3) phụ đề (ASS)
  const narrationCues = [];
  for (const seg of segments.filter((s) => s.kind === 'scene')) {
    const cues = splitCues(seg.narration);
    const start = seg.start + cfg.lead;
    narrationCues.push(...scheduleCues(cues, start, seg.audioDur));
  }
  const cards = [];
  for (const seg of segments.filter((s) => s.kind !== 'scene')) {
    cards.push({
      lines: seg.lines.map((l) => ({
        ...l,
        start: seg.start + l.start,
        end: seg.start + l.end,
      })),
    });
  }
  const assPath = join(BUILD, 'subs.ass');
  const ass = buildAss({ width: W, height: H, narrationCues, cards });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(assPath, ass);
  writeFileSync(join(OUT, cfg.outName.replace(/\.mp4$/, '.srt')), buildSrt({ narrationCues }));
  console.log(`💬 ${narrationCues.length} câu phụ đề, ${cards.flatMap((c) => c.lines).length} dòng tiêu đề`);

  if (process.argv.includes('--subs-only')) {
    console.log('✅ Đã xuất phụ đề (ASS + SRT).');
    return;
  }

  // 4) render từng đoạn video (Ken Burns / blur cho card)
  const segFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const out = join(BUILD, `seg${String(i).padStart(2, '0')}.mp4`);
    if (reuse && existsSync(out) && statSync(out).size > 1000) {
      segFiles.push(out);
      console.log(`♻️  dùng lại đoạn ${i + 1}/${segments.length}`);
      continue;
    }
    const N = Math.max(2, Math.round(seg.dur * fps));

    if (seg.kind === 'scene' && seg.motion) {
      // --- Chuyển động 2.5D: nền + lớp nhân vật (mặt nạ) + hạt bay ---
      const maskFiles = [];
      for (const [li, L] of (seg.motion.layers || []).entries()) {
        const mf = join(BUILD, `mask${seg.id}_${li}.png`);
        if (!(reuse && existsSync(mf))) await renderMaskPng(FFMPEG, { mask: L.mask, out: mf, W, H });
        maskFiles.push(mf);
      }
      let partFile = null;
      if (seg.motion.particles) {
        const pc = seg.motion.particles;
        partFile = join(BUILD, `particles_${pc.kind}_${pc.seed}.mov`);
        if (!(reuse && existsSync(partFile))) {
          await makeParticleVideo({
            ffmpeg: FFMPEG, kind: pc.kind, out: partFile,
            seconds: pc.seconds || 4, fps, seed: pc.seed || 1,
          });
        }
      }
      const { graph } = sceneFiltergraph({ seg, maskFiles, partFile, W, H, fps, dur: seg.dur });
      const inputs = ['-loop', '1', '-framerate', String(fps), '-i', join(ROOT, seg.image)];
      for (const mf of maskFiles) inputs.push('-loop', '1', '-i', mf);
      if (partFile) inputs.push('-i', partFile);
      const full = `${graph};[outv]${seg.grade},vignette=PI/5[final]`;
      await run(
        FFMPEG,
        ['-y', ...inputs, '-filter_complex', full, '-map', '[final]', '-t', fmt(seg.dur),
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
         '-r', String(fps), '-an', out],
        `render scene ${seg.id}`
      );
      segFiles.push(out);
      console.log(`🎞  render ${i + 1}/${segments.length} (cảnh ${seg.id} — 2.5D + ${seg.motion.particles?.kind || 'hạt'}) — ${fmt(seg.dur)}s`);
      continue;
    }

    // --- Thẻ tiêu đề: nền ảnh làm mờ + zoom chậm ---
    const kb = seg.kenburns || { z0: 1.0, z1: 1.08, px: 0.5, py: 0.5 };
    const dp = kb.dp ?? 0.06;
    const dy = kb.dy ?? 0.04;
    const zExpr = `${kb.z0}+(${kb.z1}-${kb.z0})*on/${N - 1}`;
    const xExpr = `(iw-iw/zoom)*(${kb.px}+${dp}*on/${N - 1})`;
    const yExpr = `(ih-ih/zoom)*(${kb.py}+${dy}*on/${N - 1})`;
    const base = `scale=${W * 4 / 3}:${H * 4 / 3}:force_original_aspect_ratio=increase,crop=${W * 4 / 3}:${H * 4 / 3}`;
    const blur = seg.kind === 'scene' ? '' : `,gblur=sigma=26,eq=brightness=-0.10:saturation=1.08`;
    const grade = seg.kind === 'scene' ? seg.grade : 'eq=saturation=1.05:contrast=1.04:brightness=-0.08';
    const vf = `${base}${blur},${grade},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${W}x${H}:fps=${fps},vignette=PI/5`;
    await run(
      FFMPEG,
      ['-y', '-loop', '1', '-framerate', String(fps), '-i', join(ROOT, seg.image), '-t', fmt(seg.dur),
       '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
       '-r', String(fps), '-an', out],
      `render ${seg.kind} ${i}`
    );
    segFiles.push(out);
    console.log(`🎞  render ${i + 1}/${segments.length} (${seg.kind}) — ${fmt(seg.dur)}s`);
  }

  // 5) nối các đoạn bằng xfade + đốt phụ đề
  const inputs = [];
  segFiles.forEach((f) => inputs.push('-i', f));
  const fc = [];
  let prev = '0:v';
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const label = `x${i}`;
    const trans = seg.transition || 'fade';
    fc.push(`[${prev}][${i}:v]xfade=transition=${trans}:duration=${XF}:offset=${fmt(seg.start)}[${label}]`);
    prev = label;
  }
  fc.push(`[${prev}]fade=t=out:st=${fmt(totalDuration - 1.2)}:d=1.2,subtitles=build/subs.ass:fontsdir=/usr/share/fonts[vout]`);
  const videoRaw = join(BUILD, 'video.mp4');
  await run(
    FFMPEG,
    ['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps),
     '-movflags', '+faststart', videoRaw],
    'xfade'
  );

  // 6) nhạc nền tổng hợp
  const musicPath = join(BUILD, 'music.wav');
  synthesizeMusic({ duration: totalDuration, outPath: musicPath });
  console.log('🎵  đã tổng hợp nhạc nền');

  // 7) ghép lời dẫn theo đúng mốc thời gian
  const voInputs = [];
  const voFilters = [];
  scenes.forEach((sc, i) => {
    const seg = segments.filter((s) => s.kind === 'scene')[i];
    const delay = Math.round((seg.start + cfg.lead) * 1000);
    voInputs.push('-i', join(ROOT, sc.audio));
    voFilters.push(`[${i}:a]adelay=${delay}|${delay}[a${i}]`);
  });
  const voLabels = scenes.map((_, i) => `[a${i}]`).join('');
  const voPath = join(BUILD, 'vo.wav');
  await run(
    FFMPEG,
    ['-y', ...voInputs, '-filter_complex',
     `${voFilters.join(';')};${voLabels}amix=inputs=${scenes.length}:normalize=0:dropout_transition=0,highpass=f=90,lowpass=f=13000,aecho=0.8:0.6:45:0.12,alimiter=limit=0.95[vo]`,
     '-map', '[vo]', '-ar', '44100', '-ac', '2', voPath],
    'voiceover'
  );

  // 8) trộn voice + nhạc, xuất file cuối
  const finalPath = join(OUT, cfg.outName);
  await run(
    FFMPEG,
    ['-y', '-i', videoRaw, '-i', voPath, '-i', musicPath, '-filter_complex',
     '[1:a]volume=1.05[vo];[2:a]volume=0.42[bg];[vo][bg]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.98,loudnorm=I=-15:TP=-1.5:LRA=11,afade=t=out:st=' +
     fmt(totalDuration - 2.5) + ':d=2.5[a]',
     '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
     '-movflags', '+faststart', finalPath],
    'mix'
  );

  // 9) ảnh đại diện + vài khung hình để kiểm tra
  await run(FFMPEG, ['-y', '-ss', '2.0', '-i', finalPath, '-frames:v', '1', '-q:v', '2', join(OUT, 'poster.jpg')], 'poster');
  for (const [i, at] of [2, 12, 20, 30, 40, 50, 62, 74].entries()) {
    await run(FFMPEG, ['-y', '-ss', String(at), '-i', finalPath, '-frames:v', '1', '-q:v', '3',
      join(BUILD, `frame${i}.jpg`)], 'frame');
  }

  const size = (statSync(finalPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Xong: ${finalPath}  (${fmt(totalDuration)}s, ${size} MB)`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
