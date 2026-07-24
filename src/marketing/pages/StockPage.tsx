import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Camera, CheckCircle, MagnifyingGlass, Trash, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { OperationsVehiclePicker } from "../../operations/components/OperationsVehiclePicker";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../../operations/components/ResizableOperationsTable";
import type { VehicleRow } from "../../operations/types";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";
import { marketingDate, marketingFetch } from "../api";
import type { MarketingLocation, StockCar } from "../types";

type PhotoRequestVehicle = {
  vehicleId: string;
  vin: string;
  carName?: string | null;
  statement?: string | null;
  note?: string | null;
};

type PhotoRequestEvent = {
  id: string;
  stage: string;
  action: string;
  note?: string | null;
  actorName?: string | null;
  createdAt: string;
};

type PhotoRequestRow = {
  id: string;
  request_no: string;
  status: string;
  requested_by_name?: string | null;
  requested_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  note?: string | null;
  source_location_name?: string | null;
  destination_location_name?: string | null;
  vehicles: PhotoRequestVehicle[];
  events: PhotoRequestEvent[];
  can_complete?: boolean;
};

type StockPayload = {
  ok: boolean;
  cars: StockCar[];
  requests: PhotoRequestRow[];
  locations: MarketingLocation[];
};

type GroupedCar = StockCar & {
  quantity: number;
  usage: any[];
  locationNames: string[];
};

const requestStageOrder = ["request_received", "vehicle_sent", "vehicle_received", "completed"] as const;
const requestStatusLabels: Record<string, string> = {
  created: "طلب جديد",
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
};

function toVehicleRow(row: GroupedCar): VehicleRow {
  return {
    id: row.id,
    vin: row.vin,
    car_name: row.car_name,
    statement: row.statement,
    exterior_color: row.exterior_color,
    interior_color: row.interior_color,
    model_year: row.model_year,
    location_id: row.location_id,
    location_code: row.location_code,
    location_name: row.location_name,
    branch_code: row.branch_code,
    status_code: row.status_code || "available_for_sale",
    status_name: row.status_name || row.status_code || "—",
    has_notes: false,
    created_at: "",
    updated_at: "",
    version: 1,
    financial_approved: row.financial_approved,
    administrative_approved: row.administrative_approved,
    active_transfer_requests: row.active_transfer_requests,
  };
}

