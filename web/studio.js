const motion = import("./motion.mjs").catch(() => null);

const byId = (id) => document.getElementById(id);
const form = byId("split-form");
const controls = byId("controls");
const source = byId("source");
const mode = form.elements.namedItem("mode");
const drop = byId("drop");
const run = byId("run");
const runLabel = byId("run-label");
const jobStatus = byId("job");
const cancel = byId("cancel");
const status = byId("status");
const progress = byId("progress");
const errorText = byId("error");
const results = byId("results");
const empty = byId("empty");
const analysis = byId("analysis");
const notes = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const labels = {
  vocals: "Giọng hát", bass: "Bass", drums: "Trống", other: "Nhạc khác",
  guitar: "Guitar", piano: "Piano", instrumental: "Bản không lời",
};
const urls = new Set();
let selection;
let worker;
let workerMode;
let job;

function showError(message = "") {
  errorText.textContent = message;
  errorText.hidden = !message;
  if (!message) {
    source.removeAttribute("aria-invalid");
    source.setAttribute("aria-describedby", "formats");
  }
}

function select(file) {
  if (!file || job) return;
  selection = file;
  clearResults();
  byId("source-name").textContent = file.name;
  jobStatus.removeAttribute("data-state");
  status.textContent = "";
  showError();
  run.disabled = false;
}

source.addEventListener("change", () => select(source.files[0]));
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!job) drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragging");
  select(event.dataTransfer.files[0]);
});
byId("sample").addEventListener("click", () => {
  source.value = "";
  select({ name: "akapella-mau.mp3", sample: true });
});
byId("mode-group").addEventListener("change", () => {
  const analysing = isAnalysis();
  runLabel.textContent = analysing ? "Phân tích nhạc" : "Tách âm thanh";
  if (!empty.hidden) setResultFormat(analysing);
  byId("empty-title").textContent = analysing ? "Chưa có phân tích" : "Chưa có track";
  byId("empty-copy").textContent = analysing
    ? "Chọn file và bắt đầu phân tích để xem BPM và tone ước tính."
    : "Chọn file và bắt đầu tách để nghe thử hoặc tải từng track WAV.";
  const hint = byId("model-note");
  const size = mode.value === "4" ? 166 : 136;
  hint.textContent = analysing
    ? "Phân tích BPM và giọng nhạc ngay trên thiết bị của bạn."
    : `Model khoảng ${size} MB. Âm thanh được xử lý trên thiết bị của bạn.`;
  showError();
  void motion.then((effects) => effects?.revealMode(hint));
});

function isAnalysis() {
  return mode.value === "analysis";
}

function finish(message, state = "") {
  job = undefined;
  controls.disabled = false;
  run.disabled = !selection;
  runLabel.textContent = isAnalysis() ? "Phân tích nhạc" : "Tách âm thanh";
  jobStatus.dataset.state = state;
  cancel.hidden = true;
  progress.hidden = true;
  form.removeAttribute("aria-busy");
  status.textContent = message;
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  workerMode = undefined;
}

cancel.addEventListener("click", () => {
  job?.abort();
  stopWorker();
  finish("Đã hủy. Bạn có thể thử lại với cùng file.", "cancelled");
  run.focus();
});

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
  const context = new OfflineAudioContext(2, 1, 44100);
  const audio = await context.decodeAudioData(bytes).catch(() => {
    throw new Error("Trình duyệt không đọc được file này. Hãy thử WAV hoặc MP3.");
  });
  if (!audio.length || audio.duration > 300) throw new Error("Hãy chọn file âm thanh dài tối đa 5 phút.");
  if (audio.numberOfChannels > 2) throw new Error("Hãy dùng file mono hoặc stereo.");
  return [audio.getChannelData(0).slice(), audio.getChannelData(audio.numberOfChannels - 1).slice()];
}

function setResultFormat(analysing) {
  byId("result-format").textContent = analysing ? "BPM / TONE" : "WAV / 44,1 kHz";
}

function clearResults() {
  setResultFormat(isAnalysis());
  void motion.then((effects) => effects?.resetResultsMotion());
  results.replaceChildren();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  results.hidden = true;
  analysis.hidden = true;
  empty.hidden = false;
}

