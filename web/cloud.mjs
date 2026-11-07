const apiPath = "/api/cloud";

export async function cloudAvailable() {
  try {
    const response = await fetch(apiPath, { signal: AbortSignal.timeout(4000) });
    if (response.status === 404 && ["127.0.0.1", "localhost"].includes(location.hostname)) return { enabled: false };
    const payload = response.ok ? await response.json() : {};
    return typeof payload.enabled === "boolean" ? payload : null;
  } catch {
    return null;
  }
}

async function request(action, data, signal, worker) {
  const response = await fetch(worker ? new URL(action, worker) : apiPath, {
    method: worker && action === "status" ? "GET" : "POST",
    headers: worker ? undefined : {
      "Content-Type": "application/json",
      ...(action === "create" && { "X-Akapella-Create": "1" }),
    },
    body: worker ? undefined : JSON.stringify({ action, ...data }),
    referrerPolicy: "no-referrer",
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 429
      ? "Bạn đã gửi nhiều lượt tách. Hãy đợi một lát rồi thử lại."
      : "Máy chủ tách stem không phản hồi.";
    throw new Error(payload.error || fallback);
  }
  return payload;
}

function uploadFile(url, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open("PUT", url);
    xhr.timeout = 300_000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("If-None-Match", "*");
    xhr.upload.onprogress = (event) => onProgress({ stage: "upload", done: event.loaded, total: file.size });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Không thể tải file lên. Hãy thử lại."));
    };
    xhr.onerror = xhr.ontimeout = () => reject(new Error("Tải file lên bị gián đoạn. Kiểm tra mạng và thử lại."));
    xhr.onabort = () => reject(signal.reason);
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}

function pause(signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1100);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function splitInCloud(source, mode, pilotCode, onProgress, signal, onSource) {
  let job;
  let worker;
  let sourceTask;
  let completed = false;
  try {
    const fromLink = typeof source === "string";
    const input = fromLink ? { sourceUrl: source } : { size: source.size };
    const created = await request("create", { ...input, mode, pilotCode }, signal);
    job = created.job;
    worker = created.worker;
    if (!fromLink) {
      onProgress({ stage: "upload", done: 0, total: source.size });
      await uploadFile(created.upload, source, onProgress, signal);
    }
    onProgress({ stage: "queued" });
    await request("start", { job }, signal, worker);

    let failures = 0;
    let previous;
    for (;;) {
      await pause(signal);
      let current;
      try {
        const pollSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
        current = await request("status", { job }, pollSignal, worker);
        failures = 0;
      } catch (error) {
        if (signal.aborted || ++failures >= 3) throw error;
        continue;
      }
      if (worker && current.source && onSource && !sourceTask) {
        sourceTask = onSource({
          ...current.source,
          preview: new URL("original.flac", worker).href,
          url: new URL("original.wav", worker).href,
        });
      }
      if (current.stage === "done") {
        await sourceTask;
        signal.throwIfAborted();
        completed = true;
        return worker ? current.tracks.map(name => ({
          name, url: new URL(`tracks/${name}.wav`, worker).href,
          preview: current.previews ? new URL(`tracks/${name}.flac`, worker).href : undefined,
        })) : current.tracks;
      }
      if (current.stage === "failed" || current.stage === "cancelled") {
        throw new Error(current.message || "Job tách stem đã dừng. Bạn có thể thử lại.");
      }
      const progress = `${current.stage}:${current.done}:${current.total}`;
      if (progress !== previous) onProgress(current);
      previous = progress;
    }
  } finally {
    if (job && !completed) {
      void request("cancel", { job }, AbortSignal.timeout(6000), worker).catch(() => {});
    }
  }
}
