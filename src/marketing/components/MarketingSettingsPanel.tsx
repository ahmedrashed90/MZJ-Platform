import { useEffect, useMemo, useState } from "react";
import { FloppyDisk, PencilSimple, Trash } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { MarketingMeta } from "../types";
import { Field, MarketingError, MarketingLoading } from "./Common";

type Tab = "departments" | "actions" | "creatives" | "campaigns" | "platforms" | "categories" | "requests" | "attendance";

type SettingsForm = {
  id: string;
  name: string;
  code: string;
  shortCode: string;
  codePrefix: string;
  departmentId: string;
  primaryDepartmentId: string;
  platformId: string;
  dimensions: string;
  percentage: number;
  audience: string;
  isContentDepartment: boolean;
  isTerminal: boolean;
  isActive: boolean;
  sortOrder: number;
};

const tabs: Array<[Tab, string]> = [
  ["departments", "الأقسام واليوزرات"],
  ["actions", "إجراءات التكليف"],
  ["creatives", "أنواع الكرييتيف"],
  ["campaigns", "أنواع الحملات"],
  ["platforms", "المنصات والنشر"],
  ["categories", "تصنيفات الباقات"],
  ["requests", "حالات الطلبات"],
  ["attendance", "الحضور"],
];

const empty: SettingsForm = {
  id: "",
  name: "",
  code: "",
  shortCode: "",
  codePrefix: "MZJ",
  departmentId: "",
  primaryDepartmentId: "",
  platformId: "",
  dimensions: "",
  percentage: 0,
  audience: "user",
  isContentDepartment: false,
  isTerminal: false,
  isActive: true,
  sortOrder: 0,
};

