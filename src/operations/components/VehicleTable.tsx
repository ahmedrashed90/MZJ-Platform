import type { VehicleRow } from "../types";

function approvalLabel(row: VehicleRow) {
  if (row.financial_approved && row.administrative_approved) return "مكتملة";
  if (row.financial_approved) return "ناقص إداري";
  if (row.administrative_approved) return "ناقص مالي";
  return "لم تتم";
}

export function VehicleTable({ rows, onOpen, empty = "لا توجد سيارات مطابقة" }: { rows: VehicleRow[]; onOpen?: (row: VehicleRow) => void; empty?: string }) {
  return (
    <div className="operations-table-scroll">
      <table className="operations-table operations-vehicle-table">
        <thead><tr>
          <th>الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>اللون الداخلي</th><th>اللون الخارجي</th>
          <th>الموديل</th><th>اللوحة</th><th>اسم الدفعة بالتاريخ</th><th>المكان</th><th>ملاحظات في السيارة</th>
          <th>حجز - نواقص - تحديد مكان</th><th>الحالة</th><th>Tracking</th><th>الموافقات</th><th>التشيك</th><th>طلبات النقل</th><th>الأرشيف</th>
        </tr></thead>
        <tbody>
          {rows.length ? rows.map(row => (
            <tr key={row.id}>
              <td><button className="vin-link" type="button" onClick={() => onOpen?.(row)}>{row.vin}</button></td>
              <td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.agent_name || "—"}</td>
              <td>{row.interior_color || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.model_year || "—"}</td>
              <td>{row.plate_no || "—"}</td><td>{row.batch_no || "—"}</td><td>{row.location_name || "—"}</td>
              <td className="operations-long-cell">{row.notes || "—"}</td><td className="operations-long-cell">{row.shortage_location_note || (Number(row.shortages_count || 0) ? `${row.shortages_count} نواقص` : "—")}</td>
              <td>{row.status_name || row.status_code}</td>
              <td>{row.tracking_order_no ? `${row.tracking_order_no} — ${row.tracking_progress || 0}%` : "لا يوجد طلب"}</td>
              <td>{approvalLabel(row)}</td><td>{Number(row.checks_count || 0) ? `${row.checks_count} عنصر` : "غير مسجل"}</td>
              <td>{Number(row.active_transfers || 0)}</td><td>{row.archived_at ? "مؤرشفة" : "نشطة"}</td>
            </tr>
          )) : <tr><td colSpan={18} className="operations-empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
