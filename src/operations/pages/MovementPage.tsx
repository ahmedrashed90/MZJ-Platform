import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Car, CheckCircle, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { OperationsVehiclePicker } from "../components/OperationsVehiclePicker";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../components/ResizableOperationsTable";
import { operationsFetch, queryString } from "../api";
import type { VehicleRow } from "../types";
import { useOperations } from "../useOperations";

const AGENCY_INTERIOR_COLORS = ["احمر", "اسود", "برتقالي", "بني غامق", "بيج", "جملي", "رمادي"] as const;

type SelectedVehicle = VehicleRow & {
  stateNote: string;
  agencyInteriorColor: string;
  checks: Record<string, { status: string; note: string }>;
};

export function MovementPage() {
  const { meta } = useOperations();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState<SelectedVehicle[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [newStatus, setNewStatus] = useState("available_for_sale");
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
      stateNote: row.state_note || "",
      agencyInteriorColor: AGENCY_INTERIOR_COLORS.includes((row.interior_color || "") as (typeof AGENCY_INTERIOR_COLORS)[number]) ? String(row.interior_color) : "",
      checks: Object.fromEntries(meta.checkItems.map((item) => [item.code, { status: "ok", note: "" }])),
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
      { key: "approvals", label: "الموافقة المالية", width: 125, min: 105, max: 185, value: (row) => row.financial_approved, render: (row) => <span className="operations-approval-pair"><small>{row.financial_approved ? "مالي ✓" : "مالي —"}</small></span> },
      { key: "stateNote", label: "ملاحظات", width: 265, min: 185, max: 470, value: (row) => row.stateNote, render: (row) => <input required={newStatus === "has_notes"} value={row.stateNote} onChange={(event) => patch(row.id, { stateNote: event.target.value })} placeholder={newStatus === "has_notes" ? "اكتب الملاحظات" : "ملاحظة اختيارية"} /> },
    ];
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
          items: selected.map((item) => ({
            vehicleId: item.id,
            stateNote: item.stateNote,
            agencyInteriorColor: item.location_code === "agency" ? item.agencyInteriorColor : undefined,
            checks: item.location_code === "agency" ? meta.checkItems.map((check) => {
              const value = item.checks[check.code] || { status: "ok", note: "" };
              return { itemCode: check.code, status: value.status, note: value.note };
            }) : [],
          })),
        }),
      });
      setMessage(payload.message);
      setSelected([]);
      setDestinationLocationId("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الحركة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="module-page operations-page operations-movement-page">
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="operations-alert success">{message}</div> : null}

      <section className="panel operations-movement-panel">
        <div className="operations-movement-controls">
          <div className="operations-movement-search">
            <OperationsVehiclePicker search={search} results={results} placeholder="ابحث برقم الهيكل أو السيارة أو البيان" onSearchChange={setSearch} onSelect={add} />
          </div>
          <div className="operations-movement-targets" aria-label="بيانات الحركة الجديدة">
            <label className="operations-control-field"><span>المكان الجديد</span><select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر المكان</option>{meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="operations-control-field"><span>الحالة الجديدة</span><select value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>{statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          </div>
        </div>


        {!selected.length ? (
          <div className="operations-empty-state"><Car size={42} weight="duotone" /><strong>لم يتم اختيار سيارات</strong><span>ابحث عن السيارة وأضفها، ثم حدد المكان والحالة الجديدة.</span></div>
        ) : (
          <div className="operations-selection-table-wrap">
            <div className="operations-selection-summary"><strong>{selected.length.toLocaleString("ar-SA-u-nu-latn")} سيارة محددة</strong><span>{destination ? <>المسار الجديد: <b>{destination.name}</b> <ArrowRight size={15} /> <b>{statusName}</b></> : "حدد المكان الجديد لإكمال الحركة"}</span></div>
            <ResizableOperationsTable<SelectedVehicle>
              rows={selected}
              columns={columns}
              rowKey={(row) => row.id}
              storageKey="mzj.operations.movementSelection.columnWidths.single-note.v1"
              emptyText="لم يتم اختيار سيارات"
              minTableWidth={1100}
              tableClassName="operations-selection-table operations-movement-selection-table"
            />

            {selected.filter((item) => item.location_code === "agency").map((item) => (
              <details key={`checks-${item.id}`} className="operations-agency-checks">
                <summary>تشيك الوكالة للسيارة <b dir="ltr">{item.vin}</b></summary>
                <label className="operations-agency-interior-color">
                  <span>اللون الداخلي</span>
                  <select value={item.agencyInteriorColor} onChange={(event) => patch(item.id, { agencyInteriorColor: event.target.value })}>
                    <option value="">اختر اللون الداخلي</option>
                    {AGENCY_INTERIOR_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                </label>
                <div className="operations-check-editor">
                  {meta.checkItems.map((check) => {
                    const checkValue = item.checks[check.code] || { status: "ok", note: "" };
                    return (
                      <article key={check.code} className={`operations-check-edit-card status-${checkValue.status}`}>
                        <header>
                          <strong>{check.name}</strong>
                          <span className="operations-check-state">
                            {checkValue.status === "ok" ? <><CheckCircle size={15} weight="fill" />صح</> : checkValue.status === "missing" ? <><XCircle size={15} weight="fill" />غلط</> : "لم يتم التحديد"}
                          </span>
                        </header>
                        <div className="operations-check-binary" role="group" aria-label={`حالة ${check.name}`}>
                          <button
                            type="button"
                            className={`operations-check-binary-option ok${checkValue.status === "ok" ? " active" : ""}`}
                            aria-pressed={checkValue.status === "ok"}
                            onClick={() => patch(item.id, { checks: { ...item.checks, [check.code]: { ...checkValue, status: "ok" } } })}
                          >
                            <span className="operations-check-option-icon" aria-hidden="true"><CheckCircle size={22} weight={checkValue.status === "ok" ? "fill" : "regular"} /></span>
                            <span className="operations-check-option-copy"><b>صح</b><small>الحالة سليمة</small></span>
                          </button>
                          <button
                            type="button"
                            className={`operations-check-binary-option missing${checkValue.status === "missing" ? " active" : ""}`}
                            aria-pressed={checkValue.status === "missing"}
                            onClick={() => patch(item.id, { checks: { ...item.checks, [check.code]: { ...checkValue, status: "missing" } } })}
                          >
                            <span className="operations-check-option-icon" aria-hidden="true"><XCircle size={22} weight={checkValue.status === "missing" ? "fill" : "regular"} /></span>
                            <span className="operations-check-option-copy"><b>غلط</b><small>توجد ملاحظة</small></span>
                          </button>
                        </div>
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
