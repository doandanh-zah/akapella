export function createMixer(onUpdate) {
  let context;
  let original;
  let stems = new Map();
  let nodes = [];
  let muted = new Set();
  let volumes = new Map();
  let solo;
  let mode = "original";
  let offset = 0;
  let started = 0;
  let playing = false;
  let frame;
  let analyser;

  function output() {
    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = .8;
      analyser.connect(context.destination);
    }
    return analyser;
  }

  function position() {
    const elapsed = playing ? Math.max(0, context.currentTime - started) : 0;
    return Math.min(original?.duration ?? 0, offset + elapsed);
  }

  function update(progressOnly = false) {
    onUpdate({ position: position(), playing, mode, muted, solo, volumes, hasStems: stems.size > 0 }, progressOnly);
  }

  function stop() {
    cancelAnimationFrame(frame);
    playing = false;
    for (const { source, gain } of nodes) {
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    nodes = [];
  }

  function level(name) {
    if (mode === "original") return name === "original" ? 1 : 0;
    if (name === "original") return 0;
    if (mode === "instrumental") return name === "vocals" ? 0 : 0.9;
    return (solo ? solo === name : !muted.has(name)) ? 0.9 * (volumes.get(name) ?? 1) : 0;
  }

  function start() {
    started = context.currentTime + 0.02;
    for (const [name, buffer] of [["original", original], ...stems]) {
      if (offset >= buffer.duration) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = level(name);
      source.connect(gain).connect(output());
      source.start(started, offset);
      nodes.push({ name, source, gain });
    }
    playing = true;
    update();
    frame = requestAnimationFrame(tick);
  }

  function tick() {
    if (position() >= original.duration) {
      offset = original.duration;
      stop();
      update();
      return;
    }
    update(true);
    frame = requestAnimationFrame(tick);
  }

  function refreshMix() {
    for (const { name, gain } of nodes) gain.gain.setTargetAtTime(level(name), context.currentTime, 0.012);
    update();
  }

  return {
    // Fills a 64-bin byte spectrum of what is playing; false when silent.
    spectrum(target) {
      if (!playing || !analyser) return false;
      analyser.getByteFrequencyData(target);
      return true;
    },
    setTrack(buffer) {
      stop();
      original = buffer;
      stems.clear();
      muted.clear();
      volumes.clear();
      solo = undefined;
      offset = 0;
      mode = "original";
      update();
    },
    setStems(buffers) {
      const resume = playing;
      offset = position();
      stop();
      stems = buffers;
      muted = new Set();
      volumes = new Map();
      solo = undefined;
      mode = "original";
      if (resume && offset < original.duration) start();
      else update();
    },
    async toggle() {
      if (!original) return;
      if (playing) {
        offset = position();
        stop();
        update();
        return;
      }
      const current = original;
      context ??= new AudioContext();
      await context.resume();
      if (current !== original || playing) return;
      if (offset >= original.duration) offset = 0;
      start();
    },
    seek(seconds) {
      if (!original) return;
      const resume = playing;
      stop();
      offset = Math.max(0, Math.min(seconds, original.duration));
      if (resume && offset < original.duration) start();
      else update();
    },
    monitor(next) {
      if (next !== "original" && !stems.size) return;
      mode = next;
      refreshMix();
    },
    mute(name) {
      if (!stems.has(name)) return;
      if (muted.has(name)) muted.delete(name);
      else {
        muted.add(name);
        if (solo === name) solo = undefined;
      }
      mode = "mix";
      refreshMix();
    },
    // Per-stem level from 0 to 1; 0 behaves like mute without losing the solo state.
    volume(name, value) {
      if (!stems.has(name)) return;
      volumes.set(name, Math.max(0, Math.min(1, value)));
      mode = "mix";
      refreshMix();
    },
    solo(name) {
      if (!stems.has(name)) return;
      solo = solo === name ? undefined : name;
      if (solo) muted.delete(name);
      mode = "mix";
      refreshMix();
    },
  };
}

export function waveform(buffer, points = 180) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(buffer.numberOfChannels - 1);
  const peaks = [];
  for (let column = 0; column < points; column++) {
    const first = Math.floor(column * buffer.length / points);
    const last = Math.floor((column + 1) * buffer.length / points);
    let peak = 0;
    for (let i = first; i < last; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    peaks.push(peak);
  }
  const max = Math.max(0.001, ...peaks);
  const row = (peak, i, sign) => `${(540 * i / (points - 1)).toFixed(1)} ${(72 + sign * Math.max(1, peak * 64 / max)).toFixed(1)}`;
  return "M" + peaks.map((peak, i) => row(peak, i, -1)).join("L")
    + "L" + peaks.map((peak, i) => row(peak, i, 1)).reverse().join("L") + "Z";
}
