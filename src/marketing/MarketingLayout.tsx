import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  CalendarDots,
  ChartBar,
  CirclesFour,
  Database,
  Gift,
  LinkSimple,
  ListChecks,
  Megaphone,
  Package,
  PaperPlaneTilt,
  PlusCircle,
  PresentationChart,
  Warehouse,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react";
import { marketingFetch } from "./api";
import type { MarketingMeta } from "./types";

const items: Array<{ href: string; label: string; icon: Icon; end?: boolean; permissions?: string[] }> = [
  { href: "/marketing", label: "لوحة التحكم", icon: CirclesFour, end: true, permissions: ["marketing.view"] },
  { href: "/marketing/database", label: "قاعدة البيانات", icon: Database, permissions: ["marketing.view"] },
  { href: "/marketing/create-campaign", label: "إنشاء حملة", icon: PlusCircle, permissions: ["marketing.project.create"] },
  { href: "/marketing/create-agenda", label: "إنشاء أجندة", icon: CalendarDots, permissions: ["marketing.project.create"] },
  { href: "/marketing/campaigns", label: "إدارة الحملات", icon: Megaphone, permissions: ["marketing.view"] },
  { href: "/marketing/packages", label: "إدارة الباقات", icon: Gift, permissions: ["marketing.view", "marketing.package.manage"] },
  { href: "/marketing/publish-prep", label: "تجهيز النشر", icon: PaperPlaneTilt, permissions: ["marketing.publish.manage", "marketing.task.execute", "marketing.project.edit"] },
  { href: "/marketing/requests", label: "متابعة الطلبات", icon: ListChecks, permissions: ["marketing.photo_request.create", "marketing.photo_request.manage"] },
  { href: "/marketing/calendar", label: "التقويم", icon: CalendarBlank, permissions: ["marketing.view"] },
  { href: "/marketing/stock", label: "الاستوك", icon: Warehouse, permissions: ["marketing.stock.view"] },
  { href: "/marketing/reports", label: "التقارير", icon: ChartBar, permissions: ["marketing.reports.view"] },
  { href: "/marketing/attendance", label: "الحضور والانصراف", icon: PresentationChart, permissions: ["marketing.attendance.use", "marketing.attendance.manage"] },
  { href: "/marketing/connections", label: "ربط المنصات", icon: LinkSimple, permissions: ["marketing.connections.manage"] },
];

export type MarketingOutletContext = { meta: MarketingMeta; reloadMeta: () => Promise<void> };

export function MarketingLayout() {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMeta() {
    setLoading(true);
    setError("");
    try { setMeta(await marketingFetch<MarketingMeta>("/api/marketing?resource=meta")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => {
    if (!meta) return;
    const sendPresence = () => void marketingFetch("/api/marketing", {
      method: "POST",
      body: JSON.stringify({ action: "attendance_action", attendanceAction: "presence", lastPage: window.location.pathname, activityType: "فتح صفحة التسويق", deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform } }),
    }).catch(() => undefined);
    sendPresence();
    const timer = window.setInterval(sendPresence, 60_000);
    return () => window.clearInterval(timer);
  }, [meta]);

  if (loading && !meta) return <div className="crm-loading-panel">جاري تجهيز نظام التسويق...</div>;
  if (!meta) return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>{error || "تعذر فتح نظام التسويق"}</span><button type="button" onClick={() => void loadMeta()}>إعادة المحاولة</button></div></div>;

  return (
    <section className="marketing-module">
      <nav className="marketing-system-nav" aria-label="صفحات التسويق">
        {items.filter((item) => !item.permissions?.length || item.permissions.some((permission) => meta.permissions[permission])).map(({ href, label, icon: Icon, end }) => (
          <NavLink key={href} to={href} end={end} className={({ isActive }) => `marketing-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}
      <Outlet context={{ meta, reloadMeta: loadMeta } satisfies MarketingOutletContext} />
    </section>
  );
}
