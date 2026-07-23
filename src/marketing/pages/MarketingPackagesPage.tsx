import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, Gift, MagnifyingGlass, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingPost, marketingQuery } from "../api";
import { useMarketing } from "../MarketingContext";
import type { MarketingPackage, PackagesResponse } from "../types";

type PackageForm = {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  cashDiscount: number;
  registrationFee: boolean;
  insurance: boolean;
  issuanceFee: boolean;
  carCareText: string;
  deliveryMode: "home" | "region";
  isActive: boolean;
};
const blankForm = (): PackageForm => ({ id: "", name: "", categoryId: "", price: 0, cashDiscount: 0, registrationFee: false, insurance: false, issuanceFee: false, carCareText: "", deliveryMode: "home", isActive: true });

export function MarketingPackagesPage() {
  const { meta } = useMarketing();
  const [rows, setRows] = useState<MarketingPackage[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [form, setForm] = useState<PackageForm>(blankForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    setError("");
    try { const payload = await marketingFetch<PackagesResponse>(`/api/marketing${marketingQuery({ action: "packages", search, categoryId })}`); setRows(payload.rows); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الباقات"); }
  };
  useEffect(() => { void load(); }, [categoryId]);

  const grouped = useMemo(() => new Map((meta?.packageCategories || []).map((category) => [category.id, rows.filter((row) => row.category_id === category.id)])), [meta, rows]);
  if (!meta) return null;

  const edit = (row: MarketingPackage) => setForm({ id: row.id, name: row.name, categoryId: row.category_id, price: row.price, cashDiscount: row.cash_discount, registrationFee: row.registration_fee, insurance: row.insurance, issuanceFee: row.issuance_fee, carCareText: row.car_care_lines.join("\n"), deliveryMode: row.delivery_mode, isActive: row.is_active });
  const save = async () => {
    setWorking(true); setError(""); setMessage("");
    try {
      const result = await marketingPost<{ ok: true; message: string }>({ action: "save_package", ...form, carCareLines: form.carCareText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) });
      setMessage(result.message); setForm(blankForm()); await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "تعذر حفظ الباقة"); }
    finally { setWorking(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("سيتم تعطيل الباقة. هل أنت متأكد؟")) return;
    try { await marketingPost({ action: "delete_package", id }); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "تعذر حذف الباقة"); }
  };
  const print = () => window.print();

  return <div className="marketing-page packages-page">
    <header className="marketing-page-title"><div><h2>إدارة الباقات</h2><p>إنشاء وتصنيف وعرض وتعديل باقات التسويق.</p></div><div className="marketing-title-actions"><button onClick={() => void load()}><ArrowClockwise />تحديث البيانات</button><button onClick={print}><FilePdf />تصدير PDF</button></div></header>
    {error ? <div className="marketing-error">{error}</div> : null}{message ? <div className="marketing-success">{message}</div> : null}
    <div className="packages-layout">
      <aside className="package-editor panel"><h3><Gift />معلومات الباقة</h3><label><span>اسم الباقة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="مثال: الباقة الذهبية - 1" /></label><label><span>التصنيف</span><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">اختر التصنيف</option>{meta.packageCategories.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="marketing-form-grid two"><label><span>قيمة الباقة (ر.س)</span><input type="number" min={0} value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) || 0 })} /></label><label><span>خصم نقدي (%)</span><input type="number" min={0} max={100} value={form.cashDiscount} onChange={(event) => setForm({ ...form, cashDiscount: Number(event.target.value) || 0 })} /></label></div><fieldset><legend>الإجراءات</legend><label><input type="checkbox" checked={form.registrationFee} onChange={(event) => setForm({ ...form, registrationFee: event.target.checked })} />رسوم التسجيل</label><label><input type="checkbox" checked={form.insurance} onChange={(event) => setForm({ ...form, insurance: event.target.checked })} />التأمين</label><label><input type="checkbox" checked={form.issuanceFee} onChange={(event) => setForm({ ...form, issuanceFee: event.target.checked })} />رسوم الإصدار</label></fieldset><label><span>العناية بالسيارة</span><small>اكتب كل ميزة في سطر منفصل.</small><textarea value={form.carCareText} onChange={(event) => setForm({ ...form, carCareText: event.target.value })} /></label><fieldset><legend>التوصيل</legend><label><input type="radio" checked={form.deliveryMode === "home"} onChange={() => setForm({ ...form, deliveryMode: "home" })} />إلى باب البيت</label><label><input type="radio" checked={form.deliveryMode === "region"} onChange={() => setForm({ ...form, deliveryMode: "region" })} />إلى المنطقة</label></fieldset><div className="package-editor-actions"><button className="primary" disabled={working || !form.name || !form.categoryId} onClick={() => void save()}>{form.id ? <PencilSimple /> : <Plus />}{form.id ? "تعديل الباقة" : "إنشاء باقة"}</button>{form.id ? <button onClick={() => setForm(blankForm())}>إلغاء التعديل</button> : null}</div></aside>
      <main className="packages-content panel"><div className="marketing-filter-bar"><label className="marketing-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="بحث عن باقة..." /></label><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">كل التصنيفات</option>{meta.packageCategories.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button onClick={() => void load()}>بحث</button></div><nav className="package-category-tabs">{meta.packageCategories.filter((row) => row.is_active).map((category) => <button key={category.id} className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(categoryId === category.id ? "" : category.id)}>{category.name}<b>{grouped.get(category.id)?.length || 0}</b></button>)}</nav><h3>الباقات {categoryId ? `– ${meta.packageCategories.find((row) => row.id === categoryId)?.name}` : ""}</h3><div className="package-cards">{rows.map((row) => <article key={row.id}><header><div><small>{row.category_name}</small><h4>{row.name}</h4></div><strong>{row.price.toLocaleString("ar-SA")} ر.س</strong></header><div className="package-badges">{row.cash_discount ? <span>خصم {row.cash_discount}%</span> : null}{row.registration_fee ? <span>رسوم التسجيل</span> : null}{row.insurance ? <span>التأمين</span> : null}{row.issuance_fee ? <span>رسوم الإصدار</span> : null}<span>{row.delivery_mode === "home" ? "إلى باب البيت" : "إلى المنطقة"}</span></div><ul>{row.car_care_lines.map((line) => <li key={line}>{line}</li>)}</ul>{meta.permissions.managePackages ? <footer><button onClick={() => edit(row)}><PencilSimple />تعديل</button><button className="danger" onClick={() => void remove(row.id)}><Trash />حذف</button></footer> : null}</article>)}</div>{!rows.length ? <div className="marketing-empty">لا توجد باقات في التصنيف الحالي.</div> : null}</main>
    </div>
  </div>;
}
