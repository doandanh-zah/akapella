import { cloudAvailable, splitInCloud } from "./cloud.mjs";
import { createMixer, waveform } from "./mixer.mjs";

const motion = import("./motion.mjs").catch(() => null);
const byId = (id) => document.getElementById(id);
const form = byId("split-form");
const controls = byId("controls");
const source = byId("source");
const mode = form.elements.namedItem("mode");
const drop = document.querySelector(".hero");
const run = byId("run");
const runLabel = byId("run-label");
const jobStatus = byId("job");
const cancel = byId("cancel");
const status = byId("status");
const progress = byId("progress");
const jobTop = byId("job-top");
const jobStage = byId("job-stage");
const jobElapsed = byId("job-elapsed");
const jobDetail = byId("job-detail");
const jobStall = byId("job-stall");
const errorText = byId("error");
const results = byId("results");
const empty = byId("empty");
const seek = byId("seek");
const play = byId("play");
const monitorOriginal = byId("monitor-original");
const monitorMix = byId("monitor-mix");
const waveArea = byId("wave-area");
const wave = document.querySelector("[data-wave]");
const sampleWave = wave.getAttribute("d");
const notes = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const labels = {
  vocals: "Giọng hát", bass: "Bass", drums: "Trống", other: "Nhạc khác",
  guitar: "Guitar", piano: "Piano", instrumental: "Bản không lời",
};
const urls = new Set();
const rowButtons = new Map();
let audio;
let decoder;
let selection;
let worker;
let workerMode;
let workerIdle;
let analysisWorker;
let job;
let useCloud = false;
let cloudUnavailable = false;
let cloudReady = false;
let supportsVocals = true;
let view = "vocals";
let completedMode;
let scrubbing = false;
let lastMixerState;
const workspace = byId("studio");
const toolLinks = [...document.querySelectorAll("[data-view]")];
const views = {
  vocals: ["01 / TÁCH ÂM THANH", "Tách giọng|khỏi bản nhạc.", "Lấy giọng hát và bản không lời thành hai track riêng để nghe, phối lại hoặc hát karaoke."],
  multitrack: ["02 / TÁCH NHIỀU STEM", "Tách từng lớp|âm thanh.", "Tách giọng, bass, trống và các nhạc cụ. Nghe và tải WAV riêng cho từng track."],
  tempo: ["03 / PHÂN TÍCH NHẠC", "Tìm BPM|và tone.", "Mở một bài để ước tính nhịp độ và giọng trưởng hoặc thứ ngay trên thiết bị."],
};
const mixer = createMixer(renderMixer);
const cloudConfig = cloudAvailable().then((config) => {
  useCloud = config?.enabled === true;
  cloudUnavailable = config === null;
  cloudReady = true;
  supportsVocals = Boolean(config?.enabled && config.modes?.includes(2));
  const requiresCode = useCloud && config.requiresCode !== false;
  byId("pilot-code").required = requiresCode;
  byId("nav-vocals").hidden = !supportsVocals;
  syncView();
});

function syncView() {
  const hash = location.hash.slice(1);
  const previous = view;
  view = hash === "youtube" || hash.startsWith("youtube=") ? "youtube"
    : hash === "tempo" ? "tempo"
    : hash === "multitrack" || !supportsVocals ? "multitrack" : "vocals";
  workspace.hidden = view === "youtube";
  byId("youtube").hidden = view !== "youtube";
  workspace.dataset.view = view;
  for (const link of toolLinks) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view !== "youtube") {
    const [kicker, heading, intro] = views[view];
    const [line, nextLine] = heading.split("|");
    byId("tool-kicker").textContent = kicker;
    byId("headline").replaceChildren(line, document.createElement("br"), ` ${nextLine}`);
    byId("tool-intro").textContent = intro;
  }
  syncWorkspace();
  if (previous !== view && view !== "youtube" && !audio) {
    void motion.then((effects) => { if (view === workspace.dataset.view) effects?.revealHero(); });
  }
}

