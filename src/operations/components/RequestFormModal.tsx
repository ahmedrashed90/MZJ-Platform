import { useEffect, useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { operationsFetch } from "../api";
import type { OperationsRequest, OperationsVehicle } from "../types";
import { OperationsModal } from "./OperationsOverlay";
import { VehiclePicker } from "./VehiclePicker";

export function RequestFormModal({
  open,
  vehicles,
  onClose,
  onCreated,
}: {
  open: boolean;
  vehicles: OperationsVehicle[];
  onClose: () => void;
  onCreated: (request: OperationsRequest) => void;
}) {
  const { meta } = useOperations();
  const [transferType, setTransferType] = useState<"transfer" | "photo">("transfer");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [targetStatusCode, setTargetStatusCode] = useState("");
  const [photoDate, setPhotoDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTransferType("transfer");
    setSelectedIds([]);
    setDestinationLocationId("");
    setTargetStatusCode("");
    setPhotoDate("");
    setNotes("");
    setError("");
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; request: OperationsRequest }>("/api/operations/requests", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          transferType,
          vehicleIds: selectedIds,
          destinationLocationId,
          targetStatusCode: transferType === "transfer" ? targetStatusCode : "",
          photoDate: transferType === "photo" ? photoDate : "",
          notes,
        }),
      });
      onCreated(payload.request);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر إنشاء الطلب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OperationsModal open={open} title="إنشاء طلب نقل أو تصوير" description="الطلب يمر بالمراحل الأربع بالترتيب، ولا يتم تحديث موقع السيارة إلا عند مرحلة تم استلام السيارة في طلب النقل." onClose={onClose} wide>
      <form className="ops-request-form" onSubmit={submit}>
        {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
        <div className="ops-segmented">
          <button type="button" className={transferType === "transfer" ? "active" : ""} onClick={() => setTransferType("transfer")}>طلب نقل</button>
          <button type="button" className={transferType === "photo" ? "active" : ""} onClick={() => setTransferType("photo")}>طلب تصوير</button>
        </div>
        <VehiclePicker vehicles={vehicles} selectedIds={selectedIds} onChange={setSelectedIds} maxHeight={280} />
        <div className="ops-form-grid three">
          <label><span>{transferType === "photo" ? "مكان التصوير" : "مكان النقل"} *</span><select required value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر الموقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {transferType === "transfer" ? <label><span>الحالة بعد الاستلام</span><select value={targetStatusCode} onChange={(event) => setTargetStatusCode(event.target.value)}><option value="">الاحتفاظ بالحالة الحالية</option>{meta?.statuses.filter((item) => item.code !== "archived").map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label> : <label><span>تاريخ التصوير *</span><input required type="date" value={photoDate} onChange={(event) => setPhotoDate(event.target.value)} /></label>}
          <label><span>ملاحظات الطلب</span><input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </div>
        <div className="ops-info-note"><CheckCircle size={17} />عدد السيارات المحددة: {selectedIds.length.toLocaleString("ar-SA")}</div>
        <div className="ops-form-actions"><button type="button" className="ops-button secondary" onClick={onClose}>إلغاء</button><button type="submit" className="ops-button primary" disabled={saving || !selectedIds.length || !destinationLocationId}>{saving ? "جاري إنشاء الطلب..." : "إنشاء الطلب"}</button></div>
      </form>
    </OperationsModal>
  );
}
