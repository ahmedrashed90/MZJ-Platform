import { useEffect, useMemo, useState } from "react";
import {
  AddressBook,
  Buildings,
  FloppyDisk,
  Key,
  ListMagnifyingGlass,
  Plus,
  ShieldCheck,
  ShieldWarning,
  UserCircleGear,
  UsersThree,
} from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { hasAnyPermission, hasPermission } from "../../components/PermissionGate";

type MetaItem = { id: string; code: string; name: string; system_code?: string; is_active?: boolean };
type SystemItem = { code: string; name_ar: string; is_active: boolean; sort_order: number };
type PageItem = { id: string; system_code: string; code: string; name_ar: string; route: string | null; sort_order: number };
type PermissionItem = {
  id: string;
  code: string;
  system_code: string;
  page_code: string | null;
  action_code: string;
  name_ar: string;
  description_ar: string | null;
  category: string;
  is_sensitive: boolean;
  is_active: boolean;
  sort_order: number;
};
type RoleItem = { id: string; code: string; name: string; is_system: boolean; permission_codes?: string[] };
type Catalog = {
  systems: SystemItem[];
  pages: PageItem[];
  permissions: PermissionItem[];
  roles: RoleItem[];
  branches: MetaItem[];
  departments: MetaItem[];
};
type UserRow = {
  id: string;
  employee_no: string | null;
  full_name: string;
  email: string | null;
  mobile: string | null;
  is_active: boolean;
  can_receive_leads: boolean;
  can_receive_tasks: boolean;
  roles: string;
  departments: string;
  branches: string;
  systems: string;
};
type AccessPayload = {
  user: UserRow & { permission_version: number; last_login_at: string | null; created_at: string };
  roles: Array<{ id: string; code: string; name: string }>;
  systems: Array<{ system_code: string; is_enabled: boolean; role_id: string | null; role_name: string | null; data_scope: string }>;
  branches: Array<MetaItem & { is_primary: boolean }>;
  departments: Array<MetaItem & { is_primary: boolean }>;
  overrides: Array<{ code: string; effect: "allow" | "deny"; reason: string | null }>;
  scopes: Array<{ system_code: string; scope_code: string; branch_ids: string[]; department_ids: string[] }>;
  access: {
    permissions: string[];
    inheritedPermissions: string[];
    storedInheritedPermissions: string[];
    allowedOverrides: string[];
    deniedOverrides: string[];
    systemCodes: string[];
    dataScopes: Record<string, string>;
  };
};
type InnerTab = "users" | "roles" | "organization" | "permissions" | "permission-log" | "security";
type OverrideState = "inherit" | "allow" | "deny";

type UserSystemDraft = {
  systemCode: string;
  isEnabled: boolean;
  roleId: string;
  dataScope: string;
  branchIds: string[];
  departmentIds: string[];
};

const systemCodes = ["operations", "tracking", "marketing", "crm"];
const dataScopes = [
  ["self", "المستخدم نفسه"],
  ["assigned", "المسند إليه فقط"],
  ["created_by_me", "الذي أنشأه المستخدم"],
  ["branch", "الفرع الأساسي"],
  ["branches", "الفروع المختارة"],
  ["department", "القسم الأساسي"],
  ["departments", "الأقسام المختارة"],
  ["branch_and_department", "الفرع والقسم"],
  ["source_branch", "الفرع المصدر"],
  ["destination_branch", "الفرع المستهدف"],
  ["workflow_assigned", "مراحل العمل المسندة"],
  ["all", "كل البيانات"],
] as const;

const tabs: Array<{ key: InnerTab; label: string; icon: typeof UsersThree; permissions: string[] }> = [
  { key: "users", label: "المستخدمون", icon: UsersThree, permissions: ["settings.users.view", "settings.users.create", "settings.users.update", "settings.users.disable", "settings.permissions.manage"] },
  { key: "roles", label: "الأدوار وقوالب الصلاحيات", icon: UserCircleGear, permissions: ["settings.roles.manage"] },
  { key: "organization", label: "الفروع والأقسام", icon: Buildings, permissions: ["settings.branches.manage"] },
  { key: "permissions", label: "دليل الصلاحيات", icon: Key, permissions: ["settings.users.view", "settings.permissions.manage"] },
  { key: "permission-log", label: "سجل تعديلات الصلاحيات", icon: ShieldCheck, permissions: ["settings.audit.view"] },
  { key: "security", label: "سجل النشاط الأمني", icon: ShieldWarning, permissions: ["settings.security.view"] },
];

