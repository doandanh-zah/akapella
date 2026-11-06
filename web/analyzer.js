import { analyzeAudio } from "./audio-analysis.mjs";

self.onmessage = ({ data: { stereo } }) => {
  try {
    postMessage({ phase: "analysis", metrics: analyzeAudio(stereo) });
  } catch (error) {
    postMessage({ phase: "error", message: String(error) });
  }
};
