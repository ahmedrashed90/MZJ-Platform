import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { tryWithDatabaseAdvisoryLock } from "../_db.js";
import { runAutoAssign } from "../_crm-inbox-agent-engine.js";

/** Dedicated, non-overlapping cron for the two-minute unclassified inbox SLA. */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const secret = String(process.env.CRON_SECRET || "").trim();
  const auth = String(request.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret) return response.status(503).json({ ok: false, error: "CRON_SECRET is required" });
  if (!token || !safeSecretEquals(token, secret)) return response.status(401).json({ ok: false, error: "Unauthorized" });

  try {
    // Cron fires once per minute. If a previous invocation is still working,
    // return immediately rather than queuing DB advisory locks for 120 seconds.
    const locked = await tryWithDatabaseAdvisoryLock(
      "mzj:crm:unclassified-auto-assign-tick",
      () => runAutoAssign(),
    );
    if (!locked.acquired) {
      const result = { ok: true, skipped: "previous_tick_running" };
      console.info("Inbox auto assignment tick", JSON.stringify(result));
      return response.status(200).json(result);
    }
    const result = { ok: true, ...(locked.result || { assigned: 0, skipped: 0, failed: 0 }) };
    console.info("Inbox auto assignment tick", JSON.stringify(result));
    return response.status(200).json(result);
  } catch (error) {
    console.error("Inbox auto assignment tick failed", error instanceof Error ? error.message : error);
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ التوزيع التلقائي للرسائل غير المصنفة" });
  }
}
