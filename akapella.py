"""Tách file nhạc hoặc link video thành các stem WAV."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from urllib.parse import urlsplit
import wave


MODELS = {
    "4": ("htdemucs", ("vocals", "drums", "bass", "other")),
    "6": ("htdemucs_6s", ("vocals", "drums", "bass", "guitar", "piano", "other")),
}
DRUM_PARTS = {
    "kick": "kick", "snare": "snare", "toms": "toms",
    "hh": "hihat", "ride": "ride", "crash": "crash",
}
RATE = 44_100
MAX_SECONDS = 20 * 60


class AkapellaError(Exception):
    pass


def run(command, stage, *, timeout=None):
    print(stage, file=sys.stderr, flush=True)
    try:
        subprocess.run(command, stdin=subprocess.DEVNULL, check=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        raise AkapellaError(f"{stage} thất bại (mã {exc.returncode}).") from exc
    except subprocess.TimeoutExpired as exc:
        raise AkapellaError(f"{stage} quá thời gian chờ.") from exc


def engine(name, requirements="requirements.txt"):
    program = Path(sysconfig.get_path("scripts")) / name
    if not program.is_file():
        raise AkapellaError(f"Thiếu {name}. Chạy python -m pip install -r {requirements}.")
    return program


def fetch_source(source, work):
    path = Path(source).expanduser()
    if path.is_file():
        return path.resolve()
    if "://" not in source:
        raise AkapellaError(f"Không tìm thấy file: {source}")

    url = urlsplit(source)
    if url.scheme not in {"https", "http"} or not url.hostname or url.username is not None:
        raise AkapellaError("Nhập URL HTTP(S) hợp lệ, không kèm thông tin đăng nhập.")

    command = [
        engine("yt-dlp"), "--ignore-config", "--no-plugin-dirs",
        "--no-playlist", "--playlist-items", "1", "--no-simulate", "--no-colors",
        "--match-filters", f"!is_live & !is_upcoming & duration <=? {MAX_SECONDS}",
        "--socket-timeout", "20", "--retries", "2", "--max-filesize", "250M",
        "-f", "bestaudio/best", "-o", str(work / "media.%(ext)s"),
        "--print", "before_dl:Đang tải %(title)s",
    ]
    if shutil.which("node"):
        command.extend(["--js-runtimes", "node"])
    run([*command, "--", source], "Đọc link và tải nguồn", timeout=600)
    downloads = [
        path for path in work.glob("media.*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    ]
    if len(downloads) != 1:
        raise AkapellaError("Link không trả về một video hợp lệ. Kiểm tra link hoặc dùng file.")
    return downloads[0]


def normalize(source, target):
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", "0:a:0",
        "-map_metadata", "-1", "-ac", "2", "-ar", str(RATE),
        "-t", str(MAX_SECONDS + 1), "-c:a", "pcm_s16le", str(target),
    ], "Chuẩn hóa âm thanh", timeout=300)
    with wave.open(str(target), "rb") as audio:
        frames = audio.getnframes()
    if not frames:
        raise AkapellaError("Nguồn không có mẫu âm thanh.")
    if frames > MAX_SECONDS * RATE:
        raise AkapellaError(f"Nguồn dài quá {MAX_SECONDS // 60} phút.")


def mix_instrumental(stems, result):
    inputs = [result / f"{stem}.wav" for stem in stems if stem != "vocals"]
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    for path in inputs:
        command.extend(["-i", str(path)])
    run([
        *command, "-filter_complex", f"amix=inputs={len(inputs)}:normalize=0",
        "-c:a", "pcm_f32le", str(result / "instrumental.wav"),
    ], "Tạo bản nhạc không lời", timeout=300)


def split_drums(program, result):
    parts = result / "drum-kit"
    run([
        program, str(result / "drums.wav"), "-o", str(parts),
        "--model", "drumsep-6stem", "--device", "cpu",
    ], "Tách từng thành phần bộ trống")
    for original, name in DRUM_PARTS.items():
        (parts / f"drums_{original}.wav").rename(parts / f"{name}.wav")


def separate(args):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise AkapellaError("Cần FFmpeg và FFprobe trong PATH.")
    demucs = engine("demucs-onnx")
    drums = engine("mdxnet-infer", "requirements-drums.txt") if args.drum_kit else None
    model, stems = MODELS[args.stems]
    output = args.output.expanduser().absolute()
    if os.path.lexists(output):
        raise AkapellaError(f"Thư mục đầu ra đã tồn tại: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    # Cùng ổ đĩa để chuyển nguyên thư mục kết quả sau khi mọi stem đã hoàn tất.
    with tempfile.TemporaryDirectory(prefix=".akapella-", dir=output.parent) as directory:
        work = Path(directory)
        source = fetch_source(args.source, work)
        normalized = work / "mix.wav"
        result = work / "result"
        normalize(source, normalized)
        run([
            demucs, "separate", str(normalized), str(result), "--model", model,
            "--providers", "cpu", "--precision", "fp16weights",
        ], f"Tách {args.stems} stem bằng HTDemucs")
        if not all((result / f"{stem}.wav").is_file() for stem in stems):
            raise AkapellaError("HTDemucs trả về thiếu stem.")
        mix_instrumental(stems, result)
        if drums:
            split_drums(drums, result)

        if os.path.lexists(output):
            raise AkapellaError(f"Thư mục đầu ra đã tồn tại: {output}")
        result.rename(output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="File nhạc/video hoặc link HTTP(S) được yt-dlp hỗ trợ")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Thư mục mới để lưu WAV")
    parser.add_argument("--stems", choices=MODELS, default="4", help="Chọn 6 để có guitar và piano")
    parser.add_argument("--drum-kit", action="store_true", help="Tách thêm kick, snare, hi-hat và cymbal")
    args = parser.parse_args()
    try:
        output = separate(args)
    except (AkapellaError, OSError, ValueError, wave.Error) as exc:
        print(f"Akapella: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nĐã hủy.", file=sys.stderr)
        return 130
    print(f"Đã lưu WAV tại {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
