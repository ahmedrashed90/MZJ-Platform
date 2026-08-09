import { useEffect, useMemo, useState } from "react";
import { Bell, CaretDown, CaretUp, Crown, Database, GearSix, MagnifyingGlass, Megaphone, Path, UsersThree, WarningCircle, Wrench } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { UsersPermissionsPanel } from "../access-control/UsersPermissionsPanel";
import { useAuth } from "../auth/AuthContext";
import { CrmAdminPage } from "../crm/pages/CrmAdminPage";
import { MarketingSettingsPanel } from "../marketing/components/MarketingSettingsPanel";
import { NotificationSettingsPanel } from "../notifications/NotificationSettingsPanel";
import { OperationsSettingsPanel } from "../operations/components/OperationsSettingsPanel";
import { hasPermission } from "../systemAccess";
import { TrackingSettingsPanel } from "../tracking/components/TrackingSettingsPanel";
import { DataManagementPanel } from "../settings/DataManagementPanel";
import { OwnersSettingsPanel } from "../owners/OwnersSettingsPanel";

type Section = "users" | "notifications" | "crm" | "marketing" | "operations" | "tracking" | "owners" | "data";

type SectionDefinition = {
  key: Section;
  label: string;
  description: string;
  keywords: string;
  icon: typeof GearSix;
  permissions: string[];
  personal?: boolean;
};

const sectionDefinitions: SectionDefinition[] = [
  { key: "users", label: "المستخدمون والصلاحيات", description: "الحسابات والأدوار والفروع والأقسام والسجلات الأمنية", keywords: "المستخدمون الأدوار قوالب الصلاحيات الفروع الأقسام دليل سجل النشاط الأمني NEXT ERP", icon: UsersThree, permissions: ["settings.users.view","settings.users.create","settings.users.update","settings.users.disable","settings.roles.manage","settings.permissions.manage","settings.branches.manage","settings.departments.manage","settings.audit.view","settings.security.view"] },
  { key: "notifications", label: "إعدادات الإشعارات", description: "الصوت والكارت المؤقت ومدة الظهور وتنبيهات الأنظمة", keywords: "الإشعارات الجرس الصوت الكارت البادج التنبيه", icon: Bell, permissions: [], personal: true },
  { key: "operations", label: "إعدادات العمليات", description: "حالات السيارات والمواقع ومسارات العمل", keywords: "العمليات السيارات المواقع", icon: Wrench, permissions: ["settings.operations.view", "settings.operations.manage"] },
  { key: "tracking", label: "إعدادات التتبع", description: "المراحل والرسائل وإعدادات التراكينج", keywords: "التتبع التراكينج المراحل الرسائل", icon: Path, permissions: ["settings.tracking.view", "settings.tracking.manage"] },
  { key: "marketing", label: "إعدادات التسويق", description: "الأقسام واليوزرات والكرييتيفات والحملات والمنصات", keywords: "التسويق الأقسام اليوزرات الكرييتيف الحملات المنصات", icon: Megaphone, permissions: ["settings.marketing.view", "settings.marketing.manage", "marketing.platforms.view"] },
  { key: "crm", label: "إعدادات CRM", description: "مسارات العملاء والأتمتة والتوزيع والتقارير", keywords: "CRM العملاء الأتمتة التوزيع السرعة الكفاءة", icon: GearSix, permissions: ["settings.crm.view", "settings.crm.manage"] },
  { key: "owners", label: "MZJ Owners Community", description: "OTP والنقاط والمكافآت وإعدادات الدعوات", keywords: "owners community العملاء النقاط المكافآت otp واتساب الدعوات", icon: Crown, permissions: ["settings.owners.view", "settings.owners.manage", "owners.community.manage"] },
  { key: "data", label: "البيانات والنسخ الاحتياطية", description: "استيراد وتصدير العملاء والنسخ الاحتياطية ومسح بيانات التجربة", keywords: "البيانات النسخة الاحتياطية استيراد تصدير العملاء مسح التجربة", icon: Database, permissions: ["platform.superadmin"] },
];

