const cacheName = "akapella-onnx-v1";
const idleLimit = 45_000;

async function openCache() {
  try {
    return await caches.open(cacheName);
  } catch {
    return undefined;
  }
}

export async function loadModel({ url, size }, report) {
  const cache = await openCache();
  if (cache) {
    const cached = await cache.match(url).catch(() => undefined);
    if (cached) {
      report({ phase: "cached" });
      const bytes = await cached.arrayBuffer().catch(() => null);
      if (bytes?.byteLength === size) return new Uint8Array(bytes);
      await cache.delete(url).catch(() => {});
    }
  }

  report({ phase: "model", done: 0, total: size });
  const controller = new AbortController();
  let timeout;
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), idleLimit);
  };

  try {
    resetTimeout();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    // Cache the immutable revision concurrently with reading the model.
    const saving = cache?.put(url, response.clone()).catch(() => {});
    const reader = response.body.getReader();
    const bytes = new Uint8Array(size);
    let received = 0;
    let lastReport = performance.now();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimeout();
      bytes.set(value, received);
      received += value.byteLength;
      if (received === size || performance.now() - lastReport >= 220) {
        report({ phase: "model", done: received, total: size });
        lastReport = performance.now();
      }
    }
    if (received !== size) throw new Error("Tệp model không đủ dữ liệu.");
    await saving;
    return bytes;
  } catch (error) {
    controller.abort();
    await cache?.delete(url).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
