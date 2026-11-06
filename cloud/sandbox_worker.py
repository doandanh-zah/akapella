"""One private audio job inside an ephemeral Vercel Sandbox."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import tempfile
from threading import Lock, Thread, Timer
from urllib.parse import urlsplit

from engine import read_audio, split


ACCESS = os.environ["JOB_ACCESS"]
ORIGIN = os.environ["JOB_ORIGIN"]
SIZE = int(os.environ["JOB_SIZE"])
MODE = int(os.environ["JOB_MODE"])
WEIGHTS = Path(__file__).resolve().parent / "weights"
WORK = Path(tempfile.mkdtemp(prefix="akapella-"))
SOURCE = WORK / "input"
STATE_LOCK = Lock()
state = {"stage": "upload"}
tracks = {}


def update(stage, **details):
    global state
    with STATE_LOCK:
        if state["stage"] != "cancelled":
            state = {"stage": stage, **details}


def process():
    try:
        import onnxruntime as ort

        update("prepare")
        stereo = read_audio(SOURCE, WORK)
        SOURCE.unlink()
        (WORK / "normalized.wav").unlink()
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        options.intra_op_num_threads = 4
        session = ort.InferenceSession(str(WEIGHTS / f"{MODE}.onnx"), options, ["CPUExecutionProvider"])
        tracks.update(split(session, stereo, MODE, WORK,
                            lambda stage, done, total: update(stage, done=done, total=total)))
        update("done", tracks=list(tracks))
    except ValueError as exc:
        update("failed", message=str(exc))
    except Exception:
        update("failed", message="Máy chủ không tách được bài này. Hãy thử lại.")
        raise
    finally:
        if state["stage"] != "done":
            shutil.rmtree(WORK, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def route(self):
        if self.headers.get("Origin") not in (None, ORIGIN):
            return None
        access, _, route = urlsplit(self.path).path.lstrip("/").partition("/")
        if not hmac.compare_digest(access.encode(), ACCESS.encode()):
            return None
        return route

    def send_headers(self, status, mime, length, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Vary", "Origin")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()

    def end_headers(self):
        if self.command == "OPTIONS":
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
        super().end_headers()

    def reply(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_headers(status, "application/json", len(body))
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_headers(204 if self.route() else 404, "text/plain", 0)

    def do_PUT(self):
        if self.route() != "upload":
            return self.reply({}, 404)
        if self.headers.get("Content-Length") != str(SIZE) or self.headers.get("If-None-Match") != "*":
            return self.reply({}, 400)
        with STATE_LOCK:
            if state["stage"] != "upload":
                return self.reply({}, 409)
            state["stage"] = "uploading"
        try:
            self.connection.settimeout(60)
            remaining = SIZE
            with SOURCE.open("wb") as output:
                while remaining:
                    data = self.rfile.read(min(remaining, 65536))
                    if not data:
                        raise EOFError
                    output.write(data)
                    remaining -= len(data)
        except (EOFError, OSError):
            SOURCE.unlink(missing_ok=True)
            update("upload")
            return self.reply({}, 400)
        update("uploaded")
        self.reply({})

    def do_POST(self):
        route = self.route()
        if route == "cancel":
            update("cancelled")
            try:
                self.reply({"stage": "cancelled"})
            finally:
                shutil.rmtree(WORK, ignore_errors=True)
                Timer(0.1, os._exit, args=(0,)).start()
        elif route == "start":
            with STATE_LOCK:
                if state["stage"] == "uploaded":
                    state["stage"] = "queued"
                    Thread(target=process, daemon=True).start()
                stage = state["stage"]
            if stage in ("upload", "uploading"):
                return self.reply({"error": "Hãy tải file lên trước."}, 409)
            self.reply({"stage": stage})
        else:
            self.reply({}, 404)

    def do_GET(self):
        route = self.route()
        if route in ("ready", "status"):
            return self.reply(state.copy())
        if route and route.startswith("tracks/") and route.endswith(".wav") and state["stage"] == "done":
            path = tracks.get(route[len("tracks/"):-len(".wav")])
            if path:
                try:
                    file = path.open("rb")
                except FileNotFoundError:
                    return self.reply({}, 404)
                with file:
                    self.send_headers(200, "audio/wav", os.fstat(file.fileno()).st_size, path.name)
                    shutil.copyfileobj(file, self.wfile)
                return
        self.reply({}, 404)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 3000), Handler).serve_forever()
