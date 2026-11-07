// Sound field: a ribbon of glowing points drawn with WebGL2. It idles on its
// own, takes the shape of the open song, sweeps with split progress, fans out
// into one coloured band per stem and reacts to the live spectrum on playback.

const LINES = 34;
const POINTS = 240;
const SAMPLES = 128;
const ROWS = 9; // row 0: whole song, rows 1-8: stems
const SPECTRUM = 64;

const vertex = `#version 300 es
in vec2 aPos;
uniform float uTime, uSplit, uCount, uHasSong, uSurge, uReveal, uProgress, uPlay, uLive, uDpr, uBeat, uCalm, uHalo, uSpan;
uniform vec2 uRes;
uniform sampler2D uEnv;
uniform sampler2D uSpec;
uniform vec3 uColors[8];
uniform float uLevels[8];
out vec3 vColor;
out float vAlpha;

float env(float row, float u) { return texture(uEnv, vec2(u, (row + .5) / ${ROWS}.)).r; }

void main() {
  float u = aPos.x;
  float t = aPos.y;
  float K = max(uCount, 1.);
  float band = min(floor(t * K), K - 1.);
  float local = K > 1. ? fract(t * K - 1e-4) : t;

  float idle = .42 + .22 * sin(u * 6.3 + uTime * .35) + .14 * sin(u * 17. - uTime * .6);
  float song = mix(env(0., u), env(band + 1., u), uSplit);
  float e = mix(idle, song, uHasSong);
  float spec = texture(uSpec, vec2(pow(u, 1.7), .5)).r;

  float taper = pow(sin(3.14159 * u), 1.1);
  float phase = local * 2.2 + band * 1.9;
  float speed = mix(1., .35, uCalm);
  // uSpan shrinks the wave count on narrow screens so phones get the same calm curves.
  float w = sin(u * 10. * uSpan + uTime * .9 * speed + phase) * .55
          + sin(u * 23. * uSpan - uTime * 1.3 * speed + phase * 1.6) * .3
          + sin(u * 4. + uTime * .45 * speed + band) * .15;
  float pulse = 1. + uBeat * .55 * pow(max(0., sin(uTime * 6.2832 * 2.)), 10.);
  float amp = (.1 + e * .9) * taper * pulse * (1. + uSurge * .9 + uLive * spec * 1.6);

  float bandHeight = mix(1., 1.6 / K, uSplit);
  float center = mix(0., .82 - (band + .5) * 1.64 / K, uSplit);
  float spread = (local - .5) * (.34 + e * .5) * bandHeight;
  float y = center + (w * .52 + spread) * amp * bandHeight;
  float x = u * 2. - 1.;
  gl_Position = vec4(x, y, 0., 1.);

  float crest = abs(w);
  float core = 1. - abs(local - .5) * 1.6;
  vec3 cool = mix(vec3(.55, .62, 1.), vec3(.86, .9, 1.), u);
  vec3 warm = vec3(1., .71, .28);
  vec3 base = mix(cool, warm, smoothstep(.55, 1., crest * e) * .55);
  vec3 color = mix(base, uColors[int(band)], min(1., uSplit * 2.4));

  float alpha = (.3 + .7 * core) * (.45 + .55 * e) * taper;
  alpha *= mix(1., uLevels[int(band)], uSplit);
  alpha *= 1. - smoothstep(uReveal * 1.2 - .2, uReveal * 1.2, u);

  if (uProgress >= 0.) {
    float head = uProgress;
    float glow = exp(-pow((u - head) * 18., 2.));
    alpha *= u > head ? .3 : 1.;
    alpha += glow * .9 * taper;
    color = mix(color, warm, glow * .8);
  }
  if (uPlay >= 0.) {
    float glow = exp(-pow((u - uPlay) * 60., 2.));
    alpha += glow * .8 * taper;
    color = mix(color, vec3(1.), glow * .7);
  }

  vColor = color;
  // Halo pass: the same points, large and faint, read as bloom without a framebuffer.
  vAlpha = clamp(alpha, 0., 1.) * mix(1., .045, uHalo);
  gl_PointSize = (1.3 + crest * 1.8 + core * 1.1) * uDpr * mix(1., 7., uHalo);
}
`;

