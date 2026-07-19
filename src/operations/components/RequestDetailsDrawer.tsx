import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  ClipboardText,
  MapPin,
  Trash,
  Truck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { formatOperationsDate, operationsFetch, requestStageLabels, requestStatusLabel } from "../api";
import type { OperationsRequest } from "../types";
import { OperationsDrawer } from "./OperationsOverlay";

const stagePermissions: Record<number, string> = {
  1: "operations.requests.receive",
  2: "operations.requests.dispatch",
  3: "operations.requests.confirm_receipt",
  4: "operations.requests.complete",
};

export function RequestDetailsDrawer({
  requestId,
  open,
  onClose,
  onChanged,
  onDeleted,
}: {
  requestId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: (request: OperationsRequest) => void;
  onDeleted: (id: string) => void;
}) {
  const { can } = useOperations();
  const [requestRow, setRequestRow] = useState<OperationsRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!requestId || !open) return;
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; request: OperationsRequest }>(`/api/operations/requests?id=${encodeURIComponent(requestId)}`);
      setRequestRow(payload.request);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الطلب");
    } finally {
      setLoading(false);
    }
  }, [open, requestId]);

  useEffect(() => { void load(); }, [load]);

  const nextStage = Math.min(Number(requestRow?.current_stage || 0) + 1, 4);
  const canAdvance = requestRow?.status !== "completed" && can(stagePermissions[nextStage]);
  const stageIcons = useMemo(() => [ClipboardText, CheckCircle, Truck, MapPin, CheckCircle], []);

  async function advance() {
    if (!requestRow || requestRow.status === "completed") return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; request: OperationsRequest; message: string }>("/api/operations/requests", {
        method: "POST",
        body: JSON.stringify({ action: "advance", requestId: requestRow.id, stage: nextStage, note }),
      });
      setRequestRow(payload.request);
      setMessage(payload.message);
      setNote("");
      onChanged(payload.request);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر تنفيذ المرحلة");
    } finally {
      setWorking(false);
    }
  }

  async function deleteRequest() {
    if (!requestRow) return;
    setWorking(true);
    setError("");
    try {
      await operationsFetch("/api/operations/requests", {
        method: "POST",
        body: JSON.stringify({ action: "delete", requestId: requestRow.id }),
      });
      onDeleted(requestRow.id);
      onClose();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر حذف الطلب");
    } finally {
      setWorking(false);
    }
  }

  return (
    <OperationsDrawer open={open} title={requestRow?.request_no || "تفاصيل الطلب"} description={requestRow ? `${requestRow.transfer_type === "photo" ? "طلب تصوير" : "طلب نقل"} • ${requestStatusLabel(requestRow.status)}` : undefined} onClose={onClose}>
      {loading ? <div className="ops-loading">جاري تحميل الطلب...</div> : null}
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      {!loading && requestRow ? <div className="ops-request-detail">
        <div className="ops-detail-actions"><button type="button" className="ops-button ghost" onClick={() => void load()}><ArrowClockwise size={17} />تحديث</button>{can("operations.requests.delete_before_receipt") && requestRow.current_stage < 3 ? <button type="button" className="ops-button danger-outline" disabled={working} onClick={() => void deleteRequest()}><Trash size={17} />حذف الطلب</button> : null}</div>
        <section className="ops-detail-section">
          <div className="ops-info-grid">
            <Info label="نوع الطلب" value={requestRow.transfer_type === "photo" ? "تصوير" : "نقل"} />
            <Info label="الموقع المطلوب" value={requestRow.destination_location_name} />
            <Info label="الحالة بعد الاستلام" value={requestRow.target_status_name || "الاحتفاظ بالحالة"} />
            <Info label="تاريخ التصوير" value={requestRow.photo_date ? formatOperationsDate(requestRow.photo_date, false) : "—"} />
            <Info label="منشئ الطلب" value={requestRow.requested_by_name} />
            <Info label="تاريخ الإنشاء" value={formatOperationsDate(requestRow.requested_at)} />
          </div>
          {requestRow.notes ? <div className="ops-request-note"><strong>ملاحظات الطلب</strong><p>{requestRow.notes}</p></div> : null}
        </section>

        <section className="ops-detail-section">
          <div className="ops-section-title"><ClipboardText size={20} weight="duotone" /><h3>مراحل الطلب</h3></div>
          <div className="ops-request-stages">
            {requestStageLabels.slice(1).map((label, index) => {
              const stage = index + 1;
              const Icon = stageIcons[stage];
              const done = requestRow.current_stage >= stage;
              const current = requestRow.current_stage + 1 === stage && requestRow.status !== "completed";
              const event = requestRow.events?.find((item) => item.stage_no === stage);
              return <article key={stage} className={`${done ? "done" : ""} ${current ? "current" : ""}`}><div className="ops-stage-icon"><Icon size={19} weight={done ? "fill" : "duotone"} /></div><div><strong>{label}</strong><span>{event ? `${event.actor_name || "—"} • ${formatOperationsDate(event.created_at)}` : current ? "المرحلة التالية" : "لم تُنفذ"}</span>{event?.note ? <p>{event.note}</p> : null}</div></article>;
            })}
          </div>
          {requestRow.status !== "completed" ? <div className="ops-next-stage-box"><label className="ops-field"><span>ملاحظة المرحلة التالية</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="button" className="ops-button primary full" disabled={!canAdvance || working} onClick={() => void advance()}>{working ? "جاري التنفيذ..." : `تنفيذ: ${requestStageLabels[nextStage]}`}</button>{!canAdvance ? <small>لا توجد لديك صلاحية تنفيذ المرحلة التالية.</small> : null}</div> : <div className="ops-completed-box"><CheckCircle size={22} weight="fill" /><div><strong>الطلب مكتمل</strong><span>{formatOperationsDate(requestRow.completed_at)} • {requestRow.completed_by_name || "—"}</span></div></div>}
        </section>

        <section className="ops-detail-section">
          <div className="ops-section-title"><Truck size={20} weight="duotone" /><h3>السيارات داخل الطلب</h3></div>
          <div className="ops-request-vehicles">
            {requestRow.vehicles?.map((vehicle) => <article key={vehicle.id}><header><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"}</span></header><div><span>المصدر: {vehicle.source_location_name || "—"}</span><span>الحالي: {vehicle.current_location_name || "—"}</span><span>الوجهة: {vehicle.destination_location_name || requestRow.destination_location_name || "—"}</span></div></article>)}
          </div>
        </section>
      </div> : null}
    </OperationsDrawer>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><span>{label}</span><strong>{value || "—"}</strong></div>;
}
