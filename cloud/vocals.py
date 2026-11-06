"""CPU inference for the KUIELab MDX-Net vocal checkpoint."""
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

FFT = 6144
HOP = 1024
BINS = 2048
FRAMES = 256
SIZE = HOP * (FRAMES - 1)
TRIM = FFT // 2
STRIDE = SIZE - 2 * TRIM
WINDOW = np.hanning(FFT + 1)[:-1].astype(np.float32)
WINDOW_SQUARED = WINDOW ** 2


def predict(session, input_name, audio):
    padded = np.pad(audio, ((0, 0), (TRIM, TRIM)), mode="reflect")
    frames = sliding_window_view(padded, FFT, axis=-1)[:, ::HOP]
    spectrum = np.fft.rfft(frames * WINDOW, axis=-1)[:, :, :BINS].transpose(0, 2, 1)
    tensor = np.stack((spectrum.real, spectrum.imag), axis=1).reshape(1, 4, BINS, FRAMES)
    estimate, = session.run(None, {input_name: tensor})
    real, imag = estimate.reshape(2, 2, BINS, FRAMES).transpose(1, 0, 3, 2)
    spectrum = np.pad(real + 1j * imag, ((0, 0), (0, 0), (0, TRIM + 1 - BINS)))
    frames = np.fft.irfft(spectrum, n=FFT, axis=-1) * WINDOW
    wave = np.zeros((2, SIZE + FFT), dtype=np.float32)
    weight = np.zeros(SIZE + FFT, dtype=np.float32)
    for index in range(FRAMES):
        span = slice(index * HOP, index * HOP + FFT)
        wave[:, span] += frames[:, index]
        weight[span] += WINDOW_SQUARED
    central = slice(2 * TRIM, SIZE)
    return wave[:, central] / weight[central]


def isolate(session, audio, progress):
    total = audio.shape[1]
    chunks = (total + STRIDE - 1) // STRIDE
    input_name = session.get_inputs()[0].name
    vocals = np.empty_like(audio)
    progress("split", 0, chunks)
    for index, start in enumerate(range(0, total, STRIDE), 1):
        length = min(STRIDE, total - start)
        left, right = start - TRIM, start - TRIM + SIZE
        segment = np.pad(audio[:, max(0, left):right], ((0, 0), (max(0, -left), max(0, right - total))))
        vocals[:, start:start + length] = predict(session, input_name, segment)[:, :length]
        progress("split", index, chunks)
    return vocals
