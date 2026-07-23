import { useCallback, useEffect, useState } from "react";
import { Camera, ClockCounterClockwise, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { formatOperationsDate, operationsFetch, queryString } from "../api";

type PhotoRequestUpdate = {
  id: string;
  old_status?: string | null;
  new_status: string;
  photography_date?: string | null;
  note?: string | null;
  changed_by_name?: string | null;
  created_at: string;
};

type PhotoRequestRow = {
  id: string;
  request_no: string;
  status: string;
  creator_name?: string | null;
  requested_at: string;
  photography_date?: string | null;
  note?: string | null;
  updated_at?: string | null;
  vehicles: Array<{ id?: string; vin: string; car_name?: string | null; statement?: string | null }>;
  updates: PhotoRequestUpdate[];
};

const labels: Record<string, string> = {
  request_received: "تم استلام الطلب",
  scheduled: "تم تحديد الموعد",
  in_progress: "جاري التصوير",
  completed: "تم الانتهاء",
  cancelled: "ملغي",
};

type PhotographyRequestsListProps = {
  completed: boolean;
};

export function PhotographyRequestsList({ completed }: PhotographyRequestsListProps) {
  const [rows, setRows] = useState<PhotoRequestRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await operationsFetch<{ rows: PhotoRequestRow[] }>(
        `/api/operations${queryString({ resource: "dashboard_requests", kind: "photo", completed, search })}`,
      );
      setRows(result.rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل طلبات التصوير");
    } finally {
      setLoading(false);
    }
  }, [completed, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <div className="operations-toolbar">
        <label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث برقم الطلب أو رقم الهيكل" /></label>
      </div>
      <div className="operations-requests-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div className="operations-request-icon"><Camera size={23} /></div>
            <div className="operations-request-copy">
              <b>{row.request_no}</b>
              <span>{row.vehicles.map((vehicle) => `${vehicle.vin} · ${vehicle.car_name || vehicle.statement || "سيارة"}`).join("، ")}</span>
              <small>{row.creator_name || "—"} · {formatOperationsDate(row.requested_at)} · موعد التصوير {row.photography_date ? formatOperationsDate(row.photography_date) : "—"}</small>
              {row.note ? <small>{row.note}</small> : null}
              <details className="operations-request-history">
                <summary><ClockCounterClockwise size={16} />بيانات المتابعة ({row.updates.length})</summary>
                {row.updates.map((update) => (
                  <div key={update.id}>
                    <b>{labels[update.new_status] || update.new_status}</b>
                    <span>{update.changed_by_name || "—"}</span>
                    <small>{formatOperationsDate(update.created_at)}{update.photography_date ? ` · موعد التصوير ${formatOperationsDate(update.photography_date)}` : ""}</small>
                    {update.note ? <p>{update.note}</p> : null}
                  </div>
                ))}
              </details>
            </div>
            <span className={`operations-status status-${row.status}`}>{labels[row.status] || row.status}</span>
          </article>
        ))}
        {!loading && !rows.length ? <div className="operations-empty-state"><Camera size={42} /><strong>{completed ? "لا توجد طلبات تصوير مكتملة" : "لا توجد طلبات تصوير قيد المتابعة"}</strong></div> : null}
        {loading ? <div className="crm-loading-panel">جاري تحميل الطلبات...</div> : null}
      </div>
    </>
  );
}
