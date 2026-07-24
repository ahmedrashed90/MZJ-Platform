import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, Copy, FloppyDisk, MagnifyingGlass, Plus, ShieldCheck, Trash, UserCircle, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { hasPermission } from "../systemAccess";
import { accessAction, accessFetch } from "./api";
import type { BootstrapResponse, OrgItem, PermissionItem, RoleItem, UserDetailResponse, UserListItem } from "./types";
import type { AccessSystemCode, DataScope, PlatformSystem } from "../../shared/access-control";

type Tab = "users" | "roles" | "org" | "catalog" | "permission-log" | "security-log";
type UserSystemForm = { systemCode: PlatformSystem; isEnabled: boolean; roleId: string; dataScope: DataScope; branchIds: string[]; departmentIds: string[]; primaryBranchId: string; primaryDepartmentId: string };
type OverrideEffect = "inherit" | "allow" | "deny";
type UserForm = { id: string; employeeNo: string; fullName: string; email: string; mobile: string; nextErpUserId: string; password: string; isActive: boolean; canReceiveLeads: boolean; canReceiveTasks: boolean; roleIds: string[]; systems: UserSystemForm[]; overrides: Record<string, OverrideEffect>; reason: string };
type RoleGroup = { key: string; name: string; canonical: RoleItem; roleIds: string[] };

const systemOrder: PlatformSystem[] = ["operations", "tracking", "marketing", "crm"];
const roleSystemOrder: AccessSystemCode[] = ["core", ...systemOrder];
const tabLabels: Record<Tab, string> = {
  users: "المستخدمون",
  roles: "الأدوار وقوالب الصلاحيات",
  org: "الفروع والأقسام",
  catalog: "دليل الصلاحيات",
  "permission-log": "سجل تعديلات الصلاحيات",
  "security-log": "سجل النشاط الأمني",
};
function cleanArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function emptyForm(bootstrap: BootstrapResponse | null): UserForm {
  return {
    id: "", employeeNo: "", fullName: "", email: "", mobile: "", nextErpUserId: "", password: "", isActive: true,
    canReceiveLeads: false, canReceiveTasks: false, roleIds: [], reason: "",
    systems: systemOrder.map((systemCode) => ({ systemCode, isEnabled: false, roleId: "", dataScope: systemCode === "marketing" ? "workflow_assigned" : "assigned", branchIds: [], departmentIds: [], primaryBranchId: "", primaryDepartmentId: "" })),
    overrides: Object.fromEntries((bootstrap?.permissions || []).map((permission) => [permission.code, "inherit"])),
  };
}
function toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function systemLabel(bootstrap: BootstrapResponse | null, code: AccessSystemCode) { return code === "core" ? "المنصة والإعدادات المركزية" : bootstrap?.systems.find((item) => item.code === code)?.name_ar || code; }

