import { useEffect, useMemo, useState } from "react";
import {
  Buildings,
  GearSix,
  Megaphone,
  Path,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { hasAnyPermission, hasPermission } from "../components/PermissionGate";
import { CrmAdminPage } from "../crm/pages/CrmAdminPage";
import { UsersPermissionsSection } from "./settings/UsersPermissionsSection";

type Section = "users" | "crm" | "marketing" | "operations" | "tracking";

type SectionDefinition = {
  key: Section;
  label: string;
  icon: typeof GearSix;
  permissions: string[];
};

const userPermissions = [
  "settings.users.view",
  "settings.users.create",
  "settings.users.update",
  "settings.users.disable",
  "settings.roles.manage",
  "settings.permissions.manage",
  "settings.branches.manage",
  "settings.audit.view",
  "settings.security.view",
];

const sections: SectionDefinition[] = [
  { key: "users", label: "المستخدمون والصلاحيات", icon: UsersThree, permissions: userPermissions },
  { key: "crm", label: "إعدادات CRM", icon: GearSix, permissions: ["crm.settings.view"] },
  { key: "marketing", label: "إعدادات التسويق", icon: Megaphone, permissions: ["marketing.settings.view"] },
  { key: "operations", label: "إعدادات العمليات", icon: Wrench, permissions: ["operations.settings.view"] },
  { key: "tracking", label: "إعدادات التراكينج", icon: Path, permissions: ["tracking.settings.view"] },
];

function PendingSystemSettings({ title, description, permission }: { title: string; description: string; permission: string }) {
  const { user } = useAuth();
  const canManage = hasPermission(user, permission);
  return (
    <section className="panel unified-settings-placeholder">
      <Buildings size={46} weight="duotone" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        <span>{canManage ? "صلاحية الإدارة مفعلة، ويتم ربط عناصر هذا الموديول هنا عند دمجه الفعلي." : "هذه الصفحة للعرض فقط، ولا تمتلك صلاحية تعديل إعداداتها."}</span>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleSections = useMemo(() => sections.filter((item) => hasAnyPermission(user, item.permissions)), [user]);
  const requested = searchParams.get("section") as Section | null;
  const initial = visibleSections.some((item) => item.key === requested) ? requested! : visibleSections[0]?.key || "users";
  const [section, setSection] = useState<Section>(initial);

  useEffect(() => {
    if (requested && visibleSections.some((item) => item.key === requested)) setSection(requested);
    else if (!visibleSections.some((item) => item.key === section) && visibleSections[0]) setSection(visibleSections[0].key);
  }, [requested, visibleSections.map((item) => item.key).join("|")]);

  function chooseSection(next: Section) {
    setSection(next);
    const params = new URLSearchParams(searchParams);
    params.set("section", next);
    if (next !== "users") params.delete("tab");
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="module-page settings-page unified-settings-page">
      <header className="module-page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>إعدادات المنصة والأنظمة والمستخدمين من مكان مركزي واحد، مع فصل صلاحيات كل قسم.</p>
        </div>
      </header>

      <nav className="unified-settings-nav" aria-label="أقسام الإعدادات">
        {visibleSections.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className={section === key ? "active" : ""} onClick={() => chooseSection(key)}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {section === "users" ? <UsersPermissionsSection /> : null}
      {section === "crm" ? <CrmAdminPage embedded /> : null}
      {section === "marketing" ? <PendingSystemSettings title="إعدادات التسويق" description="إعدادات الحملات والأجندة والتجهيز والنشر تدار من هذا القسم المركزي فقط." permission="marketing.settings.manage" /> : null}
      {section === "operations" ? <PendingSystemSettings title="إعدادات العمليات" description="إعدادات المخزون والمواقع والحركة والموافقات ستدار من هذا القسم المركزي فقط." permission="operations.settings.manage" /> : null}
      {section === "tracking" ? <PendingSystemSettings title="إعدادات التراكينج" description="إعدادات المراحل والروابط والإشعارات ستدار من هذا القسم المركزي فقط." permission="tracking.settings.manage" /> : null}
    </div>
  );
}
