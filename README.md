# 🎬 Video tri ân thầy cô 20/11

Video "Tri ân thầy cô 20/11" được dựng hoàn toàn bằng AI + pipeline tự động trong repo này:
ảnh AI → hiệu ứng Ken Burns → lời dẫn TTS (giọng nữ Việt) → nhạc nền tổng hợp → phụ đề → file MP4 1080p.

**Kết quả:** [`out/tri-an-thanh-co-20-11.mp4`](out/tri-an-thanh-co-20-11.mp4) — 1920×1080, 78 giây, H.264/AAC.

| | |
|---|---|
| Thời lượng | 78 giây |
| Khung hình | 16:9 — 1920×1080 @ 30fps |
| Âm thanh | Lời dẫn TTS nữ Việt (voice-00) + nhạc nền tổng hợp, chuẩn loudness -15 LUFS |
| Phụ đề | Đốt trong video (ASS) + file `.srt` rời để chỉnh sửa |

## Cấu trúc

```
src/
  project.json   # kịch bản: các cảnh, lời dẫn, hiệu ứng, tiêu đề đầu/cuối
  build.mjs      # pipeline chính (render cảnh → xfade → ghép âm thanh → xuất MP4)
  subtitles.mjs  # tách câu, canh thời gian, sinh phụ đề ASS + SRT
  music.mjs      # tổng hợp nhạc nền (pad + arpeggio + reverb) bằng toán học thuần
assets/
  scenes/        # 6 ảnh AI (sinh bằng công cụ tạo ảnh AI)
  vo/            # 6 file giọng đọc (TTS)
out/             # video + phụ đề + poster
```

## Chạy lại pipeline

```bash
npm install                 # cài ffmpeg/ffprobe dùng cho máy này
node src/build.mjs          # dựng lại toàn bộ video (~7 phút)
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
* `kenburns` → chuyển động zoom/pan của ảnh (`z0` → `z1`, `px`/`py` vị trí khung hình)
* `grade` → chỉnh màu (nhiệt màu, tương phản, bão hoà)
* `transition` → hiệu ứng chuyển cảnh (`fade`, `dissolve`, `smoothleft`, `smoothright`, `smoothup`)
* `titleCard` / `closingCard` → thẻ tiêu đề đầu và cuối

Sau khi đổi lời dẫn, sinh lại file giọng đọc cho từng cảnh (đặt tên `sceneNN.mp3` trong `assets/vo/`)
rồi chạy lại `node src/build.mjs --reuse` để pipeline tự đo lại thời lượng và canh phụ đề.

## Kỹ thuật trong video

* **Ảnh**: 6 ảnh AI 16:9, mỗi ảnh chuyển động Ken Burns (zoom + pan) theo từng cảnh
* **Chuyển cảnh**: `xfade` với 5 hiệu ứng khác nhau, mỗi đoạn chồng lấn 0.8s
* **Màu**: chỉnh nhiệt màu riêng cho từng cảnh + vignette làm mềm khung hình
* **Thẻ tiêu đề**: nền ảnh làm mờ (`gblur`) + chữ vàng serif, fade in/out bằng `\fad` của ASS
* **Phụ đề**: tự tách câu, ngắt dòng cân đối, canh thời gian theo tỉ lệ độ dài câu với âm thanh
* **Nhạc nền**: sinh bằng Node.js (pad 4 hợp âm + arpeggio + reverb Schroeder), không cần file nhạc ngoài
* **Âm thanh**: `adelay` đặt lời dẫn theo timeline, trộn với nhạc nền, `loudnorm` chuẩn hoá