export function StockPage() {
  const [data, setData] = useState<StockPayload | null>(null);
  const [pageTab, setPageTab] = useState<"stock" | "requests">("stock");
  const [requestTab, setRequestTab] = useState<"active" | "completed">("active");
  const [selectedRequest, setSelectedRequest] = useState<PhotoRequestRow | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    car: "",
    statement: "",
    photographed: "",
    inAgenda: "",
    agendaMonth: "",
    contentType: "",
  });
  const [requestOpen, setRequestOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedCars, setSelectedCars] = useState<GroupedCar[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requestNote, setRequestNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [completingRequestId, setCompletingRequestId] = useState("");

  async function load() {
    setError("");
    try {
      const payload = await marketingFetch<StockPayload>("/api/marketing?resource=stock");
      setData(payload);
      setSelectedRequest((current) => current ? payload.requests.find((row) => row.id === current.id) || null : null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الاستوك");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo<GroupedCar[]>(() => {
    const map = new Map<string, GroupedCar>();
    for (const car of data?.cars || []) {
      const key = [car.car_name, car.statement, car.model_year, car.exterior_color, car.interior_color]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|");
      const existing = map.get(key);
      const contentUsage = Array.isArray(car.content_usage) ? car.content_usage : [];
      if (existing) {
        existing.quantity += 1;
        existing.usage.push(...contentUsage);
        existing.photographed = Boolean(existing.photographed || car.photographed);
        if (!existing.photographed_at && car.photographed_at) existing.photographed_at = car.photographed_at;
        if (car.location_name && !existing.locationNames.includes(car.location_name)) existing.locationNames.push(car.location_name);
      } else {
        map.set(key, {
          ...car,
          quantity: 1,
          usage: [...contentUsage],
          locationNames: car.location_name ? [car.location_name] : [],
        });
      }
    }
    return [...map.values()];
  }, [data]);

  const filtered = useMemo(() => grouped.filter((row) => {
    const haystack = [
      row.vin,
      row.car_name,
      row.statement,
      row.model_year,
      row.exterior_color,
      row.interior_color,
      row.usage.map((item) => item?.contentType || item?.creative || "").join(" "),
    ].join(" ").toLowerCase();
    const matchesSearch = !filters.search || haystack.includes(filters.search.toLowerCase());
    const matchesCar = !filters.car || row.car_name === filters.car;
    const matchesStatement = !filters.statement || row.statement === filters.statement;
    const matchesPhoto = !filters.photographed || (filters.photographed === "yes" ? Boolean(row.photographed) : !row.photographed);
    const inAgenda = row.usage.some((item) => item?.sourceType === "agenda" || item?.agendaId);
    const matchesAgenda = !filters.inAgenda || (filters.inAgenda === "yes" ? inAgenda : !inAgenda);
    const matchesMonth = !filters.agendaMonth || row.usage.some((item) => String(item?.month || item?.agendaMonth || "").startsWith(filters.agendaMonth));
    const matchesType = !filters.contentType || row.usage.some((item) => String(item?.contentType || item?.creativeType || "") === filters.contentType);
    return matchesSearch && matchesCar && matchesStatement && matchesPhoto && matchesAgenda && matchesMonth && matchesType;
  }), [grouped, filters]);

  const carNames = useMemo(
    () => [...new Set(grouped.map((item) => item.car_name).filter(Boolean))] as string[],
    [grouped],
  );
  const statements = useMemo(
    () => [...new Set(grouped.map((item) => item.statement).filter(Boolean))] as string[],
    [grouped],
  );
  const contentTypes = useMemo(
    () => [...new Set(grouped.flatMap((item) => item.usage.map((usage) => usage?.contentType || usage?.creativeType)).filter(Boolean))] as string[],
    [grouped],
  );
  const metrics = useMemo(() => ({
    total: grouped.reduce((sum, row) => sum + row.quantity, 0),
    notPhotographed: grouped.filter((row) => !row.photographed).reduce((sum, row) => sum + row.quantity, 0),
    unused: grouped.filter((row) => row.usage.length === 0).reduce((sum, row) => sum + row.quantity, 0),
    requests: data?.requests.filter((row) => row.status !== "completed" && !row.cancelled_at).length || 0,
  }), [grouped, data]);

  const activeRequests = useMemo(
    () => (data?.requests || []).filter((row) => row.status !== "completed" && !row.cancelled_at),
    [data?.requests],
  );
  const completedRequests = useMemo(
    () => (data?.requests || []).filter((row) => row.status === "completed" || Boolean(row.cancelled_at)),
    [data?.requests],
  );
  const visibleRequests = requestTab === "active" ? activeRequests : completedRequests;

  const selectedSourceLocationId = selectedCars[0]?.location_id || "";
  const destination = useMemo(
    () => data?.locations.find((item) => item.id === destinationLocationId),
    [data?.locations, destinationLocationId],
  );

  const pickerRows = useMemo<VehicleRow[]>(() => {
    const term = pickerSearch.trim().toLowerCase();
    if (term.length < 2) return [];
    return grouped
      .filter((row) => {
        if (selectedCars.some((item) => item.id === row.id)) return false;
        if (row.active_transfer_requests) return false;
        if (selectedSourceLocationId && row.location_id !== selectedSourceLocationId) return false;
        return [row.vin, row.car_name, row.statement, row.model_year, row.exterior_color, row.interior_color, row.location_name]
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .slice(0, 20)
      .map(toVehicleRow);
  }, [grouped, pickerSearch, selectedCars, selectedSourceLocationId]);

  const requestColumns = useMemo<ResizableOperationsColumn<GroupedCar>[]>(() => [
    { key: "vin", label: "رقم الهيكل", width: 170, min: 125, max: 280, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
    { key: "car", label: "السيارة", width: 145, min: 105, max: 280, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
    { key: "statement", label: "البيان", width: 220, min: 145, max: 420, value: (row) => row.statement, render: (row) => row.statement || "—" },
    { key: "model", label: "الموديل", width: 95, min: 80, max: 160, value: (row) => row.model_year, render: (row) => row.model_year || "—" },
    { key: "location", label: "المكان الحالي", width: 150, min: 110, max: 250, value: (row) => row.location_name, render: (row) => row.location_name || "—" },
    { key: "note", label: "ملاحظة مستقلة للسيارة", width: 300, min: 200, max: 520, value: (row) => notes[row.id], render: (row) => <input value={notes[row.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="اكتب ملاحظة السيارة" /> },
    { key: "delete", label: "حذف", width: 76, min: 68, max: 100, value: () => "", render: (row) => <button type="button" className="operations-row-delete" onClick={() => setSelectedCars((current) => current.filter((item) => item.id !== row.id))} aria-label={`حذف السيارة ${row.vin}`}><Trash size={17} /></button> },
  ], [notes]);

  function openRequest(row: GroupedCar) {
    setSelectedCars([row]);
    setDestinationLocationId("");
    setNotes({});
    setRequestNote("");
    setPickerSearch("");
    setRequestOpen(true);
  }

  function addRequestCar(vehicle: VehicleRow) {
    const row = grouped.find((item) => item.id === vehicle.id);
    if (!row) return;
    setSelectedCars((current) => [...current, row]);
    setPickerSearch("");
  }

  function resetRequest() {
    setRequestOpen(false);
    setSelectedCars([]);
    setDestinationLocationId("");
    setNotes({});
    setRequestNote("");
    setPickerSearch("");
  }

  function closeRequest() {
    if (!busy) resetRequest();
  }

  async function completePhotoRequest(requestId: string) {
    setBusy(true);
    setCompletingRequestId(requestId);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "complete_photo_request", id: requestId }),
      });
      setMessage(result.message);
      setSelectedRequest(null);
      setRequestTab("completed");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنهاء طلب التصوير");
    } finally {
      setBusy(false);
      setCompletingRequestId("");
    }
  }

  async function createRequest() {
    if (!selectedCars.length || !destinationLocationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "create_photo_request",
          destinationLocationId,
          note: requestNote,
          vehicles: selectedCars.map((row) => ({ vehicleId: row.id, note: notes[row.id] || "" })),
        }),
      });
      setMessage(result.message);
      resetRequest();
      setPageTab("requests");
      setRequestTab("active");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء طلب التصوير");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingPage title="الاستوك" description="مخزون السيارات من سيستم العمليات، استخدام السيارات في المحتوى، وطلبات التصوير.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <div className="operations-subtabs marketing-stock-tabs">
        <button type="button" className={pageTab === "stock" ? "active" : ""} onClick={() => setPageTab("stock")}>الاستوك</button>
        <button type="button" className={pageTab === "requests" ? "active" : ""} onClick={() => setPageTab("requests")}>متابعة طلبات التصوير</button>
      </div>

      {pageTab === "stock" ? (
        <>
          <div className="marketing-metric-grid four">
            <article><strong>{metrics.total}</strong><span>المعروض في الاستوك</span></article>
            <article><strong>{metrics.notPhotographed}</strong><span>لم يتم التصوير</span></article>
            <article><strong>{metrics.unused}</strong><span>غير مستخدمة في أي نوع محتوى</span></article>
            <article><strong>{metrics.requests}</strong><span>طلبات التصوير</span></article>
          </div>

          <section className="marketing-card">
            <div className="marketing-filter-grid stock">
              <label><MagnifyingGlass />البحث<input placeholder="رقم الهيكل أو السيارة أو البيان أو نوع المحتوى" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
              <label>السيارة<select value={filters.car} onChange={(event) => setFilters({ ...filters, car: event.target.value })}><option value="">الكل</option>{carNames.map((name) => <option key={name}>{name}</option>)}</select></label>
              <label>البيان<select value={filters.statement} onChange={(event) => setFilters({ ...filters, statement: event.target.value })}><option value="">الكل</option>{statements.map((name) => <option key={name}>{name}</option>)}</select></label>
              <label>تم التصوير<select value={filters.photographed} onChange={(event) => setFilters({ ...filters, photographed: event.target.value })}><option value="">الكل</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
              <label>داخل الأجندة<select value={filters.inAgenda} onChange={(event) => setFilters({ ...filters, inAgenda: event.target.value })}><option value="">الكل</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
              <label>شهر الأجندة<input type="month" value={filters.agendaMonth} onChange={(event) => setFilters({ ...filters, agendaMonth: event.target.value })} /></label>
              <label>نوع المحتوى<select value={filters.contentType} onChange={(event) => setFilters({ ...filters, contentType: event.target.value })}><option value="">الكل</option>{contentTypes.map((name) => <option key={name}>{name}</option>)}</select></label>
            </div>
          </section>

          <section className="marketing-card">
            <div className="marketing-table-wrap">
              <table>
                <thead><tr><th>رقم الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>الموديل</th><th>اللون الخارجي</th><th>اللون الداخلي</th><th>المكان</th><th>العدد</th><th>تم التصوير</th><th>حالة الاستخدام</th></tr></thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td><button type="button" className="marketing-vin-button" onClick={() => openRequest(row)}>{row.vin}</button></td>
                      <td>{row.car_name || "—"}</td>
                      <td>{row.statement || "—"}</td>
                      <td>{row.model_year || "—"}</td>
                      <td>{row.exterior_color || "—"}</td>
                      <td>{row.interior_color || "—"}</td>
                      <td>{row.locationNames.join("، ") || "—"}</td>
                      <td>{row.quantity}</td>
                      <td><span className={row.photographed ? "marketing-status success" : "marketing-status warning"}>{row.photographed ? "تم التصوير" : "لم يتم التصوير"}</span></td>
                      <td>{row.usage.length ? <div className="usage-tags">{row.usage.slice(0, 4).map((item, index) => <span key={index}>{item?.creativeName || item?.contentType || item?.sourceName || "مستخدم"}</span>)}</div> : "غير مستخدمة"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="operations-subtabs marketing-photo-followup-tabs">
            <button type="button" className={requestTab === "active" ? "active" : ""} onClick={() => setRequestTab("active")}>متابعة الطلبات</button>
            <button type="button" className={requestTab === "completed" ? "active" : ""} onClick={() => setRequestTab("completed")}>الطلبات المكتملة</button>
          </div>

          <section className="marketing-card">
            <div className="marketing-table-wrap">
              <table>
                <thead><tr><th>رقم الطلب</th><th>الحالة</th><th>المكان المصدر</th><th>المكان المستهدف</th><th>المنشئ</th><th>تاريخ الإنشاء</th><th>السيارات</th><th>الإجراء</th></tr></thead>
                <tbody>
                  {visibleRequests.length ? visibleRequests.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.request_no}</strong></td>
                      <td><span className={`marketing-status ${row.status === "completed" ? "success" : "warning"}`}>{row.cancelled_at ? "ملغي" : requestStatusLabels[row.status] || row.status}</span></td>
                      <td>{row.source_location_name || "—"}</td>
                      <td>{row.destination_location_name || "—"}</td>
                      <td>{row.requested_by_name || "—"}</td>
                      <td>{marketingDate(row.requested_at, true)}</td>
                      <td>{row.vehicles.length.toLocaleString("ar-SA")}</td>
                      <td><button type="button" className="secondary marketing-request-action-button" onClick={() => setSelectedRequest(row)}>عرض ومتابعة</button></td>
                    </tr>
                  )) : <tr><td colSpan={8}>لا توجد طلبات في هذا التبويب.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Modal
        open={Boolean(selectedRequest)}
        title={selectedRequest ? `متابعة طلب التصوير — ${selectedRequest.request_no}` : "متابعة طلب التصوير"}
        subtitle={selectedRequest ? `${selectedRequest.requested_by_name || "—"} · ${marketingDate(selectedRequest.requested_at, true)}` : undefined}
        onClose={() => setSelectedRequest(null)}
        className="operations-request-detail-modal marketing-photo-followup-modal"
      >
        {selectedRequest ? (
          <div className="operations-transfer-detail">
            <div className="operations-request-summary-grid">
              <div><small>الحالة الحالية</small><strong>{selectedRequest.cancelled_at ? "ملغي" : requestStatusLabels[selectedRequest.status] || selectedRequest.status}</strong></div>
              <div><small>المكان المصدر</small><strong>{selectedRequest.source_location_name || "—"}</strong></div>
              <div><small>المكان المستهدف</small><strong>{selectedRequest.destination_location_name || "—"}</strong></div>
              <div><small>المنشئ</small><strong>{selectedRequest.requested_by_name || "—"}</strong></div>
            </div>

            <div className="operations-request-route">
              <span>{selectedRequest.source_location_name || "—"}</span>
              <ArrowRight size={24} />
              <span>{selectedRequest.destination_location_name || "—"}</span>
            </div>

            <div className="operations-transfer-stage-timeline">
              {requestStageOrder.map((stage, index) => {
                const currentIndex = requestStageOrder.indexOf(selectedRequest.status as typeof requestStageOrder[number]);
                const done = selectedRequest.status === "completed" || (currentIndex >= 0 && index <= currentIndex);
                const event = selectedRequest.events.find((item) => item.stage === stage && ["advanced", "stage_completed"].includes(item.action));
                return (
                  <article key={stage} className={done ? "done" : ""}>
                    <span>{done ? <CheckCircle size={21} weight="fill" /> : index + 1}</span>
                    <div>
                      <strong>{requestStatusLabels[stage]}</strong>
                      <small>{event ? `${event.actorName || "مستخدم المنصة"} · ${marketingDate(event.createdAt, true)}` : done ? "تم التنفيذ" : "لم تنفذ بعد"}</small>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="marketing-table-wrap">
              <table>
                <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th><th>ملاحظة السيارة</th></tr></thead>
                <tbody>{selectedRequest.vehicles.map((vehicle) => <tr key={vehicle.vehicleId}><td dir="ltr">{vehicle.vin}</td><td>{vehicle.carName || "—"}</td><td>{vehicle.statement || "—"}</td><td>{vehicle.note || "—"}</td></tr>)}</tbody>
              </table>
            </div>

            {selectedRequest.note ? <div className="operations-request-note"><small>ملاحظات الطلب</small><p>{selectedRequest.note}</p></div> : null}

            {selectedRequest.can_complete ? (
              <div className="operations-detail-actions">
                <button type="button" className="primary" disabled={busy} onClick={() => void completePhotoRequest(selectedRequest.id)}>
                  <CheckCircle size={18} />{completingRequestId === selectedRequest.id ? "جاري التنفيذ..." : "تم الانتهاء"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={requestOpen}
        title="إنشاء طلب تصوير"
        subtitle={selectedCars.length ? `${selectedCars.length.toLocaleString("ar-SA")} سيارة داخل الطلب` : undefined}
        onClose={closeRequest}
        className="operations-request-detail-modal marketing-photo-request-modal"
        footer={(
          <>
            <button type="button" className="secondary" disabled={busy} onClick={closeRequest}>إلغاء</button>
            <button type="button" className="primary" disabled={busy || !selectedCars.length || !destinationLocationId || selectedCars.some((row) => Boolean(row.active_transfer_requests))} onClick={() => void createRequest()}>
              <Camera size={18} />{busy ? "جاري الإنشاء..." : "إنشاء طلب التصوير"}
            </button>
          </>
        )}
      >
        <div className="operations-transfer-create marketing-photo-request-create">
          <div className="operations-transfer-controls">
            <OperationsVehiclePicker
              search={pickerSearch}
              results={pickerRows}
              placeholder="ابحث برقم الهيكل أو السيارة أو البيان أو الموديل أو اللون أو المكان"
              onSearchChange={setPickerSearch}
              onSelect={addRequestCar}
            />
            <label className="operations-control-field">
              <span>المكان المستهدف</span>
              <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}>
                <option value="">اختر المكان</option>
                {(data?.locations || []).filter((item) => item.id !== selectedSourceLocationId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>

          {!selectedCars.length ? (
            <div className="operations-empty-state"><Camera size={42} weight="duotone" /><strong>لم يتم اختيار سيارات</strong></div>
          ) : (
            <div className="operations-selection-table-wrap">
              <div className="operations-selection-summary">
                <strong>{selectedCars.length.toLocaleString("ar-SA")} سيارة داخل الطلب</strong>
                <span>{destination ? <>المكان المستهدف: <b>{destination.name}</b></> : "حدد المكان المستهدف"}</span>
              </div>
              <ResizableOperationsTable<GroupedCar>
                rows={selectedCars}
                columns={requestColumns}
                rowKey={(row) => row.id}
                storageKey="mzj.marketing.photoRequest.columnWidths.v1"
                emptyText="لم يتم اختيار سيارات"
                minTableWidth={1200}
                tableClassName="operations-selection-table marketing-photo-request-table"
              />
            </div>
          )}

          <label className="operations-field operations-transfer-note">
            <span>ملاحظات الطلب</span>
            <textarea rows={3} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="ملاحظة اختيارية على طلب التصوير" />
          </label>

          {selectedCars.some((row) => row.active_transfer_requests) ? (
            <div className="operations-alert error"><WarningCircle size={18} />إحدى السيارات مرتبطة بطلب نشط.</div>
          ) : null}
        </div>
      </Modal>
    </MarketingPage>
  );
}
