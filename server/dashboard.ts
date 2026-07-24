import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { isPlatformAdmin } from "../shared/system-access.js";
import { getDashboardData } from "./_dashboard-data.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;
  if (!isPlatformAdmin(user)) return response.status(403).json({ ok: false, error: "الداش بورد الموحدة متاحة لمدير النظام فقط" });
  await ensureTrackingSchema();
  await ensureOperationsSchema();
  const data = await getDashboardData(user);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(data);
}