const canonicalRoleCodeOrder = [
  "admin", "system_admin", "sales_manager", "accounts_manager", "operations_manager", "operations_admin",
  "branch_manager", "sales_user", "call_center_agent", "customer_service_agent", "marketing_admin",
  "marketing_user", "finance_manager", "operations_user", "tracking_user",
];
function normalizedRoleName(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar"); }
function compareRolePriority(left: RoleItem, right: RoleItem) {
  const leftKnown = canonicalRoleCodeOrder.indexOf(left.code);
  const rightKnown = canonicalRoleCodeOrder.indexOf(right.code);
  if (leftKnown !== rightKnown) return (leftKnown < 0 ? Number.MAX_SAFE_INTEGER : leftKnown) - (rightKnown < 0 ? Number.MAX_SAFE_INTEGER : rightKnown);
  if (left.is_system !== right.is_system) return left.is_system ? -1 : 1;
  if (left.users_count !== right.users_count) return right.users_count - left.users_count;
  if (left.permission_codes.length !== right.permission_codes.length) return right.permission_codes.length - left.permission_codes.length;
  return left.code.localeCompare(right.code);
}
function groupRolesByDisplayName(roles: RoleItem[]): RoleGroup[] {
  const grouped = new Map<string, RoleItem[]>();
  roles.forEach((role) => {
    const key = normalizedRoleName(role.name) || role.code;
    grouped.set(key, [...(grouped.get(key) || []), role]);
  });
  return [...grouped.entries()].map(([key, items]) => {
    const sorted = [...items].sort(compareRolePriority);
    return { key, name: sorted[0].name, canonical: sorted[0], roleIds: sorted.map((role) => role.id) };
  }).sort((left, right) => left.name.localeCompare(right.name, "ar"));
}

export function UsersPermissionsPanel() {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [form, setForm] = useState<UserForm>(() => emptyForm(null));
  const [systemTab, setSystemTab] = useState<PlatformSystem>("operations");
  const [search, setSearch] = useState("");
  const [copySourceId, setCopySourceId] = useState("");
  const [filterRoleId, setFilterRoleId] = useState("");
  const [filterSystemCode, setFilterSystemCode] = useState<"" | PlatformSystem>("");
  const [filterBranchId, setFilterBranchId] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [logRows, setLogRows] = useState<any[]>([]);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [roleDraft, setRoleDraft] = useState({ code: "", name: "", description: "", permissionCodes: [] as string[] });
  const [orgDraft, setOrgDraft] = useState({ kind: "branch" as "branch" | "department", id: "", code: "", name: "", systemCode: "crm", isActive: true, sortOrder: 0 });
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canViewUsers = hasPermission(user, "settings.users.view");
  const canCreateUsers = hasPermission(user, "settings.users.create");
  const canUpdateUsers = hasPermission(user, "settings.users.update");
  const canDisableUsers = hasPermission(user, "settings.users.disable");
  const canDeleteUsers = hasPermission(user, "platform.superadmin");
  const isEditingCurrentUser = Boolean(form.id && user?.id === form.id);
  const canEditProfile = !isEditingCurrentUser && (form.id ? canUpdateUsers : canCreateUsers);
  const canManageRoles = hasPermission(user, "settings.roles.manage");
  const canManagePermissions = hasPermission(user, "settings.permissions.manage");
  const canManageOrg = hasPermission(user, "settings.branches.manage") || hasPermission(user, "settings.departments.manage");
  const canViewAudit = hasPermission(user, "settings.audit.view");
  const canViewSecurity = hasPermission(user, "settings.security.view");
  const canReadUsers = canViewUsers || canUpdateUsers || canDisableUsers || canDeleteUsers || canManagePermissions;
  const canSaveUser = !isEditingCurrentUser && (form.id ? (canUpdateUsers || canDisableUsers || canManagePermissions) : canCreateUsers);
  const canOpenPanel = canViewUsers || canCreateUsers || canUpdateUsers || canDisableUsers || canDeleteUsers || canManageRoles || canManagePermissions || canManageOrg || canViewAudit || canViewSecurity;
  const availableTabs = (Object.keys(tabLabels) as Tab[]).filter((key) => {
    if (key === "users") return canViewUsers || canCreateUsers || canUpdateUsers || canDisableUsers || canDeleteUsers || canManagePermissions;
    if (key === "roles") return canManageRoles;
    if (key === "org") return canManageOrg;
    if (key === "catalog") return canManagePermissions || canViewUsers;
    if (key === "permission-log") return canViewAudit;
    if (key === "security-log") return canViewSecurity;
    return false;
  });

  async function loadBase() {
    setLoading(true); setError("");
    try {
      const [base, list] = await Promise.all([
        accessFetch<BootstrapResponse>("bootstrap"),
        canReadUsers ? accessFetch<{ ok: true; users: UserListItem[] }>("users") : Promise.resolve({ ok: true as const, users: [] as UserListItem[] }),
      ]);
      setBootstrap(base); setUsers(list.users || []); setForm((current) => current.id ? current : emptyForm(base));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الصلاحيات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadBase(); }, []);
  useEffect(() => { if (!availableTabs.includes(tab) && availableTabs[0]) setTab(availableTabs[0]); }, [tab, availableTabs.join("|")]);

  useEffect(() => {
    if (tab !== "permission-log" && tab !== "security-log") return;
    const resource = tab === "permission-log" ? "permission_log" : "security_log";
    setLoading(true); setError("");
    void accessFetch<{ ok: true; rows: any[] }>(resource).then((result) => setLogRows(result.rows || [])).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل السجل")).finally(() => setLoading(false));
  }, [tab]);

  const roleGroups = useMemo(() => groupRolesByDisplayName(bootstrap?.roles || []), [bootstrap]);
  const canonicalRoleIdById = useMemo(() => {
    const map = new Map<string, string>();
    roleGroups.forEach((group) => group.roleIds.forEach((id) => map.set(id, group.canonical.id)));
    return map;
  }, [roleGroups]);
  function normalizeSelectedRoleIds(values: string[]) {
    return [...new Set(values.map((id) => canonicalRoleIdById.get(id) || id))];
  }

  const filteredUsers = useMemo(() => {
    const value = search.trim().toLowerCase();
    return users.filter((item) => {
      if (value && ![item.full_name, item.email, item.mobile, item.roles, item.branches, item.departments].some((field) => String(field || "").toLowerCase().includes(value))) return false;
      if (filterRoleId && !normalizeSelectedRoleIds(cleanArray(item.role_ids)).includes(filterRoleId) && !Object.values(item.systems || {}).some((system) => (canonicalRoleIdById.get(system.roleId || "") || system.roleId) === filterRoleId)) return false;
      if (filterSystemCode && !item.systems?.[filterSystemCode]?.enabled) return false;
      if (filterBranchId && !cleanArray(item.branch_ids).includes(filterBranchId)) return false;
      if (filterDepartmentId && !cleanArray(item.department_ids).includes(filterDepartmentId)) return false;
      return true;
    });
  }, [users, search, filterRoleId, filterSystemCode, filterBranchId, filterDepartmentId, canonicalRoleIdById]);
  const currentSystem = form.systems.find((item) => item.systemCode === systemTab)!;
  const selectedUser = form.id ? users.find((item) => item.id === form.id) || null : null;
  const userFormIssues = useMemo(() => {
    const issues: string[] = [];
    if (!form.fullName.trim()) issues.push("أدخل اسم المستخدم");
    if (!form.email.trim() && !form.mobile.trim()) issues.push("أدخل البريد أو رقم الجوال");
    if (!form.id && form.password.length < 10) issues.push("كلمة المرور المؤقتة لا تقل عن 10 أحرف");
    if (form.password && form.password.length < 10) issues.push("كلمة المرور الجديدة لا تقل عن 10 أحرف");
    if (isEditingCurrentUser) issues.push("لا يمكن تعديل الحساب الحالي من نفس الجلسة");
    if (!canSaveUser && !isEditingCurrentUser) issues.push("لا توجد صلاحية لحفظ هذا المستخدم");
    return issues;
  }, [form.fullName, form.email, form.mobile, form.password, form.id, isEditingCurrentUser, canSaveUser]);
  const userSaveDisabled = saving || userFormIssues.length > 0;
  const corePermissions = useMemo(() => (bootstrap?.permissions || []).filter((item) => item.system_code === "core"), [bootstrap]);
  const corePages = useMemo(() => (bootstrap?.pages || []).filter((item) => item.system_code === "core"), [bootstrap]);
  const systemPermissions = useMemo(() => (bootstrap?.permissions || []).filter((item) => item.system_code === systemTab), [bootstrap, systemTab]);
  const pages = useMemo(() => (bootstrap?.pages || []).filter((item) => item.system_code === systemTab), [bootstrap, systemTab]);
  const previewPermissions = useMemo(() => {
    const roleIds = new Set([...form.roleIds, ...form.systems.map((item) => item.roleId).filter(Boolean)]);
    const inherited = new Set((bootstrap?.roles || []).filter((role) => roleIds.has(role.id)).flatMap((role) => role.permission_codes || []));
    const direct = new Set(Object.entries(form.overrides).filter(([, effect]) => effect === "allow").map(([code]) => code));
    const denied = new Set(Object.entries(form.overrides).filter(([, effect]) => effect === "deny").map(([code]) => code));
    const enabledSystems = new Set(form.systems.filter((item) => item.isEnabled).map((item) => item.systemCode));
    const allowedBySystem = (code: string) => {
      const permission = (bootstrap?.permissions || []).find((item) => item.code === code);
      return !permission || permission.system_code === "core" || enabledSystems.has(permission.system_code as PlatformSystem);
    };
    return {
      inheritedPermissions: [...inherited],
      directPermissions: [...direct],
      deniedPermissions: [...denied],
      permissions: [...new Set([...inherited, ...direct])].filter((code) => !denied.has(code) && allowedBySystem(code)),
    };
  }, [bootstrap, form.roleIds, form.systems, form.overrides]);

  async function editUser(id: string) {
    setLoading(true); setError(""); setMessage("");
    try {
      const detail = await accessFetch<UserDetailResponse>(`user&id=${encodeURIComponent(id)}`);
      const overrides: Record<string, OverrideEffect> = Object.fromEntries((bootstrap?.permissions || []).map((permission) => [permission.code, "inherit"]));
      detail.overrides.forEach((item) => { overrides[item.permission_code] = item.effect; });
      const systems = systemOrder.map((systemCode) => {
        const row = detail.systems.find((item) => item.system_code === systemCode);
        return { systemCode, isEnabled: Boolean(row?.is_enabled), roleId: row?.role_id || "", dataScope: row?.data_scope || "assigned", branchIds: cleanArray(row?.branch_ids), departmentIds: cleanArray(row?.department_ids), primaryBranchId: row?.primary_branch_id || cleanArray(row?.branch_ids)[0] || "", primaryDepartmentId: row?.primary_department_id || cleanArray(row?.department_ids)[0] || "" } as UserSystemForm;
      });
      setForm({ id: detail.user.id || id, employeeNo: detail.user.employee_no || "", fullName: detail.user.full_name || "", email: detail.user.email || "", mobile: detail.user.mobile || "", nextErpUserId: detail.user.next_erp_user_id || "", password: "", isActive: Boolean(detail.user.is_active), canReceiveLeads: Boolean(detail.user.can_receive_leads), canReceiveTasks: Boolean(detail.user.can_receive_tasks), roleIds: detail.roleIds || [], systems, overrides, reason: "" });
      setSystemTab("operations"); setCopySourceId("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر فتح المستخدم"); }
    finally { setLoading(false); }
  }

  async function copyAccessFromUser() {
    if (!copySourceId || !canManagePermissions) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const detail = await accessFetch<UserDetailResponse>(`user&id=${encodeURIComponent(copySourceId)}`);
      const overrides: Record<string, OverrideEffect> = Object.fromEntries((bootstrap?.permissions || []).map((permission) => [permission.code, "inherit"]));
      detail.overrides.forEach((item) => { overrides[item.permission_code] = item.effect; });
      const systems = systemOrder.map((systemCode) => {
        const row = detail.systems.find((item) => item.system_code === systemCode);
        return { systemCode, isEnabled: Boolean(row?.is_enabled), roleId: row?.role_id || "", dataScope: row?.data_scope || "assigned", branchIds: cleanArray(row?.branch_ids), departmentIds: cleanArray(row?.department_ids), primaryBranchId: row?.primary_branch_id || cleanArray(row?.branch_ids)[0] || "", primaryDepartmentId: row?.primary_department_id || cleanArray(row?.department_ids)[0] || "" } as UserSystemForm;
      });
      setForm((current) => ({ ...current, roleIds: detail.roleIds, systems, overrides, reason: current.reason || `نسخ إعدادات الوصول من ${detail.user.full_name}` }));
      setMessage("تم نسخ إعدادات الوصول إلى النموذج. راجعها ثم احفظ المستخدم.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر نسخ صلاحيات المستخدم"); }
    finally { setLoading(false); }
  }

  function resetToRoleTemplates() {
    if (!canManagePermissions) return;
    setForm((current) => ({ ...current, overrides: Object.fromEntries((bootstrap?.permissions || []).map((permission) => [permission.code, "inherit"])), reason: current.reason || "إعادة ضبط الاستثناءات الفردية إلى قوالب الأدوار" }));
    setMessage("تمت إعادة الاستثناءات الفردية إلى قوالب الأدوار. احفظ المستخدم لتطبيق التغيير.");
  }

  function updateSystem(patch: Partial<UserSystemForm>) {
    setForm((current) => ({ ...current, systems: current.systems.map((item) => item.systemCode === systemTab ? { ...item, ...patch } : item) }));
  }
  async function saveUser() {
    setSaving(true); setError(""); setMessage("");
    try {
      const overrides = Object.entries(form.overrides).filter(([, effect]) => effect !== "inherit").map(([permissionCode, effect]) => ({ permissionCode, effect }));
      const payload = await accessAction<{ ok: true; message: string }>({ action: "save_user", user: { id: form.id || undefined, employeeNo: form.employeeNo, fullName: form.fullName, email: form.email, mobile: form.mobile, nextErpUserId: form.nextErpUserId, password: form.password, isActive: form.isActive, canReceiveLeads: form.canReceiveLeads, canReceiveTasks: form.canReceiveTasks }, roleIds: form.roleIds, systems: form.systems, overrides, reason: form.reason });
      setMessage(payload.message); setForm(emptyForm(bootstrap)); setCopySourceId(""); await loadBase(); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ المستخدم"); }
    finally { setSaving(false); }
  }

  function openDeleteDialog() {
    if (!selectedUser || !canDeleteUsers || selectedUser.id === user?.id) return;
    setDeleteTarget(selectedUser);
    setDeleteReason("");
    setDeleteConfirmation("");
    setError("");
    setMessage("");
  }
  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteReason("");
    setDeleteConfirmation("");
  }
  async function deleteUserAccount() {
    if (!deleteTarget || deleteConfirmation.trim() !== deleteTarget.full_name.trim() || !deleteReason.trim()) return;
    setDeleting(true); setError(""); setMessage("");
    try {
      const result = await accessAction<{ ok: true; message: string }>({ action: "delete_user", userId: deleteTarget.id, reason: deleteReason.trim() });
      setDeleteTarget(null); setDeleteReason(""); setDeleteConfirmation("");
      setForm(emptyForm(bootstrap)); setCopySourceId("");
      setMessage(result.message);
      await loadBase();
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حذف الحساب"); }
    finally { setDeleting(false); }
  }

  function chooseRole(role: RoleItem | null) {
    setEditingRole(role); setRoleDraft(role ? { code: role.code, name: role.name, description: role.description_ar || "", permissionCodes: role.permission_codes || [] } : { code: "", name: "", description: "", permissionCodes: [] });
  }
  async function saveRole() {
    setSaving(true); setError("");
    try { const result = await accessAction<{ ok: true; message: string }>({ action: "save_role", id: editingRole?.id, ...roleDraft }); setMessage(result.message); chooseRole(null); await loadBase(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الدور"); }
    finally { setSaving(false); }
  }
  async function saveOrg() {
    setSaving(true); setError("");
    try { const result = await accessAction<{ ok: true; message: string }>({ action: "save_org_item", ...orgDraft }); setMessage(result.message); setOrgDraft({ kind: orgDraft.kind, id: "", code: "", name: "", systemCode: orgDraft.systemCode, isActive: true, sortOrder: 0 }); await loadBase(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الفرع أو القسم"); }
    finally { setSaving(false); }
  }

  if (!canOpenPanel) return <div className="connection-banner"><WarningCircle size={20} /><span>لا توجد صلاحية لفتح المستخدمين والصلاحيات.</span></div>;
  return (
    <div className="access-control-shell">
      <nav className="access-tabs">
        {availableTabs.map((key) => <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{tabLabels[key]}</button>)}
      </nav>
      {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}
      {message ? <div className="success-banner"><ShieldCheck size={20} /><span>{message}</span></div> : null}

      {tab === "users" ? <div className="access-users-grid">
        <section className="panel access-users-list">
          <div className="settings-card-title"><div><UserCircle size={22} /><h2>المستخدمون <span className="access-count-badge">{filteredUsers.length}</span></h2></div>{canCreateUsers ? <button type="button" className="secondary-button" onClick={() => { setForm(emptyForm(bootstrap)); setCopySourceId(""); setSystemTab("operations"); setError(""); setMessage(""); }}><Plus size={17} /> مستخدم جديد</button> : null}</div>
          <label className="access-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو البريد أو الفرع أو القسم" /></label>
          <div className="access-user-filter-grid"><select value={filterRoleId} onChange={(event) => setFilterRoleId(event.target.value)}><option value="">كل الأدوار</option>{roleGroups.map((group) => <option key={group.key} value={group.canonical.id}>{group.name}</option>)}</select><select value={filterSystemCode} onChange={(event) => setFilterSystemCode(event.target.value as "" | PlatformSystem)}><option value="">كل الأنظمة</option>{systemOrder.map((code) => <option key={code} value={code}>{systemLabel(bootstrap, code)}</option>)}</select><select value={filterBranchId} onChange={(event) => setFilterBranchId(event.target.value)}><option value="">كل الفروع</option>{(bootstrap?.branches || []).filter((item) => item.is_active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><select value={filterDepartmentId} onChange={(event) => setFilterDepartmentId(event.target.value)}><option value="">كل الأقسام</option>{(bootstrap?.departments || []).filter((item) => item.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
          <div className="access-user-cards">{filteredUsers.map((item) => <button key={item.id} type="button" className={form.id === item.id ? "selected" : ""} aria-current={form.id === item.id ? "true" : undefined} onClick={() => void editUser(item.id)}><span className="access-user-card-head"><strong>{item.full_name}</strong><em className={item.is_active ? "active" : "inactive"}>{item.is_active ? "فعال" : "موقوف"}</em></span><small>{item.email || item.mobile || "—"}</small><span className="access-user-role">{item.roles || "بدون دور"}{item.id === user?.id ? <b>حسابك الحالي</b> : null}</span>{item.last_access_change_at ? <small className="access-last-change">آخر تعديل: {item.last_access_changed_by || "النظام"} · {new Date(item.last_access_change_at).toLocaleString("ar-SA")}</small> : null}</button>)}{!filteredUsers.length ? <div className="access-empty-users"><UserCircle size={30} /><strong>لا توجد نتائج مطابقة</strong><span>غيّر كلمة البحث أو الفلاتر لعرض المستخدمين.</span></div> : null}</div>
        </section>
        <section className="panel access-user-editor">
          <div className="settings-card-title access-editor-title"><div><span className="access-title-icon"><ShieldCheck size={22} /></span><span><h2>{form.id ? "تعديل المستخدم" : "إضافة مستخدم"}</h2><p>{form.id ? `تحديث بيانات وصلاحيات ${selectedUser?.full_name || form.fullName}` : "إنشاء حساب جديد وتحديد الأدوار ونطاقات الوصول"}</p></span></div><div className="access-editor-head-actions">{form.id ? <span className={`access-editor-status ${form.isActive ? "active" : "inactive"}`}>{form.isActive ? "حساب فعال" : "حساب موقوف"}</span> : <span className="access-editor-status new">حساب جديد</span>}{form.id && canDeleteUsers && !isEditingCurrentUser ? <button type="button" className="access-delete-user" onClick={openDeleteDialog}><Trash size={17} /> حذف الحساب</button> : null}</div></div>
          {isEditingCurrentUser ? <div className="access-inline-note"><WarningCircle size={18} /><span>هذا هو حسابك الحالي. للحماية، لا يمكن تعديل صلاحياته من نفس الجلسة.</span></div> : null}
          {canManagePermissions ? <div className="access-copy-tools"><label><span>نسخ صلاحيات مستخدم</span><select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}><option value="">اختر المستخدم المصدر</option>{users.filter((item) => item.id !== form.id).map((item) => <option key={item.id} value={item.id}>{item.full_name} — {item.email || item.mobile || "بدون بريد"}</option>)}</select></label><button type="button" className="secondary-button" disabled={!copySourceId || loading} onClick={() => void copyAccessFromUser()}><Copy size={17} /> نسخ إلى النموذج</button><button type="button" className="secondary-button" onClick={resetToRoleTemplates}><ArrowCounterClockwise size={17} /> إعادة ضبط لقوالب الأدوار</button></div> : null}
          <section className="access-editor-section access-account-section"><header><div><h3>بيانات الحساب</h3><p>المعلومات الأساسية وحالة استقبال العملاء والتاسكات.</p></div></header><div className="access-basic-grid">
            <label><span>الاسم</span><input disabled={!canEditProfile} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
            <label><span>رقم الموظف</span><input disabled={!canEditProfile} value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} /></label>
            <label><span>البريد</span><input disabled={!canEditProfile} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label><span>الجوال</span><input disabled={!canEditProfile} value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></label>
            <label><span>NEXT ERP User ID</span><input disabled={!canEditProfile} value={form.nextErpUserId} onChange={(event) => setForm({ ...form, nextErpUserId: event.target.value })} /></label>
            <label><span>{form.id ? "كلمة مرور جديدة (اختياري)" : "كلمة مرور مؤقتة"}</span><input disabled={!canEditProfile} type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          </div>
          <div className="access-toggle-row"><label><input type="checkbox" checked={form.isActive} disabled={Boolean(form.id) ? !canDisableUsers || isEditingCurrentUser : !canEditProfile} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> الحساب فعال</label><label><input type="checkbox" disabled={!canEditProfile} checked={form.canReceiveLeads} onChange={(event) => setForm({ ...form, canReceiveLeads: event.target.checked })} /> استقبال العملاء</label><label><input type="checkbox" disabled={!canEditProfile} checked={form.canReceiveTasks} onChange={(event) => setForm({ ...form, canReceiveTasks: event.target.checked })} /> استقبال التاسكات</label></div></section>
          <fieldset className="access-fieldset" disabled={!canManagePermissions}><legend>الأدوار العامة</legend><div className="access-check-grid">{roleGroups.map((group) => { const checked = group.roleIds.some((id) => form.roleIds.includes(id)); return <label key={group.key}><input type="checkbox" checked={checked} onChange={() => setForm({ ...form, roleIds: checked ? form.roleIds.filter((id) => !group.roleIds.includes(id)) : [...form.roleIds.filter((id) => !group.roleIds.includes(id)), group.canonical.id] })} />{group.name}</label>; })}</div></fieldset>
          <section className="access-central-permissions"><h3>صلاحيات المنصة والإعدادات المركزية</h3><div className="access-effective-summary"><span>الموروثة: <strong>{previewPermissions.inheritedPermissions.filter((code) => corePermissions.some((permission) => permission.code === code)).length}</strong></span><span>السماح الفردي: <strong>{previewPermissions.directPermissions.filter((code) => corePermissions.some((permission) => permission.code === code)).length}</strong></span><span>المنع الفردي: <strong>{previewPermissions.deniedPermissions.filter((code) => corePermissions.some((permission) => permission.code === code)).length}</strong></span></div><div className="access-permission-pages">{corePages.map((page) => <section key={page.code}><h3>{page.name_ar}</h3>{corePermissions.filter((permission) => permission.page_code === page.code).map((permission) => { const inherited=previewPermissions.inheritedPermissions.includes(permission.code); const direct=previewPermissions.directPermissions.includes(permission.code); const denied=previewPermissions.deniedPermissions.includes(permission.code); return <label key={permission.code} className={permission.is_sensitive ? "sensitive" : ""}><span><strong>{permission.name_ar}</strong><small>{permission.description_ar}</small><em className={denied ? "denied" : direct ? "direct" : inherited ? "inherited" : "none"}>{denied ? "ممنوعة فرديًا" : direct ? "مضافة فرديًا" : inherited ? "موروثة من الدور" : "غير ممنوحة"}</em></span><select disabled={!canManagePermissions} value={form.overrides[permission.code] || "inherit"} onChange={(event) => setForm({ ...form, overrides: { ...form.overrides, [permission.code]: event.target.value as OverrideEffect } })}><option value="inherit">{inherited ? "استخدام صلاحية الدور" : "بدون استثناء فردي"}</option><option value="allow">سماح فردي</option><option value="deny">منع فردي</option></select></label>; })}</section>)}</div></section>
          <nav className="access-system-tabs">{systemOrder.map((code) => <button key={code} type="button" className={systemTab === code ? "active" : ""} onClick={() => setSystemTab(code)}>{systemLabel(bootstrap, code)}<span className={form.systems.find((item) => item.systemCode === code)?.isEnabled ? "on" : "off"} /></button>)}</nav>
          <div className="access-system-config">
            <div className="access-system-head"><label><input type="checkbox" disabled={!canManagePermissions} checked={currentSystem.isEnabled} onChange={(event) => updateSystem({ isEnabled: event.target.checked })} /> السماح بدخول النظام</label><small>تعطيل النظام يمنع صفحاته وواجهاته مع الاحتفاظ بالصلاحيات المخزنة.</small></div>
            <div className="access-basic-grid"><label><span>الدور داخل النظام</span><select disabled={!canManagePermissions} value={currentSystem.roleId} onChange={(event) => updateSystem({ roleId: event.target.value })}><option value="">بدون قالب إضافي</option>{roleGroups.map((group) => <option key={group.key} value={group.roleIds.includes(currentSystem.roleId) ? currentSystem.roleId : group.canonical.id}>{group.name}</option>)}</select></label><label><span>نطاق البيانات</span><select disabled={!canManagePermissions} value={currentSystem.dataScope} onChange={(event) => updateSystem({ dataScope: event.target.value as DataScope })}>{(bootstrap?.dataScopes || []).map((scope) => <option key={scope.code} value={scope.code}>{scope.name}</option>)}</select></label></div>
            <fieldset className="access-fieldset" disabled={!canManagePermissions}><legend>الفروع المسموحة</legend><div className="access-check-grid">{(bootstrap?.branches || []).filter((item) => item.is_active).map((branch) => <label key={branch.id}><input type="checkbox" checked={currentSystem.branchIds.includes(branch.id)} onChange={() => { const branchIds=toggle(currentSystem.branchIds, branch.id); updateSystem({ branchIds, primaryBranchId: branchIds.includes(currentSystem.primaryBranchId) ? currentSystem.primaryBranchId : branchIds[0] || "" }); }} />{branch.name}</label>)}</div>{currentSystem.branchIds.length ? <label className="access-primary-select"><span>الفرع الأساسي</span><select value={currentSystem.primaryBranchId || currentSystem.branchIds[0]} onChange={(event) => updateSystem({ primaryBranchId: event.target.value })}>{(bootstrap?.branches || []).filter((item) => currentSystem.branchIds.includes(item.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}</fieldset>
            <fieldset className="access-fieldset" disabled={!canManagePermissions}><legend>الأقسام المسموحة</legend><div className="access-check-grid">{(bootstrap?.departments || []).filter((item) => item.is_active && (!item.system_code || item.system_code === systemTab)).map((department) => <label key={department.id}><input type="checkbox" checked={currentSystem.departmentIds.includes(department.id)} onChange={() => { const departmentIds=toggle(currentSystem.departmentIds, department.id); updateSystem({ departmentIds, primaryDepartmentId: departmentIds.includes(currentSystem.primaryDepartmentId) ? currentSystem.primaryDepartmentId : departmentIds[0] || "" }); }} />{department.name}</label>)}</div>{currentSystem.departmentIds.length ? <label className="access-primary-select"><span>القسم الأساسي</span><select value={currentSystem.primaryDepartmentId || currentSystem.departmentIds[0]} onChange={(event) => updateSystem({ primaryDepartmentId: event.target.value })}>{(bootstrap?.departments || []).filter((item) => currentSystem.departmentIds.includes(item.id)).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label> : null}</fieldset>
            <div className="access-effective-summary"><span>الموروثة من الأدوار: <strong>{previewPermissions.inheritedPermissions.filter((code) => systemPermissions.some((permission) => permission.code === code)).length}</strong></span><span>السماح الفردي: <strong>{previewPermissions.directPermissions.filter((code) => systemPermissions.some((permission) => permission.code === code)).length}</strong></span><span>المنع الفردي: <strong>{previewPermissions.deniedPermissions.filter((code) => systemPermissions.some((permission) => permission.code === code)).length}</strong></span></div><div className="access-permission-pages">{pages.map((page) => <section key={page.code}><h3>{page.name_ar}</h3>{systemPermissions.filter((permission) => permission.page_code === page.code).map((permission) => { const inherited=previewPermissions.inheritedPermissions.includes(permission.code); const direct=previewPermissions.directPermissions.includes(permission.code); const denied=previewPermissions.deniedPermissions.includes(permission.code); return <label key={permission.code} className={permission.is_sensitive ? "sensitive" : ""}><span><strong>{permission.name_ar}</strong><small>{permission.description_ar}</small><em className={denied ? "denied" : direct ? "direct" : inherited ? "inherited" : "none"}>{denied ? "ممنوعة فرديًا" : direct ? "مضافة فرديًا" : inherited ? "موروثة من الدور" : "غير ممنوحة"}</em></span><select disabled={!canManagePermissions} value={form.overrides[permission.code] || "inherit"} onChange={(event) => setForm({ ...form, overrides: { ...form.overrides, [permission.code]: event.target.value as OverrideEffect } })}><option value="inherit">{inherited ? "استخدام صلاحية الدور" : "بدون استثناء فردي"}</option><option value="allow">سماح فردي</option><option value="deny">منع فردي</option></select></label>; })}</section>)}</div>
          </div>
          <div className="access-save-bar"><label className="access-reason-field"><span>سبب التعديل <small>اختياري ويظهر في سجل الصلاحيات</small></span><textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="اكتب سبب التعديل لتسهيل المراجعة لاحقًا" /></label><div className="access-save-actions">{userFormIssues.length ? <span className="access-save-hint"><WarningCircle size={17} />{userFormIssues[0]}</span> : <span className="access-save-ready"><ShieldCheck size={17} />البيانات جاهزة للحفظ</span>}<button type="button" className="primary-button access-save" disabled={userSaveDisabled} title={userFormIssues[0] || undefined} onClick={() => void saveUser()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : form.id ? "حفظ التعديلات والصلاحيات" : "إنشاء المستخدم وحفظ الصلاحيات"}</button></div></div>
        </section>
      </div> : null}

      {tab === "roles" ? <div className="access-role-grid"><section className="panel"><div className="settings-card-title"><h2>قوالب الأدوار</h2><button type="button" className="secondary-button" onClick={() => chooseRole(null)}><Plus size={17} /> دور جديد</button></div>{(bootstrap?.roles || []).map((role) => <button type="button" className={`access-role-row ${editingRole?.id === role.id ? "selected" : ""}`} key={role.id} onClick={() => chooseRole(role)}><strong>{role.name}</strong><small>{role.code} · {role.permission_codes.length} صلاحية · {role.users_count} مستخدم</small></button>)}</section><section className="panel"><h2>{editingRole ? "تعديل قالب الدور" : "إنشاء قالب دور"}</h2><div className="access-basic-grid"><label><span>الكود</span><input value={roleDraft.code} onChange={(event) => setRoleDraft({ ...roleDraft, code: event.target.value })} /></label><label><span>الاسم</span><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} /></label></div><label><span>الوصف</span><textarea value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} /></label><div className="access-role-permissions">{roleSystemOrder.map((code) => <section key={code}><h3>{systemLabel(bootstrap, code)}</h3>{(bootstrap?.permissions || []).filter((item) => item.system_code === code).map((permission) => <label key={permission.code}><input type="checkbox" disabled={!canManagePermissions} checked={roleDraft.permissionCodes.includes(permission.code)} onChange={() => setRoleDraft({ ...roleDraft, permissionCodes: toggle(roleDraft.permissionCodes, permission.code) })} />{permission.name_ar}</label>)}</section>)}</div><button type="button" className="primary-button access-save" disabled={saving || !roleDraft.code || !roleDraft.name} onClick={() => void saveRole()}><FloppyDisk size={18} /> حفظ قالب الدور</button></section></div> : null}

      {tab === "org" ? <div className="access-role-grid"><section className="panel"><h2>الفروع</h2>{(bootstrap?.branches || []).map((item) => <button key={item.id} type="button" className="access-role-row" onClick={() => setOrgDraft({ kind: "branch", id: item.id, code: item.code, name: item.name, systemCode: "crm", isActive: item.is_active, sortOrder: item.sort_order || 0 })}><strong>{item.name}</strong><small>{item.code} · {item.is_active ? "فعال" : "موقوف"}</small></button>)}<h2>الأقسام</h2>{(bootstrap?.departments || []).map((item) => <button key={item.id} type="button" className="access-role-row" onClick={() => setOrgDraft({ kind: "department", id: item.id, code: item.code, name: item.name, systemCode: item.system_code || "crm", isActive: item.is_active, sortOrder: 0 })}><strong>{item.name}</strong><small>{item.code} · {item.system_code}</small></button>)}</section><section className="panel"><h2>{orgDraft.kind === "branch" ? "بيانات الفرع" : "بيانات القسم"}</h2><div className="access-toggle-row"><label><input type="radio" checked={orgDraft.kind === "branch"} onChange={() => setOrgDraft({ ...orgDraft, kind: "branch", id: "" })} /> فرع</label><label><input type="radio" checked={orgDraft.kind === "department"} onChange={() => setOrgDraft({ ...orgDraft, kind: "department", id: "" })} /> قسم</label></div><label><span>الكود</span><input value={orgDraft.code} onChange={(event) => setOrgDraft({ ...orgDraft, code: event.target.value })} /></label><label><span>الاسم</span><input value={orgDraft.name} onChange={(event) => setOrgDraft({ ...orgDraft, name: event.target.value })} /></label>{orgDraft.kind === "department" ? <label><span>النظام</span><select value={orgDraft.systemCode} onChange={(event) => setOrgDraft({ ...orgDraft, systemCode: event.target.value })}>{systemOrder.map((code) => <option key={code} value={code}>{systemLabel(bootstrap, code)}</option>)}</select></label> : null}<label><input type="checkbox" checked={orgDraft.isActive} onChange={(event) => setOrgDraft({ ...orgDraft, isActive: event.target.checked })} /> فعال</label><button type="button" className="primary-button access-save" disabled={saving || !orgDraft.code || !orgDraft.name} onClick={() => void saveOrg()}><FloppyDisk size={18} /> حفظ</button></section></div> : null}

      {tab === "catalog" ? <section className="panel access-catalog"><h2>دليل الصلاحيات المركزي</h2><table><thead><tr><th>المفتاح</th><th>النظام</th><th>الصفحة</th><th>النوع</th><th>الوصف</th></tr></thead><tbody>{(bootstrap?.permissions || []).map((permission) => <tr key={permission.code}><td><code>{permission.code}</code></td><td>{permission.system_code}</td><td>{permission.page_code}</td><td>{permission.category}</td><td>{permission.name_ar}{permission.is_sensitive ? " · حساسة" : ""}</td></tr>)}</tbody></table></section> : null}
      {tab === "permission-log" || tab === "security-log" ? <section className="panel access-catalog"><h2>{tab === "permission-log" ? tabLabels["permission-log"] : tabLabels["security-log"]}</h2>{loading ? <p>جاري التحميل...</p> : <table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>الإجراء</th><th>النتيجة</th><th>Request ID</th></tr></thead><tbody>{logRows.map((row, index) => <tr key={row.id || index}><td>{new Date(row.created_at).toLocaleString("ar-SA")}</td><td>{row.changed_by_name || row.user_email || "—"}</td><td>{row.change_type || row.action || row.permission_code}</td><td>{row.result || row.target_user_name || row.target_role_name || "—"}</td><td><code>{row.request_id || "—"}</code></td></tr>)}</tbody></table>}</section> : null}

      <Modal
        open={Boolean(deleteTarget)}
        title="حذف حساب المستخدم"
        subtitle="سيتم إيقاف الحساب نهائيًا وإزالة بيانات الدخول مع الاحتفاظ بالسجلات التشغيلية السابقة."
        onClose={closeDeleteDialog}
        className="access-delete-modal"
        footer={<>
          <button type="button" onClick={closeDeleteDialog} disabled={deleting}>إلغاء</button>
          <button type="button" className="danger" disabled={deleting || !deleteReason.trim() || deleteConfirmation.trim() !== (deleteTarget?.full_name || "").trim()} onClick={() => void deleteUserAccount()}><Trash size={17} />{deleting ? "جاري الحذف..." : "حذف الحساب نهائيًا"}</button>
        </>}
      >
        {deleteTarget ? <div className="access-delete-dialog">
          <div className="access-delete-warning"><WarningCircle size={22} /><div><strong>تأكيد حذف {deleteTarget.full_name}</strong><span>{deleteTarget.email || deleteTarget.mobile || "الحساب المحدد"}</span></div></div>
          <label><span>سبب الحذف</span><textarea value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="مثال: تم إنشاء الحساب بالخطأ" /></label>
          <label><span>اكتب اسم المستخدم للتأكيد</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={deleteTarget.full_name} /></label>
        </div> : null}
      </Modal>
    </div>
  );
}
