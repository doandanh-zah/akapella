"""Deploy from repo root with: modal deploy -m cloud.modal_app"""

import re
import secrets
from pathlib import Path
import tempfile
import time

import modal

from cloud.store import JOB_TTL, MAX_BYTES, UPLOAD_TTL, Store
from cloud.weights import WEIGHTS


app = modal.App("akapella")
storage = modal.Secret.from_name("akapella-r2")
base = modal.Image.debian_slim(python_version="3.11").pip_install("boto3")
api_image = base.pip_install("fastapi[standard]").add_local_python_source("cloud")
gpu_image = (
    base.apt_install("ffmpeg", "zlib1g", "libgomp1", "curl")
    .pip_install("onnxruntime-gpu[cuda,cudnn]==1.22.0", "numpy", "soundfile")
    .run_commands("mkdir -p /weights", *(
        f"curl --fail --location --retry 3 --max-time 300 '{url}' -o /weights/{mode}.onnx "
        f"&& echo '{checksum}  /weights/{mode}.onnx' | sha256sum -c -"
        for mode, (url, checksum) in WEIGHTS.items()
    ))
    .add_local_python_source("cloud")
)


class Cancelled(Exception):
    pass


@app.cls(image=gpu_image, gpu="T4", secrets=[storage], max_containers=1,
         min_containers=0, scaledown_window=30, timeout=480, memory=8192)
class Separator:
    @modal.enter()
    def setup(self):
        import onnxruntime as ort

        ort.preload_dlls(directory="")
        self.ort = ort
        self.session = None
        self.mode = None

    @modal.method()
    def process(self, job, mode):
        from cloud.engine import read_audio, split

        store = Store()
        last_update = 0

        def check_cancel():
            if store.read(job, "cancel.json") is not None:
                raise Cancelled()

        def progress(stage, done, total):
            nonlocal last_update
            now = time.monotonic()
            if done in {0, total} or now - last_update > 1:
                check_cancel()
                store.state(job, stage, done=done, total=total)
                last_update = now

        try:
            check_cancel()
            store.state(job, "prepare")
            with tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                source = directory / "input"
                store.fetch_input(job, source)
                stereo = read_audio(source, directory)
                check_cancel()
                if self.mode != mode:
                    self.mode = None
                    self.session = None
                    options = self.ort.SessionOptions()
                    options.graph_optimization_level = self.ort.GraphOptimizationLevel.ORT_DISABLE_ALL
                    session = self.ort.InferenceSession(
                        f"/weights/{mode}.onnx", sess_options=options,
                        providers=["CUDAExecutionProvider"],
                    )
                    if session.get_providers()[0] != "CUDAExecutionProvider":
                        raise RuntimeError("CUDA provider unavailable")
                    self.session, self.mode = session, mode
                def process_progress(stage, done, total):
                    progress(stage, done, total * 2 if stage == "export" else total)

                paths = split(self.session, stereo, mode, directory, process_progress)
                for done, (name, path) in enumerate(paths.items(), 1):
                    check_cancel()
                    store.upload_output(job, name, path)
                    progress("export", len(paths) + done, len(paths) * 2)
                check_cancel()
                store.state(job, "done", tracks=list(paths))
        except Cancelled:
            store.state(job, "cancelled")
        except ValueError as exc:
            store.state(job, "failed", message=str(exc))
        except Exception:
            store.state(job, "failed", message="Máy chủ không tách được bài này. Hãy thử lại.")
            raise


@app.function(image=api_image, secrets=[storage], timeout=30)
@modal.asgi_app(requires_proxy_auth=True)
def api():
    from fastapi import FastAPI, HTTPException

    server = FastAPI()

    def lookup(store, job):
        if not re.fullmatch(r"[a-f0-9]{48}", job):
            raise HTTPException(404, "Không tìm thấy job.")
        record = store.read(job, "request.json")
        if not record or time.time() - record["created"] > JOB_TTL:
            raise HTTPException(404, "Job đã hết hạn hoặc không tồn tại.")
        return record

    @server.post("/create")
    def create(payload: dict):
        size, mode = payload.get("size"), payload.get("mode")
        if type(size) is not int or not 0 < size <= MAX_BYTES or type(mode) is not int or mode not in (4, 6):
            raise HTTPException(400, "Chọn file tối đa 50 MB và chế độ 4 hoặc 6 stem.")
        store = Store()
        if not store.reserve_daily_slot():
            raise HTTPException(429, "Bản thử nghiệm đã hết lượt hôm nay.")
        job = secrets.token_hex(24)
        store.write(job, "request.json", {"size": size, "mode": mode, "created": time.time()})
        return {"job": job, "upload": store.upload_url(job, size)}

    @server.post("/{action}")
    def job_action(action: str, payload: dict):
        if action not in {"start", "status", "cancel"}:
            raise HTTPException(404)
        store = Store()
        job = payload.get("job")
        if not isinstance(job, str):
            raise HTTPException(400, "Thiếu mã job.")
        record = lookup(store, job)
        current = store.read(job, "state.json")
        if action == "cancel" and (not current or current["stage"] not in {"done", "failed", "cancelled"}):
            store.write(job, "cancel.json", {}, once=True)
        if store.read(job, "cancel.json") is not None:
            return {"stage": "cancelled"}

        if action == "start" and current is None:
            if time.time() - record["created"] > UPLOAD_TTL or store.size(job) != record["size"]:
                raise HTTPException(400, "Chưa nhận đủ file hoặc link tải lên đã hết hạn.")
            if store.write(job, "state.json", {"stage": "queued", "at": time.time()}, once=True):
                try:
                    Separator().process.spawn(job, record["mode"])
                except Exception:
                    store.state(job, "failed", message="Không thể đưa job vào hàng chờ. Hãy thử lại.")
                    raise
            return {"stage": "queued"}

        if current is None:
            return {"stage": "upload"}
        if current["stage"] == "done":
            return {"stage": "done", "tracks": [
                {"name": name, "url": store.download_url(job, name)} for name in current["tracks"]
            ]}
        if current["stage"] not in {"failed", "cancelled"} and time.time() - current["at"] > 600:
            store.write(job, "cancel.json", {}, once=True)
            return {"stage": "failed", "message": "Máy chủ quá thời gian xử lý. Hãy thử lại."}
        return current

    return server
