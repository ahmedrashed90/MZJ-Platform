import { useEffect, useMemo, useState } from "react";
import { CheckCircle, CurrencyCircleDollar, FileXls, MagnifyingGlass, MapPin, ShieldCheck, WarningCircle, XCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { exportExcel, operationsFetch, queryString } from "../api";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "./ResizableOperationsTable";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

type RequestKindFilter = "all" | "transfer" | "photography";
type RequestStatusFilter = "" | "request_received" | "vehicle_received" | "vehicle_sent" | "completed";

export type DashboardOperationsSelection =
  | { mode: "vehicles"; locationCode: string; locationName: string; metric: string; metricName: string; branchesOnly?: boolean }
  | { mode: "requests"; kind?: RequestKindFilter; status?: RequestStatusFilter; title: string }
  | { mode: "shortages"; locationCode: string; locationName: string }
  | { mode: "approvals"; filter: "" | "missing_financial" | "missing_administrative" | "completed"; title: string };

type Vehicle = {
  id: string;
  vin: string;
  car_name?: string;
  statement?: string;
  agent_name?: string;
  model_year?: string;
  interior_color?: string;
  exterior_color?: string;
  plate_no?: string;
  batch_no?: string;
  notes?: string;
  shortage_note?: string;
  location_name?: string;
  status_name?: string;
};

type RequestVehicle = { vin?: string; car_name?: string; statement?: string; model_year?: string; interior_color?: string; exterior_color?: string; current_location_name?: string; current_status_name?: string };
type RequestRow = {
  id: string;
  request_no?: string;
  request_kind?: string;
  status?: string;
  cancelled_at?: string | null;
  requested_by_name?: string;
  creator_name?: string;
  requested_at?: string;
  source_location_name?: string;
  destination_location_name?: string;
  vehicles?: RequestVehicle[];
};

const requestKindLabels: Record<string, string> = {
  transfer: "طلب نقل",
  photography: "طلب تصوير",
};

const requestStatusLabels: Record<string, string> = {
  created: "طلب جديد",
  request_received: "تم استلام الطلب",
  vehicle_received: "تم استلام السيارة",
  vehicle_sent: "تم إرسال السيارة",
  completed: "تم الانتهاء",
};


type ShortageRow = {
  id: string;
  location_code: string;
  location_name: string;
  car_name: string;
  statement: string;
  model_year: string;
  exterior_color: string;
  interior_color: string;
  warehouse_qty: number;
  hall_qty: number;
  multaqa_qty: number;
  qadisiyah_qty: number;
  total_qty: number;
};

type ApprovalVehicle = {
  id: string;
  vehicle_id: string;
  cycle_no: number;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  agent_name?: string | null;
  model_year?: string | null;
  interior_color?: string | null;
  exterior_color?: string | null;
  plate_no?: string | null;
  batch_no?: string | null;
  notes?: string | null;
  state_note?: string | null;
  shortage_note?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  pending_destination_name?: string | null;
  financial_approved: boolean;
  administrative_approved: boolean;
  financial_note?: string | null;
  administrative_note?: string | null;
  financial_approved_by_name?: string | null;
  administrative_approved_by_name?: string | null;
  financial_approved_at?: string | null;
  administrative_approved_at?: string | null;
  updated_at?: string | null;
};

function formatApprovalDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ar-SA-u-nu-latn") : "—";
}

function DashboardApprovalBadge({ approved }: { approved: boolean }) {
  return (
    <span className={`operations-approval-status compact ${approved ? "complete" : "pending"}`}>
      {approved ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} />}
      {approved ? "مكتملة" : "ناقصة"}
    </span>
  );
}

