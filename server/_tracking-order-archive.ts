import { tryArchiveVehicleForTrackingRecord } from "./_operations-auto-archive.js";

export class TrackingOrderArchiveError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = "TrackingOrderArchiveError";
  }
}

export type TrackingOrderArchiveInventoryResult = {
  totalVehicles: number;
  archivedVehicles: number;
  alreadyArchivedVehicles: number;
  externalVehicles: number;
};

/**
 * Finalizes the inventory side of ONE Tracking sale, in the caller's transaction.
 * The caller must lock tracking.orders before calling this function. If one
 * inventory VIN is ineligible the transaction is rolled back, including its
 * archive movements/events and the Tracking archive marker.
 *
 * Unlinked external sale VINs retain their independent Tracking approvals and
 * can be archived as orders without fabricating an Operations inventory row.
 */
export async function archiveTrackingOrderInventory(
  tx: any,
  orderId: string,
  actor: { id: string; name: string },
): Promise<TrackingOrderArchiveInventoryResult> {
  // Count EVERY active stage for EVERY sale vehicle, including missing rows.
  // Counting only existing vehicle_stages would allow a partially initialized
  // vehicle to be considered 100% complete.
  const vehicles = await tx`
    select v.id::text as tracking_vehicle_id,v.vin,
      count(s.id)::int as expected_stages,
      count(vs.id) filter (where vs.status='completed')::int as completed_stages
    from tracking.order_vehicles v
    left join tracking.stages s on s.is_active=true
    left join tracking.vehicle_stages vs on vs.vehicle_id=v.id and vs.stage_id=s.id
    where v.order_id=${orderId}::uuid
    group by v.id
    order by v.created_at,v.id
  `;
  if (!vehicles.length) {
    throw new TrackingOrderArchiveError("لا يمكن أرشفة طلب بيع لا يحتوي على سيارات", "empty_order");
  }
  for (const vehicle of vehicles) {
    if (Number(vehicle.expected_stages) === 0 || Number(vehicle.completed_stages) !== Number(vehicle.expected_stages)) {
      throw new TrackingOrderArchiveError(
        `لا يمكن أرشفة الطلب: السيارة ${vehicle.vin || "بدون رقم هيكل"} لم تكمل كل مراحل التتبع (${Number(vehicle.completed_stages)} من ${Number(vehicle.expected_stages)})`,
        "tracking_incomplete",
      );
    }
  }

  const result: TrackingOrderArchiveInventoryResult = {
    totalVehicles: vehicles.length,
    archivedVehicles: 0,
    alreadyArchivedVehicles: 0,
    externalVehicles: 0,
  };
  for (const vehicle of vehicles) {
    const archived = await tryArchiveVehicleForTrackingRecord(tx, vehicle.tracking_vehicle_id, actor);
    if (!archived) {
      // An external VIN must still have both genuine approvals. Stage 6/7
      // projections alone may be stale after an older manual import.
      const [externalApproval] = await tx`
        select financial_approved,administrative_approved
        from tracking.sale_vehicle_approvals
        where tracking_vehicle_id=${vehicle.tracking_vehicle_id}::uuid
      `;
      if (externalApproval?.financial_approved !== true || externalApproval?.administrative_approved !== true) {
        throw new TrackingOrderArchiveError(
          `تعذرت أرشفة السيارة الخارجية ${vehicle.vin || "بدون رقم هيكل"}: الموافقة المالية أو الإدارية غير مكتملة`,
          "external_approvals_incomplete",
        );
      }
      result.externalVehicles++;
      continue;
    }
    if (archived.reason === "archived") {
      result.archivedVehicles++;
      continue;
    }
    if (archived.reason === "already_archived") {
      result.alreadyArchivedVehicles++;
      continue;
    }
    const explanations: Record<string, string> = {
      vehicle_not_found: "ارتباط السيارة بمخزون العمليات غير صالح",
      approvals_incomplete: "الموافقة المالية أو الإدارية غير مكتملة",
      active_transfer: "يوجد طلب نقل مفتوح أو غير مكتمل",
      tracking_incomplete: "مراحل التراكينج غير مكتملة",
    };
    throw new TrackingOrderArchiveError(
      `تعذرت أرشفة السيارة ${vehicle.vin || "بدون رقم هيكل"} في العمليات: ${explanations[archived.reason] || archived.reason}`,
      archived.reason,
    );
  }
  return result;
}
