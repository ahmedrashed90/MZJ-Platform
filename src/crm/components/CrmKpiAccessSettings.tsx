import { useEffect, useMemo, useState } from "react";
import { FloppyDisk, MagnifyingGlass, ShieldCheck, UsersThree } from "@phosphor-icons/react";
import { crmFetch } from "../api";

type SettingsUser = {
  id: string;
  full_name: string;
  employee_no?: string | null;
  is_active?: boolean;
  departments?: string[];
  branches?: string[];
};

type Props = {
  users: SettingsUser[];
  value?: { speedUserIds?: string[]; efficiencyUserIds?: string[] } | null;
  onSaved?: () => void | Promise<void>;
};

function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

export function CrmKpiAccessSettings({ users, value, onSaved }: Props) {
  const [speedUserIds, setSpeedUserIds] = useState<string[]>([]);
  const [efficiencyUserIds, setEfficiencyUserIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSpeedUserIds(value?.speedUserIds || []);
    setEfficiencyUserIds(value?.efficiencyUserIds || []);
  }, [value]);

  const activeUsers = useMemo(() => users.filter((user) => user.is_active !== false).filter((user) => {
    const haystack = [user.full_name, user.employee_no, ...(user.departments || []), ...(user.branches || [])].join(" ").toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  }), [users, query]);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const result = await crmFetch<{ message?: string }>("/api/crm/settings", {
        method: "POST",
        body: JSON.stringify({ section: "kpi_section_permissions", speedUserIds, efficiencyUserIds }),
      });
      setNotice(result.message || "تم حفظ الإعدادات");
      await onSaved?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ مسؤولي التقييم");
    } finally {
      setSaving(false);
    }
  }

  const renderUsers = (selected: string[], setter: (value: string[]) => void) => (
    <div className="crm-kpi-access-users">
      {activeUsers.map((user) => (
        <label key={user.id} className={selected.includes(user.id) ? "selected" : ""}>
          <input type="checkbox" checked={selected.includes(user.id)} onChange={() => setter(toggle(selected, user.id))} />
          <span><strong>{user.full_name}</strong><small>{[user.employee_no, ...(user.departments || []), ...(user.branches || [])].filter(Boolean).join(" • ") || "مستخدم في النظام"}</small></span>
        </label>
      ))}
      {!activeUsers.length ? <div className="crm-empty-state">لا يوجد مستخدمون مطابقون للبحث.</div> : null}
    </div>
  );

  return (
    <div className="crm-kpi-access-settings">
      <section className="crm-panel crm-kpi-access-intro">
        <div><ShieldCheck size={28} weight="duotone" /><span><h2>صلاحيات تقييم السرعة والكفاءة</h2><p>حدد أكثر من مستخدم لكل جزء. بعد الحفظ لن يستطيع تعديل الجزء إلا المستخدمون المحددون، مع بقاء باقي أجزاء KPI حسب صلاحيات الإدارة الحالية.</p></span></div>
        <label className="crm-search-box"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث باسم المستخدم أو القسم أو الفرع" /></label>
      </section>

      <div className="crm-kpi-access-grid">
        <section className="crm-panel crm-kpi-access-card">
          <header><div><UsersThree size={22} /><span><h3>مسؤولو السرعة</h3><p>المستخدمون المسموح لهم بإدخال دقائق التأخير ونتيجة السرعة.</p></span></div><b>{speedUserIds.length}</b></header>
          {renderUsers(speedUserIds, setSpeedUserIds)}
        </section>
        <section className="crm-panel crm-kpi-access-card">
          <header><div><UsersThree size={22} /><span><h3>مسؤولو الكفاءة</h3><p>المستخدمون المسموح لهم بإدخال تقييم الشخصية والجوانب الفنية.</p></span></div><b>{efficiencyUserIds.length}</b></header>
          {renderUsers(efficiencyUserIds, setEfficiencyUserIds)}
        </section>
      </div>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      <button type="button" className="crm-primary-button" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ مسؤولي السرعة والكفاءة"}</button>
    </div>
  );
}
