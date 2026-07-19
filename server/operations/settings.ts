import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { OPERATIONS_PERMISSIONS, requireOperationsPermission, requireOperationsUser } from "../_operations-auth.js";
import { clean } from "../_operations-utils.js";

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.settingsManage)) return;
  const sql = getSql();

  try {
    if (request.method === "GET") {
      const [locations, statuses, branches] = await Promise.all([
        sql<any[]>`
          select l.id::text,l.code,l.name,l.location_type,l.branch_id::text,b.name as branch_name,l.sort_order,l.is_active,l.created_at,l.updated_at
          from operations.locations l left join core.branches b on b.id=l.branch_id order by l.sort_order,l.name
        `,
        sql<any[]>`
          select code,name,sort_order,counts_in_actual_inventory,requires_approvals,allows_archive,is_active,created_at,updated_at
          from operations.vehicle_statuses order by sort_order,name
        `,
        sql<any[]>`select id::text,code,name from core.branches where is_active=true order by sort_order,name`,
      ]);
      return response.status(200).json({ ok: true, locations, statuses, branches });
    }

    if (request.method === "POST") {
      const body = parseBody(request);
      const action = clean(body.action);
      if (action === "save_location") {
        const id = clean(body.id);
        const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        const name = clean(body.name);
        const locationType = clean(body.locationType) || "branch";
        const branchId = clean(body.branchId) || null;
        const sortOrder = Number(body.sortOrder || 0);
        const isActive = body.isActive !== false;
        if (!code || !name) return response.status(400).json({ ok: false, error: "كود واسم الموقع مطلوبان" });
        const [row] = id
          ? await sql<any[]>`
              update operations.locations set code=${code},name=${name},location_type=${locationType},branch_id=${branchId}::uuid,
                sort_order=${sortOrder},is_active=${isActive},updated_at=now() where id=${id}::uuid returning id::text
            `
          : await sql<any[]>`
              insert into operations.locations(code,name,location_type,branch_id,sort_order,is_active)
              values (${code},${name},${locationType},${branchId}::uuid,${sortOrder},${isActive}) returning id::text
            `;
        return response.status(id ? 200 : 201).json({ ok: true, id: row?.id, message: "تم حفظ الموقع" });
      }

      if (action === "save_status") {
        const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        const name = clean(body.name);
        const sortOrder = Number(body.sortOrder || 0);
        if (!code || !name) return response.status(400).json({ ok: false, error: "كود واسم الحالة مطلوبان" });
        await sql`
          insert into operations.vehicle_statuses(code,name,sort_order,counts_in_actual_inventory,requires_approvals,allows_archive,is_active)
          values (${code},${name},${sortOrder},${body.countsInActualInventory !== false},${body.requiresApprovals === true},${body.allowsArchive === true},${body.isActive !== false})
          on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,
            counts_in_actual_inventory=excluded.counts_in_actual_inventory,requires_approvals=excluded.requires_approvals,
            allows_archive=excluded.allows_archive,is_active=excluded.is_active,updated_at=now()
        `;
        return response.status(200).json({ ok: true, message: "تم حفظ الحالة" });
      }

      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Operations settings failed", error);
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "الكود مستخدم بالفعل" });
    if (error?.code === "23503") return response.status(400).json({ ok: false, error: "الفرع المحدد غير صحيح" });
    return response.status(500).json({ ok: false, error: "تعذر حفظ إعدادات العمليات" });
  }
}