const fragment = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - .5);
  float a = smoothstep(.5, .05, d) * vAlpha;
  outColor = vec4(vColor * a, a);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

// RMS per bucket. Call shape() with a shared peak so stems keep their relative level.
export function envelope(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(buffer.numberOfChannels - 1);
  const size = Math.floor(buffer.length / SAMPLES);
  const step = Math.max(1, Math.floor(size / 512));
  const values = new Float32Array(SAMPLES);
  for (let bucket = 0; bucket < SAMPLES; bucket++) {
    let sum = 0;
    let count = 0;
    for (let i = bucket * size; i < (bucket + 1) * size; i += step) {
      const sample = (left[i] + right[i]) * .5;
      sum += sample * sample;
      count++;
    }
    values[bucket] = Math.sqrt(sum / Math.max(1, count));
  }
  return values;
}

export function shape(values, peak = Math.max(1e-4, ...values)) {
  return values.map((value) => Math.min(1, Math.pow(value / peak, .7)));
}

export function createField(canvas, { reduceMotion }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const positions = new Float32Array(LINES * POINTS * 2);
  for (let line = 0, i = 0; line < LINES; line++) {
    for (let point = 0; point < POINTS; point++) {
      positions[i++] = point / (POINTS - 1);
      positions[i++] = (line + .5) / LINES;
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name) => gl.getUniformLocation(program, name);
  const loc = Object.fromEntries(["uTime", "uSplit", "uCount", "uHasSong", "uSurge", "uReveal", "uProgress", "uPlay", "uLive", "uDpr", "uBeat", "uCalm", "uHalo", "uSpan", "uEnv", "uSpec", "uColors", "uLevels"].map((name) => [name, u(name)]));

  function texture(unit, width, height) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(width * height));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  const envTex = texture(0, SAMPLES, ROWS);
  const specTex = texture(1, SPECTRUM, 1);
  gl.uniform1i(loc.uEnv, 0);
  gl.uniform1i(loc.uSpec, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const envBytes = new Uint8Array(SAMPLES * ROWS);
  const spectrum = new Uint8Array(SPECTRUM);
  const colors = new Float32Array(24).fill(1);
  const levels = new Float32Array(8).fill(1);
  const value = { split: 0, hasSong: 0, surge: 0, reveal: 0, progress: -1, live: 0, beat: 0, calm: 0 };
  const target = { ...value, reveal: 1 };
  let count = 1;
  let nextCount = 1;
  let play = -1;
  let source;
  let raf = 0;
  let last = performance.now();
  let clock = 0;
  let visible = true;

  function uploadEnv() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, envTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SAMPLES, ROWS, gl.RED, gl.UNSIGNED_BYTE, envBytes);
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform1f(loc.uDpr, dpr * Math.min(1.4, Math.max(.8, canvas.clientWidth / 900)));
    gl.uniform1f(loc.uSpan, .45 + .55 * Math.min(1, canvas.clientWidth / 1100));
  }

  function draw() {
    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let live = false;
    if (source?.(spectrum)) {
      live = true;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, specTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM, 1, gl.RED, gl.UNSIGNED_BYTE, spectrum);
    }
    target.live = live ? 1 : 0;
    gl.uniform1f(loc.uTime, clock);
    gl.uniform1f(loc.uSplit, value.split);
    gl.uniform1f(loc.uCount, count);
    gl.uniform1f(loc.uHasSong, value.hasSong);
    gl.uniform1f(loc.uSurge, value.surge);
    gl.uniform1f(loc.uReveal, value.reveal);
    gl.uniform1f(loc.uProgress, target.progress < 0 ? -1 : value.progress);
    gl.uniform1f(loc.uPlay, play);
    gl.uniform1f(loc.uLive, value.live);
    gl.uniform1f(loc.uBeat, value.beat);
    gl.uniform1f(loc.uCalm, value.calm);
    gl.uniform3fv(loc.uColors, colors);
    gl.uniform1fv(loc.uLevels, levels);
    gl.uniform1f(loc.uHalo, 1);
    gl.drawArrays(gl.POINTS, 0, LINES * POINTS);
    gl.uniform1f(loc.uHalo, 0);
    gl.drawArrays(gl.POINTS, 0, LINES * POINTS);
  }

  function step(now) {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    clock += dt;
    const ease = 1 - Math.exp(-dt * 4.5);
    for (const key of Object.keys(value)) {
      if (key === "progress" && target.progress === "sweep") continue;
      value[key] += (target[key] - value[key]) * (key === "reveal" ? 1 - Math.exp(-dt * 2.2) : ease);
    }
    if (target.progress === "sweep") value.progress = (clock * .35) % 1.2 - .1;
    // Change band count only while the bands are folded together.
    if (nextCount !== count) {
      if (value.split < .02) {
        count = nextCount;
        target.split = pendingSplit;
      } else {
        target.split = 0;
      }
    }
    draw();
    schedule();
  }

  function schedule() {
    if (raf || !visible || document.hidden) return;
    if (reduceMotion.matches) {
      for (const key of Object.keys(value)) if (key !== "progress" || target.progress !== "sweep") value[key] = target[key];
      if (target.progress === "sweep") value.progress = -1;
      count = nextCount;
      value.split = target.split = pendingSplit;
      raf = requestAnimationFrame(() => { raf = 0; draw(); });
      return;
    }
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  let pendingSplit = 0;
  function setBands(next, split, palette = [], gains = []) {
    pendingSplit = split;
    for (let i = 0; i < 8; i++) {
      const color = palette[i] ?? [1, 1, 1];
      colors.set(color, i * 3);
      levels[i] = gains[i] ?? 1;
    }
    nextCount = next;
    if (next === count) target.split = split;
    schedule();
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(canvas);
  document.addEventListener("visibilitychange", schedule);
  reduceMotion.addEventListener("change", schedule);
  schedule();

  return {
    // Idle look per tool: vocals hints two strands, multitrack four, tempo pulses.
    setMode(mode, palette) {
      target.beat = mode === "tempo" ? 1 : 0;
      target.calm = mode === "youtube" ? 1 : 0;
      if (value.hasSong > .5 && target.hasSong) return schedule();
      if (mode === "vocals") setBands(2, 1, palette);
      else if (mode === "multitrack") setBands(4, 1, palette);
      else setBands(1, 0, palette);
    },
    setSong(values) {
      envBytes.fill(0);
      if (values) for (let i = 0; i < SAMPLES; i++) envBytes[i] = Math.round(values[i] * 255);
      uploadEnv();
      target.hasSong = values ? 1 : 0;
      setBands(1, 0);
    },
    setStems(stems, gains) {
      for (let row = 0; row < 8; row++) {
        const values = stems[row]?.values;
        for (let i = 0; i < SAMPLES; i++) envBytes[(row + 1) * SAMPLES + i] = values ? Math.round(values[i] * 255) : 0;
      }
      uploadEnv();
      setBands(stems.length || 1, stems.length ? 1 : 0, stems.map((stem) => stem.color), gains);
    },
    setLevels(gains) {
      for (let i = 0; i < 8; i++) levels[i] = gains[i] ?? 1;
      schedule();
    },
    setProgress(progress) {
      target.progress = progress === null ? -1 : Number.isFinite(progress) ? progress : "sweep";
      if (typeof target.progress === "number" && value.progress < 0) value.progress = 0;
      schedule();
    },
    setPlayhead(fraction) {
      play = fraction ?? -1;
      schedule();
    },
    surge(active) {
      target.surge = active ? 1 : 0;
      schedule();
    },
    listen(fill) {
      source = fill;
      schedule();
    },
  };
}
