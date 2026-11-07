import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { Sandbox } from "@vercel/sandbox";
import { mediaNetworkPolicy } from "./source.mjs";

const directory = "/vercel/akapella";
const port = 3000;
const files = ["engine.py", "sandbox_worker.py", "vocals.py", "link_source.py"];

export async function createSandboxJob(snapshotId, size, mode, origin, name, region, sourceUrl, downloaderKey) {
  const job = randomBytes(24).toString("hex");
  const source = await Promise.all(files.map(async (name) => ({
    path: `${directory}/${name}`,
    content: await readFile(new URL(name, import.meta.url)),
  })));
  const sandbox = await Sandbox.create({
    name,
    region,
    source: { type: "snapshot", snapshotId },
    ports: [port],
    resources: { vcpus: 4 },
    timeout: 15 * 60_000,
    persistent: false,
    networkPolicy: sourceUrl ? mediaNetworkPolicy : "deny-all",
    tags: { workload: "akapella-stems" },
    signal: AbortSignal.timeout(18_000),
  });
  try {
    await sandbox.writeFiles(source, { signal: AbortSignal.timeout(8000) });
    await sandbox.runCommand({
      cmd: `${directory}/.venv/bin/python`,
      args: [`${directory}/sandbox_worker.py`],
      detached: true,
      signal: AbortSignal.timeout(8000),
      env: {
        JOB_ACCESS: job, JOB_SIZE: String(size), JOB_MODE: String(mode), JOB_ORIGIN: origin,
        ...(sourceUrl && { JOB_URL: sourceUrl }),
        ...(sourceUrl && downloaderKey && { FASTSAVER_API_KEY: downloaderKey }),
        PATH: `${directory}/.venv/bin:/usr/local/bin:/usr/bin:/bin`,
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "4",
      },
    });
    const worker = `${sandbox.domain(port)}/${job}/`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await fetch(`${worker}ready`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (response?.ok) return { job, worker, ...(sourceUrl ? {} : { upload: `${worker}upload` }) };
      await response?.body?.cancel();
      await pause(350);
    }
    throw new Error("Sandbox worker did not start");
  } catch (error) {
    await sandbox.stop({ signal: AbortSignal.timeout(6000) }).catch(() => {});
    throw error;
  }
}
