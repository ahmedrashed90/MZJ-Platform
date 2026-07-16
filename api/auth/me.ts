import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_auth";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  response.setHeader("Cache-Control", "no-store");
  const user = await requireUser(request, response);
  if (!user) return;
  return response.status(200).json({ ok: true, user });
}
