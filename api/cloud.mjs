import { timingSafeEqual } from "node:crypto";

const actions = new Set(["create", "start", "status", "cancel"]);

function matches(candidate, secret) {
  if (typeof candidate !== "string" || candidate.length > 256) return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default async function handler(req, res) {
  const { AKAPELLA_MODAL_URL: url, AKAPELLA_MODAL_KEY: key,
    AKAPELLA_MODAL_SECRET: secret, AKAPELLA_PILOT_CODE: code } = process.env;
  const enabled = Boolean(url && key && secret && code && code.length >= 20);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") return res.status(200).json({ enabled });
  if (req.method !== "POST") return res.status(405).json({ error: "Phương thức không được hỗ trợ." });
  if (!enabled) return res.status(503).json({ error: "Máy chủ tách stem chưa mở." });
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return res.status(415).json({ error: "Yêu cầu không hợp lệ." });
  }

  const { action, job, size, mode, pilotCode } = req.body ?? {};
  if (!actions.has(action)) return res.status(400).json({ error: "Yêu cầu không hợp lệ." });
  if (action === "create" && !matches(pilotCode, code)) {
    return res.status(403).json({ error: "Mã truy cập không đúng." });
  }
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
