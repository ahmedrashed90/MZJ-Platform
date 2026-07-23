import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank, ChartBar, Clock, Database, Gift, Gauge, LinkSimple, Megaphone,
  PaperPlaneTilt, PlusCircle, Stack, Truck, WarningCircle,
} from "@phosphor-icons/react";
import { marketingFetch } from "./api";
import type { MarketingMeta } from "./types";
import "./marketing.css";

const items = [
  { href: "/marketing", label: "لوحة التحكم", icon: Gauge, end: true, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/database", label: "قاعدة البيانات", icon: Database, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/create-campaign", label: "إنشاء حملة", icon: PlusCircle, visible: (meta: MarketingMeta) => meta.permissions.canManage },
  { href: "/marketing/create-agenda", label: "إنشاء أجندة", icon: CalendarBlank, visible: (meta: MarketingMeta) => meta.permissions.canManage },
  { href: "/marketing/campaigns", label: "إدارة الحملات", icon: Megaphone, visible: (meta: MarketingMeta) => meta.permissions.canManage },
  { href: "/marketing/packages", label: "إدارة الباقات", icon: Gift, visible: (meta: MarketingMeta) => meta.permissions.canManagePackages },
  { href: "/marketing/publish-prep", label: "تجهيز النشر", icon: PaperPlaneTilt, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/requests", label: "متابعة الطلبات", icon: Truck, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/calendar", label: "التقويم", icon: CalendarBlank, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/stock", label: "الاستوك", icon: Stack, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/reports", label: "التقارير", icon: ChartBar, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/attendance", label: "الحضور والانصراف", icon: Clock, visible: (meta: MarketingMeta) => meta.permissions.canView },
  { href: "/marketing/connections", label: "ربط المنصات", icon: LinkSimple, visible: (meta: MarketingMeta) => meta.permissions.canManage },
] as const;

export type MarketingOutletContext = { meta: MarketingMeta; reloadMeta: () => Promise<void> };

export function MarketingLayout() {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMeta(await marketingFetch<MarketingMeta>("/api/marketing?resource=meta"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !meta) return <div className="crm-loading-panel">جاري تجهيز نظام التسويق...</div>;
  if (!meta) {
    return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>{error || "تعذر فتح نظام التسويق"}</span><button type="button" onClick={() => void load()}>إعادة المحاولة</button></div></div>;
  }
  if (!meta.permissions.canView) {
    return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>لا تملك صلاحية عرض نظام التسويق.</span></div></div>;
  }

  return (
    <section className="marketing-module">
      <nav className="marketing-system-nav" aria-label="صفحات التسويق">
        {items.filter((item) => item.visible(meta)).map(({ href, label, icon: Icon, ...item }) => (
          <NavLink key={href} to={href} end={"end" in item ? item.end : false} className={({ isActive }) => `marketing-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {error ? <div className="marketing-alert error"><WarningCircle size={18} />{error}</div> : null}
      <Outlet context={{ meta, reloadMeta: load } satisfies MarketingOutletContext} />
    </section>
  );
}
