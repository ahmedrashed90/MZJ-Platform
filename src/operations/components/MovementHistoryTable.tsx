import { formatOperationsDate } from "../api";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "./ResizableOperationsTable";

export type MovementHistoryRow = {
  id: string;
  batch_id?: string | null;
  transfer_request_id?: string | null;
  created_at: string;
  movement_type: string;
  old_status?: string | null;
  new_status?: string | null;
  old_status_name?: string | null;
  new_status_name?: string | null;
  note?: string | null;
  state_note?: string | null;
  shortage_note?: string | null;
  performed_by_name?: string | null;
  performed_by_role?: string | null;
  performed_by_branch?: string | null;
  vehicle_id: string;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  from_location_code?: string | null;
  from_location_name?: string | null;
  to_location_code?: string | null;
  to_location_name?: string | null;
};

const columns: ResizableOperationsColumn<MovementHistoryRow>[] = [
  { key: "date", label: "التاريخ والوقت", width: 190, min: 150, max: 280, value: (row) => formatOperationsDate(row.created_at), render: (row) => formatOperationsDate(row.created_at) },
  { key: "vin", label: "VIN", width: 150, min: 110, max: 260, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
  { key: "car", label: "السيارة", width: 150, min: 110, max: 300, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
  { key: "statement", label: "البيان", width: 190, min: 120, max: 380, value: (row) => row.statement, render: (row) => row.statement || "—" },
  { key: "from", label: "المكان السابق", width: 135, min: 105, max: 240, value: (row) => row.from_location_name, render: (row) => row.from_location_name || "—" },
  { key: "to", label: "المكان الجديد", width: 135, min: 105, max: 240, value: (row) => row.to_location_name, render: (row) => row.to_location_name || "—" },
  { key: "oldStatus", label: "الحالة السابقة", width: 155, min: 115, max: 250, value: (row) => row.old_status_name || row.old_status, render: (row) => row.old_status_name || row.old_status || "—" },
  { key: "newStatus", label: "الحالة الجديدة", width: 155, min: 115, max: 250, value: (row) => row.new_status_name || row.new_status, render: (row) => row.new_status_name || row.new_status || "—" },
  { key: "actor", label: "منفذ الحركة", width: 155, min: 115, max: 280, value: (row) => row.performed_by_name, render: (row) => row.performed_by_name || "—" },
  { key: "branch", label: "الفرع", width: 125, min: 95, max: 220, value: (row) => row.performed_by_branch, render: (row) => row.performed_by_branch || "—" },
  { key: "note", label: "الملاحظات", width: 220, min: 140, max: 480, value: (row) => row.note, render: (row) => <span title={row.note || ""}>{row.note || "—"}</span> },
  { key: "stateNote", label: "ملاحظات الحالة", width: 200, min: 140, max: 440, value: (row) => row.state_note, render: (row) => <span title={row.state_note || ""}>{row.state_note || "—"}</span> },
  { key: "shortage", label: "حجز - نواقص - تحديد مكان", width: 230, min: 160, max: 500, value: (row) => row.shortage_note, render: (row) => <span title={row.shortage_note || ""}>{row.shortage_note || "—"}</span> },
  { key: "request", label: "رقم الطلب", width: 155, min: 115, max: 260, value: (row) => row.transfer_request_id, render: (row) => row.transfer_request_id || "—" },
  { key: "batch", label: "Batch ID", width: 155, min: 115, max: 260, value: (row) => row.batch_id, render: (row) => row.batch_id || "—" },
];

export function MovementHistoryTable({ rows }: { rows: MovementHistoryRow[] }) {
  return (
    <ResizableOperationsTable<MovementHistoryRow>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      storageKey="mzj.operations.movementHistory.columnWidths.v2"
      emptyText="لا توجد حركات مطابقة"
      minTableWidth={1600}
      tableClassName="movements operations-movement-history-table"
    />
  );
}
