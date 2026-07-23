import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  ClipboardText,
  Gauge,
  MegaphoneSimple,
  NotePencil,
  PlusCircle,
  RocketLaunch,
  WarningCircle,
} from "@phosphor-icons/react";
import { marketingFetch } from "./api";
import type { MarketingMeta } from "./types";

type MarketingTab = { href: string; label: string; icon: typeof Gauge; end?: boolean };

const baseTabs: MarketingTab[] = [
  { href: "/marketing", label: "الداش بورد", icon: Gauge, end: true },
  { href: "/marketing/campaigns", label: "الحملات", icon: MegaphoneSimple },
  { href: "/marketing/tasks", label: "التاسكات", icon: ClipboardText },
  { href: "/marketing/agenda", label: "الأجندة", icon: NotePencil },
  { href: "/marketing/publishing", label: "تجهيز النشر", icon: RocketLaunch },
  { href: "/marketing/calendar", label: "التقويم", icon: CalendarBlank },
];

export type MarketingOutletContext = { meta: MarketingMeta; reloadMeta: () => Promise<void> };

export function MarketingLayout() {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setMeta(await marketingFetch<MarketingMeta>("/api/marketing?resource=meta"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل نظام التسويق");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading && !meta) return <div className="crm-loading-panel">جاري تجهيز نظام التسويق...</div>;
  if (!meta) {
    return (
      <div className="module-page">
        <div className="connection-banner"><WarningCircle size={20} /><span>{error || "تعذر فتح نظام التسويق"}</span></div>
      </div>
    );
  }

  return (
    <section className="marketing-module">
      <nav className="marketing-system-nav" aria-label="صفحات التسويق">
        {baseTabs.map(({ href, label, icon: Icon, end }) => (
          <NavLink key={href} to={href} end={end} className={({ isActive }) => `marketing-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
        {meta.access.canManageCampaigns ? (
          <NavLink to="/marketing/campaigns/new" className={({ isActive }) => `marketing-system-link marketing-new-link ${isActive ? "active" : ""}`}>
            <PlusCircle size={18} weight="duotone" />
            <span>حملة جديدة</span>
          </NavLink>
        ) : null}
      </nav>
      {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}
      <Outlet context={{ meta, reloadMeta: load } satisfies MarketingOutletContext} />
    </section>
  );
}
