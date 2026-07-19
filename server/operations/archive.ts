import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, requireOperationsUser } from "../_operations-auth.js";
import { bodyOf, clean, handleOperationsError, OperationsError, writeAudit, writeOutbox } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response, request.method === "GET" ? "operations.archive.view" : "operations.archive.create");
    if (!user) return;
    const sql = getSql();
    if (request.method === "GET") {
      const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);
      const vehicles = await sql<any[]>`
        select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.plate_no,v.branch_code,l.name as location_name,s.name as status_name,
          v.archived_at,v.archive_reason,u.full_name as archived_by_name,a.tracking_snapshot,a.approval_snapshot
        from operations.vehicles v join operations.vehicle_archives a on a.vehicle_id=v.id
        left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code left join core.users u on u.id=v.archived_by
        where v.is_deleted=false and v.is_archived=true and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
        order by v.archived_at desc
      `;
      return response.status(200).json({ ok: true, vehicles });
    }
    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyOf(request);
    const vehicleId = clean(body.vehicleId);
    const reason = clean(body.reason);
    if (!vehicleId || !reason) throw new OperationsError("السيارة وسبب الأرشفة مطلوبان");
    await sql.begin(async (tx) => {
      const [vehicle] = await tx`select * from operations.vehicles where id=${vehicleId}::uuid and is_deleted=false for update`;
      if (!vehicle) throw new OperationsError("السيارة غير موجودة", 404);
      if (vehicle.is_archived) throw new OperationsError("السيارة مؤرشفة بالفعل");
      if (vehicle.status_code !== "delivered") throw new OperationsError("لا يمكن الأرشفة قبل وصول السيارة إلى مباع تم التسليم");
      const [approval] = await tx`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid order by created_at desc limit 1`;
      if (!approval?.financial_approved) throw new OperationsError("لا يمكن الأرشفة لأن الموافقة المالية غير مكتملة");
      if (!approval?.administrative_approved) throw new OperationsError("لا يمكن الأرشفة لأن الموافقة الإدارية غير مكتملة");
      const [movement] = await tx`select count(*)::int as count from operations.movements where vehicle_id=${vehicleId}::uuid`;
      if (Number(movement?.count || 0) < 1) throw new OperationsError("لا يمكن الأرشفة لعدم وجود حركة مسجلة للسيارة");
      const [tracking] = await tx`
        select * from operations.vehicle_tracking_summary where vehicle_id=${vehicleId}::uuid
        order by case when status in ('not_started','in_progress') and not is_archived then 0 else 1 end,updated_at desc limit 1
      `;
      if (!tracking) throw new OperationsError("لا يمكن الأرشفة لعدم وجود طلب تراكينج مرتبط");
      if (tracking.is_deleted) throw new OperationsError("لا يمكن الأرشفة لأن طلب التراكينج محذوف");
      if (tracking.status !== "completed" || Number(tracking.progress || 0) !== 100) throw new OperationsError("لا يمكن الأرشفة لأن طلب التراكينج لم يكتمل بنسبة 100%");
      const active = await tx`
        select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
        where rv.vehicle_id=${vehicleId}::uuid and r.is_deleted=false and r.status not in ('completed','cancelled') limit 1
      `;
      if (active.length) throw new OperationsError(`لا يمكن الأرشفة لوجود طلب نقل نشط رقم ${active[0].request_no}`);
      const approvalSnapshot = { financialApproved: approval.financial_approved, administrativeApproved: approval.administrative_approved, financialApprovedAt: approval.financial_approved_at, administrativeApprovedAt: approval.administrative_approved_at };
      const trackingSnapshot = { requestId: tracking.tracking_request_id, requestNo: tracking.request_no, status: tracking.status, progress: tracking.progress, updatedAt: tracking.updated_at };
      await tx`
        insert into operations.vehicle_archives(vehicle_id,status_at_archive,approval_snapshot,tracking_snapshot,reason,archived_by,archived_by_name)
        values (${vehicleId}::uuid,${vehicle.status_code},${tx.json(approvalSnapshot)},${tx.json(trackingSnapshot)},${reason},${user.id}::uuid,${user.fullName})
      `;
      await tx`update operations.vehicles set is_archived=true,archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicleId}::uuid`;
      await writeAudit(tx, request, user, { action: "vehicle_archived", entityType: "vehicle", entityId: vehicleId, before: vehicle, after: { isArchived: true, reason, approvalSnapshot, trackingSnapshot } });
      await writeOutbox(tx, { eventType: "operations.vehicle.archived", aggregateType: "vehicle", aggregateId: vehicleId, title: "أرشفة سيارة", description: vehicle.vin, path: `/operations/archive`, metadata: { vin: vehicle.vin, reason, trackingRequestNo: tracking.request_no } });
    });
    return response.status(200).json({ ok: true, message: "تمت أرشفة السيارة مع الحفاظ على جميع بياناتها" });
  } catch (error) { return handleOperationsError(response, error); }
}
