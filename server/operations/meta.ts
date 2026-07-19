import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { requireOperationsUser } from "../_operations-auth.js";
import { handleOperationsError } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response);
    if (!user) return;
    if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const sql = getSql();
    const [locations, statuses, checkItems] = await Promise.all([
      sql<any[]>`select id::text,code,name,branch_code,location_type,sort_order,is_active from operations.locations where is_active=true order by sort_order,name`,
      sql<any[]>`select code,name,sort_order,is_inventory,requires_status_note,starts_delivery_cycle,is_final_delivery,is_active from operations.vehicle_statuses where is_active=true order by sort_order`,
      sql<any[]>`select code,name,sort_order from operations.check_items where is_active=true order by sort_order`,
    ]);
    return response.status(200).json({ ok: true, locations, statuses, checkItems, permissions: user.permissions, isSystemAdmin: user.isSystemAdmin, branches: user.branchCodes });
  } catch (error) { return handleOperationsError(response, error); }
}
