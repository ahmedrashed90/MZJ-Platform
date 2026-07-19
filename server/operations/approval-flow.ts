import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { audit, OperationsError, outbox } from "./common.js";

export const UNDER_DELIVERY_STATUS = "under_delivery";
export const DELIVERED_STATUS = "delivered";

type VehicleApprovalSnapshot = {
  id: string;
  vin?: string | null;
  status_code?: string | null;
  financial_approved?: boolean | null;
  administrative_approved?: boolean | null;
};

function approvalError(vehicle: VehicleApprovalSnapshot) {
  const financial = Boolean(vehicle.financial_approved);
  const administrative = Boolean(vehicle.administrative_approved);
  if (!financial && !administrative) {
    return `لا يمكن تغيير حالة السيارة ${vehicle.vin || ""} إلى «مباع تم التسليم» قبل اكتمال الموافقة المالية والموافقة الإدارية`.trim();
  }
  if (!financial) return `لا يمكن إتمام تسليم السيارة ${vehicle.vin || ""} لأن الموافقة المالية لم تكتمل`.trim();
  return `لا يمكن إتمام تسليم السيارة ${vehicle.vin || ""} لأن الموافقة الإدارية لم تكتمل`.trim();
}

export function assertApprovalStatusTransition(vehicle: VehicleApprovalSnapshot, targetStatusCode: string) {
  const currentStatusCode = String(vehicle.status_code || "");
  if (targetStatusCode !== DELIVERED_STATUS || currentStatusCode === targetStatusCode) return;
  if (currentStatusCode !== UNDER_DELIVERY_STATUS) {
    throw new OperationsError(
      400,
      "UNDER_DELIVERY_REQUIRED",
      `لا يمكن تغيير حالة السيارة ${vehicle.vin || ""} إلى «مباع تم التسليم» بدون المرور أولًا بحالة «مباع تحت التسليم»`.trim(),
    );
  }
  if (!vehicle.financial_approved || !vehicle.administrative_approved) {
    throw new OperationsError(400, "APPROVALS_REQUIRED", approvalError(vehicle));
  }
}

async function writeTransitionHistory(
  tx: any,
  user: SessionUser,
  vehicleId: string,
  cycleNo: number,
  action: "initialized" | "cleared",
  note: string,
  beforeData: unknown,
  afterData: unknown,
) {
  for (const approvalType of ["financial", "administrative"] as const) {
    await tx`
      insert into operations.vehicle_approval_history(
        vehicle_id,approval_type,action,performed_by,performer_name,performer_role,performer_branch,note,before_data,after_data,cycle_no
      ) values (
        ${vehicleId}::uuid,${approvalType},${action},${user.id}::uuid,${user.fullName},
        ${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},
        ${note},${tx.json(beforeData || {})},${tx.json(afterData || {})},${cycleNo}
      )
    `;
  }
}

