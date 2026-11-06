"""HTDemucs processing shared by the GPU worker and local smoke checks."""

import subprocess

import numpy as np
import soundfile as sf

RATE = 44_100
SEGMENT = 343_980
OVERLAP = SEGMENT // 4
STRIDE = SEGMENT - OVERLAP
MAX_SECONDS = 300
NAMES = ("drums", "bass", "other", "vocals", "guitar", "piano")



def read_audio(source, directory):
    normalized = directory / "normalized.wav"
    completed = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-protocol_whitelist", "file,pipe", "-format_whitelist",
        "wav,mp3,flac,mov,matroska,webm,ogg,aac,aiff",
        "-i", str(source), "-map", "0:a:0", "-map_metadata", "-1",
        "-ac", "2", "-ar", str(RATE), "-t", str(MAX_SECONDS + 1),
        "-c:a", "pcm_f32le", str(normalized),
    ], capture_output=True, timeout=90)
    if completed.returncode:
        raise ValueError("Không đọc được âm thanh. Hãy dùng MP3, WAV hoặc FLAC.")
    stereo, _ = sf.read(normalized, dtype="float32", always_2d=True)
    if not 0 < len(stereo) <= MAX_SECONDS * RATE:
        raise ValueError("File âm thanh phải dài tối đa 5 phút.")
    return stereo.T


def split(session, stereo, count, directory, progress):
    frames = stereo.shape[1]
    chunks = max(1, (frames - SEGMENT + STRIDE - 1) // STRIDE + 1)
    output = np.zeros((count, 2, frames), dtype=np.float32)
    weights = np.zeros(frames, dtype=np.float32)
    samples = np.zeros((1, 2, SEGMENT), dtype=np.float32)
    progress("split", 0, chunks)
    for index in range(chunks):
        start = index * STRIDE
        length = min(SEGMENT, frames - start)
        positions = np.arange(length, dtype=np.float32)
        fade_in = 1 if index == 0 else positions / OVERLAP
        fade_out = 1 if index == chunks - 1 else (SEGMENT - 1 - positions) / OVERLAP
        window = np.minimum(np.minimum(fade_in, fade_out), 1)
        samples.fill(0)
        samples[0, :, :length] = stereo[:, start:start + length]
        separated, = session.run(["stems"], {"mix": samples})
        output[:, :, start:start + length] += separated[0, :, :, :length] * window
        weights[start:start + length] += window
        progress("split", index + 1, chunks)

    paths = {}
    instrumental = np.zeros((2, frames), dtype=np.float32)
    progress("export", 0, count + 1)
    for index, name in enumerate(NAMES[:count]):
        output[index] /= weights
        if name != "vocals":
            instrumental += output[index]
        path = directory / f"{name}.wav"
        sf.write(path, output[index].T, RATE, subtype="PCM_16")
        paths[name] = path
        progress("export", index + 1, count + 1)
    path = directory / "instrumental.wav"
    sf.write(path, instrumental.T, RATE, subtype="PCM_16")
    paths["instrumental"] = path
    progress("export", count + 1, count + 1)
    return paths
