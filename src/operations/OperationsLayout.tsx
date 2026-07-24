import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "./api";
import type { OperationsMeta } from "./types";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";

const tabs = [
  ["/operations", "مخزون السيارات", "operations.inventory.view"],
  ["/operations/manage", "إدارة السيارات", "operations.manage.view"],
  ["/operations/movement", "الحركة", "operations.movement.view"],
  ["/operations/transfers", "الطلبات", "operations.transfers.view"],
  ["/operations/approvals", "الموافقات", "operations.approvals.view"],
  ["/operations/all", "جميع السيارات", "operations.all.view"],
  ["/operations/movements", "سجل الحركات", "operations.movements.view"],
  ["/operations/archive", "الأرشيف", "operations.archive.view"],
] as const;

export type OperationsOutletContext = { meta: OperationsMeta; reloadMeta: () => Promise<void> };

export function OperationsLayout() {
  const { user } = useAuth();
  const visibleTabs = tabs.filter(([, , permission]) => hasPermission(user, permission));
  const [meta, setMeta] = useState<OperationsMeta | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try { setMeta(await operationsFetch<OperationsMeta>("/api/operations?resource=meta")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات العمليات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  if (loading && !meta) return <div className="crm-loading-panel">جاري تجهيز نظام العمليات...</div>;
  if (!meta) return <div className="module-page"><div className="connection-banner"><WarningCircle size={20} /><span>{error || "تعذر فتح نظام العمليات"}</span><button type="button" onClick={() => void load()}><ArrowClockwise size={17} />إعادة المحاولة</button></div></div>;

  return (
    <div className="operations-module">
      <div className="operations-tabs" role="tablist">
        {visibleTabs.map(([href, label]) => <NavLink key={href} to={href} end={href === "/operations"} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>)}
      </div>
      {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}
      <Outlet context={{ meta, reloadMeta: load } satisfies OperationsOutletContext} />
    </div>
  );
}
