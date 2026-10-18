# 🎬 Video tri ân thầy cô 20/11

Video "Tri ân thầy cô 20/11" được dựng hoàn toàn bằng AI + pipeline tự động trong repo này:
ảnh AI → **animation 2.5D (nhân vật chuyển động)** → lời dẫn TTS (giọng nữ Việt) → nhạc nền tổng hợp → phụ đề → file MP4 1080p.

**Kết quả:** [`out/tri-an-thanh-co-20-11.mp4`](out/tri-an-thanh-co-20-11.mp4) — 1920×1080, 78 giây, H.264/AAC.

| | |
|---|---|
| Thời lượng | 78 giây |
| Khung hình | 16:9 — 1920×1080 @ 30fps |
| Chuyển động | 2.5D parallax + sway + motion blur + hạt bụi/cánh hoa |
| Âm thanh | Lời dẫn TTS nữ Việt (voice-00) + nhạc nền tổng hợp, chuẩn loudness -15 LUFS |
| Phụ đề | Đốt trong video (ASS) + file `.srt` rời để chỉnh sửa |

## Cấu trúc

```
src/
  project.json   # kịch bản: các cảnh, lời dẫn, lớp chuyển động, tiêu đề đầu/cuối
  build.mjs      # pipeline chính (render cảnh → xfade → ghép âm thanh → xuất MP4)
  animate.mjs    # lớp animation 2.5D: mặt nạ nhân vật, parallax, hạt bay
  subtitles.mjs  # tách câu, canh thời gian, sinh phụ đề ASS + SRT
  music.mjs      # tổng hợp nhạc nền (pad + arpeggio + reverb) bằng toán học thuần
assets/
  scenes/        # 6 ảnh AI (sinh bằng công cụ tạo ảnh AI, có dấu hiệu chuyển động)
  vo/            # 6 file giọng đọc (TTS)
out/             # video + phụ đề + poster
```

## Nhân vật chuyển động (animation 2.5D)

Thay vì trượt ảnh (Ken Burns thuần), mỗi cảnh được chia thành nhiều lớp và **chuyển động lệch pha nhau**,
tạo cảm giác nhân vật đang cử động thật:

1. **Mặt nạ nhân vật** — mỗi lớp tiền cảnh dùng một hình ellipse mềm (`geq` sinh mask) đúng vị trí nhân vật.
2. **Parallax** — lớp nền zoom nhẹ (1.00 → 1.04), lớp nhân vật zoom mạnh hơn (1.00 → 1.11) và lệch tâm,
   nên nhân vật dần "tiến lại gần" so với phông nền.
3. **Sway / bob** — thêm dao động sin nhẹ theo trục X–Y (vài pixel, chu kỳ 1.4–2.8s) để thân người
   chuyển động như đang đi, đang viết, cờ đang bay.
4. **Motion blur** — `tmix` trộn 3 frame liên tiếp tạo vệt mờ chuyển động.
5. **Hạt bay** — lớp hạt được tổng hợp bằng Node.js (cánh hoa rơi, bụi sáng, bokeh, tia lấp lánh)
   rồi ghép `overlay` lên cảnh.

Mọi tham số nằm trong `src/project.json` → mục `motion` của từng cảnh:

```json
"motion": {
  "bg": { "z0": 1.0, "z1": 1.04, "px": 0.5, "py": 0.5 },
  "layers": [{
    "mask": { "cx": 0.55, "cy": 0.66, "rx": 0.17, "ry": 0.40 },
    "z0": 1.0, "z1": 1.11, "px": 0.55, "py": 0.62,
    "sway": { "ax": 14, "ay": 13, "period": 1.9 }
  }],
  "particles": { "kind": "leaves", "seconds": 4, "seed": 11 }
}
```

* `mask` — vị trí nhân vật (toạ độ chuẩn hoá 0–1 của ảnh gốc) + bán kính ellipse
* `z0 → z1` — mức zoom của lớp (lớp nhân vật zoom mạnh hơn lớp nền để tạo chiều sâu)
* `sway` — biên độ lắc X/Y (px) và chu kỳ (giây)
* `particles.kind` — `leaves` · `dust` · `bokeh` · `spark`

> Muốn thêm "nhân vật" thứ hai trong cùng cảnh? Thêm một phần tử vào `layers` — pipeline tự sinh mặt nạ
> và ghép lớp thứ hai, mỗi lớp một tốc độ chuyển động khác nhau.

## Chạy lại pipeline

```bash
npm install                 # cài ffmpeg/ffprobe dùng cho máy này
node src/build.mjs          # dựng lại toàn bộ video (~12 phút)
node src/build.mjs --reuse  # dùng lại các đoạn đã render, chỉ ghép lại (~2 phút)
node src/build.mjs --subs-only   # chỉ xuất lại file phụ đề
```

> Cần **ffmpeg ≥ 4.3** (bắt buộc có filter `xfade`) và **libass** (để đốt phụ đề).
> Script tự dò ffmpeg qua biến `FFMPEG_PATH`, rồi tới các bản cài sẵn trong `node_modules`,
> và cuối cùng là `ffmpeg` trong `PATH`. Font dùng để đốt chữ là **DejaVu Sans**
> (đủ dấu tiếng Việt), nằm ở `/usr/share/fonts`.

## Sửa kịch bản

Mọi nội dung nằm trong `src/project.json`:

* `narration` của từng cảnh → lời dẫn (dùng để sinh file TTS trong `assets/vo/`)
* `motion` → lớp chuyển động 2.5D (mặt nạ, parallax, sway, hạt bay)
* `grade` → chỉnh màu (nhiệt màu, tương phản, bão hoà)
* `transition` → hiệu ứng chuyển cảnh (`fade`, `dissolve`, `smoothleft`, `smoothright`, `smoothup`)
* `titleCard` / `closingCard` → thẻ tiêu đề đầu và cuối

Sau khi đổi lời dẫn, sinh lại file giọng đọc cho từng cảnh (đặt tên `sceneNN.mp3` trong `assets/vo/`)
rồi chạy lại `node src/build.mjs --reuse` để pipeline tự đo lại thời lượng và canh phụ đề.

## Kỹ thuật trong video

* **Ảnh**: 6 ảnh AI 16:9 được sinh với dấu hiệu chuyển động (học sinh đang đi, tay đang viết phấn,
  giáo viên đang bước, cờ đang bay, tóc và ruy băng đang tung)
* **Chuyển động 2.5D**: tách lớp nền / lớp nhân vật bằng mặt nạ ellipse mềm, chuyển động lệch pha
  (parallax) + dao động sway/bob + `tmix` tạo motion blur
* **Hạt bay**: sinh trực tiếp bằng Node.js (RGBA → qtrle) rồi `overlay` lên cảnh
* **Chuyển cảnh**: `xfade` với 5 hiệu ứng khác nhau, mỗi đoạn chồng lấn 0.8s
* **Màu**: chỉnh nhiệt màu riêng cho từng cảnh + vignette làm mềm khung hình
* **Thẻ tiêu đề**: nền ảnh làm mờ (`gblur`) + chữ vàng serif, fade in/out bằng `\fad` của ASS
* **Phụ đề**: tự tách câu, ngắt dòng cân đối, canh thời gian theo tỉ lệ độ dài câu với âm thanh
* **Nhạc nền**: sinh bằng Node.js (pad 4 hợp âm + arpeggio + reverb), không cần file nhạc ngoài
* **Âm thanh**: `adelay` đặt lời dẫn theo timeline, trộn với nhạc nền, `loudnorm` chuẩn hoá
