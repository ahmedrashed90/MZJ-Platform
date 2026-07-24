import { useEffect, useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch, queryString, formatOperationsDate } from "../api";
import type { TransferRow } from "../types";

const nextStage: Record<string, string> = { request_received: "vehicle_sent", vehicle_sent: "vehicle_received", vehicle_received: "completed" };
const labels: Record<string, string> = { request_received: "تم استلام الطلب", vehicle_sent: "تم بدء التصوير", vehicle_received: "تم استلام ملفات التصوير", completed: "تم الانتهاء" };

export function PhotographyRequestsPage() {
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<{ rows: TransferRow[] }>(`/api/operations${queryString({ resource: "transfers", kind: "photography", completed: tab === "completed", pageSize: 200 })}`); setRows(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل طلبات التصوير"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tab]);
  async function advance(row: TransferRow) {
    const next = nextStage[row.status]; if (!next) return;
    setLoading(true); setError(""); setMessage("");
    try { const result = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "transfer_action", id: row.id, transferAction: "advance", nextStatus: next }) }); setMessage(result.message.replaceAll("نقل", "تصوير")); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث الطلب"); }
    finally { setLoading(false); }
  }
  return <div className="module-page operations-page"><header className="module-page-head"><div><h1>طلبات التصوير</h1><p>طلبات التصوير المنشأة من صفحة الاستوك في سيستم التسويق ومتابعتها داخل سيستم العمليات.</p></div></header>{error ? <div className="operations-alert error"><WarningCircle />{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}<div className="operations-subtabs"><button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>متابعة الطلبات</button><button className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>الطلبات المكتملة</button></div><section className="panel"><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>رقم الطلب</th><th>الحالة</th><th>المنشئ</th><th>التاريخ</th><th>السيارات</th><th>الملاحظات</th><th>الإجراء</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.request_no}</strong></td><td>{labels[row.status] || row.status}</td><td>{row.requested_by_name || "—"}</td><td>{formatOperationsDate(row.requested_at)}</td><td>{row.vehicles.map((vehicle) => <div key={vehicle.vehicle_id}><strong dir="ltr">{vehicle.vin}</strong> — {vehicle.car_name || "—"}{(vehicle as any).item_note ? <small> · {(vehicle as any).item_note}</small> : null}</div>)}</td><td>{row.note || "—"}</td><td>{nextStage[row.status] && !row.cancelled_at ? <button type="button" className="operations-primary-button" disabled={loading} onClick={() => void advance(row)}><CheckCircle />{labels[nextStage[row.status]]}</button> : "—"}</td></tr>)}{!loading && rows.length === 0 ? <tr><td colSpan={7} className="operations-empty">لا توجد طلبات تصوير</td></tr> : null}</tbody></table></div></section></div>;
}
