import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Camera, CheckCircle, Trash, Truck, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { OperationsVehiclePicker } from "../components/OperationsVehiclePicker";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../components/ResizableOperationsTable";
import { formatOperationsDate, operationsFetch, queryString } from "../api";
import type { TransferRow, VehicleRow } from "../types";
import { useOperations } from "../useOperations";

const stageOrder = ["request_received", "vehicle_sent", "vehicle_received", "completed"] as const;
const stageLabels: Record<string, string> = {
  created: "طلب جديد",
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
};

const requestKindLabels: Record<string, string> = {
  transfer: "طلب نقل",
  photography: "طلب تصوير",
};

type TransferVehicle = TransferRow["vehicles"][number];

function RequestIcon({ kind, size = 23 }: { kind: string; size?: number }) {
  return kind === "photography" ? <Camera size={size} /> : <Truck size={size} />;
}

export function TransferRequestsPage() {
  const { meta } = useOperations();
  const [tab, setTab] = useState<"create" | "active" | "completed">("create");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selectedCars, setSelectedCars] = useState<VehicleRow[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [selected, setSelected] = useState<TransferRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<"cancel" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const destination = useMemo(
    () => meta.locations.find((item) => item.id === destinationLocationId),
    [destinationLocationId, meta.locations],
  );

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const payload = await operationsFetch<{ rows: VehicleRow[] }>(
          `/api/operations${queryString({ resource: "vehicles", search, pageSize: 20 })}`,
        );
        setResults(
          payload.rows.filter(
            (row) => !selectedCars.some((item) => item.id === row.id) && !row.active_transfer_requests,
          ),
        );
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "تعذر البحث");
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, selectedCars]);

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ rows: TransferRow[] }>(
        `/api/operations${queryString({ resource: "transfers", kind: "all", completed: tab === "completed", pageSize: 200 })}`,
      );
      setRows(payload.rows);
      setSelected((current) => current ? payload.rows.find((row) => row.id === current.id) || null : null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "create") void loadRows();
  }, [tab]);

  function addCar(row: VehicleRow) {
    setSelectedCars((current) => [...current, row]);
    setSearch("");
    setResults([]);
  }

  const createColumns = useMemo<ResizableOperationsColumn<VehicleRow>[]>(() => [
    { key: "vin", label: "رقم الهيكل", width: 170, min: 125, max: 280, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
    { key: "car", label: "السيارة", width: 145, min: 105, max: 280, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
    { key: "statement", label: "البيان", width: 220, min: 145, max: 420, value: (row) => row.statement, render: (row) => row.statement || "—" },
    { key: "model", label: "الموديل", width: 95, min: 80, max: 160, value: (row) => row.model_year, render: (row) => row.model_year || "—" },
    { key: "interior", label: "اللون الداخلي", width: 125, min: 95, max: 210, value: (row) => row.interior_color, render: (row) => row.interior_color || "—" },
    { key: "exterior", label: "اللون الخارجي", width: 125, min: 95, max: 210, value: (row) => row.exterior_color, render: (row) => row.exterior_color || "—" },
    { key: "location", label: "المكان الحالي", width: 135, min: 105, max: 230, value: (row) => row.location_name, render: (row) => row.location_name || "—" },
    { key: "status", label: "الحالة", width: 155, min: 115, max: 250, value: (row) => row.status_name, render: (row) => <span className={`operations-status status-${row.status_code}`}>{row.status_name || row.status_code}</span> },
    { key: "approvals", label: "الموافقات", width: 145, min: 115, max: 220, value: (row) => `${row.financial_approved} ${row.administrative_approved}`, render: (row) => <span className={row.financial_approved && row.administrative_approved ? "operations-approval-pair complete" : "operations-approval-pair"}><small>{row.financial_approved ? "مالي ✓" : "مالي —"}</small><small>{row.administrative_approved ? "إداري ✓" : "إداري —"}</small></span> },
    { key: "delete", label: "حذف", width: 76, min: 68, max: 100, value: () => "", render: (row) => <button type="button" className="operations-row-delete" onClick={() => setSelectedCars((current) => current.filter((item) => item.id !== row.id))} aria-label={`حذف السيارة ${row.vin}`}><Trash size={17} /></button> },
  ], []);

  const detailColumns = useMemo<ResizableOperationsColumn<TransferVehicle>[]>(() => [
    { key: "vin", label: "رقم الهيكل", width: 170, min: 125, max: 280, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
    { key: "car", label: "السيارة", width: 145, min: 105, max: 280, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
    { key: "statement", label: "البيان", width: 220, min: 145, max: 420, value: (row) => row.statement, render: (row) => row.statement || "—" },
    { key: "model", label: "الموديل", width: 95, min: 80, max: 160, value: (row) => row.model_year, render: (row) => row.model_year || "—" },
    { key: "interior", label: "اللون الداخلي", width: 125, min: 95, max: 210, value: (row) => row.interior_color, render: (row) => row.interior_color || "—" },
    { key: "exterior", label: "اللون الخارجي", width: 125, min: 95, max: 210, value: (row) => row.exterior_color, render: (row) => row.exterior_color || "—" },
    { key: "location", label: "المكان الحالي", width: 150, min: 110, max: 250, value: (row) => row.current_location_name, render: (row) => row.current_location_name || selected?.source_location_name || "—" },
    { key: "status", label: "الحالة الحالية", width: 160, min: 120, max: 260, value: (row) => row.current_status_name || row.source_status, render: (row) => row.current_status_name || row.source_status || "—" },
    { key: "note", label: "ملاحظة السيارة", width: 230, min: 150, max: 420, value: (row) => row.item_note, render: (row) => row.item_note || "—" },
  ], [selected?.source_location_name]);

  async function create() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "create_transfer",
          vehicleIds: selectedCars.map((item) => item.id),
          destinationLocationId,
          note,
        }),
      });
      setMessage(payload.message);
      setSelectedCars([]);
      setDestinationLocationId("");
      setNote("");
      setTab("active");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء الطلب");
    } finally {
      setLoading(false);
    }
  }

  async function stageAction(row: TransferRow) {
    if (!row.next_status || !row.can_advance) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "transfer_action",
          id: row.id,
          transferAction: "advance",
          nextStatus: row.next_status,
        }),
      });
      setMessage(payload.message);
      setSelected(null);
      await loadRows();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث الطلب");
    } finally {
      setLoading(false);
    }
  }

  async function destructiveAction() {
    if (!selected || !confirmAction) return;
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "transfer_action",
          id: selected.id,
          transferAction: confirmAction,
          reason,
        }),
      });
      setMessage(payload.message);
      setConfirmAction(null);
      setSelected(null);
      setReason("");
      await loadRows();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="module-page operations-page operations-transfer-page">
      <header className="module-page-head">
        <div>
          <h1>الطلبات</h1>
          <p>إنشاء طلبات النقل ومتابعة طلبات النقل والتصوير خلال المراحل الأربع بين المكان المصدر والمكان المستهدف.</p>
        </div>
      </header>

      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="operations-alert success">{message}</div> : null}

      <div className="operations-subtabs">
        <button type="button" className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>إنشاء طلب</button>
        <button type="button" className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>متابعة الطلبات</button>
        <button type="button" className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>الطلبات المكتملة</button>
      </div>

      {tab === "create" ? (
        <section className="panel operations-transfer-create">
          <div className="operations-transfer-controls">
            <OperationsVehiclePicker
              search={search}
              results={results}
              placeholder="ابحث برقم الهيكل أو السيارة أو البيان"
              onSearchChange={setSearch}
              onSelect={addCar}
            />
            <label className="operations-control-field">
              <span>المكان المستهدف</span>
              <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}>
                <option value="">اختر المكان</option>
                {meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>

          {!selectedCars.length ? (
            <div className="operations-empty-state">
              <Truck size={42} weight="duotone" />
              <strong>لم يتم اختيار سيارات</strong>
              <span>السيارات المرتبطة بطلب نشط لن تظهر ضمن نتائج البحث.</span>
            </div>
          ) : (
            <div className="operations-selection-table-wrap">
              <div className="operations-selection-summary">
                <strong>{selectedCars.length.toLocaleString("ar-SA")} سيارة داخل الطلب</strong>
                <span>{destination ? <>المكان المستهدف: <b>{destination.name}</b></> : "حدد المكان المستهدف"}</span>
              </div>
              <ResizableOperationsTable<VehicleRow>
                rows={selectedCars}
                columns={createColumns}
                rowKey={(row) => row.id}
                storageKey="mzj.operations.transferCreate.columnWidths.v2"
                emptyText="لم يتم اختيار سيارات"
                minTableWidth={1450}
                tableClassName="operations-selection-table operations-transfer-selection-table"
              />
            </div>
          )}

          <label className="operations-field operations-transfer-note">
            <span>ملاحظات الطلب</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة اختيارية على طلب النقل" />
          </label>
          <button
            className="operations-primary-button"
            type="button"
            disabled={loading || !selectedCars.length || !destinationLocationId || !meta.permissions.canCreateTransfer}
            onClick={() => void create()}
          >
            {loading ? "جاري الإنشاء..." : "إنشاء طلب النقل"}
          </button>
        </section>
      ) : (
        <section className="panel operations-requests-panel">
          <div className="operations-requests-list">
            {!loading && !rows.length ? (
              <div className="operations-empty-state"><Truck size={42} /><strong>لا توجد طلبات</strong></div>
            ) : rows.map((row) => (
              <article key={row.id} onClick={() => setSelected(row)}>
                <div className="operations-request-icon"><RequestIcon kind={row.request_kind} /></div>
                <div className="operations-request-copy">
                  <b>{row.request_no} · {requestKindLabels[row.request_kind] || row.request_kind}</b>
                  <span>{row.source_location_name || "—"} <ArrowRight size={14} /> {row.destination_location_name || "—"}</span>
                  <small>{row.requested_by_name || "—"} · {formatOperationsDate(row.requested_at)}</small>
                </div>
                <span className={`operations-status status-${row.status}`}>{row.cancelled_at ? "ملغي" : stageLabels[row.status] || row.status}</span>
                <strong>{row.vehicles_count}</strong>
              </article>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={Boolean(selected)}
        title={selected ? `تفاصيل الطلب — ${selected.request_no}` : "تفاصيل الطلب"}
        subtitle={selected ? `${selected.requested_by_name || "—"} · ${formatOperationsDate(selected.requested_at)}` : undefined}
        onClose={() => setSelected(null)}
        className="operations-request-detail-modal"
      >
        {selected ? (
          <div className="operations-transfer-detail">
            <div className="operations-request-summary-grid">
              <div><small>نوع الطلب</small><strong>{requestKindLabels[selected.request_kind] || selected.request_kind}</strong></div>
              <div><small>المكان المصدر</small><strong>{selected.source_location_name || "—"}</strong></div>
              <div><small>المكان المستهدف</small><strong>{selected.destination_location_name || "—"}</strong></div>
              <div><small>الحالة الحالية</small><strong>{selected.cancelled_at ? "ملغي" : stageLabels[selected.status] || selected.status}</strong></div>
              <div><small>المنشئ</small><strong>{selected.requested_by_name || "—"}</strong></div>
              <div><small>تاريخ الإنشاء</small><strong>{formatOperationsDate(selected.requested_at)}</strong></div>
            </div>

            <div className="operations-request-route">
              <span>{selected.source_location_name || "—"}</span>
              <ArrowRight size={24} />
              <span>{selected.destination_location_name || "—"}</span>
            </div>

            <div className="operations-transfer-stage-timeline">
              {stageOrder.map((stage, index) => {
                const currentIndex = stageOrder.indexOf(selected.status as typeof stageOrder[number]);
                const done = selected.status === "completed" || (currentIndex >= 0 && index <= currentIndex);
                const event = selected.events?.find((item) => item.stage === stage && ["advanced", "stage_completed"].includes(item.action));
                return (
                  <article key={stage} className={done ? "done" : ""}>
                    <span>{done ? <CheckCircle size={21} weight="fill" /> : index + 1}</span>
                    <div>
                      <strong>{stageLabels[stage]}</strong>
                      <small>{event ? `${event.actor_name || "مستخدم المنصة"} · ${formatOperationsDate(event.created_at)}` : done ? "تم التنفيذ — تفاصيل التنفيذ غير مسجلة" : "لم تنفذ بعد"}</small>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="operations-request-vehicles-table-wrap">
              <h3>سيارات الطلب <span>{selected.vehicles.length.toLocaleString("ar-SA")}</span></h3>
              <ResizableOperationsTable<TransferVehicle>
                rows={selected.vehicles}
                columns={detailColumns}
                rowKey={(row) => row.vehicle_id}
                storageKey="mzj.operations.requestDetails.columnWidths.v2"
                emptyText="لا توجد سيارات داخل الطلب"
                minTableWidth={1320}
                tableClassName="operations-selection-table operations-request-details-table"
              />
            </div>

            {selected.note ? <div className="operations-request-note"><small>ملاحظات الطلب</small><p>{selected.note}</p></div> : null}

            <div className="operations-detail-actions">
              {!selected.cancelled_at && selected.next_status && selected.can_advance ? (
                <button type="button" className="primary" onClick={() => void stageAction(selected)} disabled={loading}>
                  <CheckCircle size={17} />{stageLabels[selected.next_status]}
                </button>
              ) : null}
              {selected.can_delete ? (
                <button type="button" className="danger" onClick={() => setConfirmAction("delete")}>
                  <Trash size={17} />حذف قبل التنفيذ
                </button>
              ) : null}
              {selected.can_cancel ? <button type="button" onClick={() => setConfirmAction("cancel")}>إلغاء الطلب</button> : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmAction)}
        title={confirmAction === "delete" ? "حذف الطلب" : "إلغاء الطلب"}
        onClose={() => setConfirmAction(null)}
        level={1}
        className="operations-confirm-modal"
        footer={(
          <>
            <button type="button" className="secondary" onClick={() => setConfirmAction(null)}>رجوع</button>
            <button type="button" className="danger" disabled={loading || (confirmAction === "cancel" && !reason.trim())} onClick={() => void destructiveAction()}>{loading ? "جاري التنفيذ..." : "تأكيد"}</button>
          </>
        )}
      >
        <div className="operations-confirm-warning danger">
          <WarningCircle size={24} />
          <p>{confirmAction === "delete" ? "يتم الحذف فقط قبل تنفيذ أي مرحلة، مع بقاء الحدث في سجل التدقيق." : "سيتم إيقاف المراحل الجديدة مع الحفاظ على كل الإجراءات السابقة."}</p>
        </div>
        <label className="operations-field">
          <span>السبب {confirmAction === "cancel" ? "— مطلوب" : ""}</span>
          <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
