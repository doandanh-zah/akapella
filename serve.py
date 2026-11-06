"""Serve the Akapella web UI and YouTube-to-MP3 conversion on loopback."""

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import tempfile
from threading import BoundedSemaphore
from urllib.parse import parse_qs, urlsplit

from akapella import AkapellaError, MAX_SECONDS, fetch_source, run

HOST = "127.0.0.1"
PORT = 8765
ORIGIN = f"http://{HOST}:{PORT}"
WEB = Path(__file__).resolve().parent / "web"
CONVERSION_SLOT = BoundedSemaphore(1)


def youtube_video_id(link):
    url = urlsplit(link.strip())
    if url.scheme not in {"https", "http"} or url.username is not None or url.port is not None:
        raise ValueError("Nhập link YouTube công khai hợp lệ.")

    segments = url.path.strip("/").split("/")
    video_id = ""
    if url.hostname == "youtu.be" and len(segments) == 1:
        video_id = segments[0]
    if url.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if url.path == "/watch":
            video_id = parse_qs(url.query).get("v", [""])[0]
        elif len(segments) == 2 and segments[0] in {"shorts", "live", "embed"}:
            video_id = segments[1]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("Nhập link đến một video YouTube. Link chỉ có playlist không được hỗ trợ.")
    return video_id


def make_mp3(video_id, directory):
    if not shutil.which("ffmpeg"):
        raise AkapellaError("Cần FFmpeg trong PATH.")
    source = fetch_source(f"https://www.youtube.com/watch?v={video_id}", directory)
    output = directory / f"youtube-{video_id}.mp3"
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", "0:a:0",
        "-map_metadata", "-1", "-t", str(MAX_SECONDS), "-c:a", "libmp3lame",
        "-b:a", "192k", str(output),
    ], "Xuất MP3", timeout=180)
    return output


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def json_error(self, status, message):
        body = json.dumps({"error": message}, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/youtube-mp3":
            return self.json_error(HTTPStatus.NOT_FOUND, "Không tìm thấy chức năng.")
        if self.headers.get("Origin") != ORIGIN or self.headers.get("Host") != f"{HOST}:{PORT}":
            return self.json_error(HTTPStatus.FORBIDDEN, "Mở Akapella từ địa chỉ hiển thị trong terminal.")
        if self.headers.get_content_type() != "application/json":
            return self.json_error(HTTPStatus.BAD_REQUEST, "Dữ liệu yêu cầu không hợp lệ.")

        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                raise ValueError("Link quá dài hoặc bị thiếu.")
            request = json.loads(self.rfile.read(size))
            if not isinstance(request, dict) or not isinstance(request.get("url"), str):
                raise ValueError("Nhập link YouTube công khai hợp lệ.")
            video_id = youtube_video_id(request["url"])
        except (ValueError, UnicodeError) as exc:
            message = str(exc) if type(exc) is ValueError else "Dữ liệu yêu cầu không hợp lệ."
            return self.json_error(HTTPStatus.BAD_REQUEST, message)

        if not CONVERSION_SLOT.acquire(blocking=False):
            return self.json_error(HTTPStatus.SERVICE_UNAVAILABLE, "Đang xuất một MP3 khác. Hãy thử lại sau.")

        try:
            with tempfile.TemporaryDirectory(prefix="akapella-mp3-") as temp:
                try:
                    output = make_mp3(video_id, Path(temp))
                    size = output.stat().st_size
                except (AkapellaError, OSError) as exc:
                    return self.json_error(HTTPStatus.BAD_GATEWAY, f"{exc} Kiểm tra link và xem log terminal.")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Disposition", f'attachment; filename="{output.name}"')
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with output.open("rb") as audio:
                    shutil.copyfileobj(audio, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            CONVERSION_SLOT.release()


if __name__ == "__main__":
    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        print(f"Akapella đang chạy tại {ORIGIN}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
