#!/usr/bin/env sh
# Run from the repo root, linked to the Akapella Vercel project.
set -eu

sandbox_name="akapella-model-$(date +%s)"
region=${AKAPELLA_SANDBOX_REGION:-iad1}
npx --yes vercel sandbox create --name "$sandbox_name" --region "$region" --vcpus 2 --timeout 12m --non-persistent --snapshot-expiration none
trap 'npx --yes vercel sandbox stop "$sandbox_name" >/dev/null 2>&1 || true' EXIT
npx --yes vercel sandbox exec "$sandbox_name" -- mkdir -p /vercel/akapella/weights
npx --yes vercel sandbox cp cloud/weights.py "$sandbox_name:/vercel/akapella/weights.py"
npx --yes vercel sandbox exec "$sandbox_name" -- bash -lc "$(cat <<'BOOTSTRAP'
set -eu
cd /vercel/akapella
uv venv --python 3.12
uv pip install --python .venv/bin/python onnxruntime==1.22.0 numpy==2.4.2 soundfile==0.13.1 imageio-ffmpeg==0.6.0 'yt-dlp[default]==2026.10.26'
ffmpeg=$(.venv/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
ln -s "$ffmpeg" .venv/bin/ffmpeg
.venv/bin/python - <<'PY'
import hashlib
from pathlib import Path
import subprocess

from weights import VOCAL_WEIGHTS, WEIGHTS

for mode, (url, expected) in (WEIGHTS | VOCAL_WEIGHTS).items():
    target = Path("weights") / f"{mode}.onnx"
    subprocess.run(["curl", "-fsSL", "--retry", "3", "--max-time", "300",
                    url, "-o", str(target)], check=True)
    with target.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != expected:
            raise SystemExit(f"Incorrect SHA-256 for {target}")
PY
uv cache clean
BOOTSTRAP
)"
npx --yes vercel sandbox snapshot "$sandbox_name" --stop --expiration 0
trap - EXIT
