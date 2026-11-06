// Global tempo from onset autocorrelation and key from a pitch-class profile.
// https://labrosa.ee.columbia.edu/~dpwe/resources/matlab/beat_simple/
// https://music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html
const rate = 11025;
const profiles = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

export function analyzeAudio([left, right]) {
  // Input from OfflineAudioContext is 44.1 kHz. Average groups of four for analysis.
  const mono = new Float32Array(Math.floor(left.length / 4));
  let leftEnergy = 0;
  let rightEnergy = 0;
  let mixEnergy = 0;
  for (let i = 0; i < mono.length; i++) {
    const offset = i * 4;
    const l = (left[offset] + left[offset + 1] + left[offset + 2] + left[offset + 3]) / 4;
    const r = (right[offset] + right[offset + 1] + right[offset + 2] + right[offset + 3]) / 4;
    leftEnergy += l * l;
    rightEnergy += r * r;
    mono[i] = (l + r) / 2;
    mixEnergy += mono[i] ** 2;
  }
  if (mixEnergy < Math.max(leftEnergy, rightEnergy) / 16) {
    const channel = leftEnergy >= rightEnergy ? left : right;
    for (let i = 0; i < mono.length; i++) {
      const offset = i * 4;
      mono[i] = (channel[offset] + channel[offset + 1] + channel[offset + 2] + channel[offset + 3]) / 4;
    }
    mixEnergy = Math.max(leftEnergy, rightEnergy);
  }
  if (!mono.length || mixEnergy / mono.length < 1e-10) return { tempo: null, key: null };
  return { tempo: estimateTempo(mono), key: estimateKey(mono) };
}

// Reuse the window, twiddle factors and buffers across all frames of one transform.
function spectrum(size) {
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const order = new Uint16Array(size);
  const window = Float64Array.from(real, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const cos = Float64Array.from(real.subarray(0, size / 2), (_, i) => Math.cos(2 * Math.PI * i / size));
  const sin = Float64Array.from(cos, (_, i) => -Math.sin(2 * Math.PI * i / size));
  const magnitude = new Float64Array(size / 2);
  for (let i = 1; i < size; i++) order[i] = (order[i >> 1] >> 1) | ((i & 1) * (size >> 1));

  return (samples, offset) => {
    imaginary.fill(0);
    for (let i = 0; i < size; i++) real[order[i]] = (samples[offset + i] || 0) * window[i];
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let i = 0; i < half; i++) {
          const a = start + i;
          const b = a + half;
          const w = i * step;
          const r = real[b] * cos[w] - imaginary[b] * sin[w];
          const q = real[b] * sin[w] + imaginary[b] * cos[w];
          real[b] = real[a] - r;
          imaginary[b] = imaginary[a] - q;
          real[a] += r;
          imaginary[a] += q;
        }
      }
    }
    for (let i = 0; i < magnitude.length; i++) magnitude[i] = Math.sqrt(real[i] ** 2 + imaginary[i] ** 2);
    return magnitude;
  };
}

function estimateTempo(samples) {
  if (samples.length < rate * 3) return null;
  const hop = 110;
  const size = 1024;
  const transform = spectrum(size);
  const bands = [180, 1800, 5000].map((hz) => Math.round(hz * size / rate));
  const frames = 1 + Math.floor((samples.length - size) / hop);
  const previous = new Float64Array(bands.at(-1));
  const flux = bands.map(() => new Float32Array(frames));
  const sums = [0, 0, 0];
  const maxima = [0, 0, 0];

  for (let frame = 0; frame < frames; frame++) {
    const magnitude = transform(samples, frame * hop);
    let start = 3;
    for (let band = 0; band < bands.length; band++) {
      let rise = 0;
      for (let bin = start; bin < bands[band]; bin++) {
        const value = Math.log1p(magnitude[bin]);
        rise += Math.max(0, value - previous[bin]);
        previous[bin] = value;
      }
      start = bands[band];
      if (!frame) continue;
      flux[band][frame] = rise;
      sums[band] += rise;
      maxima[band] = Math.max(maxima[band], rise);
    }
  }

  const mean = sums.map((sum) => sum / frames);
  const onset = new Float64Array(frames);
  for (let band = 0; band < bands.length; band++) {
    if (maxima[band] < 0.05) continue;
    const scale = Math.max(mean[band], maxima[band] / 12);
    for (let frame = 0; frame < frames; frame++) {
      onset[frame] += Math.max(0, flux[band][frame] - mean[band]) / scale;
    }
  }

  const average = onset.reduce((total, value) => total + value, 0) / frames;
  const strong = onset.reduce((total, value, i) => total + Number(
    i > 0 && i < frames - 1 && value > Math.max(0.5, average * 2) && value >= onset[i - 1] && value > onset[i + 1],
  ), 0);
  if (strong < 4) return null;
  for (let frame = 0; frame < frames; frame++) onset[frame] -= average;

  const tempoScale = 60 * rate / hop;
  const first = Math.floor(tempoScale / 210);
  const last = Math.ceil(tempoScale / 55);
  const correlation = new Float64Array(last * 2 + 2);
  for (let lag = first - 1; lag < correlation.length; lag++) {
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = lag; i < frames; i++) {
      const current = onset[i];
      const earlier = onset[i - lag];
      dot += current * earlier;
      a += current * current;
      b += earlier * earlier;
    }
    correlation[lag] = dot / Math.max(1e-9, Math.sqrt(a * b));
  }

  const peaks = [];
  for (let lag = first; lag <= last; lag++) {
    const center = correlation[lag];
    const left = correlation[lag - 1];
    const right = correlation[lag + 1];
    if (center < 0.24 || center <= left || center < right) continue;
    const period = lag + 0.5 * (left - right) / (left + right - 2 * center);
    const bpm = tempoScale / period;
    if (bpm < 55 || bpm > 210) continue;
    const bias = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.75) ** 2);
    const score = center + 0.18 * Math.max(0, correlation[Math.round(period * 2)]) + 0.07 * bias;
    peaks.push({ bpm, score, strength: center });
  }

  peaks.sort((a, b) => b.score - a.score);
  if (!peaks.length) return null;
  const best = peaks[0];
  // Regular rhythms often have strong peaks at the half or double tempo.
  const faster = peaks.find(({ bpm, strength }) => Math.abs(bpm / best.bpm - 2) < 0.06 && strength > best.strength * 0.90);
  const chosen = faster || best;
  const alternative = peaks.find(({ bpm, score }) =>
    score > chosen.score * 0.8 && [0.5, 2].some((ratio) => Math.abs(bpm / chosen.bpm - ratio) < 0.035)
  );
  return { bpm: Math.round(chosen.bpm), alternative: alternative ? Math.round(alternative.bpm) : null };
}