export function DashboardOperationsModal({ selection, onClose }: { selection: DashboardOperationsSelection | null; onClose: () => void }) {
  const { user } = useAuth();
  const canApproveFinancial = hasPermission(user, "operations.approval.financial");
  const canApproveAdministrative = hasPermission(user, "operations.approval.administrative");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [requestRows, setRequestRows] = useState<RequestRow[]>([]);
  const [approvalRows, setApprovalRows] = useState<ApprovalVehicle[]>([]);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalVehicle | null>(null);
  const [financialNote, setFinancialNote] = useState("");
  const [administrativeNote, setAdministrativeNote] = useState("");
  const [message, setMessage] = useState("");
  const [shortageRows, setShortageRows] = useState<ShortageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<RequestKindFilter>("all");
  const [detail, setDetail] = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  async function load() {
    if (!selection) return;
    setLoading(true);
    setError("");
    try {
      if (selection.mode === "vehicles") {
        const payload = await operationsFetch<{ rows: Vehicle[]; total: number }>(
          `/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, branchesOnly: selection.branchesOnly ? "1" : "", search, page, pageSize })}`,
        );
        setRows(payload.rows || []);
        setRequestRows([]);
        setApprovalRows([]);
        setShortageRows([]);
        setTotal(Number(payload.total || 0));
      } else if (selection.mode === "requests") {
        const payload = await operationsFetch<{ rows: RequestRow[]; total: number }>(
          `/api/operations${queryString({ resource: "dashboard_requests", kind, status: selection.status || "", search })}`,
        );
        setRequestRows(payload.rows || []);
        setRows([]);
        setApprovalRows([]);
        setShortageRows([]);
        setTotal(Number(payload.total || 0));
      } else if (selection.mode === "shortages") {
        const payload = await operationsFetch<{ rows: ShortageRow[]; total: number }>(
          `/api/operations${queryString({ resource: "dashboard_shortages", location: selection.locationCode, search, page, pageSize })}`,
        );
        setShortageRows(payload.rows || []);
        setRows([]);
        setRequestRows([]);
        setApprovalRows([]);
        setTotal(Number(payload.total || 0));
      } else {
        const payload = await operationsFetch<{ rows: ApprovalVehicle[] }>(
          `/api/operations${queryString({ resource: "approvals", filter: selection.filter, search })}`,
        );
        const nextRows = payload.rows || [];
        setApprovalRows(nextRows);
        setSelectedApproval((current) => {
          if (!current) return null;
          const updated = nextRows.find((row) => row.vehicle_id === current.vehicle_id);
          return updated ? { ...current, ...updated } : current;
        });
        setRows([]);
        setRequestRows([]);
        setShortageRows([]);
        setTotal(nextRows.length);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل التفاصيل");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSearch("");
    setPage(1);
    setDetail(null);
    setSelectedApproval(null);
    setFinancialNote("");
    setAdministrativeNote("");
    setMessage("");
    setRows([]);
    setRequestRows([]);
    setApprovalRows([]);
    setShortageRows([]);
    setTotal(0);
    if (selection?.mode === "requests") setKind(selection.kind || "all");
  }, [selection]);

  useEffect(() => {
    setPage(1);
  }, [kind]);

  useEffect(() => {
    if (!selectedApproval) return;
    setFinancialNote(selectedApproval.financial_note || "");
    setAdministrativeNote(selectedApproval.administrative_note || "");
    setMessage("");
  }, [selectedApproval?.vehicle_id, selectedApproval?.cycle_no]);

  useEffect(() => {
    if (selection) void load();
  }, [selection, kind, page]);

  async function act(type: "financial" | "administrative", action: "approve" | "revert" | "note") {
    if (!selectedApproval) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ approval?: Partial<ApprovalVehicle>; autoArchived?: boolean; message?: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "approval_action",
          vehicleId: selectedApproval.vehicle_id,
          approvalType: type,
          approvalAction: action,
          note: type === "financial" ? financialNote : administrativeNote,
        }),
      });
      setMessage(payload.message || "تم تحديث الموافقات");
      setSelectedApproval((current) => payload.autoArchived || !current ? null : { ...current, ...(payload.approval || {}) });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث الموافقة");
    } finally {
      setLoading(false);
    }
  }

  async function exportVehicles() {
    if (!selection || selection.mode !== "vehicles") return;
    setLoading(true);
    try {
      const all: Vehicle[] = [];
      const pages = Math.max(1, Math.ceil(total / 200));
      for (let current = 1; current <= pages; current += 1) {
        const payload = await operationsFetch<{ rows: Vehicle[] }>(
          `/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, branchesOnly: selection.branchesOnly ? "1" : "", search, page: current, pageSize: 200 })}`,
        );
        all.push(...(payload.rows || []));
      }
      exportExcel(
        `${selection.locationName}-${selection.metricName}.xlsx`,
        ["رقم الهيكل", "السيارة", "البيان", "الوكيل", "موديل", "داخلي", "خارجي", "اللوحة", "اسم الدفعة", "المكان", "الحالة", "ملاحظات السيارة", "حجز - نواقص - تحديد مكان"],
        all.map((row) => [row.vin, row.car_name, row.statement, row.agent_name, row.model_year, row.interior_color, row.exterior_color, row.plate_no, row.batch_no, row.location_name, row.status_name, row.notes, row.shortage_note]),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير Excel");
    } finally {
      setLoading(false);
    }
  }

  const approvalColumns = useMemo<ResizableOperationsColumn<ApprovalVehicle>[]>(() => [
    {
      key: "vin",
      label: "رقم الهيكل",
      width: 170,
      min: 145,
      max: 250,
      value: (row) => row.vin,
      render: (row) => (
        <button
          type="button"
          className="dashboard-approval-vehicle-button vin"
          onClick={() => setSelectedApproval(row)}
          aria-label={`فتح الموافقات المالية والإدارية للسيارة ${row.vin}`}
        >
          <strong dir="ltr">{row.vin}</strong>
          <span>فتح الموافقات</span>
        </button>
      ),
    },
    {
      key: "vehicle",
      label: "السيارة والبيان",
      width: 300,
      min: 220,
      max: 460,
      value: (row) => `${row.car_name || ""} ${row.statement || ""}`,
      render: (row) => (
        <button
          type="button"
          className="dashboard-approval-vehicle-button"
          onClick={() => setSelectedApproval(row)}
          aria-label={`فتح الموافقات المالية والإدارية للسيارة ${row.car_name || row.vin}`}
        >
          <span className="operations-cell-stack">
            <strong>{row.car_name || "—"}</strong>
            <small>{row.statement || "بدون بيان"}</small>
          </span>
          <span className="dashboard-approval-open-hint"><ShieldCheck size={16} />فتح الموافقات</span>
        </button>
      ),
    },
    {
      key: "model",
      label: "الموديل",
      width: 105,
      min: 90,
      max: 150,
      value: (row) => row.model_year,
      render: (row) => row.model_year || "—",
    },
    {
      key: "location",
      label: "المكان والحالة",
      width: 175,
      min: 145,
      max: 270,
      value: (row) => `${row.location_name || ""} ${row.status_name || row.status_code || ""}`,
      render: (row) => <div className="operations-cell-stack"><strong className="operations-location-cell"><MapPin size={16} />{row.location_name || "—"}</strong><small>{row.status_name || row.status_code || "—"}</small>{row.pending_destination_name ? <small>الوجهة: {row.pending_destination_name}</small> : null}</div>,
    },
    {
      key: "financial",
      label: "الموافقة المالية",
      width: 180,
      min: 150,
      max: 240,
      value: (row) => `${row.financial_approved ? "مكتملة" : "ناقصة"} ${row.financial_note || ""}`,
      render: (row) => <div className="dashboard-approval-cell"><DashboardApprovalBadge approved={row.financial_approved} /><small>{row.financial_approved_by_name || "بدون منفذ"}</small><time>{formatApprovalDate(row.financial_approved_at)}</time></div>,
    },
    {
      key: "financialNote",
      label: "الملاحظة المالية",
      width: 270,
      min: 200,
      max: 480,
      value: (row) => row.financial_note,
      render: (row) => <span className="dashboard-approval-note-cell">{row.financial_note || "بدون ملاحظة"}</span>,
    },
    {
      key: "administrative",
      label: "الموافقة الإدارية",
      width: 180,
      min: 150,
      max: 240,
      value: (row) => `${row.administrative_approved ? "مكتملة" : "ناقصة"} ${row.administrative_note || ""}`,
      render: (row) => <div className="dashboard-approval-cell"><DashboardApprovalBadge approved={row.administrative_approved} /><small>{row.administrative_approved_by_name || "بدون منفذ"}</small><time>{formatApprovalDate(row.administrative_approved_at)}</time></div>,
    },
    {
      key: "administrativeNote",
      label: "الملاحظة الإدارية",
      width: 270,
      min: 200,
      max: 480,
      value: (row) => row.administrative_note,
      render: (row) => <span className="dashboard-approval-note-cell">{row.administrative_note || "بدون ملاحظة"}</span>,
    },
    {
      key: "updated",
      label: "آخر تحديث",
      width: 165,
      min: 135,
      max: 230,
      value: (row) => formatApprovalDate(row.updated_at),
      render: (row) => formatApprovalDate(row.updated_at),
    },
  ], []);

  const title = useMemo(() => {
    if (!selection) return "";
    if (selection.mode === "vehicles") return `${selection.locationName} — ${selection.metricName}`;
    if (selection.mode === "shortages") return `نواقص السيارات — ${selection.locationName}`;
    if (selection.mode === "approvals" || selection.mode === "requests") return selection.title;
    return "طلبات النقل والتصوير";
  }, [selection]);

  const searchPlaceholder = selection?.mode === "requests"
    ? "بحث برقم الهيكل أو السيارة أو البيان أو الطلب"
    : selection?.mode === "shortages"
      ? "بحث بالسيارة أو البيان أو الموديل أو اللون"
      : "بحث برقم الهيكل أو السيارة أو البيان";

  return (
    <>
      <Modal
        open={Boolean(selection)}
        title={title}
        subtitle={`عدد النتائج: ${total.toLocaleString("ar-SA-u-nu-latn")}`}
        onClose={onClose}
        className={`wide dashboard-operations-modal ${selection?.mode === "vehicles" || selection?.mode === "shortages" || selection?.mode === "approvals" ? "dashboard-operations-modal-fullscreen" : ""} ${selection?.mode === "approvals" ? "dashboard-approvals-modal" : ""}`.trim()}
      >
        <div className="dashboard-operations-toolbar">
          {selection?.mode === "requests" ? (
            <div className="operations-subtabs">
              <button className={kind === "all" ? "active" : ""} type="button" onClick={() => setKind("all")}>الكل</button>
              <button className={kind === "transfer" ? "active" : ""} type="button" onClick={() => setKind("transfer")}>النقل</button>
              <button className={kind === "photography" ? "active" : ""} type="button" onClick={() => setKind("photography")}>التصوير</button>
            </div>
          ) : null}
          <label className="operations-search">
            <MagnifyingGlass size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); void load(); } }}
              placeholder={searchPlaceholder}
            />
          </label>
          <button type="button" onClick={() => { setPage(1); void load(); }} disabled={loading}>
            <MagnifyingGlass size={17} />
            {loading ? "جاري البحث..." : "بحث"}
          </button>
          {selection?.mode === "vehicles" ? (
            <button type="button" onClick={() => void exportVehicles()} disabled={loading}><FileXls size={17} />تصدير Excel</button>
          ) : null}
        </div>

        {error ? <div className="operations-alert error">{error}</div> : null}
        {message && !selectedApproval ? <div className="operations-alert success">{message}</div> : null}

        {selection?.mode === "vehicles" ? (
          <>
            <div className="operations-table-scroll">
              <table className="operations-table dashboard-drilldown-table">
                <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>موديل</th><th>داخلي</th><th>خارجي</th><th>اللوحة</th><th>اسم الدفعة</th><th>المكان</th><th>الحالة</th><th>ملاحظات السيارة</th><th>حجز - نواقص - تحديد مكان</th></tr></thead>
                <tbody>
                  {!loading && !rows.length ? <tr><td colSpan={13} className="table-empty">لا توجد نتائج</td></tr> : rows.map((row) => (
                    <tr key={row.id}><td><b dir="ltr">{row.vin}</b></td><td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.agent_name || "—"}</td><td>{row.model_year || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.plate_no || "—"}</td><td>{row.batch_no || "—"}</td><td>{row.location_name || "—"}</td><td>{row.status_name || "—"}</td><td className="dashboard-wrap-cell">{row.notes || "—"}</td><td className="dashboard-wrap-cell">{row.shortage_note || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="operations-pagination">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button>
              <span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span>
              <button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button>
            </div>
          </>
        ) : selection?.mode === "shortages" ? (
          <>
            <div className="dashboard-shortages-summary">
              <div><strong>التركيبات غير الموجودة في الفرع</strong><span>الرقم المتاح هو إجمالي نفس التركيبة في المستودع وباقي الفروع، مع استبعاد الوكالة والإكسسوارات.</span></div>
              <b>{total.toLocaleString("ar-SA-u-nu-latn")}</b>
            </div>
            <div className="operations-table-scroll dashboard-shortages-table-wrap">
              <table className="operations-table dashboard-shortages-table">
                <thead><tr><th>الفرع الناقص</th><th>السيارة</th><th>البيان</th><th>الموديل</th><th>الخارجي</th><th>الداخلي</th><th>الإجمالي المتاح</th><th>المستودع</th><th>الصالة</th><th>الملتقى</th><th>القادسية</th></tr></thead>
                <tbody>
                  {!loading && !shortageRows.length ? <tr><td colSpan={11} className="table-empty">لا توجد تركيبات ناقصة مطابقة</td></tr> : shortageRows.map((row) => (
                    <tr key={row.id}><td><strong>{row.location_name}</strong></td><td>{row.car_name}</td><td>{row.statement}</td><td>{row.model_year}</td><td>{row.exterior_color}</td><td>{row.interior_color}</td><td><b className="operations-quantity-badge">{row.total_qty}</b></td><td>{row.warehouse_qty}</td><td>{row.hall_qty}</td><td>{row.multaqa_qty}</td><td>{row.qadisiyah_qty}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="operations-pagination">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button>
              <span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span>
              <button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button>
            </div>
          </>
        ) : selection?.mode === "approvals" ? (
          <div className="dashboard-approvals-results">
            <div className="dashboard-approvals-summary">
              <div>
                <strong>{selection.title}</strong>
                <span>اضغط على اسم السيارة أو رقم الهيكل لفتح الموافقة المالية والإدارية مباشرة.</span>
              </div>
              <b>{total.toLocaleString("ar-SA-u-nu-latn")}</b>
            </div>
            <ResizableOperationsTable
              rows={approvalRows}
              columns={approvalColumns}
              rowKey={(row) => row.id}
              storageKey="mzj.dashboard.approvals.columns.direct-action.v1194"
              emptyText={loading ? "جاري تحميل السيارات..." : "لا توجد سيارات في هذه الحالة"}
              helperText="اضغط على اسم السيارة أو رقم الهيكل لفتح الموافقات مباشرة. ويمكنك سحب العلامة بين الأعمدة لتغيير العرض."
              minTableWidth={1880}
              tableClassName="dashboard-approvals-table"
            />
          </div>
        ) : (
          <div className="dashboard-requests-list">
            {!loading && !requestRows.length ? <div className="operations-empty-state">لا توجد طلبات</div> : requestRows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.request_no || "طلب"} · {requestKindLabels[row.request_kind || ""] || "طلب"}</strong>
                  <span>{row.source_location_name || "—"} ← {row.destination_location_name || "—"}</span>
                  <small>{row.cancelled_at ? "ملغي" : requestStatusLabels[row.status || ""] || row.status || "—"} · {row.requested_by_name || row.creator_name || "—"} · {row.requested_at ? new Date(row.requested_at).toLocaleString("ar-SA-u-nu-latn") : "—"}</small>
                </div>
                <button type="button" onClick={() => setDetail(row)}>تفاصيل</button>
              </article>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(detail)} level={1} title={`تفاصيل ${detail?.request_no || "الطلب"}`} onClose={() => setDetail(null)} className="dashboard-request-detail-modal">
        <div className="operations-request-vehicle-list">
          {(detail?.vehicles || []).map((vehicle, index) => (
            <article key={`${vehicle.vin || index}`}>
              <div><small>رقم الهيكل</small><strong dir="ltr">{vehicle.vin || "—"}</strong></div>
              <div><small>السيارة</small><strong>{vehicle.car_name || "—"}</strong></div>
              <div><small>البيان</small><strong>{vehicle.statement || "—"}</strong></div>
              <div><small>الموديل</small><strong>{vehicle.model_year || "—"}</strong></div>
              <div><small>اللون الداخلي</small><strong>{vehicle.interior_color || "—"}</strong></div>
              <div><small>اللون الخارجي</small><strong>{vehicle.exterior_color || "—"}</strong></div>
              <div><small>المكان الحالي</small><strong>{vehicle.current_location_name || "—"}</strong></div>
              <div><small>الحالة الحالية</small><strong>{vehicle.current_status_name || "—"}</strong></div>
            </article>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedApproval)}
        level={1}
        title={selectedApproval ? `تفاصيل موافقات السيارة ${selectedApproval.vin}` : "تفاصيل الموافقات"}
        subtitle={selectedApproval ? `${selectedApproval.car_name || "—"} · ${selectedApproval.statement || "—"}` : undefined}
        onClose={() => setSelectedApproval(null)}
        className="wide dashboard-approval-detail-modal"
      >
        {selectedApproval ? (
          <div className="dashboard-approval-detail-content dashboard-approval-action-first">
            <section className="dashboard-approval-quick-summary">
              <div><small>رقم الهيكل</small><strong dir="ltr">{selectedApproval.vin}</strong></div>
              <div><small>السيارة</small><strong>{selectedApproval.car_name || "—"}</strong></div>
              <div><small>المكان الحالي</small><strong>{selectedApproval.location_name || "—"}</strong></div>
              <div><small>الحالة</small><strong>{selectedApproval.status_name || selectedApproval.status_code || "—"}</strong></div>
            </section>
            {message ? <div className="operations-alert success dashboard-approval-action-message">{message}</div> : null}
            {error ? <div className="operations-alert error dashboard-approval-action-message">{error}</div> : null}
            <section className="dashboard-approval-detail-cards">
              <article className={selectedApproval.financial_approved ? "complete" : "pending"}>
                <header>
                  <div className="dashboard-approval-card-title"><span><CurrencyCircleDollar size={23} /></span><div><strong>الموافقة المالية</strong><small>{selectedApproval.financial_approved ? "تم اعتماد الموافقة المالية" : "في انتظار اعتماد المسؤول المالي"}</small></div></div>
                  <DashboardApprovalBadge approved={selectedApproval.financial_approved} />
                </header>
                <dl><div><dt>المسؤول</dt><dd>{selectedApproval.financial_approved_by_name || "—"}</dd></div><div><dt>التاريخ</dt><dd>{formatApprovalDate(selectedApproval.financial_approved_at)}</dd></div></dl>
                <label className="dashboard-approval-action-note"><span>الملاحظة المالية</span><textarea rows={3} value={financialNote} onChange={(event) => setFinancialNote(event.target.value)} placeholder="اكتب الملاحظة المالية هنا" disabled={!canApproveFinancial || loading} /></label>
                <footer className="dashboard-approval-action-footer">
                  {canApproveFinancial ? <>
                    <button type="button" onClick={() => void act("financial", "note")} disabled={loading}>حفظ الملاحظة</button>
                    {selectedApproval.financial_approved
                      ? <button type="button" className="danger-outline" onClick={() => void act("financial", "revert")} disabled={loading}><XCircle size={17} />تراجع عن الموافقة</button>
                      : <button type="button" className="primary" onClick={() => void act("financial", "approve")} disabled={loading}><CheckCircle size={17} />اعتماد مالي</button>}
                  </> : <span className="operations-no-permission">عرض فقط — لا توجد صلاحية تنفيذ الموافقة المالية.</span>}
                </footer>
              </article>
              <article className={selectedApproval.administrative_approved ? "complete" : "pending"}>
                <header>
                  <div className="dashboard-approval-card-title"><span><ShieldCheck size={23} /></span><div><strong>الموافقة الإدارية</strong><small>{selectedApproval.administrative_approved ? "تم اعتماد الموافقة الإدارية" : "في انتظار اعتماد المسؤول الإداري"}</small></div></div>
                  <DashboardApprovalBadge approved={selectedApproval.administrative_approved} />
                </header>
                <dl><div><dt>المسؤول</dt><dd>{selectedApproval.administrative_approved_by_name || "—"}</dd></div><div><dt>التاريخ</dt><dd>{formatApprovalDate(selectedApproval.administrative_approved_at)}</dd></div></dl>
                <label className="dashboard-approval-action-note"><span>الملاحظة الإدارية</span><textarea rows={3} value={administrativeNote} onChange={(event) => setAdministrativeNote(event.target.value)} placeholder="اكتب الملاحظة الإدارية هنا" disabled={!canApproveAdministrative || loading} /></label>
                <footer className="dashboard-approval-action-footer">
                  {canApproveAdministrative ? <>
                    <button type="button" onClick={() => void act("administrative", "note")} disabled={loading}>حفظ الملاحظة</button>
                    {selectedApproval.administrative_approved
                      ? <button type="button" className="danger-outline" onClick={() => void act("administrative", "revert")} disabled={loading}><XCircle size={17} />تراجع عن الموافقة</button>
                      : <button type="button" className="primary" onClick={() => void act("administrative", "approve")} disabled={loading}><CheckCircle size={17} />اعتماد إداري</button>}
                  </> : <span className="operations-no-permission">عرض فقط — لا توجد صلاحية تنفيذ الموافقة الإدارية.</span>}
                </footer>
              </article>
            </section>
            <details className="dashboard-approval-more-details">
              <summary>بيانات السيارة والملاحظات الكاملة</summary>
              <section className="dashboard-approval-detail-summary">
                <div><small>البيان</small><strong>{selectedApproval.statement || "—"}</strong></div>
                <div><small>الوكيل</small><strong>{selectedApproval.agent_name || "—"}</strong></div>
                <div><small>الموديل</small><strong>{selectedApproval.model_year || "—"}</strong></div>
                <div><small>اللون الداخلي</small><strong>{selectedApproval.interior_color || "—"}</strong></div>
                <div><small>اللون الخارجي</small><strong>{selectedApproval.exterior_color || "—"}</strong></div>
                <div><small>اللوحة</small><strong>{selectedApproval.plate_no || "—"}</strong></div>
                <div><small>اسم الدفعة</small><strong>{selectedApproval.batch_no || "—"}</strong></div>
                <div><small>الوجهة المنتظرة</small><strong>{selectedApproval.pending_destination_name || "—"}</strong></div>
                <div><small>دورة الموافقات</small><strong>{selectedApproval.cycle_no || 1}</strong></div>
              </section>
              <section className="dashboard-approval-vehicle-notes">
                <article><span>ملاحظات السيارة</span><p>{selectedApproval.notes || "لا توجد ملاحظات"}</p></article>
                <article><span>ملاحظات الحالة</span><p>{selectedApproval.state_note || "لا توجد ملاحظات حالة"}</p></article>
                <article><span>حجز - نواقص - تحديد مكان</span><p>{selectedApproval.shortage_note || "لا توجد ملاحظات حجز أو نواقص"}</p></article>
              </section>
            </details>
            <footer className="dashboard-approval-detail-footer">آخر تحديث: {formatApprovalDate(selectedApproval.updated_at)}</footer>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