function syncWorkspace() {
  workspace.toggleAttribute("data-loaded", Boolean(audio));
  workspace.toggleAttribute("data-results", !results.hidden && view !== "tempo");
  byId("source-name").textContent = audio ? "Đổi file" : "Chọn file nhạc";
  byId("player").hidden = !audio;
  byId("results-panel").hidden = results.hidden || view === "tempo";
  byId("mode-group").hidden = view !== "multitrack";
  byId("model-note").hidden = view === "tempo" || (!audio && useCloud);
  byId("cloud-access").hidden = !byId("pilot-code").required || view === "tempo" || !audio;
  byId("pilot-code").disabled = view === "tempo";
  const alreadySplit = completedMode === (view === "vocals" ? 2 : Number(mode.value));
  byId("split-actions").hidden = !job && (!audio || view === "tempo" || alreadySplit);
  run.hidden = view === "tempo";
  run.disabled = !audio || Boolean(job) || cloudUnavailable || !cloudReady;
  byId("upload-note").textContent = view === "tempo"
    ? "Phân tích ngay trên thiết bị."
    : useCloud ? "File được gửi tới máy chủ để tách." : "";
  syncModeHint();
  if (!job) setRunLabel();
}

for (const link of toolLinks) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null, "", link.hash);
    syncView();
  });
}
addEventListener("hashchange", syncView);
syncView();

function showError(message = "") {
  errorText.textContent = message;
  errorText.hidden = !message;
  if (!message) {
    source.removeAttribute("aria-invalid");
    source.setAttribute("aria-describedby", "formats upload-note");
  }
}

function formatTime(seconds) {
  const time = Math.floor(seconds);
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;
}

function showPosition(seconds) {
  const elapsed = formatTime(seconds);
  if (byId("elapsed").textContent !== elapsed) {
    byId("elapsed").textContent = elapsed;
    seek.setAttribute("aria-valuetext", `${elapsed} / ${byId("duration").textContent}`);
  }
  waveArea.style.setProperty("--played", `${audio ? 100 * seconds / audio.duration : 0}%`);
}

function setPressed(button, active) {
  if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", active);
}

function renderMixer(state, progressOnly) {
  if (!scrubbing) {
    seek.value = state.position;
    showPosition(state.position);
  }
  if (progressOnly) return;
  lastMixerState = state;
  const label = state.playing ? "Tạm dừng" : "Phát";
  if (byId("play-label").textContent !== label) {
    byId("play-label").textContent = label;
    byId("play-icon").textContent = state.playing ? "Ⅱ" : "▶";
  }
  setPressed(monitorOriginal, state.mode === "original");
  setPressed(monitorMix, state.mode === "mix");
  monitorMix.disabled = !state.hasStems;
  for (const [name, buttons] of rowButtons) {
    if (buttons.listen) setPressed(buttons.listen, state.mode === "instrumental");
    else {
      setPressed(buttons.mute, state.muted.has(name));
      setPressed(buttons.solo, state.solo === name);
    }
  }
}

play.addEventListener("click", async () => {
  byId("play-error").hidden = true;
  try {
    await mixer.toggle();
  } catch {
    byId("play-error").textContent = "Không thể phát âm thanh. Hãy thử lại trong trình duyệt.";
    byId("play-error").hidden = false;
  }
});
monitorOriginal.addEventListener("click", () => mixer.monitor("original"));
monitorMix.addEventListener("click", () => mixer.monitor("mix"));
seek.addEventListener("input", () => {
  scrubbing = true;
  showPosition(Number(seek.value));
});
seek.addEventListener("change", () => {
  scrubbing = false;
  mixer.seek(Number(seek.value));
});
seek.addEventListener("blur", () => {
  if (!scrubbing) return;
  scrubbing = false;
  mixer.seek(Number(seek.value));
});

