import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { runInboxAgentTick, runAutoAssign } from "../_crm-inbox-agent-engine.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const secret = String(process.env.CRON_SECRET || "").trim();
  const auth = String(request.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret) return response.status(503).json({ ok: false, error: "CRON_SECRET is required" });
  if (!token || !safeSecretEquals(token, secret)) return response.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    const [tickResult, assignResult] = await Promise.all([
      runInboxAgentTick(),
      runAutoAssign(),
    ]);
    const result = { ...tickResult, autoAssign: assignResult };
    console.info("Inbox agent tick", JSON.stringify(result));
    return response.status(200).json(result);
  } catch (error) {
    console.error("Inbox agent tick failed", error instanceof Error ? error.message : error);
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ وكيل صندوق الوارد" });
  }
}