export function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const available = sectionDefinitions.filter((item) => item.personal || item.permissions.some((permission) => hasPermission(user, permission)));
  const requested = params.get("section") as Section | null;
  const [section, setSection] = useState<Section>(() => available.find((item) => item.key === requested)?.key || available[0]?.key || "users");
  const [navigationSearch, setNavigationSearch] = useState("");
  const [contentOpen, setContentOpen] = useState(true);
  const filteredSections = useMemo(() => {
    const term = navigationSearch.trim().toLowerCase();
    return available.filter((item) => !term || `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(term));
  }, [available.map((item) => item.key).join("|"), navigationSearch]);
  const activeDefinition = available.find((item) => item.key === section) || available[0];
  const ActiveIcon = activeDefinition?.icon || GearSix;

  useEffect(() => {
    if (!available.some((item) => item.key === section)) setSection(available[0]?.key || "users");
  }, [section, available.map((item) => item.key).join("|")]);

  function choose(next: Section) {
    setSection(next);
    setContentOpen(true);
    setParams(next === "users" ? {} : { section: next }, { replace: true });
  }

  if (!available.length) {
    return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>لا توجد صلاحية لمشاهدة أي قسم من الإعدادات.</span></div></div>;
  }

  return (
    <div className="module-page settings-page unified-settings-page">
      <section className="unified-settings-picker">
        <header className="unified-settings-picker-head">
          <div><strong>أقسام الإعدادات</strong><span>اختر القسم المطلوب لفتح أدواته كاملة.</span></div>
          <label className="unified-settings-search unified-settings-picker-search">
            <MagnifyingGlass size={18} />
            <input value={navigationSearch} onChange={(event) => setNavigationSearch(event.target.value)} placeholder="ابحث عن إعداد أو نظام" />
          </label>
          <b>{available.length.toLocaleString("ar-SA-u-nu-latn")} أقسام متاحة</b>
        </header>
        <nav className="unified-settings-section-grid" aria-label="أقسام الإعدادات">
          {filteredSections.map(({ key, label, description, icon: Icon }) => (
            <button key={key} type="button" className={`unified-settings-section-card ${section === key ? "active" : ""}`} onClick={() => choose(key)}>
              <span className="unified-settings-section-card-icon"><Icon size={24} weight="duotone" /></span>
              <span className="unified-settings-section-card-copy"><strong>{label}</strong><small>{description}</small></span>
              <span className="unified-settings-section-card-state">{section === key ? "مفتوح الآن" : "فتح القسم"}</span>
            </button>
          ))}
          {!filteredSections.length ? <p className="unified-settings-no-results">لا توجد أقسام مطابقة للبحث.</p> : null}
        </nav>
      </section>

      <main className="unified-settings-main">
        <div className="unified-settings-section-actions page-top-actions">
          <button type="button" onClick={() => setContentOpen((current) => !current)}>{contentOpen ? <CaretUp size={18} /> : <CaretDown size={18} />}{contentOpen ? "إغلاق القسم" : "فتح القسم"}</button>
        </div>

        {contentOpen ? (
          <div className="unified-settings-content">
            {section === "users" ? <UsersPermissionsPanel /> : null}
            {section === "notifications" ? <NotificationSettingsPanel /> : null}
            {section === "crm" ? <CrmAdminPage embedded readOnly={!hasPermission(user, "settings.crm.manage")} /> : null}
            {section === "marketing" ? <MarketingSettingsPanel readOnly={!hasPermission(user, "settings.marketing.manage")} /> : null}
            {section === "operations" ? <OperationsSettingsPanel /> : null}
            {section === "tracking" ? <TrackingSettingsPanel readOnly={!hasPermission(user, "settings.tracking.manage")} /> : null}
            {section === "owners" ? <OwnersSettingsPanel /> : null}
            {section === "data" ? <DataManagementPanel /> : null}
          </div>
        ) : (
          <div className="unified-settings-collapsed"><ActiveIcon size={30} weight="duotone" /><strong>تم إغلاق قسم {activeDefinition?.label}</strong><span>يمكن فتحه مرة أخرى بدون فقد أي بيانات.</span></div>
        )}
      </main>
    </div>
  );
}
