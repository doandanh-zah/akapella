# Akapella

Tách một bản nhạc thành các stem WAV trên máy. Nguồn có thể là file MP3, WAV, FLAC, M4A, MP4 hoặc link công khai mà yt-dlp đọc được. Chế độ mặc định xuất giọng hát, bass, trống tổng, phần nhạc còn lại và một bản nhạc không lời.

## Dùng trên web

[Mở Akapella](https://akapella.vercel.app/)

Bản web tách file mono hoặc stereo thành giọng hát và bản không lời, hoặc chia thành 4 hay 6 stem. Các track được xuất WAV. Studio hỗ trợ file tối đa 50 MB và 5 phút. Dùng dạng sóng để tua, chuyển giữa bản gốc và bản tách, hoặc dùng Solo và Mute để nghe từng lớp âm thanh.

Trang Vercel gửi file lên một máy xử lý riêng cho mỗi lượt tách. Model nằm sẵn trên máy chủ. Mixer dùng FLAC để nghe thử, với WAV làm phương án dự phòng. Studio hiển thị số byte đã gửi, số đoạn đã tách và trạng thái xuất WAV. Bạn có thể hủy và thử lại với cùng file. Hãy lưu WAV trong vòng 15 phút từ lúc bắt đầu lượt tách.

Khi tự chạy bản web cục bộ mà chưa cấu hình máy chủ, Web Worker xử lý file trên thiết bị và tải khoảng 166 MB cho chế độ 4 stem hoặc 136 MB cho 6 stem trong lần đầu. [HTDemucs trên trình duyệt](https://stemsplit.github.io/demucs-onnx/browser/)

BPM và giọng trưởng/thứ được ước tính ngay khi mở bài, kể cả khi bạn chỉ muốn phân tích mà chưa tách stem. Kết quả thể hiện nhịp và giọng chính của toàn file. Bản nhạc đổi nhịp, chuyển giọng hoặc chỉ có tiếng trống có thể cho kết quả chưa rõ. [Phương pháp ước tính BPM](https://labrosa.ee.columbia.edu/~dpwe/resources/matlab/beat_simple/) · [Phương pháp ước tính giọng](https://music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html)

Trong studio, chọn **File nhạc** để tải file lên hoặc **Dán link** để máy chủ tự lấy âm thanh rồi tách theo chế độ đang chọn. Để tách riêng hi-hat và các thành phần bộ trống, dùng CLI dưới đây.

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

## Tách âm thanh từ link trên web

Chọn **Tách giọng** hoặc **4–6 stem**, chuyển nguồn sang **Dán link**, nhập URL HTTPS công khai rồi bấm **Lấy âm thanh & tách**. Máy chủ tải một nguồn tối đa 50 MB và 5 phút, sau đó xuất stem vào cùng mixer với luồng tải file. Bản gốc được tải về trình duyệt để nghe đối chiếu và tính BPM/tone.

Link YouTube kèm Radio hoặc playlist được chuẩn hóa về video đang chọn.

Luồng web dùng yt-dlp trên máy chủ với thời hạn tải 100 giây. YouTube và Facebook có thể chặn IP trung tâm dữ liệu hoặc yêu cầu đăng nhập. Khi gặp trường hợp đó, studio phân biệt lỗi giới hạn truy cập (HTTP 429), xác minh chống bot, yêu cầu quyền xem, giới hạn khu vực và thiếu luồng tải. Trạng thái job kèm mã lỗi tương ứng. Video công khai và ngắn vẫn có thể bị chặn khi máy chủ lấy nguồn. Lần kiểm tra Vercel gần nhất xác nhận link âm thanh HTTPS trực tiếp hoạt động, còn video YouTube thử nghiệm bị yêu cầu xác minh chống bot. [Hỗ trợ và giới hạn của yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)

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

## Máy chủ tách stem trên Vercel

Chạy `AKAPELLA_SANDBOX_REGION=sin1 sh cloud/provision-sandbox.sh` từ repo đã liên kết với Vercel để tạo snapshot Python, FFmpeg, HTDemucs 4/6 stem và KUIELab MDX-Net. Script xác minh SHA-256 của từng model. Đặt ID snapshot vào `AKAPELLA_SANDBOX_SNAPSHOT`, vùng snapshot vào `AKAPELLA_SANDBOX_REGION` và `AKAPELLA_SANDBOX_VOCALS=1` để bật tách giọng hai track. Đặt `AKAPELLA_SANDBOX_LINKS=1` với snapshot đã cài yt-dlp để bật nguồn link. Bật Vercel OIDC. [KUIELab MDX-Net, mã nguồn và trọng số](https://github.com/kuielab/mdx-net-submission/tree/18014d705e18f222e53c7d049a0994a27c1c41be) Mỗi lượt tách chạy trong một sandbox 4 vCPU với thời hạn 15 phút với mạng đi ra bị chặn cho job tải file. Job từ link chỉ được truy cập địa chỉ công khai, có kiểm tra DNS và chặn các dải địa chỉ nội bộ. Gateway chuyển trình duyệt sang URL riêng của job để tải file và WAV trực tiếp.

Đặt secret ngẫu nhiên `AKAPELLA_RATE_KEY` dài ít nhất 32 ký tự cho bản công khai. Gateway giới hạn mỗi IP tối đa một job trong mỗi cửa sổ 20 giây và lưu mã HMAC của IP và cửa sổ trong tên sandbox. Môi trường thử nghiệm có thể dùng `AKAPELLA_PILOT_CODE` dài ít nhất 20 ký tự nếu chưa đặt rate key. Gói Hobby dừng tạo sandbox khi dùng hết hạn mức của tài khoản. [Vercel Sandbox](https://vercel.com/docs/sandbox) · [Hạn mức Sandbox](https://vercel.com/docs/sandbox/pricing)

## Tùy chọn máy chủ GPU với Modal

Khi cấu hình GPU được bật, web gửi file thẳng lên R2 và dùng GPU Modal để tách. Trình duyệt chỉ tải WAV đầu ra. BPM, tone và phát bản gốc vẫn chạy trên thiết bị. Bản thử nghiệm yêu cầu mã truy cập, giới hạn 20 job mỗi ngày UTC và chạy tối đa một container GPU cùng lúc.

1. Tạo một bucket R2 riêng tư. Tạo API token **Object Read & Write** giới hạn cho bucket đó. Bật lifecycle xóa object có tiền tố `akapella/` sau 1 ngày. Cấu hình CORS cho domain sẽ chạy beta.

   ```json
   [
     {
       "AllowedOrigins": ["https://akapella.vercel.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type", "If-None-Match"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

2. Đăng nhập Modal, tạo secret `akapella-r2` và deploy worker. Secret cần `R2_BUCKET`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID` và `R2_SECRET_ACCESS_KEY`. Nhập các giá trị trong Modal Dashboard hoặc dùng file dotenv riêng được bảo vệ với `modal secret create --from-dotenv`. Không lưu các giá trị này trong Git.

   ```bash
   source .venv/bin/activate
   python -m pip install 'modal>=1,<2' boto3
   modal setup
   modal deploy -m cloud.modal_app
   ```

3. Tạo **Proxy Token** trong Modal. Đặt bốn biến production trong Vercel rồi redeploy. Mã pilot dài ít nhất 20 ký tự và chỉ chia sẻ với người thử.

   | Biến | Giá trị |
   | --- | --- |
   | `AKAPELLA_MODAL_URL` | URL của endpoint `api` do lệnh deploy Modal trả về |
   | `AKAPELLA_MODAL_KEY` | Proxy Token ID |
   | `AKAPELLA_MODAL_SECRET` | Proxy Token Secret |
   | `AKAPELLA_PILOT_CODE` | Mã truy cập tạo ngẫu nhiên |

4. Bỏ `AKAPELLA_SANDBOX_SNAPSHOT` để ưu tiên Modal. Kiểm tra `GET /api/cloud` báo máy chủ đã bật. Thử một lượt 4 stem và một lượt 6 stem, từ tải file đến nghe mixer và tải WAV. Link tải xuống có hạn 10 phút.

[Modal Proxy Tokens](https://modal.com/docs/guide/webhook-proxy-auth) · [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) · [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
