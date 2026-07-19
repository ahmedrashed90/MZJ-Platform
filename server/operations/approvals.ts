import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, requireOperationsUser } from "../_operations-auth.js";
import { bodyOf, clean, handleOperationsError, OperationsError, writeAudit, writeOutbox } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response);
    if (!user) return;
    const sql = getSql();

    if (request.method === "GET") {
      const id = clean(request.query.vehicleId);
      const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);
      if (id) {
        const [vehicle] = await sql<any[]>`
          select v.id::text,v.vin,v.car_name,v.statement,v.status_code,s.name as status_name,l.name as location_name,v.branch_code
          from operations.vehicles v left join operations.vehicle_statuses s on s.code=v.status_code left join operations.locations l on l.id=v.location_id
          where v.id=${id}::uuid and v.is_deleted=false and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
        `;
        if (!vehicle) return response.status(404).json({ ok: false, error: "السيارة غير موجودة" });
        const approvals = await sql<any[]>`
          select a.id::text,a.delivery_cycle_id::text,a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,
            a.financial_approved_at,a.administrative_approved_at,a.financial_reverted_at,a.administrative_reverted_at,a.created_at,a.updated_at,
            fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name
          from operations.vehicle_approvals a left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
          where a.vehicle_id=${id}::uuid order by a.created_at desc
        `;
        const events = await sql<any[]>`select id::text,approval_type,action,actor_name,reason,before_data,after_data,created_at from operations.approval_events where vehicle_id=${id}::uuid order by created_at desc limit 100`;
        return response.status(200).json({ ok: true, vehicle, approvals, events });
      }
      const vehicles = await sql<any[]>`
        select v.id::text,v.vin,v.car_name,v.statement,v.branch_code,l.name as location_name,v.status_code,s.name as status_name,
          coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
          a.financial_note,a.administrative_note,a.financial_approved_at,a.administrative_approved_at
        from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
        left join lateral (select x.* from operations.vehicle_approvals x where x.vehicle_id=v.id order by x.created_at desc limit 1) a on true
        where v.is_deleted=false and v.is_archived=false and v.status_code='under_delivery'
          and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
        order by v.updated_at desc
      `;
      return response.status(200).json({ ok: true, vehicles });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyOf(request);
    const vehicleId = clean(body.vehicleId);
    const action = clean(body.action);
    const type = clean(body.type);
    const note = clean(body.note) || null;
    const reason = clean(body.reason) || note;
    if (!vehicleId) throw new OperationsError("معرف السيارة مطلوب");
    if (!["financial","administrative","both"].includes(type || "both")) throw new OperationsError("نوع الموافقة غير صحيح");

    const permission = type === "financial" ? "operations.approvals.financial" : type === "administrative" ? "operations.approvals.administrative" : "operations.approvals.clear";
    if (action === "revert" && !user.isSystemAdmin && !user.permissions.includes("operations.approvals.revert")) throw new OperationsError("ليس لديك صلاحية التراجع عن الموافقة", 403);
    if (action === "clear" && !user.isSystemAdmin && !user.permissions.includes("operations.approvals.clear")) throw new OperationsError("ليس لديك صلاحية مسح الموافقات", 403);
    if (["approve","note"].includes(action) && !user.isSystemAdmin && !user.permissions.includes(permission)) throw new OperationsError("ليس لديك صلاحية تنفيذ هذه الموافقة", 403);
    if (["revert","clear"].includes(action) && !reason) throw new OperationsError("سبب التراجع أو المسح مطلوب");

    await sql.begin(async (tx) => {
      const [vehicle] = await tx`select id::text,vin,status_code,branch_code from operations.vehicles where id=${vehicleId}::uuid and is_deleted=false for update`;
      if (!vehicle) throw new OperationsError("السيارة غير موجودة", 404);
      if (vehicle.status_code !== "under_delivery") throw new OperationsError("الموافقات متاحة فقط للسيارات بحالة مباع تحت التسليم");
      const [approval] = await tx`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid order by created_at desc limit 1 for update`;
      if (!approval) throw new OperationsError("لم يتم تهيئة دورة الموافقات لهذه السيارة");
      const before = { financialApproved: approval.financial_approved, administrativeApproved: approval.administrative_approved, financialNote: approval.financial_note, administrativeNote: approval.administrative_note };
      if (action === "approve" && type === "financial") {
        await tx`update operations.vehicle_approvals set financial_approved=true,financial_approved_by=${user.id}::uuid,financial_approved_at=now(),financial_note=coalesce(${note},financial_note),financial_reverted_by=null,financial_reverted_at=null,updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "approve" && type === "administrative") {
        await tx`update operations.vehicle_approvals set administrative_approved=true,administrative_approved_by=${user.id}::uuid,administrative_approved_at=now(),administrative_note=coalesce(${note},administrative_note),administrative_reverted_by=null,administrative_reverted_at=null,updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "revert" && type === "financial") {
        await tx`update operations.vehicle_approvals set financial_approved=false,financial_reverted_by=${user.id}::uuid,financial_reverted_at=now(),updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "revert" && type === "administrative") {
        await tx`update operations.vehicle_approvals set administrative_approved=false,administrative_reverted_by=${user.id}::uuid,administrative_reverted_at=now(),updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "note" && type === "financial") {
        await tx`update operations.vehicle_approvals set financial_note=${note},updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "note" && type === "administrative") {
        await tx`update operations.vehicle_approvals set administrative_note=${note},updated_at=now() where id=${approval.id}::uuid`;
      } else if (action === "clear") {
        await tx`update operations.vehicle_approvals set financial_approved=false,administrative_approved=false,financial_reverted_by=${user.id}::uuid,administrative_reverted_by=${user.id}::uuid,financial_reverted_at=now(),administrative_reverted_at=now(),updated_at=now() where id=${approval.id}::uuid`;
      } else {
        throw new OperationsError("الإجراء غير مدعوم");
      }
      const [afterRow] = await tx`select financial_approved,administrative_approved,financial_note,administrative_note from operations.vehicle_approvals where id=${approval.id}::uuid`;
      const eventAction = action === "approve" ? "approved" : action === "revert" ? "reverted" : action === "note" ? "note_updated" : "cleared";
      await tx`
        insert into operations.approval_events(vehicle_id,approval_id,approval_type,action,actor_id,actor_name,reason,before_data,after_data)
        values (${vehicleId}::uuid,${approval.id}::uuid,${type || "both"},${eventAction},${user.id}::uuid,${user.fullName},${reason},${tx.json(before)},${tx.json(afterRow)})
      `;
      await writeAudit(tx, request, user, { action: `vehicle_approval_${eventAction}`, entityType: "vehicle", entityId: vehicleId, before, after: afterRow });
      await writeOutbox(tx, { eventType: action === "revert" ? "operations.vehicle.approval_reversed" : "operations.vehicle.approval_granted", aggregateType: "vehicle", aggregateId: vehicleId, title: "تحديث موافقات سيارة", description: vehicle.vin, path: `/operations/approvals?vehicle=${vehicleId}`, metadata: { vin: vehicle.vin, type, action: eventAction } });
    });
    return response.status(200).json({ ok: true, message: action === "note" ? "تم حفظ الملاحظة" : action === "clear" ? "تم مسح الموافقات مع الحفاظ على السجل" : "تم تحديث الموافقة" });
  } catch (error) { return handleOperationsError(response, error); }
}
