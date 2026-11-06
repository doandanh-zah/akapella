// HTDemucs ONNX tensor layout and overlap-add follow the demucs-onnx browser guide.
// https://stemsplit.github.io/demucs-onnx/browser/
import { loadModel } from "./model-loader.mjs";

const runtime = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
const models = {
  4: {
    url: "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx",
    size: 165_612_636,
  },
  6: {
    url: "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s_fp16weights.onnx",
    size: 136_428_532,
  },
};
const rate = 44100;
const segment = 343980;
const overlap = Math.floor(segment / 4);
const stride = segment - overlap;
const names = ["drums", "bass", "other", "vocals", "guitar", "piano"];
let session;
let loadedMode;

self.onmessage = async ({ data: { stereo, mode } }) => {
  let stage = "download";
  try {
    if (loadedMode !== mode) {
      await session?.release();
      session = undefined;
      loadedMode = undefined;
      const [ort, model] = await Promise.all([
        import(runtime + "ort.wasm.min.mjs"),
        loadModel(models[mode], (event) => postMessage(event)),
      ]);
      stage = "init";
      postMessage({ phase: "init" });
      ort.env.wasm.wasmPaths = runtime;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 2, 4) : 1;
      // Graph optimization can exhaust the WASM heap while loading HTDemucs.
      session = await ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "disabled",
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
      loadedMode = mode;
    }
    stage = "split";
    const tracks = await separate(stereo, Number(mode));
    postMessage({ phase: "done", tracks }, tracks.map(({ wav }) => wav));
  } catch (error) {
    postMessage({ phase: "error", stage, message: error instanceof Error ? error.message : String(error) });
  }
};

async function separate(stereo, count) {
  const ort = await import(runtime + "ort.wasm.min.mjs");
  const frames = stereo[0].length;
  const chunks = Math.max(1, Math.ceil((frames - segment) / stride) + 1);
  postMessage({ phase: "split", done: 0, chunks });
  const output = Array.from({ length: count }, () => new Float32Array(frames * 2));
  const weights = new Float32Array(frames);
  const chunk = new Float32Array(segment * 2);

  for (let index = 0; index < chunks; index++) {
    const start = index * stride;
    const length = Math.min(segment, frames - start);
    const window = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const fadeIn = index === 0 ? 1 : i / overlap;
      const fadeOut = index === chunks - 1 ? 1 : (segment - 1 - i) / overlap;
      window[i] = Math.min(fadeIn, fadeOut, 1);
      weights[start + i] += window[i];
    }

    chunk.fill(0);
    chunk.set(stereo[0].subarray(start, start + length));
    chunk.set(stereo[1].subarray(start, start + length), segment);
    const input = new ort.Tensor("float32", chunk, [1, 2, segment]);
    const { stems } = await session.run({ mix: input });
    try {
      if (stems.dims[1] !== count || stems.dims[2] !== 2 || stems.dims[3] !== segment) {
        throw new Error("Kết quả model có kích thước ngoài dự kiến.");
      }
      const samples = stems.data;
      for (let stem = 0; stem < count; stem++) {
        for (let channel = 0; channel < 2; channel++) {
          const offset = (stem * 2 + channel) * segment;
          const target = output[stem];
          for (let i = 0; i < length; i++) {
            target[2 * (start + i) + channel] += samples[offset + i] * window[i];
          }
        }
      }
    } finally {
      stems.dispose();
      input.dispose();
    }
    postMessage({ phase: "split", done: index + 1, chunks });
  }

  const total = count + 1;
  postMessage({ phase: "encode", done: 0, total });
  const instrumental = new Float32Array(frames * 2);
  const tracks = output.map((samples, index) => {
    for (let i = 0; i < samples.length; i++) {
      samples[i] /= weights[Math.floor(i / 2)];
      if (names[index] !== "vocals") instrumental[i] += samples[i];
    }
    const wav = encodeWav(samples);
    postMessage({ phase: "encode", done: index + 1, total });
    return { name: names[index], wav };
  });
  tracks.push({ name: "instrumental", wav: encodeWav(instrumental) });
  postMessage({ phase: "encode", done: total, total });
  return tracks;
}

function encodeWav(samples) {
  const size = samples.length * 2;
  const buffer = new ArrayBuffer(44 + size);
  const wav = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) wav.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  wav.setUint32(4, 36 + size, true);
  text(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 2, true);
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 4, true);
  wav.setUint16(32, 4, true);
  wav.setUint16(34, 16, true);
  text(36, "data");
  wav.setUint32(40, size, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    wav.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return buffer;
}
