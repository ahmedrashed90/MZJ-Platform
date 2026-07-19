import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { OPERATIONS_PERMISSIONS, requireOperationsPermission, requireOperationsUser } from "../_operations-auth.js";
import { clean } from "../_operations-utils.js";

function scopeAll(user: { roleCodes: string[]; branchCodes: string[] }) {
  if (user.roleCodes.some((code) => ["admin", "sales_manager"].includes(code))) return true;
  return user.roleCodes.includes("operations_user") && user.branchCodes.length === 0;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.reportsAllCars)) return;
  const sql = getSql();

  try {
    const search = clean(request.query.search);
    const carName = clean(request.query.carName);
    const statement = clean(request.query.statement);
    const modelYear = clean(request.query.modelYear);
    const minCount = Math.max(Number(request.query.minCount || 0), 0);
    const pattern = `%${search}%`;
    const all = scopeAll(user);

    const rows = await sql<any[]>`
      select
        coalesce(nullif(trim(v.car_name),''),'غير محدد') as car_name,
        coalesce(nullif(trim(v.statement),''),'غير محدد') as statement,
        coalesce(nullif(trim(v.model_year),''),'غير محدد') as model_year,
        count(*)::int as total,
        count(*) filter (where v.status_code='available_for_sale')::int as available_for_sale,
        count(*) filter (where v.status_code='reserved')::int as reserved,
        count(*) filter (where v.status_code='has_notes')::int as has_notes,
        count(*) filter (where l.code='warehouse')::int as warehouse,
        count(*) filter (where l.code='agency')::int as agency,
        count(*) filter (where l.code='hall')::int as hall,
        count(*) filter (where l.code='qadisiyah')::int as qadisiyah,
        count(*) filter (where l.code='multaqa')::int as multaqa,
        max(v.updated_at) as last_update
      from operations.vehicles v
      left join operations.locations l on l.id=v.location_id
      left join core.branches b on b.id=l.branch_id
      left join operations.vehicle_statuses st on st.code=v.status_code
      where v.is_deleted=false and v.is_archived=false and coalesce(st.counts_in_actual_inventory,false)=true
        and (${search}='' or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.model_year,'') ilike ${pattern})
        and (${carName}='' or v.car_name=${carName})
        and (${statement}='' or v.statement=${statement})
        and (${modelYear}='' or v.model_year=${modelYear})
        and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
      group by coalesce(nullif(trim(v.car_name),''),'غير محدد'),coalesce(nullif(trim(v.statement),''),'غير محدد'),coalesce(nullif(trim(v.model_year),''),'غير محدد')
      having count(*)>=${minCount}
      order by car_name,statement,model_year
    `;

    const filters = await sql<any[]>`
      select
        array_remove(array_agg(distinct nullif(trim(v.car_name),'')),null) as car_names,
        array_remove(array_agg(distinct nullif(trim(v.statement),'')),null) as statements,
        array_remove(array_agg(distinct nullif(trim(v.model_year),'')),null) as model_years
      from operations.vehicles v
      left join operations.locations l on l.id=v.location_id
      left join core.branches b on b.id=l.branch_id
      left join operations.vehicle_statuses st on st.code=v.status_code
      where v.is_deleted=false and v.is_archived=false and coalesce(st.counts_in_actual_inventory,false)=true
        and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
    `;
    const totals = rows.reduce((acc, row) => ({
      total: acc.total + Number(row.total || 0),
      availableForSale: acc.availableForSale + Number(row.available_for_sale || 0),
      reserved: acc.reserved + Number(row.reserved || 0),
      hasNotes: acc.hasNotes + Number(row.has_notes || 0),
    }), { total: 0, availableForSale: 0, reserved: 0, hasNotes: 0 });

    return response.status(200).json({ ok: true, rows, filters: filters[0] || {}, totals });
  } catch (error) {
    console.error("Operations reports failed", error);
    return response.status(500).json({ ok: false, error: "تعذر تحميل تقرير جميع السيارات" });
  }
}
