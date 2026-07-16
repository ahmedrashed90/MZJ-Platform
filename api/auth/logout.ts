import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSession } from "../_auth.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await clearSession(request, response);
  return response.status(200).json({ ok: true });
}