async function select(file) {
  if (!file || job) return;
  selection?.controller.abort();
  analysisWorker?.terminate();
  analysisWorker = undefined;
  const current = { controller: new AbortController(), file, view };
  selection = current;
  audio = undefined;
  completedMode = undefined;
  scrubbing = false;
  mixer.setTrack(undefined);
  clearResults();
  clearAnalysis();
  syncWorkspace();
  byId("song-name").textContent = "Đang đọc file…";
  byId("wave-source").textContent = "ĐANG ĐỌC FILE";
  wave.removeAttribute("data-loaded");
  wave.setAttribute("d", sampleWave);
  play.disabled = seek.disabled = monitorOriginal.disabled = run.disabled = true;
  byId("play-error").hidden = true;
  byId("duration").textContent = "—";
  jobStatus.removeAttribute("data-state");
  setRunLabel();
  status.textContent = "Đang đọc âm thanh…";
  showError();

  try {
    const decoded = await decode(file, current.controller.signal);
    if (selection !== current) return;
    audio = decoded;
    byId("song-name").textContent = file.name;
    byId("duration").textContent = formatTime(audio.duration);
    byId("wave-source").textContent = "BÀI ĐANG MỞ";
    wave.removeAttribute("data-placeholder");
    for (const attr of ["stroke-dasharray", "stroke-dashoffset", "pathLength"]) wave.removeAttribute(attr);
    wave.setAttribute("data-loaded", "");
    wave.setAttribute("d", waveform(audio));
    seek.max = audio.duration;
    seek.setAttribute("aria-valuetext", `0:00 / ${formatTime(audio.duration)}`);
    play.disabled = seek.disabled = monitorOriginal.disabled = false;
    mixer.setTrack(audio);
    status.textContent = "";
    syncWorkspace();
    void motion.then((effects) => { if (selection === current) effects?.revealWave(); });
    analyze(audio);
    await cloudConfig;
    if (selection === current && current.view === "vocals" && view === "vocals" && !byId("pilot-code").required) {
      form.requestSubmit(run);
    }
  } catch (error) {
    if (selection !== current) return;
    byId("song-name").textContent = "Chưa chọn bài";
    byId("wave-source").textContent = "BÀI MẪU";
    status.textContent = "";
    if (!file.sample) {
      source.setAttribute("aria-invalid", "true");
      source.setAttribute("aria-describedby", "formats upload-note error");
    }
    showError(error.message);
  }
}

source.addEventListener("change", () => {
  const file = source.files[0];
  source.value = "";
  void select(file);
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!job) drop.classList.add("dragging");
});
drop.addEventListener("dragleave", (event) => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("dragging");
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragging");
  void select(event.dataTransfer.files[0]);
});
byId("sample").addEventListener("click", () => void select({ name: "akapella-mau.mp3", sample: true }));
function setRunLabel() {
  runLabel.textContent = view === "vocals" ? "Tách giọng" : "Tách âm thanh";
}

function syncModeHint() {
  const hint = byId("model-note");
  hint.textContent = cloudUnavailable
    ? "Chưa kết nối được máy chủ. Hãy tải lại trang để thử lại."
    : useCloud
    ? "Máy chủ xử lý file và tạo WAV. BPM và tone được tính ngay trên thiết bị."
    : `Lần đầu có thể cần tải model khoảng ${mode.value === "4" ? 166 : 136} MB. Âm thanh được xử lý trên thiết bị của bạn.`;
  return hint;
}

byId("mode-group").addEventListener("change", () => {
  syncWorkspace();
  const hint = syncModeHint();
  void motion.then((effects) => effects?.revealMode(hint));
});


const mb = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

function reportProgress(step, message, detail = "", done, total) {
  job.updated = performance.now();
  const stages = [job.cloud ? "Gửi file" : "Model", "Tách stem", "Xuất kết quả"];
  jobStage.textContent = `Bước ${step}/3 · ${stages[step - 1]}`;
  if (status.textContent !== message) status.textContent = message;
  jobDetail.textContent = detail;
  jobDetail.hidden = !detail;
  jobStall.hidden = true;
  if (total) {
    progress.max = total;
    progress.value = done;
  } else {
    progress.removeAttribute("value");
  }
}

function tickJob() {
  if (!job) return;
  const now = performance.now();
  jobElapsed.textContent = formatTime((now - job.started) / 1000);
  const idle = now - job.updated;
  jobStall.hidden = idle < 20_000;
  if (idle > 180_000) failed("Quá lâu chưa có thêm tiến độ. Hãy thử lại với file ngắn hơn.");
}

function finish(message, state = "") {
  clearInterval(job?.timer);
  job = undefined;
  controls.disabled = false;
  syncWorkspace();
  if (state === "error") runLabel.textContent = "Thử lại";
  jobStatus.dataset.state = state;
  cancel.hidden = progress.hidden = jobTop.hidden = jobDetail.hidden = jobStall.hidden = true;
  form.removeAttribute("aria-busy");
  status.textContent = message;
}

function stopWorker() {
  clearTimeout(workerIdle);
  worker?.terminate();
  worker = undefined;
  workerMode = undefined;
}

function keepWorkerBriefly() {
  // Free the WASM heap on smaller devices and after longer jobs.
  if ((navigator.deviceMemory ?? 0) >= 8 && audio.duration <= 60) {
    workerIdle = setTimeout(stopWorker, 60_000);
  } else {
    stopWorker();
  }
}