function estimateKey(samples) {
  const size = 8192;
  const transform = spectrum(size);
  const chroma = new Float64Array(12);
  const bass = new Float64Array(12);
  const end = Math.floor(2000 * size / rate);
  let pitchedFrames = 0;

  for (let start = 0; start + size / 2 < samples.length; start += size / 2) {
    const magnitude = transform(samples, start);
    let max = 0;
    let spectralEnergy = 0;
    for (let bin = 40; bin < end; bin++) {
      max = Math.max(max, magnitude[bin]);
      spectralEnergy += magnitude[bin] ** 2;
    }
    if (max < 0.1 || max ** 2 < spectralEnergy * 0.015) continue;
    let frameWeight = 0;
    const notes = new Float64Array(12);
    const lowNotes = new Float64Array(12);

    for (let bin = 41; bin < end; bin++) {
      const peak = magnitude[bin];
      if (peak < max * 0.07 || peak <= magnitude[bin - 1] || peak < magnitude[bin + 1]) continue;
      if (peak < 3 * Math.max(magnitude[bin - 4], magnitude[bin + 4])) continue;
      const left = Math.log(magnitude[bin - 1] + 1e-9);
      const middle = Math.log(peak);
      const right = Math.log(magnitude[bin + 1] + 1e-9);
      const offset = 0.5 * (left - right) / (left + right - 2 * middle);
      const frequency = (bin + offset) * rate / size;
      const pitch = 69 + 12 * Math.log2(frequency / 440);
      const midi = Math.round(pitch);
      const weight = (peak / max) ** 0.8 * Math.max(0, 1 - 2 * Math.abs(pitch - midi));
      notes[midi % 12] += weight;
      if (frequency < 220) lowNotes[midi % 12] += weight;
      frameWeight += weight;
    }
    if (frameWeight < 0.5) continue;
    pitchedFrames++;
    for (let note = 0; note < 12; note++) {
      chroma[note] += notes[note] / frameWeight;
      bass[note] += lowNotes[note] / frameWeight;
    }
  }

  if (pitchedFrames < 3) return null;
  if (chroma.filter((weight) => weight > pitchedFrames * 0.04).length < 3) return null;
  const candidates = [];
  const chromaMean = pitchedFrames / 12;
  const chromaNorm = Math.sqrt(chroma.reduce((sum, value) => sum + (value - chromaMean) ** 2, 0));
  const bassTotal = bass.reduce((sum, value) => sum + value, 0);
  for (const [mode, profile] of Object.entries(profiles)) {
    const average = profile.reduce((sum, weight) => sum + weight, 0) / 12;
    const norm = Math.sqrt(profile.reduce((sum, weight) => sum + (weight - average) ** 2, 0));
    for (let root = 0; root < 12; root++) {
      const dot = profile.reduce((sum, weight, i) => sum + (weight - average) * (chroma[(root + i) % 12] - chromaMean), 0);
      const correlation = dot / Math.max(1e-9, chromaNorm * norm);
      const score = correlation + 0.12 * bass[root] / Math.max(1, bassTotal);
      candidates.push({ root, mode, correlation, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, second] = candidates;
  if (best.correlation < 0.52) return null;
  return { root: best.root, mode: best.mode, uncertain: best.score - second.score < 0.09 };
}
