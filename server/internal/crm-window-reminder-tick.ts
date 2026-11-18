import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { runCrmWindowReminders } from "../_crm-window-reminders.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const secret = String(process.env.CRON_SECRET || "").trim();
  const auth = String(request.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret) return response.status(503).json({ ok: false, error: "CRON_SECRET is required" });
  if (!token || !safeSecretEquals(token, secret)) return response.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    const reminders = await runCrmWindowReminders();
    const result = { ok: true, reminders };
    console.info("CRM window reminder tick", JSON.stringify(result));
    return response.status(200).json(result);
  } catch (error) {
    console.error("CRM window reminder tick failed", error instanceof Error ? error.message : error);
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ تذكيرات نافذة الرد" });
  }
}
