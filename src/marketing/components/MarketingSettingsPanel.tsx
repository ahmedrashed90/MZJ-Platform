import { useEffect, useState, type ReactNode } from "react";
import {
  CurrencyCircleDollar,
  FloppyDisk,
  Package,
  Palette,
  PencilSimple,
  Plus,
  Tag,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { marketingFetch } from "../api";
import { DepartmentsPage } from "../pages/DepartmentsPage";
import "../marketing.css";

type MarketingSettingsTab = "departments" | "colors" | "package_options";
type UserColorRow = { id: string; full_name: string; email?: string | null; color: string };
type PackageOption = { id: string; name: string; sort_order: number };
type PackageOptionsPayload = { categories: PackageOption[]; salesTypes: PackageOption[] };
type OptionDraft = { id: string; name: string; sortOrder: number };

const emptyOption: OptionDraft = { id: "", name: "", sortOrder: 0 };

function normalizeTab(value: string | null): MarketingSettingsTab {
  if (value === "colors" || value === "package_options") return value;
  return "departments";
}

export function MarketingSettingsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<MarketingSettingsTab>(normalizeTab(requestedTab));
  const [rows, setRows] = useState<UserColorRow[]>([]);
  const [packageOptions, setPackageOptions] = useState<PackageOptionsPayload>({ categories: [], salesTypes: [] });
  const [categoryDraft, setCategoryDraft] = useState<OptionDraft>(emptyOption);
  const [salesDraft, setSalesDraft] = useState<OptionDraft>(emptyOption);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(normalizeTab(requestedTab));
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

  async function loadPackageOptions() {
    setError("");
    try {
      const payload = await marketingFetch<PackageOptionsPayload>("/api/marketing?resource=package_options");
      setPackageOptions(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات الباقات");
    }
  }

  useEffect(() => {
    if (tab === "colors") void loadColors();
    if (tab === "package_options") void loadPackageOptions();
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

  async function savePackageOption(kind: "category" | "sales_type", draft: OptionDraft) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_package_option", kind, ...draft }),
      });
      setMessage(result.message);
      if (kind === "category") setCategoryDraft(emptyOption);
      else setSalesDraft(emptyOption);
      await loadPackageOptions();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ إعداد الباقة");
    } finally {
      setBusy(false);
    }
  }

  async function deletePackageOption(kind: "category" | "sales_type", id: string) {
    if (!window.confirm("تأكيد حذف الاختيار؟")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_package_option", kind, id }),
      });
      setMessage(result.message);
      await loadPackageOptions();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حذف الاختيار");
    } finally {
      setBusy(false);
    }
  }

  function optionManager(
    title: string,
    description: string,
    icon: ReactNode,
    kind: "category" | "sales_type",
    items: PackageOption[],
    draft: OptionDraft,
    setDraft: (value: OptionDraft) => void,
  ) {
    return (
      <section className="marketing-package-option-card">
        <header><div className="marketing-settings-option-icon">{icon}</div><div><h3>{title}</h3><p>{description}</p></div></header>
        <div className="marketing-package-option-form">
          <label><span>الاسم</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label><span>الترتيب</span><input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })} /></label>
          <button type="button" className="primary" disabled={busy || !draft.name.trim()} onClick={() => void savePackageOption(kind, draft)}>{draft.id ? <FloppyDisk size={17} /> : <Plus size={17} />}{draft.id ? "حفظ التعديل" : "إضافة"}</button>
          {draft.id ? <button type="button" className="secondary" onClick={() => setDraft(emptyOption)}>إلغاء</button> : null}
        </div>
        <div className="marketing-package-option-list">
          {items.map((item) => (
            <article key={item.id}>
              <div><strong>{item.name}</strong><small>الترتيب: {Number(item.sort_order || 0).toLocaleString("ar-SA")}</small></div>
              <div className="marketing-inline-actions">
                <button type="button" className="secondary" onClick={() => setDraft({ id: item.id, name: item.name, sortOrder: Number(item.sort_order || 0) })}><PencilSimple size={16} />تعديل</button>
                <button type="button" className="danger" onClick={() => void deletePackageOption(kind, item.id)}><Trash size={16} />حذف</button>
              </div>
            </article>
          ))}
          {!items.length ? <div className="marketing-empty small">لا توجد اختيارات.</div> : null}
        </div>
      </section>
    );
  }

  return (
    <div className="marketing-settings-root">
      <section className="panel marketing-settings-panel marketing-settings-header">
        <div className="settings-card-title"><div><h2>إعدادات سيستم التسويق</h2></div></div>
        <nav className="marketing-settings-tabs" aria-label="إعدادات سيستم التسويق">
          <button type="button" className={tab === "departments" ? "active" : ""} onClick={() => chooseTab("departments")}><UsersThree size={18} weight="duotone" />الأقسام</button>
          <button type="button" className={tab === "colors" ? "active" : ""} onClick={() => chooseTab("colors")}><Palette size={18} weight="duotone" />تعيين لون لكل مسؤول</button>
          <button type="button" className={tab === "package_options" ? "active" : ""} onClick={() => chooseTab("package_options")}><Package size={18} weight="duotone" />إعدادات الباقات</button>
        </nav>
      </section>

      {readOnly ? <div className="connection-banner"><WarningCircle size={18} /><span>صلاحية مشاهدة فقط؛ تعديل إعدادات التسويق يحتاج صلاحية الإدارة.</span></div> : null}

      <fieldset className="settings-readonly-fieldset" disabled={readOnly}>
        {tab === "departments" ? <DepartmentsPage embedded /> : null}

        {tab === "colors" ? (
          <section className="panel marketing-settings-panel">
            {error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}
            {message ? <div className="success-banner">{message}</div> : null}
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

        {tab === "package_options" ? (
          <section className="panel marketing-settings-panel">
            {error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}
            {message ? <div className="success-banner">{message}</div> : null}
            <div className="marketing-package-options-grid">
              {optionManager("تصنيفات الباقات", "إضافة وتعديل التصنيفات المستخدمة داخل إنشاء الباقة.", <Tag size={22} weight="duotone" />, "category", packageOptions.categories, categoryDraft, setCategoryDraft)}
              {optionManager("أنواع المبيعات", "إضافة وتعديل اختيارات المبيعات المستخدمة داخل إنشاء الباقة.", <CurrencyCircleDollar size={22} weight="duotone" />, "sales_type", packageOptions.salesTypes, salesDraft, setSalesDraft)}
            </div>
          </section>
        ) : null}
      </fieldset>
    </div>
  );
}
