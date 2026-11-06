# Akapella

Tách một bản nhạc thành các stem WAV trên máy. Nguồn có thể là file MP3, WAV, FLAC, M4A, MP4 hoặc link công khai mà yt-dlp đọc được. Chế độ mặc định xuất giọng hát, bass, trống tổng, phần nhạc còn lại và một bản nhạc không lời.

## Dùng trên web

[Mở Akapella](https://akapella.vercel.app/)

Bản web trong thư mục `web/` tách file âm thanh thành 4 hoặc 6 stem và xuất WAV. Dùng dạng sóng để tua, chuyển giữa bản gốc và bản tách, hoặc dùng Solo và Mute để nghe từng lớp âm thanh. Web hỗ trợ file mono hoặc stereo, tối đa 50 MB và 5 phút. Model tải về trình duyệt và chạy trong Web Worker. Âm thanh của bạn được xử lý trên thiết bị. [HTDemucs trên trình duyệt](https://stemsplit.github.io/demucs-onnx/browser/)

Lần tách đầu cần tải khoảng 166 MB cho chế độ 4 stem hoặc 136 MB cho 6 stem. Trình duyệt lưu model nếu có chỗ. Studio hiển thị dung lượng tải, số đoạn đã tách và trạng thái xuất WAV. Bạn có thể hủy và thử lại với cùng file.

BPM và giọng trưởng/thứ được ước tính ngay khi mở bài, kể cả khi bạn chỉ muốn phân tích mà chưa tách stem. Kết quả thể hiện nhịp và giọng chính của toàn file. Bản nhạc đổi nhịp, chuyển giọng hoặc chỉ có tiếng trống có thể cho kết quả chưa rõ. [Phương pháp ước tính BPM](https://labrosa.ee.columbia.edu/~dpwe/resources/matlab/beat_simple/) · [Phương pháp ước tính giọng](https://music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html)

Để tách stem từ link YouTube, Facebook hoặc tách từng phần bộ trống như hi-hat, dùng bản CLI dưới đây.

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

## Tải MP3 từ YouTube

Cài môi trường Python và FFmpeg theo hướng dẫn trên, sau đó chạy trong thư mục repo:

```bash
source .venv/bin/activate
python serve.py
```

Mở [Akapella trên máy](http://127.0.0.1:8765/#youtube), dán link và chọn **Tải MP3**. Akapella xuất MP3 192 kbps từ video công khai dài tối đa 20 phút. Trang Vercel chuyển link đã nhập sang trang trên máy. Quá trình lấy video và đổi sang MP3 chạy bằng yt-dlp và FFmpeg trên máy của bạn. [Hỗ trợ YouTube của yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

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
