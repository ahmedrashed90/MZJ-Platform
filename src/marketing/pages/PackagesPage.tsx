import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

type PackageOption = { id: string; name: string; sort_order?: number };
type PackageOptionsResponse = { categories: PackageOption[]; salesTypes: PackageOption[] };
type PackageForm = {
  id: string;
  name: string;
  categoryId: string;
  salesTypeId: string;
  price: number;
  cashDiscount: number;
  registrationFees: boolean;
  insurance: boolean;
  issuanceFees: boolean;
  careText: string;
  deliveryHome: boolean;
  deliveryRegion: boolean;
};

const emptyForm = (categoryId = "", salesTypeId = ""): PackageForm => ({
  id: "",
  name: "",
  categoryId,
  salesTypeId,
  price: 0,
  cashDiscount: 0,
  registrationFees: false,
  insurance: false,
  issuanceFees: false,
  careText: "",
  deliveryHome: false,
  deliveryRegion: false,
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function PackagesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [options, setOptions] = useState<PackageOptionsResponse>({ categories: [], salesTypes: [] });
  const [form, setForm] = useState<PackageForm>(emptyForm());
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salesTypeId, setSalesTypeId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setError("");
    try {
      const [packagesPayload, optionsPayload] = await Promise.all([
        marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "packages" })}`),
        marketingFetch<PackageOptionsResponse>(`/api/marketing${marketingQuery({ resource: "package_options" })}`),
      ]);
      setRows(packagesPayload.rows);
      setOptions(optionsPayload);
      setForm((current) => ({
        ...current,
        categoryId: current.categoryId || optionsPayload.categories[0]?.id || "",
        salesTypeId: current.salesTypeId || optionsPayload.salesTypes[0]?.id || "",
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الباقات");
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    if (categoryId && row.category_id !== categoryId) return false;
    if (salesTypeId && row.sales_type_id !== salesTypeId) return false;
    const haystack = `${row.name} ${row.category_name || row.category || ""} ${row.sales_type_name || ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }), [rows, search, categoryId, salesTypeId]);

  async function save() {
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_package",
          ...form,
          careFeatures: form.careText.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      setMessage(result.message);
      setForm(emptyForm(options.categories[0]?.id || "", options.salesTypes[0]?.id || ""));
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الباقة");
    }
  }

  function edit(row: any) {
    setForm({
      id: row.id,
      name: row.name,
      categoryId: row.category_id || "",
      salesTypeId: row.sales_type_id || "",
      price: Number(row.price),
      cashDiscount: Number(row.cash_discount),
      registrationFees: Boolean(row.registration_fees),
      insurance: Boolean(row.insurance),
      issuanceFees: Boolean(row.issuance_fees),
      careText: Array.isArray(row.care_features) ? row.care_features.join("\n") : "",
      deliveryHome: Boolean(row.delivery_home),
      deliveryRegion: Boolean(row.delivery_region),
    });
  }

  async function remove(id: string) {
    if (!window.confirm("تأكيد حذف الباقة؟")) return;
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_setting", entity: "package", id }),
      });
      setForm(emptyForm(options.categories[0]?.id || "", options.salesTypes[0]?.id || ""));
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حذف الباقة");
    }
  }

  function exportPackagesPdf() {
    if (!filtered.length) {
      setError("لا توجد باقات لتصديرها");
      return;
    }
    const popup = window.open("", "_blank", "width=1200,height=850");
    if (!popup) {
      setError("تعذر فتح نافذة التصدير. اسمح بالنوافذ المنبثقة ثم أعد المحاولة");
      return;
    }
    const cards = filtered.map((row) => {
      const features = [
        row.registration_fees ? "رسوم التسجيل" : "",
        row.insurance ? "التأمين" : "",
        row.issuance_fees ? "رسوم الإصدار" : "",
        ...(Array.isArray(row.care_features) ? row.care_features : []),
        row.delivery_home ? "التوصيل إلى باب البيت" : "",
        row.delivery_region ? "التوصيل إلى المنطقة" : "",
      ].filter(Boolean);
      return `<article class="package-card">
        <div class="badges"><span>${escapeHtml(row.category_name || row.category)}</span><span>${escapeHtml(row.sales_type_name || "غير محدد")}</span></div>
        <h2>${escapeHtml(row.name)}</h2>
        <div class="price">${Number(row.price || 0).toLocaleString("ar-SA")} <small>ر.س</small></div>
        <p>خصم نقدي ${Number(row.cash_discount || 0).toLocaleString("ar-SA")}%</p>
        <ul>${features.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>`;
    }).join("");
    popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>باقات التسويق</title><style>
      @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Tahoma,Arial,sans-serif;color:#3f211b;background:#fff}header{text-align:center;margin-bottom:18px}header h1{margin:0 0 6px;font-size:24px}header p{margin:0;color:#8c6f67}.packages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.package-card{break-inside:avoid;border:1px solid #e4c9bc;border-radius:16px;padding:18px;background:#fffaf7}.badges{display:flex;gap:7px;flex-wrap:wrap}.badges span{padding:5px 10px;border-radius:999px;background:#f5e5dc;font-size:12px;font-weight:700}.package-card h2{margin:16px 0 8px;font-size:20px}.price{font-size:27px;font-weight:900;color:#843c2e}.price small{font-size:13px}.package-card p{font-weight:700}.package-card ul{margin:12px 0 0;padding-right:20px;line-height:1.9}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@media(max-width:700px){.packages{grid-template-columns:1fr}}
    </style></head><body><header><h1>باقات التسويق</h1><p>عدد الباقات: ${filtered.length.toLocaleString("ar-SA")}</p></header><main class="packages">${cards}</main><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();};<\/script></body></html>`);
    popup.document.close();
  }

  return (
    <MarketingPage
      title="إدارة الباقات"
      description="إنشاء باقة أو تعديلها أو حذفها حسب التصنيف ونوع المبيعات."
      actions={<div className="marketing-inline-actions">
        <input className="marketing-search" placeholder="بحث عن باقة" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">كل التصنيفات</option>{options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={salesTypeId} onChange={(event) => setSalesTypeId(event.target.value)}><option value="">كل أنواع المبيعات</option>{options.salesTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className="secondary" onClick={exportPackagesPdf}><FilePdf size={17} />تصدير PDF</button>
        <button type="button" className="secondary" onClick={() => void load()}><ArrowClockwise size={17} />تحديث</button>
      </div>}
    >
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      <div className="marketing-packages-layout">
        <section className="panel marketing-package-form">
          <h2>{form.id ? "تعديل الباقة" : "إنشاء باقة"}</h2>
          <div className="marketing-form-grid">
            <label><span>اسم الباقة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>التصنيف</span><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">اختر التصنيف</option>{options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>المبيعات</span><select value={form.salesTypeId} onChange={(event) => setForm({ ...form, salesTypeId: event.target.value })}><option value="">اختر نوع المبيعات</option>{options.salesTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>قيمة الباقة (ر.س)</span><input type="number" min={0} value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) || 0 })} /></label>
            <label><span>خصم نقدي (%)</span><input type="number" min={0} max={100} value={form.cashDiscount} onChange={(event) => setForm({ ...form, cashDiscount: Number(event.target.value) || 0 })} /></label>
          </div>
          <div className="marketing-check-grid">
            <label><input type="checkbox" checked={form.registrationFees} onChange={(event) => setForm({ ...form, registrationFees: event.target.checked })} />رسوم التسجيل</label>
            <label><input type="checkbox" checked={form.insurance} onChange={(event) => setForm({ ...form, insurance: event.target.checked })} />التأمين</label>
            <label><input type="checkbox" checked={form.issuanceFees} onChange={(event) => setForm({ ...form, issuanceFees: event.target.checked })} />رسوم الإصدار</label>
          </div>
          <label><span>العناية بالسيارة — كل ميزة في سطر</span><textarea rows={7} value={form.careText} onChange={(event) => setForm({ ...form, careText: event.target.value })} /></label>
          <div className="marketing-check-grid">
            <label><input type="checkbox" checked={form.deliveryHome} onChange={(event) => setForm({ ...form, deliveryHome: event.target.checked })} />إلى باب البيت</label>
            <label><input type="checkbox" checked={form.deliveryRegion} onChange={(event) => setForm({ ...form, deliveryRegion: event.target.checked })} />إلى المنطقة</label>
          </div>
          <div className="marketing-inline-actions">
            <button type="button" className="primary" onClick={() => void save()}>{form.id ? <PencilSimple size={17} /> : <Plus size={17} />}{form.id ? "تعديل الباقة" : "إنشاء باقة"}</button>
            {form.id ? <button type="button" className="secondary" onClick={() => setForm(emptyForm(options.categories[0]?.id || "", options.salesTypes[0]?.id || ""))}>إلغاء التعديل</button> : null}
          </div>
        </section>

        <section className="marketing-package-cards">
          {filtered.map((row) => (
            <article key={row.id} className="marketing-package-card">
              <div className="marketing-package-badges"><span>{row.category_name || row.category}</span><span>{row.sales_type_name || "غير محدد"}</span></div>
              <h3>{row.name}</h3>
              <strong>{Number(row.price).toLocaleString("ar-SA")} <small>ر.س</small></strong>
              <p>خصم نقدي {Number(row.cash_discount).toLocaleString("ar-SA")}%</p>
              <ul>
                {row.registration_fees ? <li>رسوم التسجيل</li> : null}
                {row.insurance ? <li>التأمين</li> : null}
                {row.issuance_fees ? <li>رسوم الإصدار</li> : null}
                {Array.isArray(row.care_features) ? row.care_features.map((item: string) => <li key={item}>{item}</li>) : null}
              </ul>
              <footer><button type="button" onClick={() => edit(row)}><PencilSimple size={16} />تعديل</button><button type="button" className="danger" onClick={() => void remove(row.id)}><Trash size={16} />حذف</button></footer>
            </article>
          ))}
          {!filtered.length ? <div className="marketing-empty">لا توجد باقات.</div> : null}
        </section>
      </div>
    </MarketingPage>
  );
}
