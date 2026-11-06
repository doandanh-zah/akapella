import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createSandboxJob } from "../cloud/sandbox.mjs";

const actions = new Set(["create", "start", "status", "cancel"]);

function matches(candidate, secret) {
  if (typeof candidate !== "string" || candidate.length > 256) return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default async function handler(req, res) {
  const { AKAPELLA_MODAL_URL: url, AKAPELLA_MODAL_KEY: key,
    AKAPELLA_MODAL_SECRET: secret, AKAPELLA_PILOT_CODE: code,
    AKAPELLA_SANDBOX_SNAPSHOT: snapshot, VERCEL_URL: deployment,
    VERCEL_BRANCH_URL: branch, AKAPELLA_RATE_KEY: rateKey,
    AKAPELLA_SANDBOX_REGION: region, AKAPELLA_SANDBOX_VOCALS: vocals } = process.env;
  const validCode = code?.length >= 20;
  const publicSandbox = Boolean(snapshot && rateKey?.length >= 32);
  const sandboxEnabled = Boolean(snapshot && (publicSandbox || validCode));
  const enabled = sandboxEnabled || Boolean(url && key && secret && validCode);
  const requiresCode = enabled && !publicSandbox;
  res.setHeader("Cache-Control", "no-store");

  const modes = sandboxEnabled && vocals === "1" ? [2, 4, 6] : [4, 6];
  if (req.method === "GET") return res.status(200).json({ enabled, requiresCode, modes });
  if (req.method !== "POST") return res.status(405).json({ error: "Phương thức không được hỗ trợ." });
  if (!enabled) return res.status(503).json({ error: "Máy chủ tách stem chưa mở." });
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return res.status(415).json({ error: "Yêu cầu không hợp lệ." });
  }

  const { action, job, size, mode, pilotCode } = req.body ?? {};
  if (action === "create" && requiresCode && !matches(pilotCode, code)) {
    return res.status(403).json({ error: "Mã truy cập không đúng." });
  }
  if (sandboxEnabled) {
    if (action !== "create" || req.headers["x-akapella-create"] !== "1") {
      return res.status(400).json({ error: "Yêu cầu không hợp lệ." });
    }
    if (!Number.isInteger(size) || size < 1 || size > 50_000_000 || !modes.includes(mode)) {
      return res.status(400).json({ error: "Chọn file tối đa 50 MB và một chế độ đang mở." });
    }
    const origins = ["https://akapella.vercel.app", ...[deployment, branch].filter(Boolean).map(host => `https://${host}`)];
    const origin = req.headers.origin ?? origins[0];
    if (!origins.includes(origin)) return res.status(403).json({ error: "Nguồn yêu cầu không hợp lệ." });
    let name;
    if (publicSandbox) {
      const ip = req.headers["x-vercel-forwarded-for"];
      if (typeof ip !== "string" || !isIP(ip)) {
        return res.status(403).json({ error: "Không xác minh được nguồn yêu cầu." });
      }
      // The platform reserves sandbox names atomically, including across function instances.
      const window = Math.floor(Date.now() / 20_000);
      const digest = createHmac("sha256", rateKey).update(`${window}:${ip}`).digest("hex").slice(0, 32);
      name = `akapella-${digest}`;
    }
    try {
      return res.status(200).json(await createSandboxJob(snapshot, size, mode, origin, name, region));
    } catch (error) {
      const status = error.response?.status ?? error.status;
      const conflict = status === 400 && error.json?.error?.message?.includes(`with the name '${name}' already exists`);
      if (publicSandbox && conflict) {
        res.setHeader("Retry-After", "20");
        return res.status(429).json({ error: "Bạn đã gửi một lượt tách. Hãy đợi 20 giây rồi thử lại." });
      }
      console.error("Akapella Sandbox creation failed", status ?? error.name);
      return res.status(503).json({ error: "Chưa mở được máy chủ tách stem. Hãy thử lại sau." });
    }
  }
  if (!actions.has(action)) return res.status(400).json({ error: "Yêu cầu không hợp lệ." });
  if (action !== "create" && (typeof job !== "string" || !/^[a-f0-9]{48}$/.test(job))) {
    return res.status(400).json({ error: "Mã job không hợp lệ." });
  }

  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".modal.run")) {
      throw new Error("Invalid Modal endpoint");
    }
    const reply = await fetch(new URL(action, endpoint.href.replace(/\/?$/, "/")), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Modal-Key": key, "Modal-Secret": secret },
      body: JSON.stringify(action === "create" ? { size, mode } : { job }),
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    const payload = await reply.json();
    if (!reply.ok) {
      const error = reply.status < 500 && typeof payload.detail === "string"
        ? payload.detail : "Không kết nối được máy chủ tách stem.";
      return res.status(reply.status).json({ error });
    }
    return res.status(200).json(payload);
  } catch {
    return res.status(502).json({ error: "Không kết nối được máy chủ tách stem." });
  }
}
