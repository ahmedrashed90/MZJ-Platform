import { useEffect, useMemo, useState } from "react";
import { Bell, CaretDown, CaretUp, GearSix, MagnifyingGlass, Megaphone, Path, UsersThree, WarningCircle, Wrench } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { UsersPermissionsPanel } from "../access-control/UsersPermissionsPanel";
import { useAuth } from "../auth/AuthContext";
import { CrmAdminPage } from "../crm/pages/CrmAdminPage";
import { MarketingSettingsPanel } from "../marketing/components/MarketingSettingsPanel";
import { NotificationSettingsPanel } from "../notifications/NotificationSettingsPanel";
import { OperationsSettingsPanel } from "../operations/components/OperationsSettingsPanel";
import { hasPermission } from "../systemAccess";
import { TrackingSettingsPanel } from "../tracking/components/TrackingSettingsPanel";

type Section = "users" | "notifications" | "crm" | "marketing" | "operations" | "tracking";
const sectionDefinitions: Array<{ key: Section; label: string; description: string; keywords: string; icon: typeof GearSix; permissions: string[]; personal?: boolean }> = [
  { key: "users", label: "المستخدمون والصلاحيات", description: "المستخدمون، الأدوار، الفروع، الأقسام، دليل الصلاحيات والسجلات الأمنية", keywords: "المستخدمون الأدوار قوالب الصلاحيات الفروع الأقسام دليل سجل النشاط الأمني NEXT ERP", icon: UsersThree, permissions: ["settings.users.view","settings.users.create","settings.users.update","settings.users.disable","settings.roles.manage","settings.permissions.manage","settings.branches.manage","settings.departments.manage","settings.audit.view","settings.security.view"] },
  { key: "notifications", label: "إعدادات الإشعارات", description: "الصوت والكارت المؤقت ومدة الظهور وتنبيهات الأنظمة", keywords: "الإشعارات الجرس الصوت الكارت البادج التنبيه", icon: Bell, permissions: [], personal: true },
  { key: "operations", label: "إعدادات العمليات", description: "حالات السيارات والمواقع ومسارات العمل", keywords: "العمليات السيارات المواقع", icon: Wrench, permissions: ["settings.operations.view", "settings.operations.manage"] },
  { key: "tracking", label: "إعدادات التتبع", description: "المراحل والرسائل وإعدادات التراكينج", keywords: "التتبع التراكينج المراحل الرسائل", icon: Path, permissions: ["settings.tracking.view", "settings.tracking.manage"] },
  { key: "marketing", label: "إعدادات التسويق", description: "الأقسام واليوزرات والكرييتيفات والحملات والمنصات", keywords: "التسويق الأقسام اليوزرات الكرييتيف الحملات المنصات", icon: Megaphone, permissions: ["settings.marketing.view", "settings.marketing.manage"] },
  { key: "crm", label: "إعدادات CRM", description: "إعدادات مسارات العملاء والأتمتة والتوزيع", keywords: "CRM العملاء الأتمتة التوزيع", icon: GearSix, permissions: ["settings.crm.view", "settings.crm.manage"] },
];

export function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const available = sectionDefinitions.filter((item) => item.personal || item.permissions.some((permission) => hasPermission(user, permission)));
  const requested = params.get("section") as Section | null;
  const [section, setSection] = useState<Section>(() => available.find((item) => item.key === requested)?.key || available[0]?.key || "users");
  const [navigationSearch, setNavigationSearch] = useState("");
  const [contentOpen, setContentOpen] = useState(true);
  const filteredSections = useMemo(() => { const term = navigationSearch.trim().toLowerCase(); return available.filter((item) => !term || `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(term)); }, [available.map((item) => item.key).join("|"), navigationSearch]);
  const activeDefinition = available.find((item) => item.key === section) || available[0];

  useEffect(() => {
    if (!available.some((item) => item.key === section)) setSection(available[0]?.key || "users");
  }, [section, available.map((item) => item.key).join("|")]);

  function choose(next: Section) {
    setSection(next);
    setContentOpen(true);
    setParams(next === "users" ? {} : { section: next }, { replace: true });
  }

  if (!available.length) return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>لا توجد صلاحية لمشاهدة أي قسم من الإعدادات.</span></div></div>;

  return (
    <div className="module-page settings-page unified-settings-page">
      <header className="module-page-head unified-settings-hero"><div><h1>الإعدادات</h1><p>إدارة المنصة والأنظمة من مكان واحد مع الحفاظ الكامل على كل الصلاحيات والوظائف الحالية.</p></div></header>
      <div className="unified-settings-layout">
        <aside className="unified-settings-sidebar">
          <div className="unified-settings-sidebar-head"><strong>أقسام الإعدادات</strong><small>{available.length.toLocaleString("ar-SA")} أقسام متاحة</small></div>
          <label className="unified-settings-search"><MagnifyingGlass size={17} /><input value={navigationSearch} onChange={(event) => setNavigationSearch(event.target.value)} placeholder="ابحث داخل الإعدادات" /></label>
          <nav className="unified-settings-nav" aria-label="أقسام الإعدادات">
            {filteredSections.map(({ key, label, description, icon: Icon }) => <button key={key} type="button" className={section === key ? "active" : ""} onClick={() => choose(key)}><Icon size={20} weight="duotone" /><span><strong>{label}</strong><small>{description}</small></span></button>)}
            {!filteredSections.length ? <p className="unified-settings-no-results">لا توجد إعدادات مطابقة للبحث.</p> : null}
          </nav>
        </aside>
        <main className="unified-settings-main">
          <header className="unified-settings-section-head"><div><span>الإعدادات / {activeDefinition?.label}</span><h2>{activeDefinition?.label}</h2><p>{activeDefinition?.description}</p></div><button type="button" onClick={() => setContentOpen((current) => !current)}>{contentOpen ? <CaretUp size={18} /> : <CaretDown size={18} />}{contentOpen ? "إغلاق المجموعة" : "فتح المجموعة"}</button></header>
          {contentOpen ? <div className="unified-settings-content">
            {section === "users" ? <UsersPermissionsPanel /> : null}
            {section === "notifications" ? <NotificationSettingsPanel /> : null}
            {section === "crm" ? <CrmAdminPage embedded readOnly={!hasPermission(user, "settings.crm.manage")} /> : null}
            {section === "marketing" ? <MarketingSettingsPanel readOnly={!hasPermission(user, "settings.marketing.manage")} /> : null}
            {section === "operations" ? <OperationsSettingsPanel /> : null}
            {section === "tracking" ? <TrackingSettingsPanel readOnly={!hasPermission(user, "settings.tracking.manage")} /> : null}
          </div> : <div className="unified-settings-collapsed"><GearSix size={28} weight="duotone" /><strong>تم إغلاق مجموعة {activeDefinition?.label}</strong><span>يمكن فتحها مرة أخرى دون فقد أي بيانات.</span></div>}
        </main>
      </div>
    </div>
  );
}
