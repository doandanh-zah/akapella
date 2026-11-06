# Akapella

Tách một bản nhạc thành các stem WAV trên máy. Nguồn có thể là file MP3, WAV, FLAC, M4A, MP4 hoặc link công khai mà yt-dlp đọc được. Chế độ mặc định xuất giọng hát, bass, trống tổng, phần nhạc còn lại và một bản nhạc không lời.

## Chạy trên macOS

Cần Python 3.11, FFmpeg, FFprobe và vài GB trống cho môi trường, model và file WAV. Để lấy nguồn YouTube, dùng Deno hoặc Node.js 22 trở lên. Akapella tự bật Node nếu có trong PATH.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --no-cache-dir -r requirements.txt
```

```bash
# Tách từ file
python akapella.py "bai-hat.mp3" -o stems/bai-hat

# Tách từ URL YouTube, Facebook hoặc nền tảng được yt-dlp hỗ trợ
python akapella.py "URL_VIDEO_CONG_KHAI" -o stems/video

# Thêm stem guitar và piano
python akapella.py "bai-hat.flac" -o stems/sau-stem --stems 6
```

Dùng thư mục đầu ra mới cho mỗi lần chạy. Chế độ mặc định xuất `vocals.wav`, `bass.wav`, `drums.wav` và `other.wav`. `instrumental.wav` là bản cộng các stem ngoài giọng hát. Với `--stems 6`, bản không lời cũng bao gồm guitar và piano. Các WAV đều là stereo 44,1 kHz và bắt đầu cùng mốc thời gian để đưa vào DAW.

## Tách riêng hi-hat và từng phần của bộ trống

```bash
python -m pip install --no-cache-dir -r requirements-drums.txt
python akapella.py "bai-hat.mp3" -o stems/bo-trong --drum-kit
```

DrumSep chạy thêm trên `drums.wav` và xuất `kick.wav`, `snare.wav`, `toms.wav`, `hihat.wav`, `ride.wav` và `crash.wav` trong thư mục `drum-kit/`. Có thể dùng cùng `--stems 6`. Trọng số DrumSep được tải riêng khi bật tùy chọn này. Điều khoản cho trọng số chưa được tác giả công bố chính thức. [DrumSep và nguồn trọng số](https://github.com/openmirlab/mdxnet-infer#license)

## Phạm vi bản đầu

- Akapella chạy inference trên CPU và xử lý âm thanh cục bộ. Lần chạy đầu của mỗi chế độ cần mạng để tải model. [HTDemucs ONNX](https://github.com/StemSplit/demucs-onnx)
- Mỗi lần chạy xử lý một nguồn dài tối đa 20 phút. Với link, Akapella lấy tối đa một mục và bỏ qua livestream. Hãy dùng nguồn bạn có quyền xử lý.
- Với video cần đăng nhập, bị giới hạn truy cập hoặc gặp lỗi extractor, hãy thử với file MP3/MP4 bạn có sẵn. YouTube và Facebook có thể thay đổi cách phân phối media. [Danh sách nền tảng và giới hạn của yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- Chất lượng tùy bản phối. Có thể còn tiếng lẫn giữa các stem, đặc biệt là hi-hat với cymbal. Chế độ guitar/piano dùng model sáu nguồn riêng. [Các model của HTDemucs](https://github.com/facebookresearch/demucs#available-models)