cancel.addEventListener("click", () => {
  job?.controller.abort();
  stopWorker();
  const message = job?.exported
    ? "Đã dừng chuẩn bị mixer. Bạn vẫn có thể tải WAV."
    : "Đã hủy. Bạn có thể thử lại với cùng file.";
  finish(message, "cancelled");
  run.focus();
});

function audioDecoder() {
  return decoder ??= new OfflineAudioContext(2, 1, 44100);
}

async function decode(file, signal) {
  if (file.size > 50_000_000) throw new Error("File vượt quá 50 MB. Hãy chọn một file nhỏ hơn.");
  let bytes;
  if (file.sample) {
    const response = await fetch("/demo.mp3", { signal });
    if (!response.ok) throw new Error("Tải file mẫu thất bại. Bạn có thể chọn file riêng.");
    bytes = await response.arrayBuffer();
  } else {
    bytes = await file.arrayBuffer();
  }
  signal.throwIfAborted();
  const decoded = await audioDecoder().decodeAudioData(bytes).catch(() => {
    throw new Error("Trình duyệt không đọc được file này. Hãy thử WAV hoặc MP3.");
  });
  if (!decoded.length || decoded.duration > 300) throw new Error("Hãy chọn file âm thanh dài tối đa 5 phút.");
  if (decoded.numberOfChannels > 2) throw new Error("Hãy dùng file mono hoặc stereo.");
  return decoded;
}

function sendAudio(target, buffer, splitMode) {
  const stereo = [buffer.getChannelData(0).slice(), buffer.getChannelData(buffer.numberOfChannels - 1).slice()];
  target.postMessage({ stereo, mode: splitMode }, stereo.map((channel) => channel.buffer));
}

function clearResults() {
  void motion.then((effects) => effects?.resetResultsMotion());
  results.replaceChildren();
  rowButtons.clear();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  results.hidden = true;
  empty.hidden = false;
}

function trackButton(text, description, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-toggle";
  button.textContent = text;
  button.setAttribute("aria-label", description);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", action);
  return button;
}

function showResults(files, buffers) {
  clearResults();
  for (const [name, label] of Object.entries(labels)) {
    if (!files.has(name)) continue;
    const file = files.get(name);
    const url = typeof file === "string" ? file : URL.createObjectURL(file);
    if (typeof file !== "string") urls.add(url);
    const item = document.createElement("li");
    item.className = "track";
    const index = document.createElement("span");
    index.className = "track-index";
    index.setAttribute("aria-hidden", "true");
    index.textContent = String(results.children.length + 1).padStart(2, "0");
    const title = document.createElement("strong");
    title.textContent = label;
    const actions = document.createElement("div");
    actions.className = "track-actions";
    if (name === "instrumental") {
      const listen = trackButton("Nghe", "Nghe bản không lời", () => {
        mixer.monitor(lastMixerState.mode === "instrumental" ? "original" : "instrumental");
      });
      rowButtons.set(name, { listen });
      actions.append(listen);
    } else {
      const mute = trackButton("Mute", `Mute · ${label}`, () => mixer.mute(name));
      const solo = trackButton("Solo", `Solo · ${label}`, () => mixer.solo(name));
      rowButtons.set(name, { mute, solo });
      actions.append(mute, solo);
    }
    for (const button of actions.children) button.disabled = !buffers.size;
    const link = document.createElement("a");
    link.href = url;
    link.referrerPolicy = "no-referrer";
    link.download = name + ".wav";
    link.textContent = "Tải WAV ↓";
    link.setAttribute("aria-label", `Tải WAV · ${label}`);
    actions.append(link);
    item.append(index, title, actions);
    results.append(item);
  }
  mixer.setStems(buffers);
  byId("results-heading").textContent = files.size === 2
    ? "Giọng hát & bản không lời"
    : `${files.size - 1} stem và bản không lời`;
  results.hidden = false;
  byId("results-panel").hidden = view === "tempo";
  workspace.toggleAttribute("data-results", view !== "tempo");
  empty.hidden = true;
  void motion.then((effects) => { if (!results.hidden) effects?.revealResults(results.children); });
}

function clearAnalysis() {
  byId("tempo").textContent = "—";
  byId("key").textContent = "—";
  byId("tempo-note").textContent = "";
  byId("key-note").textContent = "";
  byId("analysis-status").textContent = "";
}

