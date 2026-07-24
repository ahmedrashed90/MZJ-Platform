import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle, MagnifyingGlass, X } from "@phosphor-icons/react";
import { MarketingPage, MarketingAlert } from "../components/MarketingPage";
import { marketingDate, marketingFetch } from "../api";
import type { StockCar } from "../types";

type StockPayload = { ok: boolean; cars: StockCar[]; requests: any[] };
type GroupedCar = StockCar & { ids: string[]; vins: string[]; locations: string[]; quantity: number; anyPhotographed: boolean; usage: any[] };

export function StockPage() {
  const [data, setData] = useState<StockPayload | null>(null);
  const [filters, setFilters] = useState({ search: "", car: "", statement: "", photographed: "", inAgenda: "", agendaMonth: "", contentType: "" });
  const [selected, setSelected] = useState<GroupedCar | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requestNote, setRequestNote] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try { setData(await marketingFetch<StockPayload>("/api/marketing?resource=stock")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الاستوك"); }
  }
  useEffect(() => { void load(); }, []);

  const grouped = useMemo<GroupedCar[]>(() => {
    const map = new Map<string, GroupedCar>();
    for (const car of data?.cars || []) {
      const key = [car.car_name, car.statement, car.model_year, car.exterior_color, car.interior_color].map((value) => String(value || "").trim().toLowerCase()).join("|");
      const existing = map.get(key);
      if (existing) {
        existing.ids.push(car.id); existing.vins.push(car.vin); if (car.location_name && !existing.locations.includes(car.location_name)) existing.locations.push(car.location_name); existing.quantity += 1;
        existing.anyPhotographed = existing.anyPhotographed || Boolean(car.photographed);
        existing.usage.push(...(Array.isArray(car.content_usage) ? car.content_usage : []));
      } else map.set(key, { ...car, ids: [car.id], vins: [car.vin], locations: car.location_name ? [car.location_name] : [], quantity: 1, anyPhotographed: Boolean(car.photographed), usage: Array.isArray(car.content_usage) ? [...car.content_usage] : [] });
    }
    return [...map.values()];
  }, [data]);

  const filtered = useMemo(() => grouped.filter((row) => {
    const haystack = [row.vins.join(" "), row.car_name, row.statement, row.model_year, row.exterior_color, row.interior_color, row.usage.map((item) => item?.contentType || item?.creative || "").join(" ")].join(" ").toLowerCase();
    const matchesSearch = !filters.search || haystack.includes(filters.search.toLowerCase());
    const matchesCar = !filters.car || row.car_name === filters.car;
    const matchesStatement = !filters.statement || row.statement === filters.statement;
    const matchesPhoto = !filters.photographed || (filters.photographed === "yes" ? row.anyPhotographed : !row.anyPhotographed);
    const inAgenda = row.usage.some((item) => item?.sourceType === "agenda" || item?.agendaId);
    const matchesAgenda = !filters.inAgenda || (filters.inAgenda === "yes" ? inAgenda : !inAgenda);
    const matchesMonth = !filters.agendaMonth || row.usage.some((item) => String(item?.month || item?.agendaMonth || "").startsWith(filters.agendaMonth));
    const matchesType = !filters.contentType || row.usage.some((item) => String(item?.contentType || item?.creativeType || "") === filters.contentType);
    return matchesSearch && matchesCar && matchesStatement && matchesPhoto && matchesAgenda && matchesMonth && matchesType;
  }), [grouped, filters]);

  const carNames = useMemo(() => [...new Set(grouped.map((item) => item.car_name).filter(Boolean))] as string[], [grouped]);
  const statements = useMemo(() => [...new Set(grouped.map((item) => item.statement).filter(Boolean))] as string[], [grouped]);
  const contentTypes = useMemo(() => [...new Set(grouped.flatMap((item) => item.usage.map((usage) => usage?.contentType || usage?.creativeType)).filter(Boolean))] as string[], [grouped]);
  const metrics = useMemo(() => ({ total: grouped.reduce((sum, row) => sum + row.quantity, 0), notPhotographed: grouped.filter((row) => !row.anyPhotographed).reduce((sum, row) => sum + row.quantity, 0), unused: grouped.filter((row) => row.usage.length === 0).reduce((sum, row) => sum + row.quantity, 0), requests: data?.requests.filter((row) => row.status !== "completed").length || 0 }), [grouped, data]);

  function openRequest(row: GroupedCar, id?: string) {
    setSelected(row); setSelectedIds(id ? [id] : [...row.ids]); setNotes({}); setRequestNote("");
  }
  async function createRequest() {
    if (!selectedIds.length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_photo_request", note: requestNote, vehicles: selectedIds.map((vehicleId) => ({ vehicleId, note: notes[vehicleId] || "" })) }) });
      setMessage(result.message); setSelected(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء طلب التصوير"); }
    finally { setBusy(false); }
  }
  async function markPhotographed(vehicleId: string, photographed: boolean) {
    setBusy(true); setError("");
    try { const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "mark_photographed", vehicleId, photographed }) }); setMessage(result.message); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث حالة التصوير"); }
    finally { setBusy(false); }
  }

  return <MarketingPage title="الاستوك" description="مخزون السيارات من سيستم العمليات، استخدام السيارات في المحتوى، وطلبات التصوير.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    <div className="marketing-metric-grid four"><article><strong>{metrics.total}</strong><span>المعروض في الاستوك</span></article><article><strong>{metrics.notPhotographed}</strong><span>لم يتم التصوير</span></article><article><strong>{metrics.unused}</strong><span>غير مستخدمة في أي نوع محتوى</span></article><article><strong>{metrics.requests}</strong><span>طلبات التصوير</span></article></div>
    <section className="marketing-card"><div className="marketing-filter-grid stock"><label><MagnifyingGlass />البحث<input placeholder="رقم الهيكل أو السيارة أو البيان أو نوع المحتوى" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></label><label>السيارة<select value={filters.car} onChange={(e) => setFilters({ ...filters, car: e.target.value })}><option value="">الكل</option>{carNames.map((name) => <option key={name}>{name}</option>)}</select></label><label>البيان<select value={filters.statement} onChange={(e) => setFilters({ ...filters, statement: e.target.value })}><option value="">الكل</option>{statements.map((name) => <option key={name}>{name}</option>)}</select></label><label>تم التصوير<select value={filters.photographed} onChange={(e) => setFilters({ ...filters, photographed: e.target.value })}><option value="">الكل</option><option value="yes">نعم</option><option value="no">لا</option></select></label><label>داخل الأجندة<select value={filters.inAgenda} onChange={(e) => setFilters({ ...filters, inAgenda: e.target.value })}><option value="">الكل</option><option value="yes">نعم</option><option value="no">لا</option></select></label><label>شهر الأجندة<input type="month" value={filters.agendaMonth} onChange={(e) => setFilters({ ...filters, agendaMonth: e.target.value })} /></label><label>نوع المحتوى<select value={filters.contentType} onChange={(e) => setFilters({ ...filters, contentType: e.target.value })}><option value="">الكل</option>{contentTypes.map((name) => <option key={name}>{name}</option>)}</select></label></div></section>
    <section className="marketing-card"><div className="marketing-table-wrap"><table><thead><tr><th>رقم الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>الموديل</th><th>اللون الخارجي</th><th>اللون الداخلي</th><th>المكان</th><th>العدد</th><th>تم التصوير</th><th>حالة الاستخدام</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.ids.join("-")}><td><div className="vin-stack">{row.vins.map((vin, index) => <button key={vin} type="button" onClick={() => openRequest(row, row.ids[index])}>{vin}</button>)}</div></td><td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.model_year || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.locations.join("، ") || "—"}</td><td>{row.quantity}</td><td><button className={row.anyPhotographed ? "marketing-status success" : "marketing-status warning"} onClick={() => void markPhotographed(row.ids[0], !row.anyPhotographed)}>{row.anyPhotographed ? "تم التصوير" : "لم يتم التصوير"}</button></td><td>{row.usage.length ? <div className="usage-tags">{row.usage.slice(0, 4).map((item, index) => <span key={index}>{item?.creativeName || item?.contentType || item?.sourceName || "مستخدم"}</span>)}</div> : "غير مستخدمة"}</td></tr>)}</tbody></table></div></section>
    <section className="marketing-card"><h2>طلبات التصوير</h2><div className="marketing-table-wrap"><table><thead><tr><th>رقم الطلب</th><th>الحالة</th><th>المنشئ</th><th>تاريخ الإنشاء</th><th>السيارات</th><th>الملاحظات</th></tr></thead><tbody>{(data?.requests || []).map((row) => <tr key={row.id}><td>{row.request_no}</td><td>{row.status}</td><td>{row.requested_by_name}</td><td>{marketingDate(row.requested_at, true)}</td><td>{row.vehicles?.map((vehicle: any) => vehicle.vin).join("، ")}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div></section>
    {selected ? <div className="marketing-modal-backdrop"><div className="marketing-modal"><header><div><h2>إنشاء طلب تصوير</h2><p>{selected.car_name} — {selected.statement}</p></div><button onClick={() => setSelected(null)}><X /></button></header><div className="marketing-modal-body"><label className="marketing-check"><input type="checkbox" checked={selectedIds.length === selected.ids.length} onChange={(e) => setSelectedIds(e.target.checked ? [...selected.ids] : [])} />اختيار كل السيارات في التركيبة</label>{selected.ids.map((id, index) => <div className="photo-request-row" key={id}><label className="marketing-check"><input type="checkbox" checked={selectedIds.includes(id)} onChange={(e) => setSelectedIds(e.target.checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id))} />{selected.vins[index]}</label><input placeholder="ملاحظة مستقلة للسيارة" value={notes[id] || ""} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} /></div>)}<label>ملاحظات الطلب<textarea rows={3} value={requestNote} onChange={(e) => setRequestNote(e.target.value)} /></label></div><footer><button className="marketing-secondary" onClick={() => setSelected(null)}>إلغاء</button><button className="marketing-primary" disabled={busy || !selectedIds.length} onClick={() => void createRequest()}><Camera />إنشاء الطلب</button></footer></div></div> : null}
  </MarketingPage>;
}
