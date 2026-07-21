import { useEffect, useMemo, useState } from "react";
import { CheckCircle, FileXls, MagnifyingGlass, MapPin, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { exportExcel, operationsFetch, queryString } from "../api";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "./ResizableOperationsTable";

export type DashboardOperationsSelection =
  | { mode: "vehicles"; locationCode: string; locationName: string; metric: string; metricName: string }
  | { mode: "requests" }
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
  status?: string;
  requested_by_name?: string;
  creator_name?: string;
  requested_at?: string;
  vehicles?: RequestVehicle[];
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
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  model_year?: string | null;
  location_name?: string | null;
  financial_approved: boolean;
  administrative_approved: boolean;
};

function DashboardApprovalBadge({ approved }: { approved: boolean }) {
  return (
    <span className={`operations-approval-status compact ${approved ? "complete" : "pending"}`}>
      {approved ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} />}
      {approved ? "مكتملة" : "ناقصة"}
    </span>
  );
}

export function DashboardOperationsModal({ selection, onClose }: { selection: DashboardOperationsSelection | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [requestRows, setRequestRows] = useState<RequestRow[]>([]);
  const [approvalRows, setApprovalRows] = useState<ApprovalVehicle[]>([]);
  const [shortageRows, setShortageRows] = useState<ShortageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"transfer" | "photo">("transfer");
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
          `/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, search, page, pageSize })}`,
        );
        setRows(payload.rows || []);
        setRequestRows([]);
        setApprovalRows([]);
        setShortageRows([]);
        setTotal(Number(payload.total || 0));
      } else if (selection.mode === "requests") {
        const payload = await operationsFetch<{ rows: RequestRow[]; total: number }>(
          `/api/operations${queryString({ resource: "dashboard_requests", kind, search })}`,
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
        setApprovalRows(payload.rows || []);
        setRows([]);
        setRequestRows([]);
        setShortageRows([]);
        setTotal((payload.rows || []).length);
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
    setRows([]);
    setRequestRows([]);
    setApprovalRows([]);
    setShortageRows([]);
    setTotal(0);
  }, [selection, kind]);

  useEffect(() => {
    if (selection) void load();
  }, [selection, kind, page]);

  async function exportVehicles() {
    if (!selection || selection.mode !== "vehicles") return;
    setLoading(true);
    try {
      const all: Vehicle[] = [];
      const pages = Math.max(1, Math.ceil(total / 200));
      for (let current = 1; current <= pages; current += 1) {
        const payload = await operationsFetch<{ rows: Vehicle[] }>(
          `/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, search, page: current, pageSize: 200 })}`,
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
      width: 150,
      min: 125,
      max: 230,
      value: (row) => row.vin,
      render: (row) => <strong dir="ltr">{row.vin}</strong>,
    },
    {
      key: "vehicle",
      label: "السيارة والبيان",
      width: 290,
      min: 210,
      max: 430,
      value: (row) => `${row.car_name || ""} ${row.statement || ""}`,
      render: (row) => <div className="operations-cell-stack"><strong>{row.car_name || "—"}</strong><small>{row.statement || "بدون بيان"}</small></div>,
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
      label: "المكان الحالي",
      width: 145,
      min: 120,
      max: 220,
      value: (row) => row.location_name,
      render: (row) => <span className="operations-location-cell"><MapPin size={16} />{row.location_name || "—"}</span>,
    },
    {
      key: "financial",
      label: "الموافقة المالية",
      width: 160,
      min: 140,
      max: 210,
      value: (row) => row.financial_approved ? "مكتملة" : "ناقصة",
      render: (row) => <DashboardApprovalBadge approved={row.financial_approved} />,
    },
    {
      key: "administrative",
      label: "الموافقة الإدارية",
      width: 160,
      min: 140,
      max: 210,
      value: (row) => row.administrative_approved ? "مكتملة" : "ناقصة",
      render: (row) => <DashboardApprovalBadge approved={row.administrative_approved} />,
    },
  ], []);

  const title = useMemo(() => {
    if (!selection) return "";
    if (selection.mode === "vehicles") return `${selection.locationName} — ${selection.metricName}`;
    if (selection.mode === "shortages") return `نواقص السيارات — ${selection.locationName}`;
    if (selection.mode === "approvals") return selection.title;
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
        subtitle={`عدد النتائج: ${total.toLocaleString("ar-SA")}`}
        onClose={onClose}
        className={`wide dashboard-operations-modal ${selection?.mode === "approvals" ? "dashboard-approvals-modal" : ""}`.trim()}
      >
        <div className="dashboard-operations-toolbar">
          {selection?.mode === "requests" ? (
            <div className="operations-subtabs">
              <button className={kind === "transfer" ? "active" : ""} type="button" onClick={() => setKind("transfer")}>النقل</button>
              <button className={kind === "photo" ? "active" : ""} type="button" onClick={() => setKind("photo")}>التصوير</button>
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
              <b>{total.toLocaleString("ar-SA")}</b>
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
                <span>السيارات المطابقة للحالة المحددة من كارت الموافقات.</span>
              </div>
              <b>{total.toLocaleString("ar-SA")}</b>
            </div>
            <ResizableOperationsTable
              rows={approvalRows}
              columns={approvalColumns}
              rowKey={(row) => row.id}
              storageKey="mzj.dashboard.approvals.columns.v1149"
              emptyText={loading ? "جاري تحميل السيارات..." : "لا توجد سيارات في هذه الحالة"}
              minTableWidth={1000}
              tableClassName="dashboard-approvals-table"
            />
          </div>
        ) : (
          <div className="dashboard-requests-list">
            {!loading && !requestRows.length ? <div className="operations-empty-state">لا توجد طلبات</div> : requestRows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.request_no || "طلب"}</strong>
                  <span>المنشئ: {row.requested_by_name || row.creator_name || "—"}</span>
                  <small>تاريخ الطلب: {row.requested_at ? new Date(row.requested_at).toLocaleString("ar-SA") : "—"}</small>
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
    </>
  );
}
