import { useEffect, useState } from "react";
import { FloppyDisk, Package, Palette, PencilSimple, Plus, Trash, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { marketingFetch } from "../api";
import { DepartmentsPage } from "../pages/DepartmentsPage";
import "../marketing.css";

type MarketingSettingsTab = "departments" | "colors" | "packages";
type UserColorRow = { id: string; full_name: string; email?: string | null; color: string };
type LookupRow = { id: string; name: string; sort_order: number };

type PackageSettingsPayload = {
  categories: LookupRow[];
  salesTypes: LookupRow[];
};

function LookupManager({
  title,
  description,
  rows,
  lookupType,
  entity,
  readOnly,
  onReload,
}: {
  title: string;
  description: string;
  rows: LookupRow[];
  lookupType: "category" | "sales_type";
  entity: "package_category" | "package_sales_type";
  readOnly: boolean;
  onReload: () => Promise<void>;
}) {
  const [form, setForm] = useState({ id: "", name: "", sortOrder: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!form.name.trim()) {
      setError("اكتب الاسم أولًا");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_package_lookup", lookupType, ...form }),
      });
      setForm({ id: "", name: "", sortOrder: 0 });
      await onReload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: LookupRow) {
    if (!window.confirm(`حذف ${row.name} من الاختيارات الجديدة؟`)) return;
    setBusy(true);
    setError("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_setting", entity, id: row.id }),
      });
      if (form.id === row.id) setForm({ id: "", name: "", sortOrder: 0 });
      await onReload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر الحذف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="marketing-package-setting-card">
      <header>
        <div><h3>{title}</h3><p>{description}</p></div>
        <span>{rows.length.toLocaleString("ar-SA")}</span>
      </header>
      {error ? <div className="connection-banner"><WarningCircle size={17} />{error}</div> : null}
      <div className="marketing-package-setting-form">
        <label><span>الاسم</span><input disabled={readOnly} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><span>الترتيب</span><input disabled={readOnly} type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) || 0 })} /></label>
        <button type="button" className="primary" disabled={readOnly || busy} onClick={() => void save()}>{form.id ? <FloppyDisk size={17} /> : <Plus size={17} />}{form.id ? "حفظ التعديل" : "إضافة"}</button>
        {form.id ? <button type="button" className="secondary" disabled={readOnly || busy} onClick={() => setForm({ id: "", name: "", sortOrder: 0 })}>إلغاء</button> : null}
      </div>
      <div className="marketing-package-setting-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div><strong>{row.name}</strong><small>الترتيب: {row.sort_order.toLocaleString("ar-SA")}</small></div>
            <div className="marketing-row-actions">
              <button type="button" className="secondary compact-button" disabled={readOnly || busy} onClick={() => setForm({ id: row.id, name: row.name, sortOrder: row.sort_order })}><PencilSimple size={16} />تعديل</button>
              <button type="button" className="danger compact-button" disabled={readOnly || busy} onClick={() => void remove(row)}><Trash size={16} />حذف</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MarketingSettingsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab: MarketingSettingsTab = requestedTab === "colors" || requestedTab === "packages" ? requestedTab : "departments";
  const [tab, setTab] = useState<MarketingSettingsTab>(initialTab);
  const [rows, setRows] = useState<UserColorRow[]>([]);
  const [packageSettings, setPackageSettings] = useState<PackageSettingsPayload>({ categories: [], salesTypes: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(requestedTab === "colors" || requestedTab === "packages" ? requestedTab : "departments");
  }, [requestedTab]);

  async function loadColors() {
    setError("");
    try {
      const payload = await marketingFetch<{ rows: UserColorRow[] }>("/api/marketing?resource=user_colors");
      setRows(payload.rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق");
    }
  }

  async function loadPackageSettings() {
    setError("");
    try {
      const payload = await marketingFetch<PackageSettingsPayload>("/api/marketing?resource=package_settings");
      setPackageSettings(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات الباقات");
    }
  }

  useEffect(() => {
    if (tab === "colors") void loadColors();
    if (tab === "packages") void loadPackageSettings();
  }, [tab]);

  function chooseTab(next: MarketingSettingsTab) {
    setTab(next);
    setMessage("");
    setError("");
    setSearchParams({ section: "marketing", tab: next }, { replace: true });
  }

  async function saveColors() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_user_colors", colors: rows.map((row) => ({ userId: row.id, color: row.color })) }),
      });
      setMessage(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الألوان");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-settings-root">
      <section className="panel marketing-settings-panel marketing-settings-header">
        <div className="settings-card-title"><div><h2>إعدادات سيستم التسويق</h2></div></div>
        <nav className="marketing-settings-tabs" aria-label="إعدادات سيستم التسويق">
          <button type="button" className={tab === "departments" ? "active" : ""} onClick={() => chooseTab("departments")}><UsersThree size={18} weight="duotone" />الأقسام</button>
          <button type="button" className={tab === "colors" ? "active" : ""} onClick={() => chooseTab("colors")}><Palette size={18} weight="duotone" />تعيين لون لكل مسؤول</button>
          <button type="button" className={tab === "packages" ? "active" : ""} onClick={() => chooseTab("packages")}><Package size={18} weight="duotone" />إعدادات الباقات</button>
        </nav>
      </section>

      {readOnly ? <div className="connection-banner"><WarningCircle size={18} /><span>صلاحية مشاهدة فقط؛ تعديل إعدادات التسويق يحتاج صلاحية الإدارة.</span></div> : null}
      {error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="success-banner">{message}</div> : null}

      <fieldset className="settings-readonly-fieldset" disabled={readOnly}>
        {tab === "departments" ? <DepartmentsPage embedded /> : null}

        {tab === "colors" ? (
          <section className="panel marketing-settings-panel">
            <h3>تعيين لون لكل مسؤول</h3>
            <div className="marketing-color-list">
              {rows.map((row) => (
                <label key={row.id}>
                  <span className="marketing-user-color" style={{ backgroundColor: row.color }} />
                  <div><strong>{row.full_name}</strong><small>{row.email || "—"}</small></div>
                  <input type="color" value={row.color} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, color: event.target.value } : item))} />
                </label>
              ))}
            </div>
            <button className="save-user-button" disabled={busy} onClick={() => void saveColors()}><FloppyDisk size={18} />حفظ ألوان المسؤولين</button>
          </section>
        ) : null}

        {tab === "packages" ? (
          <section className="panel marketing-settings-panel">
            <div className="marketing-package-settings-grid">
              <LookupManager title="تصنيفات الباقات" description="الاختيارات التي تظهر في حقل التصنيف عند إنشاء الباقة." rows={packageSettings.categories} lookupType="category" entity="package_category" readOnly={readOnly} onReload={loadPackageSettings} />
              <LookupManager title="أنواع المبيعات" description="الاختيارات التي تظهر في حقل المبيعات عند إنشاء الباقة." rows={packageSettings.salesTypes} lookupType="sales_type" entity="package_sales_type" readOnly={readOnly} onReload={loadPackageSettings} />
            </div>
          </section>
        ) : null}
      </fieldset>
    </div>
  );
}
