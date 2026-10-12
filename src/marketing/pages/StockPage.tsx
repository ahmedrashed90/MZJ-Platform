import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarBlank, Camera, CaretDown, CheckCircle, MagnifyingGlass, Trash, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { OperationsVehiclePicker } from "../../operations/components/OperationsVehiclePicker";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../../operations/components/ResizableOperationsTable";
import type { VehicleRow } from "../../operations/types";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";
import { marketingDate, marketingFetch } from "../api";
import type { MarketingLocation, StockCar } from "../types";
import { collectLinkedActiveRequests, searchLinkedActiveRequests, type LinkedActiveRequest } from "../linkedStockRequests";

type PhotoRequestVehicle = {
  vehicleId: string;
  vin: string;
  carName?: string | null;
  statement?: string | null;
  sourceLocationName?: string | null;
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
  photography_date?: string | null;
  note?: string | null;
  source_location_name?: string | null;
  destination_location_name?: string | null;
  vehicles: PhotoRequestVehicle[];
  events: PhotoRequestEvent[];
  can_complete?: boolean;
  can_delete?: boolean;
};

type StockPayload = {
  ok: boolean;
  cars: StockCar[];
  requests: PhotoRequestRow[];
  locations: MarketingLocation[];
  canViewOperationsTransfers?: boolean;
};

type StockVehicleRow = StockCar & {
  usage: any[];
};

type StockSummaryRow = {
  key: string;
  carName: string;
  statement: string;
  exteriorColor: string;
  interiorColor: string;
  modelYear: string;
  quantity: number;
};

function blockingRequestDescription(row: StockVehicleRow) {
  const blockers = row.active_request_details || [];
  return blockers.length
    ? blockers.map((request) => `${request.requestKind === "photography" ? "طلب تصوير" : "طلب نقل"} ${request.requestNo || "غير مرقم"} (${requestStatusLabels[request.status] || request.status})`).join("، ")
    : "طلب نشط غير ظاهر في متابعة التصوير";
}

const requestStageOrder = ["request_received", "vehicle_sent", "vehicle_received", "completed"] as const;
const requestStatusLabels: Record<string, string> = {
  created: "طلب جديد",
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
};