export function MarketingSettingsPanel() {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [tab, setTab] = useState<Tab>("departments");
  const [form, setForm] = useState<SettingsForm>(empty);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [departmentUserIds, setDepartmentUserIds] = useState<string[]>([]);
  const [attendance, setAttendance] = useState({ workStartTime: "16:00", workEndTime: "21:00", graceMinutes: 0, idleAfterMinutes: 5, offlineAfterMinutes: 10 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const result = await marketingFetch<MarketingMeta>("/api/marketing?resource=meta");
      setMeta(result);
      if (!selectedDepartment && result.departments[0]) setSelectedDepartment(result.departments[0].id);
      if (result.attendanceSettings) {
        setAttendance({
          workStartTime: result.attendanceSettings.work_start_time.slice(0, 5),
          workEndTime: result.attendanceSettings.work_end_time.slice(0, 5),
          graceMinutes: result.attendanceSettings.grace_minutes,
          idleAfterMinutes: result.attendanceSettings.idle_after_minutes,
          offlineAfterMinutes: result.attendanceSettings.offline_after_minutes,
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!meta || !selectedDepartment) return;
    setDepartmentUserIds(meta.departmentUsers.filter((row) => row.department_id === selectedDepartment && row.is_active).map((row) => row.user_id));
  }, [meta, selectedDepartment]);

  const rows = useMemo(() => {
    if (!meta) return [];
    if (tab === "departments") return meta.departments;
    if (tab === "actions") return meta.actions;
    if (tab === "creatives") return meta.creativeTypes;
    if (tab === "campaigns") return meta.campaignTypes;
    if (tab === "platforms") return [...meta.platforms, ...meta.postTypes];
    if (tab === "categories") return meta.categories;
    if (tab === "requests") return meta.requestStatuses;
    return [];
  }, [meta, tab]);

  async function send(payload: Record<string, unknown>) {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await marketingFetch<{ ok: true; message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "settings_action", ...payload }) });
      setMessage(result.message);
      setForm(empty);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الإعداد");
    } finally { setBusy(false); }
  }

  function edit(row: Record<string, unknown>) {
    setForm({
      ...empty,
      id: String(row.id || ""),
      name: String(row.name || ""),
      code: String(row.code || ""),
      shortCode: String(row.short_code || ""),
      codePrefix: String(row.code_prefix || "MZJ"),
      departmentId: String(row.department_id || ""),
      primaryDepartmentId: String(row.primary_department_id || ""),
      platformId: String(row.platform_id || ""),
      dimensions: String(row.dimensions || ""),
      percentage: Number(row.percentage || 0),
      audience: String(row.audience || "user"),
      isContentDepartment: Boolean(row.is_content_department),
      isTerminal: Boolean(row.is_terminal),
      isActive: row.is_active !== false,
      sortOrder: Number(row.sort_order || 0),
    });
  }

  async function saveCurrent() {
    const base = { operation: "save", id: form.id, name: form.name, isActive: form.isActive, sortOrder: form.sortOrder };
    if (tab === "departments") return send({ ...base, entity: "department", code: form.code, isContentDepartment: form.isContentDepartment });
    if (tab === "actions") return send({ ...base, entity: "action", departmentId: form.departmentId, percentage: form.percentage, audience: form.audience, isRequired: true });
    if (tab === "creatives") return send({ ...base, entity: "creative_type", shortCode: form.shortCode, primaryDepartmentId: form.primaryDepartmentId });
    if (tab === "campaigns") return send({ ...base, entity: "campaign_type", shortCode: form.shortCode, codePrefix: form.codePrefix });
    if (tab === "categories") return send({ ...base, entity: "category" });
    if (tab === "requests") return send({ ...base, entity: "request_status", code: form.code, isTerminal: form.isTerminal });
    if (tab === "platforms") {
      return form.platformId
        ? send({ ...base, entity: "post_type", platformId: form.platformId, code: form.code, dimensions: form.dimensions })
        : send({ ...base, entity: "platform", code: form.code });
    }
  }

  async function remove(row: Record<string, unknown>) {
    if (!window.confirm("تأكيد تعطيل العنصر؟")) return;
    const entity = tab === "departments" ? "department"
      : tab === "actions" ? "action"
      : tab === "creatives" ? "creative_type"
      : tab === "campaigns" ? "campaign_type"
      : tab === "categories" ? "category"
      : tab === "requests" ? "request_status"
      : "platform_id" in row ? "post_type" : "platform";
    await send({ entity, operation: "delete", id: row.id });
  }

  if (!meta && !error) return <MarketingLoading text="جاري تحميل إعدادات التسويق..." />;
  if (!meta) return <MarketingError message={error} onRetry={() => void load()} />;
  if (!meta.permissions["marketing.settings.manage"]) return <MarketingError message="لا توجد لديك صلاحية إدارة إعدادات التسويق." />;

  return <div className="marketing-settings-panel">
    <nav className="marketing-settings-tabs">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setForm(empty); }}>{label}</button>)}</nav>
    {error ? <MarketingError message={error} /> : null}
    {message ? <div className="success-banner"><span>{message}</span></div> : null}

    {tab === "departments" ? <div className="marketing-settings-users panel">
      <h2>ربط اليوزرات بالأقسام</h2>
      <Field label="القسم"><select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>{meta.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
      <div className="marketing-check-grid">{meta.users.map((row) => <label key={row.id}><input type="checkbox" checked={departmentUserIds.includes(row.id)} onChange={(event) => setDepartmentUserIds((values) => event.target.checked ? [...new Set([...values, row.id])] : values.filter((id) => id !== row.id))} /><span>{row.full_name}</span></label>)}</div>
      <button className="marketing-primary-button" type="button" disabled={busy} onClick={() => void send({ entity: "department_users", departmentId: selectedDepartment, userIds: departmentUserIds })}><FloppyDisk size={18} />حفظ يوزرات القسم</button>
    </div> : null}

    {tab === "attendance" ? <section className="panel marketing-settings-form">
      <h2>مواعيد الدوام والحضور</h2>
      <div className="marketing-form-grid">
        <Field label="بداية الدوام"><input type="time" value={attendance.workStartTime} onChange={(event) => setAttendance({ ...attendance, workStartTime: event.target.value })} /></Field>
        <Field label="نهاية الدوام"><input type="time" value={attendance.workEndTime} onChange={(event) => setAttendance({ ...attendance, workEndTime: event.target.value })} /></Field>
        <Field label="دقائق السماح"><input type="number" min="0" value={attendance.graceMinutes} onChange={(event) => setAttendance({ ...attendance, graceMinutes: Number(event.target.value) })} /></Field>
        <Field label="اعتبار خامل بعد"><input type="number" min="1" value={attendance.idleAfterMinutes} onChange={(event) => setAttendance({ ...attendance, idleAfterMinutes: Number(event.target.value) })} /></Field>
        <Field label="اعتبار أوفلاين بعد"><input type="number" min="2" value={attendance.offlineAfterMinutes} onChange={(event) => setAttendance({ ...attendance, offlineAfterMinutes: Number(event.target.value) })} /></Field>
      </div>
      <button className="marketing-primary-button" type="button" disabled={busy} onClick={() => void send({ entity: "attendance_settings", ...attendance })}><FloppyDisk size={18} />حفظ مواعيد الدوام</button>
    </section> : null}

    {tab !== "attendance" ? <div className="marketing-settings-grid">
      <section className="panel marketing-table-wrap">
        <div className="marketing-section-title"><h2>العناصر المحفوظة</h2><span>{rows.length}</span></div>
        <table><thead><tr><th>الاسم</th><th>الكود / القسم</th><th>النسبة / الحالة</th><th /></tr></thead><tbody>{rows.map((row) => {
          const item = row as unknown as Record<string, unknown>;
          const state = item.percentage !== undefined ? `${item.percentage}%` : item.is_terminal ? "حالة نهائية" : item.is_active === false ? "موقوف" : "فعال";
          return <tr key={`${item.id}-${item.name}`}><td><strong>{String(item.name || "—")}</strong></td><td>{String(item.short_code || item.code || item.department_name || item.platform_name || "—")}</td><td>{state}</td><td><div className="marketing-table-actions"><button type="button" onClick={() => edit(item)} aria-label="تعديل"><PencilSimple size={16} /></button><button type="button" onClick={() => void remove(item)} aria-label="تعطيل"><Trash size={16} /></button></div></td></tr>;
        })}</tbody></table>
      </section>

      <section className="panel marketing-settings-form">
        <h2>{form.id ? "تعديل العنصر" : "إضافة عنصر"}</h2>
        <Field label="الاسم"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        {tab === "departments" || tab === "platforms" || tab === "requests" ? <Field label="الكود"><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></Field> : null}
        {tab === "creatives" || tab === "campaigns" ? <Field label="الكود المختصر"><input value={form.shortCode} onChange={(event) => setForm({ ...form, shortCode: event.target.value })} /></Field> : null}
        {tab === "campaigns" ? <Field label="بادئة كود الحملة"><input value={form.codePrefix} onChange={(event) => setForm({ ...form, codePrefix: event.target.value })} /></Field> : null}
        {tab === "actions" ? <><Field label="القسم"><select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}><option value="">اختر القسم</option>{meta.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label="النسبة"><input type="number" min="0" max="100" value={form.percentage} onChange={(event) => setForm({ ...form, percentage: Number(event.target.value) })} /></Field><Field label="الظهور"><select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}><option value="user">يوزر</option><option value="admin">أدمن</option><option value="both">الكل</option></select></Field></> : null}
        {tab === "creatives" ? <Field label="القسم الأساسي"><select value={form.primaryDepartmentId} onChange={(event) => setForm({ ...form, primaryDepartmentId: event.target.value })}><option value="">بدون</option>{meta.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
        {tab === "platforms" ? <><Field label="نوع العنصر"><select value={form.platformId} onChange={(event) => setForm({ ...form, platformId: event.target.value })}><option value="">منصة رئيسية</option>{meta.platforms.map((row) => <option key={row.id} value={row.id}>نوع نشر تابع لـ {row.name}</option>)}</select></Field>{form.platformId ? <Field label="المقاس"><input value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} placeholder="1080x1920" /></Field> : null}</> : null}
        {tab === "departments" ? <label className="marketing-toggle"><input type="checkbox" checked={form.isContentDepartment} onChange={(event) => setForm({ ...form, isContentDepartment: event.target.checked })} /><span>قسم المحتوى</span></label> : null}
        {tab === "requests" ? <label className="marketing-toggle"><input type="checkbox" checked={form.isTerminal} onChange={(event) => setForm({ ...form, isTerminal: event.target.checked })} /><span>حالة نهائية تغلق الطلب</span></label> : null}
        <Field label="الترتيب"><input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></Field>
        <label className="marketing-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>فعال</span></label>
        <div className="marketing-form-actions"><button className="marketing-primary-button" type="button" disabled={busy || !form.name.trim()} onClick={() => void saveCurrent()}><FloppyDisk size={18} />حفظ</button>{form.id ? <button type="button" onClick={() => setForm(empty)}>إلغاء التعديل</button> : null}</div>
      </section>
    </div> : null}
  </div>;
}
