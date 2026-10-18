/**
 * Sinh file phụ đề ASS (libass) từ lời dẫn, tự chia câu và canh thời gian
 * theo tỉ lệ độ dài câu so với thời lượng audio của cảnh.
 */

function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Tách lời dẫn thành các câu ngắn, ưu tiên cắt ở dấu câu tự nhiên. */
export function splitCues(text, maxLen = 52) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const cues = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length <= maxLen) {
      cues.push(s);
      continue;
    }
    // Câu dài -> cắt theo dấu phẩy trước, sau đó theo từ
    const parts = s.split(/(?<=,)\s+/);
    let current = '';
    for (const part of parts) {
      if ((current + ' ' + part).trim().length > maxLen && current) {
        cues.push(current.trim());
        current = part;
      } else {
        current = (current + ' ' + part).trim();
      }
    }
    if (current) {
      if (current.length > maxLen) {
        let words = current.split(' ');
        let buf = '';
        for (const w of words) {
          if ((buf + ' ' + w).trim().length > maxLen && buf) {
            cues.push(buf.trim());
            buf = w;
          } else buf = (buf + ' ' + w).trim();
        }
        if (buf) cues.push(buf.trim());
      } else cues.push(current.trim());
    }
  }
  // Gộp các mảnh quá ngắn vào câu kề (tránh caption 2-3 từ)
  const merged = [];
  for (const c of cues) {
    if (merged.length && (merged[merged.length - 1] + ' ' + c).length <= maxLen && merged[merged.length - 1].length < 24) {
      merged[merged.length - 1] = (merged[merged.length - 1] + ' ' + c).trim();
    } else merged.push(c);
  }
  return merged;
}

/** Ngắt dòng cân đối: ưu tiên 2 dòng dài bằng nhau. */
export function wrapCue(cue, maxLine = 34) {
  if (cue.length <= maxLine) return cue;
  const words = cue.split(' ');
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const d = Math.abs(a - b);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  const line1 = words.slice(0, best).join(' ');
  const line2 = words.slice(best).join(' ');
  if (!line2) return line1;
  return `${line1}\\N${line2}`;
}

/** Canh thời gian cho các cue theo tỉ lệ trọng số (độ dài + dấu câu). */
export function scheduleCues(cues, start, duration) {
  const weights = cues.map((c) => {
    const pauses = (c.match(/[.,!?;]/g) || []).length;
    return c.length + pauses * 6;
  });
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const pad = 0.12;
  const usable = Math.max(0.5, duration - pad);
  let t = start + pad * 0.5;
  return cues.map((cue, i) => {
    const d = (weights[i] / totalW) * usable;
    const item = { text: cue, start: t, end: t + d };
    t += d;
    return item;
  });
}

/** Xuất phụ đề SRT (tiện để chỉnh sửa tiếp trong CapCut / Premiere). */
export function buildSrt({ narrationCues = [] }) {
  const t = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const c = String(ms % 1000).padStart(3, '0');
    return `${h}:${m}:${s},${c}`;
  };
  return (
    narrationCues
      .map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${wrapCue(c.text).replace(/\\N/g, '\n')}\n`)
      .join('\n') + '\n'
  );
}

export function buildAss({ width, height, narrationCues = [], cards = [] }) {
  const header = `[Script Info]
Title: Tri ân thầy cô 20/11
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narration,DejaVu Sans,42,&H00FFFFFF,&H000000FF,&H00101010,&HA0000000,0,0,0,0,100,100,0,0,3,1,0,2,150,150,78,1
Style: Title,DejaVu Serif,96,&H008AD9F5,&H000000FF,&H00202020,&H00000000,1,0,0,0,100,100,2,0,1,0,0,5,80,80,80,1
Style: CardSub,DejaVu Sans,34,&H00FFFFFF,&H000000FF,&H00202020,&H64000000,0,0,0,0,100,100,0,0,1,0,0,5,140,140,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = [];
  for (const c of narrationCues) {
    events.push(
      `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Narration,,0,0,0,,{\\fad(180,180)}${wrapCue(c.text)}`
    );
  }
  for (const card of cards) {
    for (const line of card.lines) {
      const fade = Math.min(700, (line.end - line.start) * 0.35);
      events.push(
        `Dialogue: 0,${assTime(line.start)},${assTime(line.end)},${line.style},,0,0,0,,{\\fad(${Math.round(fade)},${Math.round(
          fade
        )})}${line.text}`
      );
    }
  }
  return `${header}\n${events.join('\n')}\n`;
}