function showAnalysis({ tempo, key }) {
  byId("tempo").textContent = tempo ? `${tempo.bpm} BPM` : "Chưa rõ";
  byId("tempo-note").textContent = tempo?.alternative
    ? `Nhịp thay thế: ${tempo.alternative} BPM`
    : tempo ? "" : "Chưa tìm được nhịp ổn định.";
  byId("key").textContent = key ? `${notes[key.root]} ${key.mode === "major" ? "trưởng" : "thứ"}` : "Chưa rõ";
  byId("key-note").textContent = key
    ? key.uncertain ? "Giọng ước tính chưa chắc chắn." : ""
    : "Cần giai điệu hoặc hòa âm rõ.";
  byId("analysis-status").textContent = `Tempo ${byId("tempo").textContent}, tone ${byId("key").textContent}.`;
}

function analyze(buffer) {
  byId("tempo").textContent = "Đang đo…";
  byId("key").textContent = "Đang đo…";
  const emptyMetrics = { tempo: null, key: null };
  let analysis;
  try {
    analysis = new Worker("/analyzer.js", { type: "module" });
  } catch {
    showAnalysis(emptyMetrics);
    return;
  }
  analysisWorker = analysis;
  const complete = (metrics) => {
    if (analysisWorker !== analysis) return;
    analysis.terminate();
    analysisWorker = undefined;
    showAnalysis(metrics);
  };
  analysis.onmessage = ({ data }) => complete(data.metrics ?? emptyMetrics);
  analysis.onerror = () => complete(emptyMetrics);
  try {
    sendAudio(analysis, buffer);
  } catch {
    complete(emptyMetrics);
  }
}

function failed(message) {
  job?.controller.abort();
  stopWorker();
  finish("", "error");
  showError(message);
}

async function prepareResults(files, mixTracks, readWav, current) {
  const exportTotal = files.size + mixTracks.length;
  try {
    const buffers = new Map();
    showResults(files, buffers);
    current.exported = true;
    reportProgress(3, "Đang chuẩn bị mixer…", "Bạn đã có thể tải WAV ở danh sách stem.", files.size, exportTotal);
    try {
      for (let index = 0; index < mixTracks.length; index += 3) {
        const batch = await Promise.allSettled(mixTracks.slice(index, index + 3).map(async (name) => {
          const buffer = await readWav(name);
          if (job !== current) return;
          buffers.set(name, buffer);
          reportProgress(3, "Đang chuẩn bị mixer…", `Đã mở ${buffers.size}/${mixTracks.length} track. WAV đã sẵn sàng.`, files.size + buffers.size, exportTotal);
        }));
        if (job !== current) return;
        if (batch.some((result) => result.status === "rejected")) throw new Error("Không đọc được stem.");
      }
    } catch {
      buffers.clear();
    }
    if (job !== current) return;
    if (buffers.size) {
      for (const buttons of rowButtons.values()) {
        for (const button of Object.values(buttons)) button.disabled = false;
      }
      mixer.setStems(buffers);
    }
    const message = buffers.size
      ? "Chọn Bản tách hoặc Solo để nghe."
      : "Không thể mở mixer trên thiết bị này. Bạn vẫn có thể tải WAV.";
    const expiry = current.cloud ? " Link tải WAV có thời hạn." : "";
    completedMode = current.mode;
    finish(`Đã tạo ${files.size} track WAV. ${message}${expiry}`, "done");
  } catch {
    if (job === current) failed("Không thể chuẩn bị file WAV. Hãy thử tách lại với file ngắn hơn.");
  }
}

