import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { requireOperationsUser } from "../_operations-auth.js";
import { bodyOf, bool, clean, handleOperationsError, integer, OperationsError, writeAudit } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response, request.method === "GET" ? "operations.view" : "operations.settings.manage");
    if (!user) return;
    const sql = getSql();
    if (request.method === "GET") {
      const [locations, statuses, checkItems] = await Promise.all([
        sql<any[]>`select id::text,code,name,branch_code,location_type,sort_order,is_active,created_at,updated_at from operations.locations order by sort_order,name`,
        sql<any[]>`select code,name,sort_order,is_inventory,requires_status_note,starts_delivery_cycle,is_final_delivery,is_active,created_at,updated_at from operations.vehicle_statuses order by sort_order,name`,
        sql<any[]>`select code,name,sort_order,is_active from operations.check_items order by sort_order,name`,
      ]);
      return response.status(200).json({ ok: true, locations, statuses, checkItems });
    }
    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyOf(request);
    const action = clean(body.action);
    if (action === "save_location") {
      const id = clean(body.id);
      const code = clean(body.code);
      const name = clean(body.name);
      const branchCode = clean(body.branchCode) || null;
      const locationType = clean(body.locationType) || "branch";
      const sortOrder = integer(body.sortOrder, 0, 0, 10000);
      const isActive = body.isActive === undefined ? true : bool(body.isActive);
      if (!code || !name) throw new OperationsError("كود المكان واسمه مطلوبان");
      const [saved] = id ? await sql<any[]>`
        update operations.locations set code=${code},name=${name},branch_code=${branchCode},location_type=${locationType},sort_order=${sortOrder},is_active=${isActive},updated_at=now() where id=${id}::uuid returning id::text
      ` : await sql<any[]>`
        insert into operations.locations(code,name,branch_code,location_type,sort_order,is_active) values (${code},${name},${branchCode},${locationType},${sortOrder},${isActive}) returning id::text
      `;
      await writeAudit(sql, request, user, { action: id ? "operations_location_updated" : "operations_location_created", entityType: "operations_location", entityId: saved.id, after: { code, name, branchCode, locationType, sortOrder, isActive } });
      return response.status(200).json({ ok: true, message: "تم حفظ المكان" });
    }
    if (action === "save_status") {
      const code = clean(body.code);
      const name = clean(body.name);
      if (!code || !name) throw new OperationsError("كود الحالة واسمها مطلوبان");
      const payload = {
        sortOrder: integer(body.sortOrder, 0, 0, 10000), isInventory: bool(body.isInventory),
        requiresStatusNote: bool(body.requiresStatusNote), startsDeliveryCycle: bool(body.startsDeliveryCycle),
        isFinalDelivery: bool(body.isFinalDelivery), isActive: body.isActive === undefined ? true : bool(body.isActive),
      };
      await sql`
        insert into operations.vehicle_statuses(code,name,sort_order,is_inventory,requires_status_note,starts_delivery_cycle,is_final_delivery,is_active)
        values (${code},${name},${payload.sortOrder},${payload.isInventory},${payload.requiresStatusNote},${payload.startsDeliveryCycle},${payload.isFinalDelivery},${payload.isActive})
        on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order,is_inventory=excluded.is_inventory,requires_status_note=excluded.requires_status_note,starts_delivery_cycle=excluded.starts_delivery_cycle,is_final_delivery=excluded.is_final_delivery,is_active=excluded.is_active,updated_at=now()
      `;
      await writeAudit(sql, request, user, { action: "operations_status_saved", entityType: "operations_status", entityId: code, after: { code, name, ...payload } });
      return response.status(200).json({ ok: true, message: "تم حفظ الحالة" });
    }
    throw new OperationsError("الإجراء غير مدعوم");
  } catch (error) { return handleOperationsError(response, error); }
}