export async function applyApprovalStatusTransition(
  tx: any,
  request: VercelRequest,
  user: SessionUser,
  vehicle: VehicleApprovalSnapshot,
  targetStatusCode: string,
) {
  const currentStatusCode = String(vehicle.status_code || "");
  if (currentStatusCode === targetStatusCode) return;

  const enteringUnderDelivery = targetStatusCode === UNDER_DELIVERY_STATUS;
  const leavingUnderDeliveryWithoutDelivery =
    currentStatusCode === UNDER_DELIVERY_STATUS &&
    targetStatusCode !== UNDER_DELIVERY_STATUS &&
    targetStatusCode !== DELIVERED_STATUS;

  if (!enteringUnderDelivery && !leavingUnderDeliveryWithoutDelivery) return;

  const [before] = await tx<any[]>`
    select * from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid for update
  `;

  if (enteringUnderDelivery) {
    const cycleNo = Number(before?.cycle_no || 0) + 1;
    const [after] = await tx<any[]>`
      insert into operations.vehicle_approvals(
        vehicle_id,financial_approved,administrative_approved,
        financial_approved_by,financial_approved_at,financial_note,financial_revoked_by,financial_revoked_at,
        administrative_approved_by,administrative_approved_at,administrative_note,administrative_revoked_by,administrative_revoked_at,
        cycle_no,updated_at
      ) values (
        ${vehicle.id}::uuid,false,false,null,null,null,null,null,null,null,null,null,null,${cycleNo},now()
      )
      on conflict(vehicle_id) do update set
        financial_approved=false,administrative_approved=false,
        financial_approved_by=null,financial_approved_at=null,financial_note=null,financial_revoked_by=null,financial_revoked_at=null,
        administrative_approved_by=null,administrative_approved_at=null,administrative_note=null,administrative_revoked_by=null,administrative_revoked_at=null,
        cycle_no=${cycleNo},updated_at=now()
      returning *
    `;
    const note = "تم تهيئة الموافقات عند دخول السيارة إلى حالة «مباع تحت التسليم»";
    await writeTransitionHistory(tx,user,vehicle.id,cycleNo,"initialized",note,before,after);
    await audit(tx,request,user,{
      pageCode:"operations.approvals",
      action:"vehicle.approvals_initialized",
      entityType:"vehicle",
      entityId:vehicle.id,
      beforeData:before,
      afterData:after,
      reason:note,
    });
    await outbox(tx,user,{
      eventType:"operations.vehicle.approvals_initialized",
      entityType:"vehicle",
      entityId:vehicle.id,
      vehicleId:vehicle.id,
      vin:vehicle.vin || undefined,
      title:"السيارة تحتاج موافقات التسليم",
      description:`${vehicle.vin || "السيارة"} دخلت حالة مباع تحت التسليم`,
      internalPath:`/operations/approvals?vehicle=${vehicle.id}`,
      metadata:{cycleNo,targetStatusCode},
    });
    return;
  }

  const cycleNo = Number(before?.cycle_no || 0);
  const [after] = await tx<any[]>`
    insert into operations.vehicle_approvals(
      vehicle_id,financial_approved,administrative_approved,
      financial_approved_by,financial_approved_at,financial_note,financial_revoked_by,financial_revoked_at,
      administrative_approved_by,administrative_approved_at,administrative_note,administrative_revoked_by,administrative_revoked_at,
      cycle_no,updated_at
    ) values (
      ${vehicle.id}::uuid,false,false,null,null,null,null,null,null,null,null,null,null,${cycleNo},now()
    )
    on conflict(vehicle_id) do update set
      financial_approved=false,administrative_approved=false,
      financial_approved_by=null,financial_approved_at=null,financial_note=null,financial_revoked_by=null,financial_revoked_at=null,
      administrative_approved_by=null,administrative_approved_at=null,administrative_note=null,administrative_revoked_by=null,administrative_revoked_at=null,
      updated_at=now()
    returning *
  `;
  const note = "تم مسح حالة الموافقات التشغيلية لأن السيارة خرجت من «مباع تحت التسليم» إلى حالة أخرى غير «مباع تم التسليم»";
  await writeTransitionHistory(tx,user,vehicle.id,cycleNo,"cleared",note,before,after);
  await audit(tx,request,user,{
    pageCode:"operations.approvals",
    action:"vehicle.approvals_cleared",
    entityType:"vehicle",
    entityId:vehicle.id,
    beforeData:before,
    afterData:after,
    reason:note,
  });
  await outbox(tx,user,{
    eventType:"operations.vehicle.approvals_cleared",
    entityType:"vehicle",
    entityId:vehicle.id,
    vehicleId:vehicle.id,
    vin:vehicle.vin || undefined,
    title:"تمت إزالة السيارة من موافقات التسليم",
    description:`${vehicle.vin || "السيارة"} خرجت من حالة مباع تحت التسليم`,
    internalPath:`/operations?vehicle=${vehicle.id}`,
    metadata:{cycleNo,targetStatusCode},
  });
}
