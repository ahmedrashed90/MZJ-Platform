import { useEffect, useState } from "react";
import { GearSix, Megaphone, Path, UsersThree, WarningCircle, Wrench } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { UsersPermissionsPanel } from "../access-control/UsersPermissionsPanel";
import { useAuth } from "../auth/AuthContext";
import { CrmAdminPage } from "../crm/pages/CrmAdminPage";
import { MarketingSettingsPanel } from "../marketing/components/MarketingSettingsPanel";
import { OperationsSettingsPanel } from "../operations/components/OperationsSettingsPanel";
import { hasPermission } from "../systemAccess";
import { TrackingSettingsPanel } from "../tracking/components/TrackingSettingsPanel";

type Section = "users" | "crm" | "marketing" | "operations" | "tracking";
const sectionDefinitions: Array<{ key: Section; label: string; icon: typeof GearSix; permissions: string[] }> = [
  { key: "users", label: "المستخدمون والصلاحيات", icon: UsersThree, permissions: ["settings.users.view","settings.users.create","settings.users.update","settings.users.disable","settings.roles.manage","settings.permissions.manage","settings.branches.manage","settings.departments.manage","settings.audit.view","settings.security.view"] },
  { key: "crm", label: "إعدادات CRM", icon: GearSix, permissions: ["settings.crm.view", "settings.crm.manage"] },
  { key: "marketing", label: "إعدادات التسويق", icon: Megaphone, permissions: ["settings.marketing.view", "settings.marketing.manage"] },
  { key: "operations", label: "إعدادات العمليات", icon: Wrench, permissions: ["settings.operations.view", "settings.operations.manage"] },
  { key: "tracking", label: "إعدادات التتبع", icon: Path, permissions: ["settings.tracking.view", "settings.tracking.manage"] },
];

export function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const available = sectionDefinitions.filter((item) => item.permissions.some((permission) => hasPermission(user, permission)));
  const requested = params.get("section") as Section | null;
  const [section, setSection] = useState<Section>(() => available.find((item) => item.key === requested)?.key || available[0]?.key || "users");

  useEffect(() => {
    if (!available.some((item) => item.key === section)) setSection(available[0]?.key || "users");
  }, [section, available.map((item) => item.key).join("|")]);

  function choose(next: Section) {
    setSection(next);
    setParams(next === "users" ? {} : { section: next }, { replace: true });
  }

  if (!available.length) return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>لا توجد صلاحية لمشاهدة أي قسم من الإعدادات.</span></div></div>;

  return (
    <div className="module-page settings-page unified-settings-page">
      <header className="module-page-head"><div><h1>الإعدادات</h1><p>إعدادات المنصة والأنظمة من مصدر مركزي واحد، مع فصل صلاحيات كل قسم.</p></div></header>
      <nav className="unified-settings-nav" aria-label="أقسام الإعدادات">
        {available.map(({ key, label, icon: Icon }) => <button key={key} type="button" className={section === key ? "active" : ""} onClick={() => choose(key)}><Icon size={18} weight="duotone" /><span>{label}</span></button>)}
      </nav>
      {section === "users" ? <UsersPermissionsPanel /> : null}
      {section === "crm" ? <CrmAdminPage embedded readOnly={!hasPermission(user, "settings.crm.manage")} /> : null}
      {section === "marketing" ? <MarketingSettingsPanel readOnly={!hasPermission(user, "settings.marketing.manage")} /> : null}
      {section === "operations" ? <OperationsSettingsPanel /> : null}
      {section === "tracking" ? <TrackingSettingsPanel readOnly={!hasPermission(user, "settings.tracking.manage")} /> : null}
    </div>
  );
}
