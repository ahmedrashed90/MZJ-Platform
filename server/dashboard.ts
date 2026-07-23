import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { getDashboardData } from "./_dashboard-data.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";
import { ensureMarketingSchema } from "./_marketing-schema.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;
  await ensureTrackingSchema();
  await ensureOperationsSchema();
  await ensureMarketingSchema();
  const data = await getDashboardData(user);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(data);
}
