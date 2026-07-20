import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { getDashboardData } from "./_dashboard-data.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;
  const data = await getDashboardData();
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(data);
}
