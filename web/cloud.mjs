const apiPath = "/api/cloud";

export async function cloudAvailable() {
  try {
    const response = await fetch(apiPath, { signal: AbortSignal.timeout(4000) });
    if (response.status === 404 && ["127.0.0.1", "localhost"].includes(location.hostname)) return false;
    const payload = response.ok ? await response.json() : {};
    return typeof payload.enabled === "boolean" ? payload.enabled : null;
  } catch {
    return null;
  }
}

async function request(action, data, signal) {
  const response = await fetch(apiPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Máy chủ tách stem không phản hồi.");
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
    }, 1600);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function splitInCloud(file, mode, pilotCode, onProgress, signal) {
  let job;
  let completed = false;
  try {
    const created = await request("create", { size: file.size, mode, pilotCode }, signal);
    job = created.job;
    onProgress({ stage: "upload", done: 0, total: file.size });
    await uploadFile(created.upload, file, onProgress, signal);
    onProgress({ stage: "queued" });
    await request("start", { job }, signal);

    let failures = 0;
    for (;;) {
      await pause(signal);
      let current;
      try {
        current = await request("status", { job }, signal);
        failures = 0;
      } catch (error) {
        if (signal.aborted || ++failures >= 3) throw error;
        continue;
      }
      if (current.stage === "done") {
        completed = true;
        return current.tracks;
      }
      if (current.stage === "failed" || current.stage === "cancelled") {
        throw new Error(current.message || "Job tách stem đã dừng. Bạn có thể thử lại.");
      }
      onProgress(current);
    }
  } finally {
    if (job && !completed) {
      void request("cancel", { job }, AbortSignal.timeout(6000)).catch(() => {});
    }
  }
}
