"""Fetch one public media URL in a bounded subprocess, without browser cookies."""

import json
import ipaddress
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
from threading import Timer
import time
from urllib.parse import urlsplit

MAX_BYTES = 50_000_000
MAX_SECONDS = 300
_active = None


class SourceError(ValueError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def download_error(error, url):
    message = str(error).lower()
    host = (urlsplit(url).hostname or "").lower()
    platform = "YouTube" if host in ("youtu.be", "youtube.com") or host.endswith(".youtube.com") else "Nền tảng"
    if "429" in message or "too many requests" in message:
        return SourceError(
            f"{platform} đang giới hạn truy cập từ máy chủ Akapella (HTTP 429). Hãy thử lại sau.",
            "source_rate_limited",
        )
    if "confirm" in message and ("not a bot" in message or "you're not a bot" in message):
        return SourceError(
            f"{platform} yêu cầu máy chủ Akapella xác minh chống bot. Máy chủ hiện chưa tải được âm thanh từ video này.",
            "source_bot_check",
        )
    if any(text in message for text in ("private video", "members-only", "confirm your age", "login required", "sign in")):
        return SourceError(
            "Nguồn này yêu cầu đăng nhập hoặc quyền xem riêng. Hãy chọn nguồn có thể truy cập trực tiếp.",
            "source_access_required",
        )
    if any(text in message for text in ("not available in your country", "geo-restricted", "geographic restriction")):
        return SourceError(
            "Video bị giới hạn khu vực đối với máy chủ Akapella.",
            "source_geo_restricted",
        )
    if "requested format is not available" in message:
        return SourceError(
            "Nền tảng chưa cung cấp luồng âm thanh có thể tải cho máy chủ Akapella.",
            "source_format_unavailable",
        )
    if any(text in message for text in ("timed out", "timeout")):
        return SourceError(
            "Nền tảng phản hồi quá lâu khi máy chủ lấy âm thanh. Hãy thử lại sau.",
            "source_timeout",
        )
    if any(text in message for text in ("video unavailable", "video is unavailable", "has been removed", "does not exist")):
        return SourceError("Nền tảng báo video không còn khả dụng.", "source_unavailable")
    return SourceError(
        "Máy chủ chưa lấy được âm thanh từ nền tảng này. Hãy thử lại sau hoặc chọn nguồn khác.",
        "source_download_failed",
    )


def validate_url(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        raise ValueError("Nhập link HTTPS công khai hợp lệ.") from None
    host = (parsed.hostname or "").lower().rstrip(".")
    if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
            or port not in (None, 443) or "." not in host or ":" in host
            or host.replace(".", "").isdigit()
            or host.endswith((".localhost", ".local", ".internal", ".test", ".lan", ".home.arpa"))
            or host == "localhost" or len(value) > 2048):
        raise ValueError("Nhập link HTTPS công khai hợp lệ.")
    return value


def cancel_download():
    if _active is not None:
        try:
            os.killpg(_active.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def fetch_source(url, directory, on_progress):
    global _active
    validate_url(url)
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), url, str(directory)],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True,
    )
    _active = child
    timer = Timer(100, cancel_download)
    timer.start()
    result = None
    try:
        for line in child.stdout:
            event = json.loads(line)
            if event["stage"] == "failed":
                raise SourceError(event["message"], event.get("code", "source_download_failed"))
            if event["stage"] == "downloaded":
                result = event
            else:
                on_progress(event)
        if child.wait() or result is None:
            raise ValueError("Không lấy được âm thanh từ link. Link có thể bị chặn hoặc yêu cầu đăng nhập.")
        source = directory / result["file"]
        if source.parent != directory or not source.is_file() or source.stat().st_size > MAX_BYTES:
            raise ValueError("Nguồn âm thanh vượt quá 50 MB hoặc không hợp lệ.")
        return source, result["title"]
    finally:
        timer.cancel()
        if child.poll() is None:
            cancel_download()
        child.wait()
        _active = None


def emit(**event):
    print(json.dumps(event), flush=True)


def download(url, directory):
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    resolve = socket.getaddrinfo

    def public_addresses(host, port, *args, **kwargs):
        addresses = resolve(host, port, *args, **kwargs)
        if any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError("Link phải trỏ tới máy chủ công khai.")
        return addresses

    # This subprocess resolves every HTTP hop, including extractor redirects.
    socket.getaddrinfo = public_addresses

    class Silent:
        def debug(self, *_args):
            pass

        warning = error = debug

    last = 0

    def progress(event):
        nonlocal last
        done = event.get("downloaded_bytes", 0)
        if done > MAX_BYTES:
            raise ValueError("Nguồn âm thanh vượt quá 50 MB.")
        now = time.monotonic()
        if now - last >= 0.5 or event["status"] == "finished":
            emit(stage="download", done=done, total=event.get("total_bytes"))
            last = now

    options = {
        "quiet": True, "no_warnings": True, "logger": Silent(),
        "noplaylist": True, "playlist_items": "1", "cachedir": False,
        "socket_timeout": 12, "retries": 1, "extractor_retries": 1,
        "source_address": "0.0.0.0",
        "fragment_retries": 1, "max_filesize": MAX_BYTES,
        "outtmpl": str(directory / "download.%(ext)s"), "restrictfilenames": True,
        "format": "bestaudio/best",
        "js_runtimes": {"node": {}},
        "progress_hooks": [progress],
        "overwrites": False, "continuedl": False,
        "writethumbnail": False, "writesubtitles": False, "writeinfojson": False,
    }
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(validate_url(url), download=False)
            if not info or info.get("_type") in ("playlist", "multi_video"):
                raise ValueError("Dán link đến một video hoặc file âm thanh, thay vì playlist.")
            if info.get("is_live") or info.get("live_status") == "is_upcoming":
                raise ValueError("Hãy chọn video đã đăng, dài tối đa 5 phút.")
            duration = info.get("duration")
            if duration is not None and not 0 < duration <= MAX_SECONDS:
                raise ValueError("Nguồn âm thanh phải dài tối đa 5 phút.")
            title = str(info.get("title") or "Âm thanh từ link").strip()[:160]
            emit(stage="download", done=0, total=None, title=title)
            downloader.process_info(info)
            files = [path for path in directory.glob("download.*")
                     if path.is_file() and path.suffix not in (".part", ".ytdl")]
            if len(files) != 1 or files[0].stat().st_size > MAX_BYTES:
                raise ValueError("Không tải được một nguồn âm thanh hợp lệ trong giới hạn 50 MB.")
            emit(stage="downloaded", file=files[0].name, title=title)
    except DownloadError as exc:
        error = download_error(exc, url)
        emit(stage="failed", message=str(error), code=error.code)
        return 1
    except ValueError as exc:
        emit(stage="failed", message=str(exc))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(download(sys.argv[1], Path(sys.argv[2])))
