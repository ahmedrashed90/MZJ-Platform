import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Car, Trash, WarningCircle } from "@phosphor-icons/react";
import { OperationsVehiclePicker } from "../components/OperationsVehiclePicker";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../components/ResizableOperationsTable";
import { operationsFetch, queryString } from "../api";
import type { VehicleRow } from "../types";
import { useOperations } from "../useOperations";

type SelectedVehicle = VehicleRow & {
  note: string;
  stateNote: string;
  shortageNote: string;
  checks: Record<string, { status: string; note: string }>;
};

export function MovementPage() {
  const { meta } = useOperations();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState<SelectedVehicle[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [newStatus, setNewStatus] = useState("available_for_sale");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const statuses = useMemo(() => {
    const byCode = new Map(meta.statuses.map((item) => [item.code, item]));
    return [...byCode.values()];
  }, [meta.statuses]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) { setResults([]); return; }
      try {
        const payload = await operationsFetch<{ rows: VehicleRow[] }>(`/api/operations${queryString({ resource: "vehicles", search, pageSize: 20 })}`);
        setResults(payload.rows.filter((row) => !selected.some((item) => item.id === row.id)));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "تعذر البحث عن السيارات");
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, selected]);

  function add(row: VehicleRow) {
    setSelected((current) => [...current, {
      ...row,
      note: "",
      stateNote: row.state_note || "",
      shortageNote: row.shortage_note || "",
      checks: Object.fromEntries(meta.checkItems.map((item) => [item.code, { status: "unknown", note: "" }])),
    }]);
    setSearch("");
    setResults([]);
  }

  function patch(id: string, values: Partial<SelectedVehicle>) {
    setSelected((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }

  const destination = useMemo(() => meta.locations.find((item) => item.id === destinationLocationId), [meta.locations, destinationLocationId]);
  const statusName = statuses.find((status) => status.code === newStatus)?.name || newStatus;

  const columns = useMemo<ResizableOperationsColumn<SelectedVehicle>[]>(() => {
    const base: ResizableOperationsColumn<SelectedVehicle>[] = [
      { key: "vin", label: "رقم الهيكل", width: 170, min: 125, max: 280, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
      { key: "car", label: "السيارة والبيان", width: 230, min: 150, max: 420, value: (row) => `${row.car_name || ""} ${row.statement || ""}`, render: (row) => <span className="operations-cell-stack"><b>{row.car_name || "—"}</b><small>{row.statement || "لا يوجد بيان"}</small></span> },
      { key: "location", label: "المكان الحالي", width: 135, min: 105, max: 230, value: (row) => row.location_name, render: (row) => row.location_name || "—" },
      { key: "status", label: "الحالة الحالية", width: 155, min: 115, max: 250, value: (row) => row.status_name, render: (row) => <span className={`operations-status status-${row.status_code}`}>{row.status_name || row.status_code}</span> },
      { key: "approvals", label: "الموافقات", width: 145, min: 115, max: 220, value: (row) => `${row.financial_approved} ${row.administrative_approved}`, render: (row) => <span className={row.financial_approved && row.administrative_approved ? "operations-approval-pair complete" : "operations-approval-pair"}><small>{row.financial_approved ? "مالي ✓" : "مالي —"}</small><small>{row.administrative_approved ? "إداري ✓" : "إداري —"}</small></span> },
      { key: "note", label: "ملاحظة السيارة", width: 210, min: 145, max: 420, value: (row) => row.note, render: (row) => <input value={row.note} onChange={(event) => patch(row.id, { note: event.target.value })} placeholder="ملاحظة اختيارية" /> },
      { key: "shortage", label: "حجز - نواقص - تحديد مكان", width: 245, min: 170, max: 480, value: (row) => row.shortageNote, render: (row) => <input value={row.shortageNote} onChange={(event) => patch(row.id, { shortageNote: event.target.value })} placeholder="حجز أو نواقص" /> },
    ];
    if (newStatus === "has_notes") {
      base.push({ key: "stateNote", label: "ملاحظات الحالة", width: 220, min: 160, max: 460, value: (row) => row.stateNote, render: (row) => <input required value={row.stateNote} onChange={(event) => patch(row.id, { stateNote: event.target.value })} placeholder="مطلوبة" /> });
    }
    base.push({ key: "delete", label: "حذف", width: 76, min: 68, max: 100, value: () => "", render: (row) => <button type="button" className="operations-row-delete" onClick={() => setSelected((current) => current.filter((item) => item.id !== row.id))} aria-label={`حذف السيارة ${row.vin}`}><Trash size={17} /></button> });
    return base;
  }, [newStatus]);

  async function submit() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "move_vehicles",
          destinationLocationId,
          newStatus,
          note,
          items: selected.map((item) => ({
            vehicleId: item.id,
            note: item.note,
            stateNote: item.stateNote,
            shortageNote: item.shortageNote,
            checks: item.location_code === "agency" ? Object.entries(item.checks).map(([itemCode, value]: [string, { status: string; note: string }]) => ({ itemCode, status: value.status, note: value.note })) : [],
          })),
        }),
      });
      setMessage(payload.message);
      setSelected([]);
      setDestinationLocationId("");
      setNote("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الحركة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="module-page operations-page operations-movement-page">
      <header className="module-page-head"><div><h1>الحركة</h1><p>تحريك سيارة أو عدة سيارات إلى مكان وحالة جديدين داخل عملية واحدة، مع حفظ سجل مستقل لكل سيارة.</p></div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="operations-alert success">{message}</div> : null}

      <section className="panel operations-movement-panel">
        <div className="operations-movement-controls">
          <OperationsVehiclePicker search={search} results={results} placeholder="ابحث برقم الهيكل أو السيارة أو البيان" onSearchChange={setSearch} onSelect={add} />
          <label className="operations-control-field"><span>المكان الجديد</span><select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر المكان</option>{meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="operations-control-field"><span>الحالة الجديدة</span><select value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>{statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        </div>

        <label className="operations-field operations-general-note"><span>ملاحظات عامة للحركة</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="ملاحظة اختيارية تطبق على الحركة" /></label>

        {!selected.length ? (
          <div className="operations-empty-state"><Car size={42} weight="duotone" /><strong>لم يتم اختيار سيارات</strong><span>ابحث عن السيارة وأضفها، ثم حدد المكان والحالة الجديدة.</span></div>
        ) : (
          <div className="operations-selection-table-wrap">
            <div className="operations-selection-summary"><strong>{selected.length.toLocaleString("ar-SA")} سيارة محددة</strong><span>{destination ? <>المسار الجديد: <b>{destination.name}</b> <ArrowRight size={15} /> <b>{statusName}</b></> : "حدد المكان الجديد لإكمال الحركة"}</span></div>
            <ResizableOperationsTable<SelectedVehicle>
              rows={selected}
              columns={columns}
              rowKey={(row) => row.id}
              storageKey={`mzj.operations.movementSelection.columnWidths.${newStatus === "has_notes" ? "notes" : "default"}.v1`}
              emptyText="لم يتم اختيار سيارات"
              minTableWidth={1350}
              tableClassName="operations-selection-table operations-movement-selection-table"
            />

            {selected.filter((item) => item.location_code === "agency").map((item) => (
              <details key={`checks-${item.id}`} className="operations-agency-checks">
                <summary>تشيك الوكالة للسيارة <b dir="ltr">{item.vin}</b></summary>
                <div className="operations-check-editor">
                  {meta.checkItems.map((check) => {
                    const checkValue = item.checks[check.code] || { status: "unknown", note: "" };
                    return (
                      <article key={check.code} className={`operations-check-edit-card status-${checkValue.status}`}>
                        <header><strong>{check.name}</strong><span>{checkValue.status === "ok" ? "موجود" : checkValue.status === "missing" ? "ناقص" : "غير محدد"}</span></header>
                        <label><span>الحالة</span><select value={checkValue.status} onChange={(event) => patch(item.id, { checks: { ...item.checks, [check.code]: { ...checkValue, status: event.target.value } } })}><option value="unknown">غير محدد</option><option value="ok">موجود</option><option value="missing">ناقص</option></select></label>
                        <label><span>الملاحظة</span><input placeholder="اكتب ملاحظة اختيارية" value={checkValue.note} onChange={(event) => patch(item.id, { checks: { ...item.checks, [check.code]: { ...checkValue, note: event.target.value } } })} /></label>
                      </article>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}

        <button className="operations-primary-button operations-submit-movement" type="button" disabled={saving || !selected.length || !destinationLocationId || !meta.permissions.canMove || (newStatus === "has_notes" && selected.some((item) => !item.stateNote.trim()))} onClick={() => void submit()}>{saving ? "جاري تنفيذ الحركة..." : `تنفيذ الحركة على ${selected.length} سيارة`}</button>
      </section>
    </div>
  );
}
