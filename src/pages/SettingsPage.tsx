import { useEffect, useMemo, useState } from "react";
import {
  FloppyDisk,
  GearSix,
  Megaphone,
  Path,
  UserPlus,
  UsersThree,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { CrmAdminPage } from "../crm/pages/CrmAdminPage";
import { TrackingSettingsPanel } from "../tracking/components/TrackingSettingsPanel";
import { OperationsSettingsPanel } from "../operations/components/OperationsSettingsPanel";
import { MarketingSettingsPanel } from "../marketing/components/MarketingSettingsPanel";

type MetaItem = { id: string; code: string; name: string; system_code?: string };
type MetaResponse = { ok: boolean; departments: MetaItem[]; branches: MetaItem[]; roles: MetaItem[]; error?: string };
type UserRow = {
  id: string;
  employee_no: string | null;
  full_name: string;
  email: string | null;
  mobile: string | null;
  next_erp_user_id: string | null;
  is_active: boolean;
  can_receive_leads: boolean;
  can_receive_tasks: boolean;
  role_id: string | null;
  department_id: string | null;
  branch_id: string | null;
  roles: string;
  departments: string;
  branches: string;
};
type UsersResponse = { ok: boolean; users: UserRow[]; error?: string };
type Section = "users" | "crm" | "marketing" | "operations" | "tracking";

const sections: Array<{ key: Section; label: string; icon: typeof GearSix }> = [
  { key: "users", label: "المستخدمون والصلاحيات", icon: UsersThree },
  { key: "crm", label: "إعدادات CRM", icon: GearSix },
  { key: "marketing", label: "إعدادات التسويق", icon: Megaphone },
  { key: "operations", label: "إعدادات العمليات", icon: Wrench },
  { key: "tracking", label: "إعدادات التتبع", icon: Path },
];

const initialForm = {
  employeeNo: "",
  fullName: "",
  email: "",
  mobile: "",
  nextErpUserId: "",
  password: "",
  roleId: "",
  departmentId: "",
  branchId: "",
  canReceiveLeads: false,
  canReceiveTasks: false,
};

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("section") as Section | null;
  const [section, setSection] = useState<Section>(requested && sections.some((item) => item.key === requested) ? requested : "users");
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState(initialForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [metaResponse, usersResponse] = await Promise.all([
        fetch("/api/meta", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      const metaPayload = await metaResponse.json() as MetaResponse;
      const usersPayload = await usersResponse.json() as UsersResponse;
      if (!metaResponse.ok || !metaPayload.ok) throw new Error(metaPayload.error || "تعذر تحميل بيانات الإعدادات");
      if (!usersResponse.ok || !usersPayload.ok) throw new Error(usersPayload.error || "تعذر تحميل المستخدمين");
      setMeta(metaPayload);
      setUsers(usersPayload.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر الاتصال بقاعدة البيانات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (requested && sections.some((item) => item.key === requested)) setSection(requested);
  }, [requested]);

  const selectedDepartment = useMemo(
    () => meta?.departments.find((item) => item.id === form.departmentId),
    [meta, form.departmentId],
  );

  const visibleRoles = useMemo(() => {
    const names = new Set<string>();
    return (meta?.roles || []).filter((item) => {
      const key = item.name.trim().toLocaleLowerCase("ar");
      if (!key || names.has(key)) return false;
      names.add(key);
      return true;
    });
  }, [meta]);

  function chooseSection(next: Section) {
    setSection(next);
    setSearchParams(next === "users" ? {} : { section: next }, { replace: true });
    setMessage("");
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/users", {
        method: editingUserId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingUserId ? { ...form, userId: editingUserId } : form),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || (editingUserId ? "تعذر تحديث المستخدم" : "تعذر إضافة المستخدم"));
      setForm(initialForm);
      setEditingUserId(null);
      setMessage(editingUserId ? "تم تحديث بيانات المستخدم بنجاح" : "تم إنشاء المستخدم وربطه بالقسم والفرع والصلاحية بنجاح");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : (editingUserId ? "تعذر تحديث المستخدم" : "تعذر إضافة المستخدم"));
    } finally {
      setSaving(false);
    }
  }

  function editUser(row: UserRow) {
    setEditingUserId(row.id);
    setForm({
      employeeNo: row.employee_no || "",
      fullName: row.full_name,
      email: row.email || "",
      mobile: row.mobile || "",
      nextErpUserId: row.next_erp_user_id || "",
      password: "",
      roleId: row.role_id || "",
      departmentId: row.department_id || "",
      branchId: row.branch_id || "",
      canReceiveLeads: row.can_receive_leads,
      canReceiveTasks: row.can_receive_tasks,
    });
    setMessage("");
    setError("");
  }

  return (
    <div className="module-page settings-page unified-settings-page">
      <header className="module-page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>إعدادات المنصة والأنظمة والمستخدمين من مكان مركزي واحد.</p>
        </div>
      </header>

      <nav className="unified-settings-nav" aria-label="أقسام الإعدادات">
        {sections.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className={section === key ? "active" : ""} onClick={() => chooseSection(key)}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner"><span>{message}</span></div> : null}

      {section === "users" ? (
        <div className="settings-grid">
          <section className="panel settings-table-card">
            <div className="settings-card-title"><div><UsersThree size={22} weight="duotone" /><h2>المستخدمون</h2></div><span>{loading ? "—" : users.length}</span></div>
            <div className="users-table-wrap"><table className="users-table"><thead><tr><th>المستخدم</th><th>رقم الموظف</th><th>ربط NEXT ERP</th><th>القسم</th><th>الفرع</th><th>الصلاحية</th><th>استقبال العملاء</th><th>الحالة</th></tr></thead><tbody>{!loading && users.length === 0 ? <tr><td colSpan={8} className="table-empty">لا يوجد مستخدمون حتى الآن</td></tr> : users.map((row) => <tr key={row.id} onClick={() => editUser(row)}><td><strong>{row.full_name}</strong><small>{row.email || row.mobile || "—"}</small></td><td>{row.employee_no || "—"}</td><td><strong>{row.next_erp_user_id || "—"}</strong></td><td>{row.departments || "—"}</td><td>{row.branches || "—"}</td><td>{row.roles || "—"}</td><td>{row.can_receive_leads ? "مفعّل" : "موقوف"}</td><td><span className={`user-status ${row.is_active ? "active" : "inactive"}`}>{row.is_active ? "فعال" : "موقوف"}</span></td></tr>)}</tbody></table></div>
          </section>

          <section className="panel user-form-card">
            <div className="settings-card-title"><div><UserPlus size={22} weight="duotone" /><h2>{editingUserId ? "تعديل مستخدم" : "إضافة مستخدم"}</h2></div></div>
            <form className="user-form" onSubmit={submit}>
              <label><span>اسم المستخدم</span><input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
              <div className="form-row"><label><span>رقم الموظف</span><input value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} /></label><label><span>رقم الجوال</span><input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></label></div>
              <label><span>البريد الإلكتروني</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label><span>ID المستخدم في NEXT ERP (الإيميل)</span><input type="email" value={form.nextErpUserId} onChange={(event) => setForm({ ...form, nextErpUserId: event.target.value })} placeholder="الإيميل المسجل داخل NEXT ERP" /></label>
              <label><span>{editingUserId ? "كلمة مرور جديدة (اختياري)" : "كلمة مرور مؤقتة"}</span><input required={!editingUserId} minLength={10} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
              <div className="form-row"><label><span>القسم</span><select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}><option value="">اختر القسم</option>{meta?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>الفرع</span><select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}><option value="">اختر الفرع</option>{meta?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
              <label><span>الدور والصلاحية</span><select value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}><option value="">اختر الدور</option>{visibleRoles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <div className="form-checks"><label><input type="checkbox" checked={form.canReceiveLeads} onChange={(event) => setForm({ ...form, canReceiveLeads: event.target.checked })} /><span>يستقبل عملاء ويدخل في قواعد التوزيع</span></label><label><input type="checkbox" checked={form.canReceiveTasks} onChange={(event) => setForm({ ...form, canReceiveTasks: event.target.checked })} /><span>يستقبل تاسكات</span></label></div>
              {selectedDepartment ? <p className="selected-department">النظام المرتبط بالقسم: {selectedDepartment.system_code}</p> : null}
              <button className="save-user-button" type="submit" disabled={saving || !meta?.ok}><FloppyDisk size={19} />{saving ? "جاري الحفظ..." : editingUserId ? "تحديث المستخدم" : "حفظ المستخدم"}</button>
            </form>
          </section>
        </div>
      ) : null}

      {section === "crm" ? <CrmAdminPage embedded /> : null}
      {section === "marketing" ? <MarketingSettingsPanel /> : null}
      {section === "operations" ? <OperationsSettingsPanel /> : null}
      {section === "tracking" ? <TrackingSettingsPanel /> : null}
    </div>
  );
}