function showResults(tracks) {
  const byName = new Map(tracks.map((track) => [track.name, track.wav]));
  for (const [name, label] of Object.entries(labels)) {
    if (!byName.has(name)) continue;
    const url = URL.createObjectURL(new Blob([byName.get(name)], { type: "audio/wav" }));
    urls.add(url);
    const item = document.createElement("li");
    item.className = "track";
    const index = document.createElement("span");
    index.className = "track-index";
    index.setAttribute("aria-hidden", "true");
    index.textContent = String(results.children.length + 1).padStart(2, "0");
    const title = document.createElement("strong");
    title.textContent = label;
    const link = document.createElement("a");
    link.href = url;
    link.download = name + ".wav";
    link.textContent = "Tải WAV ↓";
    link.setAttribute("aria-label", `Tải WAV · ${label}`);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = url;
    audio.setAttribute("aria-label", label);
    audio.addEventListener("play", () => {
      for (const other of results.querySelectorAll("audio")) if (other !== audio) other.pause();
    });
    item.append(index, title, link, audio);
    results.append(item);
  }
  results.hidden = false;
  empty.hidden = true;
  void motion.then((effects) => { if (!results.hidden) effects?.revealResults(results.children); });
}

function showAnalysis({ tempo, key }) {
  byId("tempo").textContent = tempo ? `${tempo.bpm} BPM` : "Chưa rõ";
  byId("tempo-note").textContent = tempo?.alternative
    ? `Có thể đếm ở ${tempo.alternative} BPM`
    : tempo ? "" : "Chưa tìm được nhịp lặp ổn định.";
  byId("key").textContent = key ? `${notes[key.root]} ${key.mode === "major" ? "trưởng" : "thứ"}` : "Chưa rõ";
  byId("key-note").textContent = key
    ? key.uncertain ? "Tín hiệu giọng nhạc chưa rõ." : ""
    : "Cần đoạn có giai điệu hoặc hòa âm rõ.";
  analysis.hidden = false;
  empty.hidden = true;
  void motion.then((effects) => { if (!analysis.hidden) effects?.revealResults(analysis.querySelectorAll(".metrics > div")); });
}

function failed(message) {
  stopWorker();
  finish("");
  showError(message);
}

function handleWorker({ data }) {
  if (!job) return;
  if (data.phase === "model") {
    status.textContent = "Đang tải model. Lần đầu có thể mất vài phút…";
  } else if (data.phase === "processing") {
    status.textContent = "Đang tách các stem…";
  } else if (data.phase === "split") {
    progress.max = data.chunks;
    progress.value = data.done;
    status.textContent = `Đã xử lý ${data.done}/${data.chunks} đoạn…`;
  } else if (data.phase === "done") {
    showResults(data.tracks);
    finish(`Đã tạo ${data.tracks.length} track WAV.`, "done");
  } else if (data.phase === "analysis") {
    stopWorker();
    showAnalysis(data.metrics);
    finish("Đã phân tích tempo và tone.", "done");
  } else if (data.phase === "error") {
    console.error(data.message);
    failed(isAnalysis()
      ? "Không thể phân tích file này. Hãy thử lại với file WAV hoặc MP3."
      : "Không thể chạy model. Kiểm tra kết nối rồi thử lại trên trình duyệt máy tính.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (job || !selection) return;
  const current = new AbortController();
  job = current;
  controls.disabled = true;
  run.disabled = true;
  runLabel.textContent = isAnalysis() ? "Đang phân tích…" : "Đang tách…";
  jobStatus.dataset.state = "busy";
  cancel.hidden = false;
  form.setAttribute("aria-busy", "true");
  status.textContent = "Đang đọc âm thanh…";
  progress.removeAttribute("value");
  progress.hidden = false;
  showError();

  try {
    const stereo = await decode(selection, current.signal).catch((error) => {
      if (job === current && !selection.sample) {
        source.setAttribute("aria-invalid", "true");
        source.setAttribute("aria-describedby", "formats error");
      }
      throw error;
    });
    if (job !== current) return;
    clearResults();
    const task = isAnalysis() ? "analyzer" : "separator";
    if (workerMode !== task) stopWorker();
    if (!worker) {
      worker = new Worker(`/${task}.js`, { type: "module" });
      workerMode = task;
      worker.onmessage = handleWorker;
      worker.onerror = () => failed("Trình duyệt không khởi động được tác vụ. Hãy tải lại trang.");
    }
    status.textContent = isAnalysis() ? "Đang đo nhịp và phân tích giọng nhạc…" : "Đang khởi động bộ tách…";
    worker.postMessage({ stereo, mode: mode.value }, stereo.map((channel) => channel.buffer));
  } catch (error) {
    if (job === current) failed(error.message);
  }
});