function formatPhotographyDate(value: string | null | undefined) {
  const normalized = String(value || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function toVehicleRow(row: StockVehicleRow): VehicleRow {
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
  const [pageTab, setPageTab] = useState<"stock" | "all" | "requests">("stock");
  const [requestTab, setRequestTab] = useState<"active" | "completed" | "linked">("active");
  const [selectedRequest, setSelectedRequest] = useState<PhotoRequestRow | null>(null);
  const [selectedLinkedRequest, setSelectedLinkedRequest] = useState<LinkedActiveRequest | null>(null);
  const [linkedRequestSearch, setLinkedRequestSearch] = useState("");
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
  const [selectedCars, setSelectedCars] = useState<StockVehicleRow[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [photographyDate, setPhotographyDate] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requestNote, setRequestNote] = useState("");
  const [vinBatch, setVinBatch] = useState("");
  const [requestError, setRequestError] = useState("");
  const [followupError, setFollowupError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [completingRequestId, setCompletingRequestId] = useState("");
  const [deletingRequestId, setDeletingRequestId] = useState("");
  const [markingStockId, setMarkingStockId] = useState("");
  const [refreshingRequestLocks, setRefreshingRequestLocks] = useState(false);
  const photographyDateInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setError("");
    try {
      const payload = await marketingFetch<StockPayload>("/api/marketing?resource=stock");
      setData(payload);
      setSelectedRequest((current) => current ? payload.requests.find((row) => row.id === current.id) || null : null);
      // Requests can be completed by other users while the creation dialog stays open.
      const freshById = new Map<string, StockCar>(payload.cars.map((row) => [row.id, row]));
      setSelectedCars((current) => current.map((row) => {
        const fresh = freshById.get(row.id);
        return fresh ? { ...fresh, usage: Array.isArray(fresh.content_usage) ? [...fresh.content_usage] : [] } : row;
      }));
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : "تعذر تحميل الاستوك";
      if (requestOpen) setRequestError(text);
      else setError(text);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const stockRows = useMemo<StockVehicleRow[]>(() => {
    return (data?.cars || []).map((car) => ({
      ...car,
      usage: Array.isArray(car.content_usage) ? [...car.content_usage] : [],
    }));
  }, [data]);

  const filtered = useMemo(() => stockRows.filter((row) => {
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
  }), [stockRows, filters]);

  const allCarsRows = useMemo<StockSummaryRow[]>(() => {
    const groups = new Map<string, StockSummaryRow>();
    for (const row of stockRows) {
      const carName = String(row.car_name || "");
      const statement = String(row.statement || "");
      const exteriorColor = String(row.exterior_color || "");
      const interiorColor = String(row.interior_color || "");
      const modelYear = String(row.model_year || "");
      const key = JSON.stringify([carName, statement, exteriorColor, interiorColor, modelYear]);
      const current = groups.get(key);
      if (current) current.quantity += 1;
      else groups.set(key, { key, carName, statement, exteriorColor, interiorColor, modelYear, quantity: 1 });
    }
    return [...groups.values()].sort((left, right) =>
      [left.carName, left.statement, left.exteriorColor, left.interiorColor, left.modelYear].join(" ").localeCompare(
        [right.carName, right.statement, right.exteriorColor, right.interiorColor, right.modelYear].join(" "),
        "ar",
      ),
    );
  }, [stockRows]);

  const carNames = useMemo(
    () => [...new Set(stockRows.map((item) => item.car_name).filter(Boolean))] as string[],
    [stockRows],
  );
  const statements = useMemo(
    () => [...new Set(stockRows.map((item) => item.statement).filter(Boolean))] as string[],
    [stockRows],
  );
  const contentTypes = useMemo(
    () => [...new Set(stockRows.flatMap((item) => item.usage.map((usage) => usage?.contentType || usage?.creativeType)).filter(Boolean))] as string[],
    [stockRows],
  );
  const metrics = useMemo(() => ({
    total: stockRows.length,
    notPhotographed: stockRows.filter((row) => !row.photographed).length,
    unused: stockRows.filter((row) => row.usage.length === 0).length,
    requests: data?.requests.filter((row) => row.status !== "completed" && !row.cancelled_at).length || 0,
  }), [stockRows, data]);

  const activeRequests = useMemo(
    () => (data?.requests || []).filter((row) => row.status !== "completed" && !row.cancelled_at),
    [data?.requests],
  );
  const completedRequests = useMemo(
    () => (data?.requests || []).filter((row) => row.status === "completed" || Boolean(row.cancelled_at)),
    [data?.requests],
  );
  const visibleRequests = requestTab === "active" ? activeRequests : completedRequests;
  // Show read-only active blockers in stock, including transport requests not listed
  // in the photo-only follow-up tab. No changes to request permissions or lifecycle.
  const linkedActiveRequests = useMemo(() => collectLinkedActiveRequests(stockRows), [stockRows]);
  const visibleLinkedRequests = useMemo(
    () => searchLinkedActiveRequests(linkedActiveRequests, linkedRequestSearch),
    [linkedActiveRequests, linkedRequestSearch],
  );
  const blockedSelectedCars = selectedCars.filter((row) => Number(row.active_transfer_requests || 0) > 0);

  function viewLinkedRequest(requestNo = "") {
    // Close the creation dialog before switching the underlying tab, so errors
    // never appear behind overlapping modals.
    resetRequest();
    setLinkedRequestSearch(requestNo);
    setSelectedLinkedRequest(null);
    setRequestTab("linked");
    setPageTab("requests");
  }

  const destination = useMemo(
    () => data?.locations.find((item) => item.id === destinationLocationId),
    [data?.locations, destinationLocationId],
  );

  const pickerRows = useMemo<VehicleRow[]>(() => {
    const term = pickerSearch.trim().toLowerCase();
    if (term.length < 2) return [];

    const compactTerm = term.replace(/\s+/g, "");
    const matchRank = (row: StockVehicleRow) => {
      const vin = String(row.vin || "").trim().toLowerCase();
      const compactVin = vin.replace(/\s+/g, "");
      if (compactVin === compactTerm) return 0;
      if (compactVin.startsWith(compactTerm)) return 1;
      if (compactVin.includes(compactTerm)) return 2;
      return 3;
    };

    return stockRows
      .filter((row) => {
        const searchable = [
          row.vin,
          row.car_name,
          row.statement,
          row.model_year,
          row.exterior_color,
          row.interior_color,
          row.location_name,
        ].join(" ").toLowerCase();
        const compactVin = String(row.vin || "").toLowerCase().replace(/\s+/g, "");
        return searchable.includes(term) || compactVin.includes(compactTerm);
      })
      .sort((left, right) => matchRank(left) - matchRank(right) || String(left.vin || "").localeCompare(String(right.vin || ""), "en"))
      .map(toVehicleRow);
  }, [stockRows, pickerSearch]);

  const requestColumns = useMemo<ResizableOperationsColumn<StockVehicleRow>[]>(() => [
    { key: "vin", label: "رقم الهيكل", width: 170, min: 125, max: 280, value: (row) => row.vin, render: (row) => <strong dir="ltr">{row.vin}</strong> },
    { key: "car", label: "السيارة", width: 145, min: 105, max: 280, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
    { key: "statement", label: "البيان", width: 220, min: 145, max: 420, value: (row) => row.statement, render: (row) => row.statement || "—" },
    { key: "model", label: "الموديل", width: 95, min: 80, max: 160, value: (row) => row.model_year, render: (row) => row.model_year || "—" },
    { key: "location", label: "المكان الحالي", width: 150, min: 110, max: 250, value: (row) => row.location_name, render: (row) => row.location_name || "—" },
    { key: "note", label: "ملاحظة مستقلة للسيارة", width: 300, min: 200, max: 520, value: (row) => notes[row.id], render: (row) => <input value={notes[row.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="اكتب ملاحظة السيارة" /> },
    { key: "delete", label: "حذف", width: 76, min: 68, max: 100, value: () => "", render: (row) => <button type="button" className="operations-row-delete" onClick={() => setSelectedCars((current) => current.filter((item) => item.id !== row.id))} aria-label={`حذف السيارة ${row.vin}`}><Trash size={17} /></button> },
  ], [notes]);

  function openRequest(row: StockVehicleRow) {
    setError("");
    setSelectedCars([row]);
    setDestinationLocationId("");
    setPhotographyDate("");
    setNotes({});
    setRequestNote("");
    setPickerSearch("");
    setVinBatch("");
    setRequestError("");
    setRequestOpen(true);
  }

  function addRequestCar(vehicle: VehicleRow) {
    const row = stockRows.find((item) => item.id === vehicle.id);
    if (!row) return;

    if (selectedCars.some((item) => item.id === row.id)) {
      setRequestError(`السيارة ${row.vin} مضافة بالفعل إلى طلب التصوير`);
      return;
    }
    if (row.active_transfer_requests) {
      setRequestError(`السيارة ${row.vin} مرتبطة بـ${blockingRequestDescription(row)}. راجع الطلب في النظام المختص أولًا.`);
      return;
    }
    setRequestError("");
    setSelectedCars((current) => [...current, row]);
    setPickerSearch("");
  }

  function addCarsByVin() {
    const values = [...new Set(vinBatch.trim().split(/[\s,،;؛]+/).map((vin) => vin.trim().toUpperCase()).filter(Boolean))];
    if (!values.length) {
      setRequestError("اكتب أو الصق رقم هيكل واحدًا على الأقل");
      return;
    }
    const carsByVin = new Map<string, StockVehicleRow>(stockRows.map((row) => [String(row.vin || "").trim().toUpperCase(), row]));
    const existingIds = new Set(selectedCars.map((row) => row.id));
    const found: StockVehicleRow[] = [];
    const unknown: string[] = [];
    const blocked: string[] = [];
    const already: string[] = [];
    for (const vin of values) {
      const row = carsByVin.get(vin);
      if (!row) unknown.push(vin);
      else if (existingIds.has(row.id)) already.push(vin);
      else if (row.active_transfer_requests) blocked.push(`${vin} (${blockingRequestDescription(row)})`);
      else {
        existingIds.add(row.id);
        found.push(row);
      }
    }
    if (found.length) setSelectedCars((current) => [...current, ...found]);
    const describe = (values: string[]) => values.slice(0, 4).join("، ") + (values.length > 4 ? `، و${values.length - 4} أخرى` : "");
    const notices = [
      unknown.length ? `أرقام غير موجودة في الاستوك: ${describe(unknown)}` : "",
      blocked.length ? `سيارات مرتبطة بطلبات نشطة ولم تُضف: ${describe(blocked)}` : "",
      already.length ? `أرقام موجودة مسبقًا في الطلب: ${describe(already)}` : "",
    ].filter(Boolean);
    setRequestError(notices.join(". "));
    setVinBatch([...unknown, ...blocked.map((item) => item.split(" ")[0])].join("\n"));
  }

  function resetRequest() {
    setRequestOpen(false);
    setSelectedCars([]);
    setDestinationLocationId("");
    setPhotographyDate("");
    setNotes({});
    setRequestNote("");
    setPickerSearch("");
    setVinBatch("");
    setRequestError("");
    setError("");
  }

  function closeRequest() {
    if (!busy) resetRequest();
  }

  async function markStockPhotographed(row: StockVehicleRow) {
    if (row.photographed || markingStockId) return;
    setMarkingStockId(row.id);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "mark_stock_photographed", vehicleIds: [row.id] }),
      });
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث حالة التصوير");
    } finally {
      setMarkingStockId("");
    }
  }

  async function completePhotoRequest(requestId: string) {
    setBusy(true);
    setCompletingRequestId(requestId);
    setFollowupError("");
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
      setFollowupError(failure instanceof Error ? failure.message : "تعذر إنهاء طلب التصوير");
    } finally {
      setBusy(false);
      setCompletingRequestId("");
    }
  }

  async function deletePhotoRequest(requestId: string, requestNo: string) {
    if (!window.confirm(`هل تريد حذف طلب التصوير ${requestNo}؟`)) return;
    setBusy(true);
    setDeletingRequestId(requestId);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_photo_request", id: requestId }),
      });
      setMessage(result.message);
      setSelectedRequest((current) => current?.id === requestId ? null : current);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حذف طلب التصوير");
    } finally {
      setBusy(false);
      setDeletingRequestId("");
    }
  }

  async function createRequest() {
    if (!selectedCars.length || !destinationLocationId || !photographyDate) {
      setRequestError("اختر السيارات والمكان المستهدف وتاريخ التصوير قبل إنشاء الطلب");
      return;
    }
    if (blockedSelectedCars.length) {
      setRequestError(`لا يمكن إنشاء الطلب: ${blockedSelectedCars.map((row) => `${row.vin} (${blockingRequestDescription(row)})`).join("، ")}`);
      return;
    }
    setBusy(true);
    setRequestError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "create_photo_request",
          destinationLocationId,
          photographyDate,
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
      setRequestError(failure instanceof Error ? failure.message : "تعذر إنشاء طلب التصوير");
    } finally {
      setBusy(false);
    }
  }

  async function refreshRequestLocks() {
    setRefreshingRequestLocks(true);
    await load();
    setRefreshingRequestLocks(false);
  }

  function openPhotographyDatePicker() {
    const input = photographyDateInputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else {
        input.focus();
        input.click();
      }
    } catch {
      input.focus();
      input.click();
    }
  }

  return (
    <MarketingPage title="الاستوك" description="مخزون السيارات من سيستم العمليات، استخدام السيارات في المحتوى، وطلبات التصوير.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <div className="operations-subtabs marketing-stock-tabs">
        <button type="button" className={pageTab === "stock" ? "active" : ""} onClick={() => setPageTab("stock")}>الاستوك</button>
        <button type="button" className={pageTab === "all" ? "active" : ""} onClick={() => setPageTab("all")}>كل السيارات</button>
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
                      <td>{row.location_name || "—"}</td>
                      <td>1</td>
                      <td>{row.photographed ? <span className="marketing-status success">تم التصوير</span> : <button type="button" className="marketing-status warning marketing-photo-status-button" disabled={markingStockId === row.id} onClick={() => void markStockPhotographed(row)}>{markingStockId === row.id ? "جاري التحديث..." : "لم يتم التصوير"}</button>}</td>
                      <td>{row.usage.length ? <div className="usage-tags">{row.usage.slice(0, 4).map((item, index) => <span key={index}>{item?.creativeName || item?.contentType || item?.sourceName || "مستخدم"}</span>)}</div> : "غير مستخدمة"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : pageTab === "all" ? (
        <section className="marketing-card">
          <div className="marketing-table-wrap">
            <table>
              <thead><tr><th>السيارة</th><th>البيان</th><th>اللون الخارجي</th><th>اللون الداخلي</th><th>الموديل</th><th>الكمية</th></tr></thead>
              <tbody>
                {allCarsRows.length ? allCarsRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.carName || "—"}</td>
                    <td>{row.statement || "—"}</td>
                    <td>{row.exteriorColor || "—"}</td>
                    <td>{row.interiorColor || "—"}</td>
                    <td>{row.modelYear || "—"}</td>
                    <td>{row.quantity.toLocaleString("ar-SA-u-nu-latn")}</td>
                  </tr>
                )) : <tr><td colSpan={6}>لا توجد سيارات في الاستوك.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <div className="operations-subtabs marketing-photo-followup-tabs">
            <button type="button" className={requestTab === "active" ? "active" : ""} onClick={() => setRequestTab("active")}>متابعة الطلبات</button>
            <button type="button" className={requestTab === "completed" ? "active" : ""} onClick={() => setRequestTab("completed")}>الطلبات المكتملة</button>
            <button type="button" className={requestTab === "linked" ? "active" : ""} onClick={() => setRequestTab("linked")}>الطلبات المرتبطة بالسيارات ({linkedActiveRequests.length.toLocaleString("ar-SA-u-nu-latn")})</button>
          </div>

          {requestTab === "active" && !activeRequests.length && linkedActiveRequests.length ? (
            <div className="marketing-linked-requests-hint">
              <div><strong>لا توجد طلبات تصوير نشطة في هذه القائمة.</strong><small>لكن توجد {linkedActiveRequests.length.toLocaleString("ar-SA-u-nu-latn")} طلبات نشطة مرتبطة بسيارات الاستوك، قد تكون طلبات نقل أو طلبات تصوير لدى مستخدم آخر.</small></div>
              <button type="button" className="secondary" onClick={() => setRequestTab("linked")}>عرض الطلبات المرتبطة</button>
            </div>
          ) : null}
          {requestTab === "linked" ? (
            <section className="marketing-card marketing-linked-requests-section">
              <div className="marketing-linked-requests-header">
                <div>
                  <strong>الطلبات النشطة المرتبطة بالسيارات</strong>
                  <small>تعرض طلبات النقل والتصوير التي تمنع إنشاء طلب جديد لأي سيارة في الاستوك. تفاصيل للمتابعة فقط؛ إنهاء أو إلغاء طلب النقل يتم من سيستم العمليات.</small>
                </div>
                <label className="marketing-linked-requests-search"><MagnifyingGlass size={18} /><input value={linkedRequestSearch} onChange={(event) => setLinkedRequestSearch(event.target.value)} placeholder="بحث برقم الطلب أو الهيكل أو المنشئ" aria-label="البحث في الطلبات المرتبطة" /></label>
              </div>
              <div className="marketing-table-wrap">
                <table>
                  <thead><tr><th>رقم الطلب</th><th>النوع</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>المنشئ</th><th>المكان المصدر</th><th>المكان المستهدف</th><th>السيارات</th><th>الإجراء</th></tr></thead>
                  <tbody>
                    {visibleLinkedRequests.length ? visibleLinkedRequests.map((request) => (
                      <tr key={request.id}>
                        <td><strong dir="ltr">{request.requestNo}</strong></td>
                        <td>{request.requestKind === "transfer" ? "طلب نقل" : "طلب تصوير"}</td>
                        <td><span className="marketing-status warning">{requestStatusLabels[request.status] || request.status}</span></td>
                        <td>{request.requestedAt ? marketingDate(request.requestedAt, true) : "—"}</td>
                        <td>{request.requestedByName || "—"}</td>
                        <td>{request.sourceLocationName || "—"}</td>
                        <td>{request.destinationLocationName || "—"}</td>
                        <td>{request.cars.length.toLocaleString("ar-SA-u-nu-latn")}</td>
                        <td><button type="button" className="secondary marketing-request-action-button" onClick={() => setSelectedLinkedRequest(request)}>عرض التفاصيل</button></td>
                      </tr>
                    )) : <tr><td colSpan={9}>لا توجد طلبات نشطة مرتبطة بسيارات الاستوك {linkedRequestSearch ? "تطابق البحث." : "حاليًا."}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
          <section className="marketing-card">
            <div className="marketing-table-wrap">
              <table>
                <thead><tr><th>رقم الطلب</th><th>الحالة</th><th>تاريخ التصوير</th><th>المكان المصدر</th><th>المكان المستهدف</th><th>المنشئ</th><th>تاريخ الإنشاء</th><th>السيارات</th><th>الإجراء</th></tr></thead>
                <tbody>
                  {visibleRequests.length ? visibleRequests.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.request_no}</strong></td>
                      <td><span className={`marketing-status ${row.status === "completed" ? "success" : "warning"}`}>{row.cancelled_at ? "ملغي" : requestStatusLabels[row.status] || row.status}</span></td>
                      <td>{formatPhotographyDate(row.photography_date)}</td>
                      <td>{row.source_location_name || "—"}</td>
                      <td>{row.destination_location_name || "—"}</td>
                      <td>{row.requested_by_name || "—"}</td>
                      <td>{marketingDate(row.requested_at, true)}</td>
                      <td>{row.vehicles.length.toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td>
                        <div className="marketing-inline-actions">
                          <button type="button" className="secondary marketing-request-action-button" onClick={() => { setFollowupError(""); setSelectedRequest(row); }}>عرض ومتابعة</button>
                          {row.can_delete ? (
                            <button type="button" className="danger marketing-request-action-button" disabled={busy} onClick={() => void deletePhotoRequest(row.id, row.request_no)}>
                              <Trash size={16} />{deletingRequestId === row.id ? "جاري المسح..." : "حذف"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={9}>لا توجد طلبات في هذا التبويب.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          )}
        </>
      )}

      <Modal
        open={Boolean(selectedLinkedRequest)}
        title={selectedLinkedRequest ? `تفاصيل الطلب المرتبط — ${selectedLinkedRequest.requestNo}` : "تفاصيل الطلب المرتبط"}
        subtitle={selectedLinkedRequest ? `${selectedLinkedRequest.requestKind === "transfer" ? "طلب نقل" : "طلب تصوير"} · ${requestStatusLabels[selectedLinkedRequest.status] || selectedLinkedRequest.status}` : undefined}
        onClose={() => setSelectedLinkedRequest(null)}
        className="operations-request-detail-modal marketing-photo-followup-modal"
      >
        {selectedLinkedRequest ? (
          <div className="operations-transfer-detail marketing-linked-request-detail">
            <div className="operations-request-summary-grid">
              <div><small>رقم الطلب</small><strong dir="ltr">{selectedLinkedRequest.requestNo}</strong></div>
              <div><small>نوع الطلب</small><strong>{selectedLinkedRequest.requestKind === "transfer" ? "طلب نقل" : "طلب تصوير"}</strong></div>
              <div><small>الحالة</small><strong>{requestStatusLabels[selectedLinkedRequest.status] || selectedLinkedRequest.status}</strong></div>
              <div><small>المنشئ</small><strong>{selectedLinkedRequest.requestedByName || "—"}</strong></div>
              <div><small>تاريخ الإنشاء</small><strong>{selectedLinkedRequest.requestedAt ? marketingDate(selectedLinkedRequest.requestedAt, true) : "—"}</strong></div>
              <div><small>المكان المصدر</small><strong>{selectedLinkedRequest.sourceLocationName || "—"}</strong></div>
              <div><small>المكان المستهدف</small><strong>{selectedLinkedRequest.destinationLocationName || "—"}</strong></div>
            </div>
            <div className="marketing-table-wrap">
              <table>
                <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>المكان الحالي</th></tr></thead>
                <tbody>{selectedLinkedRequest.cars.map((car) => (
                  <tr key={car.id}><td dir="ltr">{car.vin}</td><td>{car.carName || "—"}</td><td>{car.locationName || "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="marketing-linked-request-note">
              <WarningCircle size={18} />
              <span>هذا الطلب ما زال نشطًا، لذلك يمنع إنشاء طلب جديد لنفس رقم الهيكل. {selectedLinkedRequest.requestKind === "transfer" ? "متابعته وإنهاؤه من العمليات ← الطلبات." : "متابعته من طلبات التصوير لدى المنشئ أو المسؤول."}</span>
            </div>
            {data?.canViewOperationsTransfers && selectedLinkedRequest.requestKind === "transfer" ? (
              <div className="operations-detail-actions"><a className="secondary marketing-linked-operations-link" href="/operations/transfers">الانتقال إلى طلبات العمليات</a></div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedRequest)}
        title={selectedRequest ? `متابعة طلب التصوير — ${selectedRequest.request_no}` : "متابعة طلب التصوير"}
        subtitle={selectedRequest ? `${selectedRequest.requested_by_name || "—"} · ${marketingDate(selectedRequest.requested_at, true)}` : undefined}
        onClose={() => { setFollowupError(""); setSelectedRequest(null); }}
        className="operations-request-detail-modal marketing-photo-followup-modal"
      >
        {selectedRequest ? (
          <div className="operations-transfer-detail">
            {followupError ? <div role="alert" className="operations-alert error marketing-photo-dialog-error"><WarningCircle size={18} />{followupError}</div> : null}
            <div className="operations-request-summary-grid">
              <div><small>الحالة الحالية</small><strong>{selectedRequest.cancelled_at ? "ملغي" : requestStatusLabels[selectedRequest.status] || selectedRequest.status}</strong></div>
              <div><small>تاريخ التصوير</small><strong>{formatPhotographyDate(selectedRequest.photography_date)}</strong></div>
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
                <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th><th>المكان المصدر</th><th>ملاحظة السيارة</th></tr></thead>
                <tbody>{selectedRequest.vehicles.map((vehicle) => <tr key={vehicle.vehicleId}><td dir="ltr">{vehicle.vin}</td><td>{vehicle.carName || "—"}</td><td>{vehicle.statement || "—"}</td><td>{vehicle.sourceLocationName || "—"}</td><td>{vehicle.note || "—"}</td></tr>)}</tbody>
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
        subtitle={selectedCars.length ? `${selectedCars.length.toLocaleString("ar-SA-u-nu-latn")} سيارة داخل الطلب` : undefined}
        onClose={closeRequest}
        className="operations-request-detail-modal marketing-photo-request-modal"
        footer={(
          <>
            {requestError ? <div role="alert" className="operations-alert error marketing-photo-dialog-error"><WarningCircle size={18} />{requestError}</div> : null}
            <button type="button" className="secondary" disabled={busy} onClick={closeRequest}>إلغاء</button>
            <button type="button" className="primary" disabled={busy || !selectedCars.length || !destinationLocationId || !photographyDate || blockedSelectedCars.length > 0} onClick={() => void createRequest()}>
              <Camera size={18} />{busy ? "جاري الإنشاء..." : "إنشاء طلب التصوير"}
            </button>
          </>
        )}
      >
        <div className="operations-transfer-create marketing-photo-request-create">
          {blockedSelectedCars.length ? (
            <div className="marketing-photo-blockers" role="alert">
              <strong><WarningCircle size={19} /> يوجد {blockedSelectedCars.length.toLocaleString("ar-SA-u-nu-latn")} رقم هيكل مرتبط بطلب نشط</strong>
              <button type="button" className="secondary marketing-photo-refresh-button" disabled={refreshingRequestLocks || busy} onClick={() => void refreshRequestLocks()}>{refreshingRequestLocks ? "جاري التحديث..." : "تحديث حالة الطلبات"}</button>
              <p>قد يكون الطلب من نوع النقل داخل سيستم العمليات، أو طلب تصوير أنشأه مستخدم آخر؛ لذلك لن يظهر بالضرورة في قائمة طلبات التصوير الخاصة بك.</p>
              {blockedSelectedCars.map((row) => (
                <div className="marketing-photo-blocker-row" key={row.id}>
                  <span><b dir="ltr">{row.vin}</b> — {blockingRequestDescription(row)}</span>
              <div className="marketing-inline-actions">
                <button type="button" className="secondary" onClick={() => viewLinkedRequest(row.active_request_details?.[0]?.requestNo || "")}>عرض الطلب المرتبط</button>
                <button type="button" className="secondary" onClick={() => { setSelectedCars((current) => current.filter((item) => item.id !== row.id)); setRequestError(""); }}>إزالة من الطلب</button>
              </div>
                </div>
              ))}
            </div>
          ) : null}
          {requestError.includes("طلبات نشطة") || requestError.includes("مرتبطة بطلب") ? (
            <button type="button" className="secondary marketing-linked-requests-shortcut" onClick={() => viewLinkedRequest()}>عرض الطلبات المرتبطة بالسيارات</button>
          ) : null}
          <section className="marketing-photo-bulk-picker" aria-label="إضافة عدة أرقام هياكل">
            <div className="marketing-photo-bulk-heading">
              <strong>إضافة أرقام هياكل متعددة</strong>
              <small>يمكن إضافة أكثر من سيارتين في نفس الطلب، من أماكن مختلفة. اكتب الأرقام مفصولة بمسافة أو فاصلة أو سطر.</small>
            </div>
            <div className="marketing-photo-bulk-controls">
              <textarea rows={2} value={vinBatch} onChange={(event) => setVinBatch(event.target.value)} placeholder={"الصق أرقام الهياكل هنا، كل رقم في سطر\nمثال: 12345678901234567"} aria-label="أرقام الهياكل" />
              <button type="button" className="secondary" disabled={busy || !vinBatch.trim()} onClick={addCarsByVin}>إضافة السيارات</button>
            </div>
          </section>
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
                {(data?.locations || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="operations-control-field marketing-photo-date-field">
              <span>تاريخ التصوير</span>
              <span className="marketing-photo-date-field-control">
                <button type="button" className={`marketing-photo-date-control${photographyDate ? " has-value" : ""}`} onClick={openPhotographyDatePicker}>
                  <CalendarBlank size={20} weight="duotone" />
                  <span className="marketing-photo-date-copy">
                    <strong>{photographyDate ? formatPhotographyDate(photographyDate) : "اختر تاريخ التصوير"}</strong>
                    <small>{photographyDate ? "اضغط لتغيير التاريخ" : "اضغط لفتح التقويم"}</small>
                  </span>
                  <CaretDown size={16} />
                </button>
                <input
                  ref={photographyDateInputRef}
                  className="marketing-photo-date-native"
                  type="date"
                  value={photographyDate}
                  onChange={(event) => setPhotographyDate(event.target.value)}
                  aria-label="تاريخ التصوير"
                  required
                />
              </span>
            </div>
          </div>

          {!selectedCars.length ? (
            <div className="operations-empty-state"><Camera size={42} weight="duotone" /><strong>لم يتم اختيار سيارات</strong></div>
          ) : (
            <div className="operations-selection-table-wrap">
              <div className="operations-selection-summary">
                <strong>{selectedCars.length.toLocaleString("ar-SA-u-nu-latn")} سيارة داخل الطلب</strong>
                <span>{destination ? <>المكان المستهدف: <b>{destination.name}</b></> : "حدد المكان المستهدف"}</span>
                <button type="button" className="secondary marketing-photo-clear-button" disabled={busy} onClick={() => { setSelectedCars([]); setRequestError(""); }}>تفريغ السيارات</button>
              </div>
              <ResizableOperationsTable<StockVehicleRow>
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
        </div>
      </Modal>
    </MarketingPage>
  );
}
