import type { VercelRequest, VercelResponse } from "@vercel/node";
import accessControlHandler from "./access-control.js";

/**
 * Compatibility read alias only. User and permission mutations have one source:
 * /api/access-control from the centralized Settings page.
 */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method === "GET") {
    request.query.resource = "users";
    return accessControlHandler(request, response);
  }
  return response.status(410).json({
    ok: false,
    error: "تم نقل إدارة المستخدمين والصلاحيات إلى الإعدادات المركزية",
  });
}