async function runCloud(current, splitMode, selected) {
  const signal = current.controller.signal;
  try {
    const file = selected.sample
      ? await fetch("/demo.mp3", { signal }).then((res) => {
        if (!res.ok) throw new Error("Không tải được bài mẫu.");
        return res.blob();
      })
      : selected;
    const tracks = await splitInCloud(file, Number(splitMode), byId("pilot-code").value, (data) => {
      if (job !== current) return;
      if (data.stage === "upload") {
        reportProgress(1, "Đang tải file lên…", `${mb.format(data.done / 1e6)} / ${mb.format(data.total / 1e6)} MB`, data.done, data.total);
      } else if (data.stage === "queued") {
        reportProgress(2, "Đang đưa bài vào xử lý…");
      } else if (data.stage === "prepare") {
        reportProgress(2, "Máy chủ đang chuẩn bị bài nhạc…");
      } else if (data.stage === "split") {
        reportProgress(2, "Máy chủ đang tách stem…", `${data.done}/${data.total} đoạn`, data.done, data.total);
      } else if (data.stage === "export") {
        reportProgress(3, "Máy chủ đang xuất WAV…", "", data.done, data.total);
      } else if (data.stage === "preview") {
        reportProgress(3, "Đang chuẩn bị bản nghe thử…");
      }
    }, signal);
    if (job !== current) return;
    const files = new Map(tracks.map(({ name, url }) => [name, url]));
    const previews = new Map(tracks.map(({ name, preview }) => [name, preview]));
    const mixTracks = [...files.keys()].filter((name) => splitMode === 2 || name !== "instrumental");
    const read = async (url) => {
      const response = await fetch(url, { signal, referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Không thể đọc âm thanh.");
      return audioDecoder().decodeAudioData(await response.arrayBuffer());
    };
    await prepareResults(files, mixTracks, async (name) => {
      if (previews.get(name)) {
        try { return await read(previews.get(name)); }
        catch { signal.throwIfAborted(); }
      }
      return read(files.get(name));
    }, current);
  } catch (error) {
    if (job === current) failed(error.message);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (job || !audio || cloudUnavailable || !cloudReady || view === "tempo" || view === "youtube") return;
  const splitMode = view === "vocals" ? 2 : Number(mode.value);
  const current = { started: performance.now(), timer: setInterval(tickJob, 1000), controller: new AbortController(), cloud: useCloud, mode: splitMode };
  job = current;
  controls.disabled = true;
  run.disabled = true;
  runLabel.textContent = "Đang tách…";
  jobStatus.dataset.state = "busy";
  cancel.hidden = progress.hidden = jobTop.hidden = false;
  byId("split-actions").hidden = false;
  jobElapsed.textContent = "0:00";
  form.setAttribute("aria-busy", "true");
  showError();
  if (current.cloud) {
    reportProgress(1, "Đang mở máy chủ…");
    void runCloud(current, splitMode, selection.file);
    return;
  }
  reportProgress(1, "Đang kiểm tra model…");

  try {
    clearTimeout(workerIdle);
    if (workerMode !== mode.value) stopWorker();
    if (!worker) {
      worker = new Worker("/separator.js", { type: "module" });
      workerMode = mode.value;
    }
    worker.onmessage = ({ data }) => {
      if (job !== current) return;
      if (data.phase === "model") {
        const detail = `${mb.format(data.done / 1e6)} / ${mb.format(data.total / 1e6)} MB · ${Math.floor(100 * data.done / data.total)}%`;
        reportProgress(1, "Đang tải model…", detail, data.done, data.total);
      } else if (data.phase === "cached") {
        reportProgress(1, "Đang đọc model đã lưu…", "Dùng bản lưu trên thiết bị.");
      } else if (data.phase === "init") {
        reportProgress(1, "Đang khởi tạo bộ tách…", "Model đã sẵn sàng. Trình duyệt đang chuẩn bị chạy.");
      } else if (data.phase === "split") {
        reportProgress(2, "Đang tách stem…", `Đã xử lý ${data.done}/${data.chunks} đoạn · ${Math.floor(100 * data.done / data.chunks)}%`, data.done, data.chunks);
      } else if (data.phase === "encode") {
        reportProgress(3, "Đang xuất WAV…", `Đã tạo ${data.done}/${data.total} file`, data.done, data.total * 2 - 1);
      } else if (data.phase === "done") {
        keepWorkerBriefly();
        try {
          const files = new Map(data.tracks.map(({ name, wav }) => [name, new Blob([wav], { type: "audio/wav" })]));
          const mixTracks = data.tracks.filter(({ name }) => name !== "instrumental");
          const wavs = new Map(mixTracks.map(({ name, wav }) => [name, wav]));
          void prepareResults(files, [...wavs.keys()], (name) => audioDecoder().decodeAudioData(wavs.get(name)), current);
        } catch {
          failed("Không thể chuẩn bị file WAV. Hãy thử tách lại với file ngắn hơn.");
        }
      } else if (data.phase === "error") {
        console.error(data.message);
        failed(data.stage === "download"
          ? "Không tải được model. Kiểm tra mạng và bấm Thử lại."
          : "Trình duyệt không tách được file này. Hãy thử lại hoặc dùng file ngắn hơn.");
      }
    };
    worker.onerror = () => {
      if (job === current) failed("Trình duyệt không khởi động được bộ tách. Hãy tải lại trang.");
    };
    sendAudio(worker, audio, mode.value);
  } catch {
    failed("Trình duyệt không khởi động được bộ tách. Hãy tải lại trang.");
  }
});
