import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { requireOperationsUser } from "../_operations-auth.js";
import { getSql } from "../_db.js";

function scopeAll(user: { roleCodes: string[]; branchCodes: string[] }) {
  if (user.roleCodes.some((code) => ["admin", "sales_manager"].includes(code))) return true;
  return user.roleCodes.includes("operations_user") && user.branchCodes.length === 0;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  const sql = getSql();
  const all = scopeAll(user);

  try {
    const [locations, statuses] = await Promise.all([
      sql<any[]>`
        select l.id::text,l.code,l.name,l.location_type,l.branch_id::text,b.code as branch_code,b.name as branch_name,l.sort_order
        from operations.locations l
        left join core.branches b on b.id=l.branch_id
        where l.is_active=true
          and (${all}::boolean or l.location_type<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
        order by l.sort_order,l.name
      `,
      sql<any[]>`
        select code,name,sort_order,counts_in_actual_inventory,requires_approvals,allows_archive
        from operations.vehicle_statuses
        where is_active=true
        order by sort_order
      `,
    ]);

    return response.status(200).json({
      ok: true,
      locations,
      statuses,
      permissions: user.permissionCodes,
      roles: user.roleCodes,
      branches: user.branchCodes,
      contents: [
        { key: "farshat", label: "فرشات" },
        { key: "tafaia", label: "طفاية" },
        { key: "shanta", label: "شنطة سلامة" },
        { key: "spare", label: "اسبير" },
        { key: "remote", label: "ريموت" },
        { key: "screen", label: "شاشة" },
        { key: "recorder", label: "مسجل" },
        { key: "ac", label: "مكيف" },
        { key: "camera", label: "كاميرا" },
        { key: "sensors", label: "حساس" },
      ],
    });
  } catch (error) {
    console.error("Operations meta failed", error);
    return response.status(500).json({ ok: false, error: "تعذر تحميل إعدادات العمليات" });
  }
}
