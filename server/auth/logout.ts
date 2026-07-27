import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSession, getSessionUser, requestIp } from "../_auth.js";
import { logSecurityEvent } from "../_access-control.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await getSessionUser(request).catch(() => null);
  await clearSession(request, response);
  if (user) await logSecurityEvent({ request, user, systemCode: "core", pageCode: "login", action: "logout", result: "success", ipAddress: requestIp(request) });
  return response.status(200).json({ ok: true });
}
