import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, Package, PencilSimple, Plus, Tag, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

type LookupRow = { id: string; name: string; sort_order: number };
type PackageSettingsPayload = { categories: LookupRow[]; salesTypes: LookupRow[] };

type PackageForm = {
  id: string;
  name: string;
  categoryId: string;
  salesTypeId: string;
  price: number;
  cashDiscount: number;
  registrationFees: boolean;
  insurance: boolean;
  insuranceDescription: string;
  issuanceFees: boolean;
  careText: string;
  deliveryHome: boolean;
  deliveryRegion: boolean;
};

const emptyForm: PackageForm = { id: "", name: "", categoryId: "", salesTypeId: "", price: 0, cashDiscount: 0, registrationFees: false, insurance: false, insuranceDescription: "", issuanceFees: false, careText: "", deliveryHome: false, deliveryRegion: false };

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

export function PackagesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [settings, setSettings] = useState<PackageSettingsPayload>({ categories: [], salesTypes: [] });
  const [form, setForm] = useState<PackageForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salesTypeId, setSalesTypeId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [packages, lookups] = await Promise.all([
        marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "packages" })}`),
        marketingFetch<PackageSettingsPayload>(`/api/marketing${marketingQuery({ resource: "package_settings" })}`),
      ]);
      setRows(packages.rows);
      setSettings(lookups);
      setForm((current) => ({
        ...current,
        categoryId: current.categoryId || lookups.categories[0]?.id || "",
        salesTypeId: current.salesTypeId || lookups.salesTypes[0]?.id || "",
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الباقات");
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    const text = `${row.name} ${row.category_name || row.category} ${row.sales_type_name || row.sales_type || ""}`.toLowerCase();
    return (!categoryId || row.category_id === categoryId)
      && (!salesTypeId || row.sales_type_id === salesTypeId)
      && text.includes(search.toLowerCase());
  }), [rows, search, categoryId, salesTypeId]);

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_package", ...form, careFeatures: form.careText.split("\n").map((item) => item.trim()).filter(Boolean) }),
      });
      setMessage(result.message);
      setForm({ ...emptyForm, categoryId: settings.categories[0]?.id || "", salesTypeId: settings.salesTypes[0]?.id || "" });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الباقة");
    } finally {
      setBusy(false);
    }
  }

  function edit(row: any) {
    setForm({
      id: row.id,
      name: row.name,
      categoryId: row.category_id || settings.categories.find((item) => item.name === row.category)?.id || "",
      salesTypeId: row.sales_type_id || settings.salesTypes.find((item) => item.name === row.sales_type)?.id || "",
      price: Number(row.price),
      cashDiscount: Number(row.cash_discount),
      registrationFees: row.registration_fees,
      insurance: row.insurance,
      insuranceDescription: String(row.insurance_description || ""),
      issuanceFees: row.issuance_fees,
      careText: Array.isArray(row.care_features) ? row.care_features.join("\n") : "",
      deliveryHome: row.delivery_home,
      deliveryRegion: row.delivery_region,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(id: string) {
    if (!window.confirm("تأكيد حذف الباقة؟")) return;
    try {
      await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "delete_setting", entity: "package", id }) });
      setForm({ ...emptyForm, categoryId: settings.categories[0]?.id || "", salesTypeId: settings.salesTypes[0]?.id || "" });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حذف الباقة");
    }
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1200,height=850");
    if (!popup) {
      setError("اسمح بفتح النافذة المنبثقة لتصدير PDF");
      return;
    }
    popup.opener = null;
    const cards = filtered.map((row) => {
      const features = [
        row.registration_fees ? "رسوم التسجيل" : "",
        row.insurance ? `التأمين${row.insurance_description ? ` — ${row.insurance_description}` : ""}` : "",
        row.issuance_fees ? "رسوم الإصدار" : "",
        row.delivery_home ? "توصيل إلى باب البيت" : "",
        row.delivery_region ? "توصيل إلى المنطقة" : "",
        ...(Array.isArray(row.care_features) ? row.care_features : []),
      ].filter(Boolean);
      return `<article><header><span>${escapeHtml(row.category_name || row.category)}</span><b>${escapeHtml(row.sales_type_name || row.sales_type || "—")}</b></header><h2>${escapeHtml(row.name)}</h2><div class="price">${Number(row.price || 0).toLocaleString("ar-SA-u-nu-latn")} <small>ر.س</small></div><p>الخصم النقدي: ${Number(row.cash_discount || 0).toLocaleString("ar-SA-u-nu-latn")}%</p><ul>${features.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>لا توجد مزايا إضافية</li>"}</ul></article>`;
    }).join("");
    popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>باقات MZJ</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Tajawal,Arial,sans-serif;color:#341c16;margin:0;background:#fff}header.page{display:flex;justify-content:space-between;align-items:end;border-bottom:2px solid #7f3528;padding-bottom:12px;margin-bottom:18px}.brand{font-size:25px;font-weight:900}.meta{color:#806c65}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}article{border:1px solid #e8d2c8;border-radius:16px;padding:16px;break-inside:avoid;background:#fffdfc}article header{display:flex;justify-content:space-between;gap:10px}article header span,article header b{border-radius:999px;padding:6px 10px;background:#f8ece6;color:#7f3528;font-size:12px}h2{margin:16px 0 8px;font-size:21px}.price{font-size:26px;font-weight:900;color:#7f3528}.price small{font-size:13px}p{margin:8px 0;color:#6f5a53}ul{margin:12px 0 0;padding:0 18px;line-height:1.9}@media print{.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><header class="page"><div><div class="brand">باقات MZJ</div><div class="meta">إجمالي الباقات: ${filtered.length.toLocaleString("ar-SA-u-nu-latn")}</div></div><div class="meta">${new Date().toLocaleDateString("ar-SA-u-nu-latn")}</div></header><main class="grid">${cards || "<p>لا توجد باقات مطابقة.</p>"}</main><script>window.onload=()=>window.print();</script></body></html>`);
    popup.document.close();
  }

  return (
    <MarketingPage
      title="إدارة الباقات"
      description="إنشاء باقة أو تعديلها أو حذفها وتصفيتها حسب التصنيف ونوع المبيعات."
      actions={<div className="marketing-inline-actions marketing-package-toolbar"><input className="marketing-search" placeholder="بحث عن باقة" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">كل التصنيفات</option>{settings.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={salesTypeId} onChange={(event) => setSalesTypeId(event.target.value)}><option value="">كل المبيعات</option>{settings.salesTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="secondary" onClick={exportPdf}><FilePdf size={18} />تصدير الباقات PDF</button><button type="button" className="secondary" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button></div>}
    >
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <div className="marketing-packages-layout">
        <section className="panel marketing-package-form">
          <div className="marketing-package-form-head"><div className="marketing-package-icon"><Package size={24} /></div><div><h2>{form.id ? "تعديل الباقة" : "إنشاء باقة"}</h2><p>بيانات الباقة والتصنيف والمبيعات والمزايا.</p></div></div>
          <div className="marketing-form-grid">
            <label className="full"><span>اسم الباقة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>التصنيف</span><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">اختر التصنيف</option>{settings.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>المبيعات</span><select value={form.salesTypeId} onChange={(event) => setForm({ ...form, salesTypeId: event.target.value })}><option value="">اختر المبيعات</option>{settings.salesTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>قيمة الباقة (ر.س)</span><input type="number" min={0} value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) || 0 })} /></label>
            <label><span>خصم نقدي (%)</span><input type="number" min={0} max={100} value={form.cashDiscount} onChange={(event) => setForm({ ...form, cashDiscount: Number(event.target.value) || 0 })} /></label>
          </div>
          <div className="marketing-package-options"><label><input type="checkbox" checked={form.registrationFees} onChange={(event) => setForm({ ...form, registrationFees: event.target.checked })} /><span>رسوم التسجيل</span></label><label><input type="checkbox" checked={form.insurance} onChange={(event) => setForm({ ...form, insurance: event.target.checked, insuranceDescription: event.target.checked ? form.insuranceDescription : "" })} /><span>التأمين</span></label><label><input type="checkbox" checked={form.issuanceFees} onChange={(event) => setForm({ ...form, issuanceFees: event.target.checked })} /><span>رسوم الإصدار</span></label><label><input type="checkbox" checked={form.deliveryHome} onChange={(event) => setForm({ ...form, deliveryHome: event.target.checked })} /><span>إلى باب البيت</span></label><label><input type="checkbox" checked={form.deliveryRegion} onChange={(event) => setForm({ ...form, deliveryRegion: event.target.checked })} /><span>إلى المنطقة</span></label></div>
          {form.insurance ? <label className="marketing-insurance-description"><span>وصف التأمين</span><textarea rows={3} value={form.insuranceDescription} onChange={(event) => setForm({ ...form, insuranceDescription: event.target.value })} placeholder="مثال: سنة ضد الغير - يتحمل العميل فرق السعر إذا زاد عن 2,000 ريال" /></label> : null}
          <label><span>العناية بالسيارة — كل ميزة في سطر</span><textarea rows={7} value={form.careText} onChange={(event) => setForm({ ...form, careText: event.target.value })} /></label>
          <div className="marketing-inline-actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{form.id ? <PencilSimple size={18} /> : <Plus size={18} />}{form.id ? "حفظ تعديلات الباقة" : "إنشاء الباقة"}</button>{form.id ? <button type="button" className="secondary" onClick={() => setForm({ ...emptyForm, categoryId: settings.categories[0]?.id || "", salesTypeId: settings.salesTypes[0]?.id || "" })}>إلغاء التعديل</button> : null}</div>
        </section>

        <section className="marketing-package-cards">
          {filtered.map((row) => <article key={row.id} className="marketing-package-card">
            <header><div className="marketing-package-tags"><span><Tag size={14} />{row.category_name || row.category}</span><span>{row.sales_type_name || row.sales_type || "—"}</span></div><div className="marketing-row-actions"><button type="button" className="secondary compact-button" onClick={() => edit(row)}><PencilSimple size={16} />تعديل</button><button type="button" className="danger compact-button" onClick={() => void remove(row.id)}><Trash size={16} />حذف</button></div></header>
            <h3>{row.name}</h3>
            <strong className="marketing-package-price">{Number(row.price).toLocaleString("ar-SA-u-nu-latn")} <small>ر.س</small></strong>
            <p>خصم نقدي {Number(row.cash_discount).toLocaleString("ar-SA-u-nu-latn")}%</p>
            <ul>{row.registration_fees ? <li>رسوم التسجيل</li> : null}{row.insurance ? <li className="marketing-package-insurance"><span>التأمين</span>{row.insurance_description ? <small>{row.insurance_description}</small> : null}</li> : null}{row.issuance_fees ? <li>رسوم الإصدار</li> : null}{row.delivery_home ? <li>إلى باب البيت</li> : null}{row.delivery_region ? <li>إلى المنطقة</li> : null}{Array.isArray(row.care_features) ? row.care_features.map((item: string) => <li key={item}>{item}</li>) : null}</ul>
          </article>)}
          {!filtered.length ? <div className="marketing-empty"><Package size={34} />لا توجد باقات مطابقة.</div> : null}
        </section>
      </div>
    </MarketingPage>
  );
}
