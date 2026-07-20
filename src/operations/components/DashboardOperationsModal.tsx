import { useEffect, useMemo, useState } from "react";
import { FileXls, MagnifyingGlass } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { exportExcel, operationsFetch, queryString } from "../api";

export type DashboardOperationsSelection =
  | { mode: "vehicles"; locationCode: string; locationName: string; metric: string; metricName: string }
  | { mode: "requests" };

type Vehicle = { id: string; vin: string; car_name?: string; statement?: string; model_year?: string; interior_color?: string; exterior_color?: string; location_name?: string; status_name?: string };
type RequestVehicle = { vin?: string; car_name?: string; statement?: string };
type RequestRow = { id: string; request_no?: string; status?: string; requested_by_name?: string; creator_name?: string; requested_at?: string; vehicles?: RequestVehicle[] };

export function DashboardOperationsModal({ selection, onClose }: { selection: DashboardOperationsSelection | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [requestRows, setRequestRows] = useState<RequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"transfer" | "photo">("transfer");
  const [detail, setDetail] = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  async function load() {
    if (!selection) return;
    setLoading(true); setError("");
    try {
      if (selection.mode === "vehicles") {
        const payload = await operationsFetch<{ rows: Vehicle[]; total: number }>(`/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, search, page, pageSize })}`);
        setRows(payload.rows || []); setTotal(Number(payload.total || 0));
      } else {
        const payload = await operationsFetch<{ rows: RequestRow[]; total: number }>(`/api/operations${queryString({ resource: "dashboard_requests", kind, search })}`);
        setRequestRows(payload.rows || []); setTotal(Number(payload.total || 0));
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل التفاصيل"); }
    finally { setLoading(false); }
  }

  useEffect(() => { setSearch(""); setPage(1); setDetail(null); }, [selection, kind]);
  useEffect(() => { if (selection) void load(); }, [selection, kind, page]);

  async function exportVehicles() {
    if (!selection || selection.mode !== "vehicles") return;
    setLoading(true);
    try {
      const all: Vehicle[] = [];
      const pages = Math.max(1, Math.ceil(total / 200));
      for (let current = 1; current <= pages; current += 1) {
        const payload = await operationsFetch<{ rows: Vehicle[] }>(`/api/operations${queryString({ resource: "dashboard_vehicles", location: selection.locationCode, metric: selection.metric, search, page: current, pageSize: 200 })}`);
        all.push(...(payload.rows || []));
      }
      exportExcel(`${selection.locationName}-${selection.metricName}.xlsx`, ["رقم الهيكل","السيارة","البيان","موديل","داخلي","خارجي","المكان","الحالة"], all.map((row) => [row.vin,row.car_name,row.statement,row.model_year,row.interior_color,row.exterior_color,row.location_name,row.status_name]));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تصدير Excel"); }
    finally { setLoading(false); }
  }

  const title = useMemo(() => !selection ? "" : selection.mode === "vehicles" ? `${selection.locationName} — ${selection.metricName}` : "طلبات النقل والتصوير", [selection]);

  return <>
    <Modal open={Boolean(selection)} title={title} subtitle={`عدد النتائج: ${total.toLocaleString("ar-SA")}`} onClose={onClose} className="wide dashboard-operations-modal">
      <div className="dashboard-operations-toolbar">
        {selection?.mode === "requests" ? <div className="operations-subtabs"><button className={kind === "transfer" ? "active" : ""} type="button" onClick={() => setKind("transfer")}>النقل</button><button className={kind === "photo" ? "active" : ""} type="button" onClick={() => setKind("photo")}>التصوير</button></div> : null}
        <label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); void load(); } }} placeholder="بحث برقم الهيكل أو السيارة أو البيان أو الطلب" /></label>
        <button type="button" onClick={() => { setPage(1); void load(); }}><MagnifyingGlass size={17} />بحث</button>
        {selection?.mode === "vehicles" ? <button type="button" onClick={() => void exportVehicles()} disabled={loading}><FileXls size={17} />تصدير Excel</button> : null}
      </div>
      {error ? <div className="operations-alert error">{error}</div> : null}
      {selection?.mode === "vehicles" ? <>
        <div className="operations-table-scroll"><table className="operations-table dashboard-drilldown-table"><thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th><th>موديل</th><th>داخلي</th><th>خارجي</th><th>المكان</th><th>الحالة</th></tr></thead><tbody>{!loading && !rows.length ? <tr><td colSpan={8} className="table-empty">لا توجد نتائج</td></tr> : rows.map((row) => <tr key={row.id}><td><b>{row.vin}</b></td><td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.model_year || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.location_name || "—"}</td><td>{row.status_name || "—"}</td></tr>)}</tbody></table></div>
        <div className="operations-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </> : <div className="dashboard-requests-list">{!loading && !requestRows.length ? <div className="operations-empty-state">لا توجد طلبات</div> : requestRows.map((row) => <article key={row.id}><div><strong>{row.request_no || "طلب"}</strong><span>المنشئ: {row.requested_by_name || row.creator_name || "—"}</span><small>تاريخ الطلب: {row.requested_at ? new Date(row.requested_at).toLocaleString("ar-SA") : "—"}</small></div><button type="button" onClick={() => setDetail(row)}>تفاصيل</button></article>)}</div>}
    </Modal>
    <Modal open={Boolean(detail)} level={1} title={`تفاصيل ${detail?.request_no || "الطلب"}`} onClose={() => setDetail(null)} className="dashboard-request-detail-modal">
      <div className="operations-request-vehicle-list">{(detail?.vehicles || []).map((vehicle, index) => <article key={`${vehicle.vin || index}`}><div><small>رقم الهيكل</small><strong>{vehicle.vin || "—"}</strong></div><div><small>السيارة</small><strong>{vehicle.car_name || "—"}</strong></div><div><small>البيان</small><strong>{vehicle.statement || "—"}</strong></div></article>)}</div>
    </Modal>
  </>;
}