const emptyCreateForm = {
  employeeNo: "",
  fullName: "",
  email: "",
  mobile: "",
  password: "",
  roleId: "",
  departmentId: "",
  branchId: "",
  canReceiveLeads: false,
  canReceiveTasks: false,
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function MultiChecks({ items, selected, onChange, disabled = false }: { items: MetaItem[]; selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <div className="permission-multi-checks">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(checked ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
            />
            <span>{item.name}</span>
          </label>
        );
      })}
      {items.length === 0 ? <span className="muted-inline">لا توجد عناصر متاحة</span> : null}
    </div>
  );
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-SA");
}

export function UsersPermissionsSection() {
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleTabs = tabs.filter((item) => hasAnyPermission(currentUser, item.permissions));
  const requestedTab = searchParams.get("tab") as InnerTab | null;
  const defaultTab = visibleTabs[0]?.key || "users";
  const [tab, setTab] = useState<InnerTab>(visibleTabs.some((item) => item.key === requestedTab) ? requestedTab! : defaultTab);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [selectedSystem, setSelectedSystem] = useState("operations");
  const [systemDrafts, setSystemDrafts] = useState<Record<string, UserSystemDraft>>({});
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, OverrideState>>({});
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState({ employeeNo: "", fullName: "", email: "", mobile: "", canReceiveLeads: false, canReceiveTasks: false });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<string[]>([]);
  const [permissionFilter, setPermissionFilter] = useState("");
  const [permissionSystemFilter, setPermissionSystemFilter] = useState("");
  const [permissionLog, setPermissionLog] = useState<any[]>([]);
  const [securityLog, setSecurityLog] = useState<any[]>([]);
  const [organizationForm, setOrganizationForm] = useState({ entity: "branch", code: "", name: "", systemCode: "crm" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canCreate = hasPermission(currentUser, "settings.users.create");
  const canViewAccess = hasAnyPermission(currentUser, ["settings.users.view", "settings.users.update", "settings.users.disable", "settings.permissions.manage"]);
  const canUpdate = hasPermission(currentUser, "settings.users.update");
  const canDisable = hasPermission(currentUser, "settings.users.disable");
  const canManagePermissions = hasPermission(currentUser, "settings.permissions.manage");

  function selectTab(next: InnerTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("section", "users");
    params.set("tab", next);
    setSearchParams(params, { replace: true });
    setMessage("");
    setError("");
  }

  async function loadBase() {
    setLoading(true);
    setError("");
    try {
      const requests: Promise<Response>[] = [fetch("/api/access-control?view=catalog", { cache: "no-store" })];
      const canLoadUsers = hasAnyPermission(currentUser, ["settings.users.view", "settings.users.create", "settings.users.update", "settings.users.disable", "settings.permissions.manage"]);
      if (canLoadUsers) requests.push(fetch("/api/users", { cache: "no-store" }));
      if (hasPermission(currentUser, "settings.roles.manage")) requests.push(fetch("/api/access-control?view=roles", { cache: "no-store" }));
      const responses = await Promise.all(requests);
      const payloads = await Promise.all(responses.map(readJson));
      if (!responses[0].ok || !payloads[0].ok) throw new Error(payloads[0].error || "تعذر تحميل دليل الصلاحيات");
      setCatalog(payloads[0] as Catalog);
      let index = 1;
      if (canLoadUsers) {
        if (!responses[index].ok || !payloads[index].ok) throw new Error(payloads[index].error || "تعذر تحميل المستخدمين");
        setUsers(payloads[index].users || []);
        index += 1;
      }
      if (hasPermission(currentUser, "settings.roles.manage")) {
        if (!responses[index].ok || !payloads[index].ok) throw new Error(payloads[index].error || "تعذر تحميل الأدوار");
        setRoles(payloads[index].roles || []);
      } else {
        setRoles((payloads[0].roles || []) as RoleItem[]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات الصلاحيات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => {
    if (requestedTab && visibleTabs.some((item) => item.key === requestedTab)) setTab(requestedTab);
  }, [requestedTab, currentUser?.permissions?.join("|")]);

  async function loadUser(userId: string) {
    setSelectedUserId(userId);
    setAccess(null);
    setError("");
    try {
      const response = await fetch(`/api/access-control?view=user&id=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تحميل صلاحيات المستخدم");
      const nextAccess = payload as AccessPayload;
      setAccess(nextAccess);
      setEditForm({
        employeeNo: nextAccess.user.employee_no || "",
        fullName: nextAccess.user.full_name || "",
        email: nextAccess.user.email || "",
        mobile: nextAccess.user.mobile || "",
        canReceiveLeads: nextAccess.user.can_receive_leads === true,
        canReceiveTasks: nextAccess.user.can_receive_tasks === true,
      });
      setRoleIds(nextAccess.roles.map((item) => item.id));
      const systems: Record<string, UserSystemDraft> = {};
      for (const code of systemCodes) {
        const row = nextAccess.systems.find((item) => item.system_code === code);
        const scope = nextAccess.scopes.find((item) => item.system_code === code);
        systems[code] = {
          systemCode: code,
          isEnabled: row?.is_enabled === true,
          roleId: row?.role_id || "",
          dataScope: row?.data_scope || scope?.scope_code || "assigned",
          branchIds: scope?.branch_ids || nextAccess.branches.map((item) => item.id),
          departmentIds: scope?.department_ids || nextAccess.departments.filter((item) => item.system_code === code || code === "crm").map((item) => item.id),
        };
      }
      setSystemDrafts(systems);
      const overrides: Record<string, OverrideState> = {};
      for (const item of nextAccess.overrides) overrides[item.code] = item.effect;
      setOverrideDrafts(overrides);
      const firstEnabled = systemCodes.find((code) => systems[code].isEnabled);
      setSelectedSystem(firstEnabled || "operations");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل صلاحيات المستخدم");
    }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر إضافة المستخدم");
      setCreateForm(emptyCreateForm);
      setMessage("تم إنشاء المستخدم. افتح بياناته لتحديد الأنظمة والنطاق والصلاحيات التفصيلية.");
      await loadBase();
      if (payload.user?.id) await loadUser(payload.user.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر إضافة المستخدم");
    } finally {
      setSaving(false);
    }
  }

  async function saveUserProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedUserId) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", userId: selectedUserId, ...editForm }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تعديل المستخدم");
      setMessage("تم تحديث بيانات المستخدم.");
      await loadBase();
      await loadUser(selectedUserId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر تعديل المستخدم");
    } finally {
      setSaving(false);
    }
  }

  async function saveUserAccess() {
    if (!selectedUserId || !access) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const overrides = Object.entries(overrideDrafts)
        .filter(([, effect]) => effect !== "inherit")
        .map(([code, effect]) => ({ code, effect }));
      const response = await fetch("/api/access-control", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save-user-access",
          userId: selectedUserId,
          roleIds,
          replaceRoles: true,
          replaceOrganization: true,
          systems: systemCodes.map((code) => systemDrafts[code]),
          overrides,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر حفظ صلاحيات المستخدم");
      setMessage("تم حفظ الأنظمة والنطاق والصلاحيات المركزية للمستخدم.");
      await loadUser(selectedUserId);
      await loadBase();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الصلاحيات");
    } finally {
      setSaving(false);
    }
  }

  async function changeUserStatus(row: UserRow) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status", userId: row.id, isActive: !row.is_active }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تغيير حالة المستخدم");
      setMessage(row.is_active ? "تم تعطيل المستخدم وإبطال جلساته الحالية." : "تم إعادة تفعيل المستخدم مع الاحتفاظ بصلاحياته المخزنة.");
      await loadBase();
      if (selectedUserId === row.id) await loadUser(row.id);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "تعذر تغيير حالة المستخدم");
    } finally {
      setSaving(false);
    }
  }

  function selectRole(roleId: string) {
    setSelectedRoleId(roleId);
    const role = roles.find((item) => item.id === roleId);
    setRolePermissionDraft(role?.permission_codes || []);
  }

  async function saveRole() {
    if (!selectedRoleId) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/access-control", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-role", roleId: selectedRoleId, permissionCodes: rolePermissionDraft }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر حفظ قالب الدور");
      setMessage("تم تحديث قالب صلاحيات الدور وإصدار صلاحيات المستخدمين المرتبطين به.");
      await loadBase();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الدور");
    } finally {
      setSaving(false);
    }
  }

  async function saveOrganization(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/access-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-organization", ...organizationForm }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر حفظ الفرع أو القسم");
      setOrganizationForm({ entity: organizationForm.entity, code: "", name: "", systemCode: organizationForm.systemCode });
      setMessage("تم الحفظ داخل دليل الفروع والأقسام المركزي.");
      await loadBase();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الفرع أو القسم");
    } finally {
      setSaving(false);
    }
  }

  async function loadLog(kind: "permission-log" | "security") {
    setLoading(true);
    setError("");
    try {
      const view = kind === "security" ? "security-log" : "permission-log";
      const response = await fetch(`/api/access-control?view=${view}`, { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تحميل السجل");
      if (kind === "security") setSecurityLog(payload.entries || []);
      else setPermissionLog(payload.entries || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل السجل");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "permission-log" && permissionLog.length === 0) void loadLog("permission-log");
    if (tab === "security" && securityLog.length === 0) void loadLog("security");
  }, [tab]);

  const currentSystemDraft = systemDrafts[selectedSystem];
  const currentSystemPermissions = useMemo(
    () => (catalog?.permissions || []).filter((item) => item.system_code === selectedSystem),
    [catalog, selectedSystem],
  );
  const permissionPages = useMemo(() => {
    const pages = (catalog?.pages || []).filter((item) => item.system_code === selectedSystem);
    return [
      { code: "__system__", name_ar: "دخول النظام" },
      ...pages,
    ];
  }, [catalog, selectedSystem]);
  const filteredDirectory = useMemo(() => {
    const query = permissionFilter.trim().toLowerCase();
    return (catalog?.permissions || []).filter((item) =>
      (!permissionSystemFilter || item.system_code === permissionSystemFilter)
      && (!query || item.code.toLowerCase().includes(query) || item.name_ar.toLowerCase().includes(query)),
    );
  }, [catalog, permissionFilter, permissionSystemFilter]);

  return (
    <section className="central-access-section">
      <div className="central-access-header panel">
        <div>
          <h2>المستخدمون والصلاحيات</h2>
          <p>المصدر المركزي الوحيد للأنظمة والأدوار والنطاق والصفحات والإجراءات وسجلات الأمان.</p>
        </div>
        <ShieldCheck size={42} weight="duotone" />
      </div>

      <nav className="central-access-tabs" aria-label="أقسام المستخدمين والصلاحيات">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => selectTab(key)}>
            <Icon size={18} weight="duotone" /><span>{label}</span>
          </button>
        ))}
      </nav>

      {error ? <div className="connection-banner"><ShieldWarning size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner"><span>{message}</span></div> : null}

      {tab === "users" ? (
        <div className="central-users-layout">
          <section className="panel central-users-table-card">
            <div className="settings-card-title"><div><UsersThree size={22} weight="duotone" /><h3>المستخدمون</h3></div><span>{loading ? "—" : users.length}</span></div>
            <div className="users-table-wrap">
              <table className="users-table central-users-table">
                <thead><tr><th>المستخدم</th><th>الأنظمة</th><th>الأدوار</th><th>الفروع والأقسام</th><th>الحالة</th><th>إجراء</th></tr></thead>
                <tbody>
                  {!loading && users.length === 0 ? <tr><td colSpan={6} className="table-empty">لا يوجد مستخدمون</td></tr> : users.map((row) => (
                    <tr key={row.id} className={selectedUserId === row.id ? "selected" : ""}>
                      <td><button type="button" className="user-name-button" onClick={() => void loadUser(row.id)}><strong>{row.full_name}</strong><small>{row.email || row.mobile || "—"}</small></button></td>
                      <td>{row.systems || "لا يوجد"}</td>
                      <td>{row.roles || "—"}</td>
                      <td><span>{row.branches || "—"}</span><small>{row.departments || "—"}</small></td>
                      <td><span className={`user-status ${row.is_active ? "active" : "inactive"}`}>{row.is_active ? "فعال" : "موقوف"}</span></td>
                      <td><div className="table-action-buttons">{canViewAccess ? <button type="button" onClick={() => void loadUser(row.id)}>الصلاحيات</button> : null}{canDisable ? <button type="button" className={row.is_active ? "danger-soft" : "success-soft"} disabled={saving} onClick={() => void changeUserStatus(row)}>{row.is_active ? "تعطيل" : "تفعيل"}</button> : null}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {canCreate ? (
            <section className="panel central-create-user-card">
              <div className="settings-card-title"><div><Plus size={22} weight="duotone" /><h3>إضافة مستخدم</h3></div></div>
              <form className="user-form" onSubmit={createUser}>
                <label><span>اسم المستخدم</span><input required value={createForm.fullName} onChange={(event) => setCreateForm({ ...createForm, fullName: event.target.value })} /></label>
                <div className="form-row"><label><span>رقم الموظف</span><input value={createForm.employeeNo} onChange={(event) => setCreateForm({ ...createForm, employeeNo: event.target.value })} /></label><label><span>رقم الجوال</span><input value={createForm.mobile} onChange={(event) => setCreateForm({ ...createForm, mobile: event.target.value })} /></label></div>
                <label><span>البريد الإلكتروني</span><input type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} /></label>
                <label><span>كلمة مرور مؤقتة</span><input required minLength={10} type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} /></label>
                <div className="form-row"><label><span>الدور الأولي</span><select required value={createForm.roleId} onChange={(event) => setCreateForm({ ...createForm, roleId: event.target.value })}><option value="">اختر الدور</option>{catalog?.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>القسم الأولي</span><select value={createForm.departmentId} onChange={(event) => setCreateForm({ ...createForm, departmentId: event.target.value })}><option value="">بدون قسم</option>{catalog?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
                <label><span>الفرع الأولي</span><select value={createForm.branchId} onChange={(event) => setCreateForm({ ...createForm, branchId: event.target.value })}><option value="">بدون فرع</option>{catalog?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <div className="form-checks"><label><input type="checkbox" checked={createForm.canReceiveLeads} onChange={(event) => setCreateForm({ ...createForm, canReceiveLeads: event.target.checked })} /><span>يستقبل العملاء</span></label><label><input type="checkbox" checked={createForm.canReceiveTasks} onChange={(event) => setCreateForm({ ...createForm, canReceiveTasks: event.target.checked })} /><span>يستقبل التاسكات</span></label></div>
                <button className="save-user-button" type="submit" disabled={saving}><FloppyDisk size={19} />{saving ? "جاري الحفظ..." : "إنشاء المستخدم"}</button>
              </form>
            </section>
          ) : null}

          {selectedUserId ? (
            <section className="panel user-access-editor">
              {!access ? <div className="table-empty">جاري تحميل صلاحيات المستخدم...</div> : (
                <>
                  <div className="user-access-title">
                    <div><AddressBook size={28} weight="duotone" /><div><h3>{access.user.full_name}</h3><p>{access.user.email || access.user.mobile || "—"} · آخر دخول: {formatDate(access.user.last_login_at)}</p></div></div>
                    <span className={`user-status ${access.user.is_active ? "active" : "inactive"}`}>{access.user.is_active ? "فعال" : "موقوف"}</span>
                  </div>

                  {canUpdate ? (
                    <form className="user-form user-edit-form" onSubmit={saveUserProfile}>
                      <h4>بيانات المستخدم</h4>
                      <div className="form-row"><label><span>الاسم</span><input required value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} /></label><label><span>رقم الموظف</span><input value={editForm.employeeNo} onChange={(event) => setEditForm({ ...editForm, employeeNo: event.target.value })} /></label></div>
                      <div className="form-row"><label><span>البريد</span><input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></label><label><span>الجوال</span><input value={editForm.mobile} onChange={(event) => setEditForm({ ...editForm, mobile: event.target.value })} /></label></div>
                      <div className="form-checks"><label><input type="checkbox" checked={editForm.canReceiveLeads} onChange={(event) => setEditForm({ ...editForm, canReceiveLeads: event.target.checked })} /><span>يستقبل العملاء</span></label><label><input type="checkbox" checked={editForm.canReceiveTasks} onChange={(event) => setEditForm({ ...editForm, canReceiveTasks: event.target.checked })} /><span>يستقبل التاسكات</span></label></div>
                      <button className="save-user-button" type="submit" disabled={saving}><FloppyDisk size={18} />حفظ بيانات المستخدم</button>
                    </form>
                  ) : null}

                  <div className="global-role-picker">
                    <strong>الأدوار العامة وقوالب الصلاحيات</strong>
                    <MultiChecks items={(catalog?.roles || []).map((item) => ({ id: item.id, code: item.code, name: item.name }))} selected={roleIds} onChange={setRoleIds} disabled={!canManagePermissions} />
                  </div>

                  <div className="system-access-tabs">
                    {systemCodes.map((code) => {
                      const system = catalog?.systems.find((item) => item.code === code);
                      const enabled = systemDrafts[code]?.isEnabled;
                      return <button key={code} type="button" className={`${selectedSystem === code ? "active" : ""} ${enabled ? "enabled" : "disabled"}`} onClick={() => setSelectedSystem(code)}><span>{system?.name_ar || code}</span><small>{enabled ? "مسموح" : "ممنوع"}</small></button>;
                    })}
                  </div>

                  {currentSystemDraft ? (
                    <div className="system-access-editor">
                      <div className="system-access-controls">
                        <label className="system-toggle"><input type="checkbox" checked={currentSystemDraft.isEnabled} disabled={!canManagePermissions} onChange={(event) => setSystemDrafts({ ...systemDrafts, [selectedSystem]: { ...currentSystemDraft, isEnabled: event.target.checked } })} /><span>السماح بدخول النظام</span></label>
                        <label><span>الدور داخل النظام</span><select value={currentSystemDraft.roleId} disabled={!canManagePermissions} onChange={(event) => setSystemDrafts({ ...systemDrafts, [selectedSystem]: { ...currentSystemDraft, roleId: event.target.value } })}><option value="">بدون دور خاص</option>{catalog?.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                        <label><span>نطاق البيانات</span><select value={currentSystemDraft.dataScope} disabled={!canManagePermissions} onChange={(event) => setSystemDrafts({ ...systemDrafts, [selectedSystem]: { ...currentSystemDraft, dataScope: event.target.value } })}>{dataScopes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      </div>
                      <div className="scope-grid">
                        <div><strong>الفروع المسموحة</strong><MultiChecks items={catalog?.branches || []} selected={currentSystemDraft.branchIds} disabled={!canManagePermissions} onChange={(branchIds) => setSystemDrafts({ ...systemDrafts, [selectedSystem]: { ...currentSystemDraft, branchIds } })} /></div>
                        <div><strong>الأقسام المسموحة</strong><MultiChecks items={(catalog?.departments || []).filter((item) => item.system_code === selectedSystem || selectedSystem === "crm" && ["crm", "core"].includes(item.system_code || ""))} selected={currentSystemDraft.departmentIds} disabled={!canManagePermissions} onChange={(departmentIds) => setSystemDrafts({ ...systemDrafts, [selectedSystem]: { ...currentSystemDraft, departmentIds } })} /></div>
                      </div>

                      <div className="permission-editor-groups">
                        {permissionPages.map((page) => {
                          const pagePermissions = currentSystemPermissions.filter((item) => page.code === "__system__" ? item.category === "system" : item.page_code === page.code);
                          if (pagePermissions.length === 0) return null;
                          return (
                            <div className="permission-page-group" key={page.code}>
                              <h4>{page.name_ar}</h4>
                              {pagePermissions.map((permission) => {
                                const inherited = (access.access.storedInheritedPermissions || access.access.inheritedPermissions).includes(permission.code);
                                const effect = overrideDrafts[permission.code] || "inherit";
                                const effective = effect === "deny" ? false : effect === "allow" ? true : access.access.permissions.includes(permission.code);
                                return (
                                  <div className="permission-edit-row" key={permission.code}>
                                    <div><strong>{permission.name_ar}</strong><code>{permission.code}</code></div>
                                    <div className="permission-badges"><span className={inherited ? "inherited" : "neutral"}>{inherited ? "موروثة من الدور" : "غير موروثة"}</span><span className={effective ? "allowed" : "denied"}>{effective ? "مسموحة" : "ممنوعة"}</span>{permission.is_sensitive ? <span className="sensitive">حساسة</span> : null}</div>
                                    <select disabled={!canManagePermissions} value={effect} onChange={(event) => setOverrideDrafts({ ...overrideDrafts, [permission.code]: event.target.value as OverrideState })}><option value="inherit">حسب الدور</option><option value="allow">سماح فردي</option><option value="deny">منع فردي</option></select>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {canManagePermissions ? <button type="button" className="save-user-button user-access-save" disabled={saving} onClick={() => void saveUserAccess()}><FloppyDisk size={19} />{saving ? "جاري الحفظ..." : "حفظ صلاحيات المستخدم"}</button> : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "roles" ? (
        <div className="roles-editor-layout">
          <section className="panel roles-list-card">
            <h3>الأدوار وقوالب الصلاحيات</h3>
            <p>الدور قالب افتراضي، ويمكن إضافة سماح أو منع فردي من ملف المستخدم.</p>
            <div className="roles-list">{roles.map((role) => <button key={role.id} type="button" className={selectedRoleId === role.id ? "active" : ""} onClick={() => selectRole(role.id)}><strong>{role.name}</strong><code>{role.code}</code><span>{role.permission_codes?.length || 0} صلاحية</span></button>)}</div>
          </section>
          <section className="panel role-permissions-card">
            {!selectedRoleId ? <div className="table-empty">اختر دورًا لعرض قالب صلاحياته</div> : (
              <>
                <div className="role-permissions-head"><div><h3>{roles.find((item) => item.id === selectedRoleId)?.name}</h3><p>حدد الأنظمة والصفحات والإجراءات الموروثة من هذا الدور.</p></div><button type="button" className="save-user-button" disabled={saving} onClick={() => void saveRole()}><FloppyDisk size={18} />حفظ القالب</button></div>
                <div className="role-permission-systems">{catalog?.systems.map((system) => {
                  const permissions = catalog.permissions.filter((item) => item.system_code === system.code);
                  return <div key={system.code} className="role-permission-group"><h4>{system.name_ar}</h4>{permissions.map((permission) => <label key={permission.code}><input type="checkbox" checked={rolePermissionDraft.includes(permission.code)} onChange={() => setRolePermissionDraft(rolePermissionDraft.includes(permission.code) ? rolePermissionDraft.filter((code) => code !== permission.code) : [...rolePermissionDraft, permission.code])} /><span><strong>{permission.name_ar}</strong><code>{permission.code}</code></span></label>)}</div>;
                })}</div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "organization" ? (
        <div className="organization-layout">
          <section className="panel organization-form-card">
            <h3>إضافة فرع أو قسم</h3>
            <form className="user-form" onSubmit={saveOrganization}>
              <label><span>النوع</span><select value={organizationForm.entity} onChange={(event) => setOrganizationForm({ ...organizationForm, entity: event.target.value })}><option value="branch">فرع</option><option value="department">قسم</option></select></label>
              <label><span>الكود الثابت</span><input required value={organizationForm.code} onChange={(event) => setOrganizationForm({ ...organizationForm, code: event.target.value })} placeholder="warehouse" /></label>
              <label><span>الاسم</span><input required value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} placeholder="المستودع" /></label>
              {organizationForm.entity === "department" ? <label><span>النظام</span><select value={organizationForm.systemCode} onChange={(event) => setOrganizationForm({ ...organizationForm, systemCode: event.target.value })}>{catalog?.systems.filter((item) => item.code !== "core").map((item) => <option key={item.code} value={item.code}>{item.name_ar}</option>)}</select></label> : null}
              <button className="save-user-button" type="submit" disabled={saving}><FloppyDisk size={18} />حفظ</button>
            </form>
          </section>
          <section className="panel organization-table-card"><h3>الفروع</h3><div className="directory-grid">{catalog?.branches.map((item) => <div key={item.id}><strong>{item.name}</strong><code>{item.code}</code></div>)}</div></section>
          <section className="panel organization-table-card"><h3>الأقسام</h3><div className="directory-grid">{catalog?.departments.map((item) => <div key={item.id}><strong>{item.name}</strong><code>{item.code} · {item.system_code}</code></div>)}</div></section>
        </div>
      ) : null}

      {tab === "permissions" ? (
        <section className="panel permission-directory-card">
          <div className="directory-head"><div><ListMagnifyingGlass size={28} weight="duotone" /><div><h3>دليل الصلاحيات المركزي</h3><p>كل مفتاح مرتبط بنظام وصفحة وإجراء، ويستخدم في الواجهة والراوت والـAPI.</p></div></div><span>{filteredDirectory.length}</span></div>
          <div className="directory-filters"><input value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)} placeholder="ابحث بالاسم أو مفتاح الصلاحية" /><select value={permissionSystemFilter} onChange={(event) => setPermissionSystemFilter(event.target.value)}><option value="">كل الأنظمة</option>{catalog?.systems.map((item) => <option key={item.code} value={item.code}>{item.name_ar}</option>)}</select></div>
          <div className="users-table-wrap"><table className="users-table permission-directory-table"><thead><tr><th>الصلاحية</th><th>النظام</th><th>الصفحة</th><th>النوع</th><th>الحساسية</th></tr></thead><tbody>{filteredDirectory.map((item) => <tr key={item.code}><td><strong>{item.name_ar}</strong><code>{item.code}</code></td><td>{catalog?.systems.find((system) => system.code === item.system_code)?.name_ar || item.system_code}</td><td>{catalog?.pages.find((page) => page.system_code === item.system_code && page.code === item.page_code)?.name_ar || "دخول النظام"}</td><td>{item.category}</td><td>{item.is_sensitive ? <span className="sensitive-badge">حساسة</span> : "عادية"}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      {tab === "permission-log" ? (
        <section className="panel audit-log-card">
          <div className="directory-head"><div><ShieldCheck size={28} weight="duotone" /><div><h3>سجل تعديلات الصلاحيات</h3><p>يسجل المستخدم المنفذ والقيمة السابقة والجديدة والوقت.</p></div></div></div>
          <div className="users-table-wrap"><table className="users-table audit-table"><thead><tr><th>الوقت</th><th>المنفذ</th><th>المستهدف</th><th>نوع التعديل</th><th>الصلاحية/النظام</th><th>البيانات</th></tr></thead><tbody>{permissionLog.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td><strong>{entry.changed_by_name || "النظام"}</strong><small>{entry.changed_by_email || "—"}</small></td><td>{entry.target_user_name || entry.target_role_name || "—"}</td><td>{entry.change_type}</td><td><code>{entry.permission_code || entry.system_code || "—"}</code></td><td><details><summary>عرض</summary><pre>{JSON.stringify({ before: entry.old_value, after: entry.new_value }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      {tab === "security" ? (
        <section className="panel audit-log-card">
          <div className="directory-head"><div><ShieldWarning size={28} weight="duotone" /><div><h3>سجل النشاط الأمني</h3><p>تسجيل الدخول والإجراءات الحساسة ونتائج السماح أو الرفض.</p></div></div></div>
          <div className="users-table-wrap"><table className="users-table audit-table"><thead><tr><th>الوقت</th><th>المستخدم</th><th>النظام</th><th>الإجراء</th><th>الصلاحية</th><th>النتيجة</th><th>IP</th></tr></thead><tbody>{securityLog.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td><strong>{entry.user_name || "مجهول"}</strong><small>{entry.user_email || "—"}</small></td><td>{entry.system_code}</td><td>{entry.action}</td><td><code>{entry.permission_code || "—"}</code></td><td><span className={entry.result === "success" ? "result-success" : "result-failed"}>{entry.result || "success"}</span><small>{entry.rejection_reason || ""}</small></td><td>{entry.ip_address || "—"}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}
    </section>
  );
}
