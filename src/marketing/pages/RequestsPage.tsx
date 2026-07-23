import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, Camera, ClockCounterClockwise } from "@phosphor-icons/react";
import { useOutletContext } from "react-router-dom";
import { formatDate, marketingFetch } from "../api";
import type { PhotoRequest } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { Alert, Empty, PageHead, StatusBadge } from "../components/Ui";

type Response = { ok: boolean; rows: PhotoRequest[] };

export function MarketingRequestsPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [rows, setRows] = useState<PhotoRequest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await marketingFetch<Response>("/api/marketing?resource=photo_requests");
      setRows(data.rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل طلبات التصوير");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function update(row: PhotoRequest, patch: { status?: string; photographyDate?: string; note?: string }) {
    setError("");
    setMessage("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "photo_request_action",
          id: row.id,
          status: patch.status || row.status,
          photographyDate: patch.photographyDate ?? row.photography_date,
          note: patch.note ?? row.note,
        }),
      });
      setMessage("تم تحديث نفس سجل الطلب في التسويق والعمليات.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث الطلب");
    }
  }

  return (
    <div className="marketing-page">
      <PageHead
        title="متابعة الطلبات"
        description="طلبات التصوير المشتركة مع نظام العمليات بنفس الحالة والتاريخ والملاحظات."
        actions={<button className="marketing-button secondary" type="button" onClick={() => void load()}><ArrowsClockwise size={17} />تحديث</button>}
      />
      {error ? <Alert type="error">{error}</Alert> : null}
      {message ? <Alert type="success">{message}</Alert> : null}

      <div className="marketing-request-list">
        {rows.map((row) => (
          <article key={row.id}>
            <header>
              <div><Camera size={22} /><strong>{row.request_no}</strong><small>طلب تصوير</small></div>
              <StatusBadge status={row.status} />
            </header>
            <div className="marketing-detail-grid compact">
              <div><small>منشئ الطلب</small><b>{row.requested_by_name || "—"}</b></div>
              <div><small>تاريخ الطلب</small><b>{formatDate(row.requested_at, true)}</b></div>
              <div>
                <small>تاريخ التصوير</small>
                <input
                  type="date"
                  defaultValue={row.photography_date?.slice(0, 10) || ""}
                  readOnly={!meta.permissions.canManageRequests}
                  onBlur={(event) => {
                    if (event.target.value !== (row.photography_date?.slice(0, 10) || "")) {
                      void update(row, { photographyDate: event.target.value });
                    }
                  }}
                />
              </div>
              <div>
                <small>الحالة</small>
                <select value={row.status} disabled={!meta.permissions.canManageRequests} onChange={(event) => void update(row, { status: event.target.value })}>
                  {meta.requestStatuses.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
                </select>
              </div>
              <div><small>آخر تحديث</small><b>{formatDate(row.updated_at, true)}</b></div>
            </div>
            <div className="marketing-chip-list">
              {row.vehicles.map((vehicle) => <span key={vehicle.id || vehicle.vin}>{vehicle.vin} · {vehicle.car_name || vehicle.statement || "سيارة"}</span>)}
            </div>
            <label>
              <span>الملاحظات</span>
              <textarea
                rows={3}
                defaultValue={row.note || ""}
                readOnly={!meta.permissions.canManageRequests}
                onBlur={(event) => {
                  if (event.target.value !== (row.note || "")) void update(row, { note: event.target.value });
                }}
              />
            </label>
            <details className="marketing-request-history">
              <summary><ClockCounterClockwise size={18} />بيانات المتابعة ({row.updates.length})</summary>
              {row.updates.length ? row.updates.map((item) => (
                <div key={item.id}>
                  <StatusBadge status={item.new_status} />
                  <span>{item.changed_by_name || "—"}</span>
                  <span>{formatDate(item.created_at, true)}</span>
                  <span>{item.photography_date ? `موعد التصوير: ${formatDate(item.photography_date)}` : ""}</span>
                  {item.note ? <p>{item.note}</p> : null}
                </div>
              )) : <Empty text="لا توجد تحديثات متابعة بعد." />}
            </details>
          </article>
        ))}
      </div>
      {!rows.length ? <Empty text="لا توجد طلبات تصوير." /> : null}
    </div>
  );
}
