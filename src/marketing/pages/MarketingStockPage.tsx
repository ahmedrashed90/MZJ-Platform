import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Camera, MagnifyingGlass, Trash, X } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingFetch, marketingPost, marketingQuery } from "../api";
import type { StockResponse, StockVehicle } from "../types";

export function MarketingStockPage() {
  const [rows, setRows] = useState<StockVehicle[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockVehicle[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [photographyDate, setPhotographyDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    setError("");
    try { const payload = await marketingFetch<StockResponse>(`/api/marketing${marketingQuery({ action: "stock", search })}`); setRows(payload.rows); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل مخزن السيارات"); }
  };
  useEffect(() => { void load(); }, []);
  const selectedIds = useMemo(() => new Set(selected.map((row) => row.id)), [selected]);
  const toggle = (vehicle: StockVehicle) => setSelected((current) => current.some((row) => row.id === vehicle.id) ? current.filter((row) => row.id !== vehicle.id) : [...current, vehicle]);
  const create = async () => {
    setWorking(true); setError(""); setMessage("");
    try { const result = await marketingPost<{ ok: true; message: string; requestNo: string }>({ action: "create_photo_request", vehicleIds: selected.map((row) => row.id), photographyDate, note }); setMessage(`${result.message} — ${result.requestNo}`); setSelected([]); setModalOpen(false); setPhotographyDate(""); setNote(""); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "تعذر إنشاء طلب التصوير"); }
    finally { setWorking(false); }
  };
  return <div className="marketing-page"><header className="marketing-page-title"><div><h2>الاستوك</h2><p>قراءة مخزن السيارات من نظام العمليات وإنشاء طلبات تصوير مشتركة.</p></div><div className="marketing-title-actions"><button onClick={() => void load()}><ArrowClockwise />تحديث</button>{selected.length ? <button className="primary" onClick={() => setModalOpen(true)}><Camera />إنشاء طلب تصوير ({selected.length})</button> : null}</div></header>{error ? <div className="marketing-error">{error}</div> : null}{message ? <div className="marketing-success">{message}</div> : null}<section className="marketing-filter-bar"><label className="marketing-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="ابحث برقم الهيكل أو السيارة..." /></label><button className="primary" onClick={() => void load()}>بحث</button></section><section className="marketing-table-panel"><div className="marketing-table-scroll"><table><thead><tr><th>اختيار</th><th>الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>اللون الداخلي</th><th>اللون الخارجي</th><th>الموديل</th><th>المكان</th><th>طلبات تصوير نشطة</th><th>إجراء</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={selectedIds.has(row.id) ? "selected" : ""}><td><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggle(row)} /></td><td><button className="link-button" onClick={() => { if (!selectedIds.has(row.id)) setSelected([row]); setModalOpen(true); }}>{row.vin}</button></td><td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.model_year || "—"}</td><td>{row.location_name || "—"}</td><td>{row.active_photo_requests}</td><td><button onClick={() => { setSelected([row]); setModalOpen(true); }}><Camera />طلب تصوير</button></td></tr>)}</tbody></table></div>{!rows.length ? <div className="marketing-empty">لا توجد سيارات مطابقة.</div> : null}</section><Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إنشاء طلب تصوير"><div className="marketing-modal-body"><div className="selected-vehicles"><h3>السيارات داخل الطلب ({selected.length})</h3>{selected.map((row) => <article key={row.id}><div><strong>{row.vin}</strong><span>{row.car_name} — {row.statement}</span><small>المكان الحالي: {row.location_name || "—"}</small></div><button onClick={() => setSelected((current) => current.filter((vehicle) => vehicle.id !== row.id))}><Trash /></button></article>)}</div><label><span>تاريخ التصوير</span><input type="date" value={photographyDate} onChange={(event) => setPhotographyDate(event.target.value)} /></label><label><span>ملاحظات الطلب</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة اختيارية على طلب التصوير" /></label><div className="marketing-modal-actions"><button onClick={() => setModalOpen(false)}><X />إغلاق</button><button className="primary" disabled={working || !selected.length || !photographyDate} onClick={() => void create()}><Camera />إنشاء طلب تصوير</button></div></div></Modal></div>;
}
