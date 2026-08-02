import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Briefcase, Database, DownloadSimple, MagnifyingGlass, Megaphone, Truck, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { crmFetch, departmentLabel, formatDate, queryString as crmQuery } from "../crm/api";
import { sourceLabel } from "../crm/sourceCatalog";
import type { CrmLead, CrmMeta } from "../crm/types";
import { marketingDate, marketingFetch, marketingQuery } from "../marketing/api";
import { operationsFetch, formatOperationsDate, queryString as operationsQuery } from "../operations/api";
import type { OperationsMeta, VehicleRow } from "../operations/types";
import { trackingFetch, trackingQuery, trackingStatusLabel, formatTrackingDate } from "../tracking/api";
import type { TrackingCounts, TrackingOrderRow } from "../tracking/types";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, hasPermission } from "../systemAccess";

type DatabaseTab = "crm" | "marketing" | "operations" | "tracking";
type MarketingRow = {
  id: string;
  source_type: string;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  objective?: string | null;
  publish_start?: string | null;
  publish_end?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

const pageSize = 50;
const tabLabels: Record<DatabaseTab, string> = {
  crm: "قاعدة بيانات CRM",
  marketing: "قاعدة بيانات التسويق",
  operations: "قاعدة بيانات العمليات",
  tracking: "قاعدة بيانات التراكينج",
};
const detailsLinks: Record<DatabaseTab, string> = {
  crm: "/crm/database",
  marketing: "/marketing/database",
  operations: "/operations/all",
  tracking: "/tracking",
};

function downloadCsv(fileName: string, rows: Array<Record<string, unknown>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const content = `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function progress(order: TrackingOrderRow) {
  const total = Number(order.total_stages || 0);
  return total ? Math.round((Number(order.completed_stages || 0) / total) * 100) : 0;
}

export function UnifiedDatabasePage() {
  const { user } = useAuth();
  const tabs = useMemo(() => [
    canAccessCrm(user) && hasPermission(user, "crm.database.view") ? "crm" : null,
    canAccessMarketing(user) && hasPermission(user, "marketing.database.view") ? "marketing" : null,
    canAccessOperations(user) && (hasPermission(user, "operations.all.view") || hasPermission(user, "operations.inventory.view")) ? "operations" : null,
    canAccessTracking(user) && hasPermission(user, "tracking.orders.view") ? "tracking" : null,
  ].filter(Boolean) as DatabaseTab[], [user]);
  const [active, setActive] = useState<DatabaseTab>(tabs[0] || "crm");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [crmMeta, setCrmMeta] = useState<CrmMeta | null>(null);
  const [operationsMeta, setOperationsMeta] = useState<OperationsMeta | null>(null);

  useEffect(() => {
    if (!tabs.includes(active) && tabs[0]) setActive(tabs[0]);
  }, [active, tabs]);

  useEffect(() => {
    setSearch("");
    setAppliedSearch("");
    setFilter("");
    setPage(1);
    setRows([]);
    setTotal(0);
  }, [active]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setAppliedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (active === "crm" && !crmMeta) void crmFetch<CrmMeta>("/api/crm/meta").then(setCrmMeta).catch(() => undefined);
    if (active === "operations" && !operationsMeta) void operationsFetch<OperationsMeta>("/api/operations?resource=meta").then(setOperationsMeta).catch(() => undefined);
  }, [active, crmMeta, operationsMeta]);

  async function load() {
    if (!tabs.includes(active)) return;
    setLoading(true);
    setError("");
    try {
      if (active === "crm") {
        const payload = await crmFetch<{ rows: CrmLead[]; total: number }>(`/api/crm/leads${crmQuery({ q: appliedSearch, status: filter, limit: pageSize, offset: (page - 1) * pageSize })}`);
        setRows(payload.rows || []);
        setTotal(Number(payload.total || 0));
      } else if (active === "marketing") {
        const payload = await marketingFetch<{ rows: MarketingRow[] }>(`/api/marketing${marketingQuery({ resource: "database" })}`);
        const filtered = (payload.rows || []).filter((row) => {
          const matchesSearch = `${row.name || ""} ${row.code || ""} ${row.type || ""} ${row.objective || ""}`.toLowerCase().includes(appliedSearch.toLowerCase());
          return matchesSearch && (!filter || row.source_type === filter);
        });
        setTotal(filtered.length);
        setRows(filtered.slice((page - 1) * pageSize, page * pageSize));
      } else if (active === "operations") {
        const payload = await operationsFetch<{ rows: VehicleRow[]; total: number }>(`/api/operations${operationsQuery({ resource: "vehicles", search: appliedSearch, status: filter, all: hasPermission(user, "operations.all.view") ? 1 : undefined, page, pageSize })}`);
        setRows(payload.rows || []);
        setTotal(Number(payload.total || 0));
      } else {
        const payload = await trackingFetch<{ orders: TrackingOrderRow[]; counts: TrackingCounts }>(`/api/tracking/orders${trackingQuery({ search: appliedSearch, status: filter, archived: "false" })}`);
        const all = payload.orders || [];
        setTotal(all.length);
        setRows(all.slice((page - 1) * pageSize, page * pageSize));
      }
    } catch (failure) {
      setRows([]);
      setTotal(0);
      setError(failure instanceof Error ? failure.message : "تعذر تحميل قاعدة البيانات الموحدة");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [active, appliedSearch, filter, page]);

  async function exportAll() {
    setExporting(true);
    setError("");
    try {
      if (active === "crm") {
        const all: CrmLead[] = [];
        let offset = 0;
        let expected = 0;
        do {
          const payload = await crmFetch<{ rows: CrmLead[]; total: number }>(`/api/crm/leads${crmQuery({ q: appliedSearch, status: filter, limit: 500, offset })}`);
          expected = Number(payload.total || 0);
          all.push(...(payload.rows || []));
          offset += payload.rows?.length || 0;
          if (!payload.rows?.length) break;
        } while (offset < expected);
        downloadCsv("قاعدة-بيانات-CRM.csv", all.map((row) => ({
          "اسم العميل": row.customer_name,
          "الجوال": row.phone || row.phone_normalized,
          "القسم": departmentLabel(row.department_code),
          "الفرع": row.branch_name || row.branch_code,
          "الحالة": row.status_label,
          "المصدر": sourceLabel(row.source_code, row.source_name),
          "السيارة": row.car_name,
          "المسؤول": row.assigned_name,
          "آخر تحديث": formatDate(row.updated_at),
        })));
      } else if (active === "marketing") {
        const payload = await marketingFetch<{ rows: MarketingRow[] }>(`/api/marketing${marketingQuery({ resource: "database" })}`);
        const all = (payload.rows || []).filter((row) => `${row.name || ""} ${row.code || ""} ${row.type || ""} ${row.objective || ""}`.toLowerCase().includes(appliedSearch.toLowerCase()) && (!filter || row.source_type === filter));
        downloadCsv("قاعدة-بيانات-التسويق.csv", all.map((row) => ({
          "النوع": row.source_type === "agenda" ? "أجندة" : "حملة",
          "الكود": row.code,
          "الاسم": row.name,
          "التصنيف": row.type,
          "الهدف": row.objective,
          "بداية النشر": marketingDate(row.publish_start),
          "نهاية النشر": marketingDate(row.publish_end),
          "الحالة": row.status,
        })));
      } else if (active === "operations") {
        const first = await operationsFetch<{ rows: VehicleRow[]; total: number }>(`/api/operations${operationsQuery({ resource: "vehicles", search: appliedSearch, status: filter, all: hasPermission(user, "operations.all.view") ? 1 : undefined, page: 1, pageSize: 200 })}`);
        const all = [...(first.rows || [])];
        const pages = Math.max(1, Math.ceil(Number(first.total || 0) / 200));
        for (let current = 2; current <= pages; current += 1) {
          const payload = await operationsFetch<{ rows: VehicleRow[] }>(`/api/operations${operationsQuery({ resource: "vehicles", search: appliedSearch, status: filter, all: hasPermission(user, "operations.all.view") ? 1 : undefined, page: current, pageSize: 200 })}`);
          all.push(...(payload.rows || []));
        }
        downloadCsv("قاعدة-بيانات-العمليات.csv", all.map((row) => ({
          "رقم الهيكل": row.vin,
          "السيارة": row.car_name,
          "البيان": row.statement,
          "الموديل": row.model_year,
          "اللون الداخلي": row.interior_color,
          "اللون الخارجي": row.exterior_color,
          "المكان": row.location_name,
          "الحالة": row.status_name,
          "الملاحظات": row.notes,
          "آخر تحديث": formatOperationsDate(row.updated_at),
        })));
      } else {
        const payload = await trackingFetch<{ orders: TrackingOrderRow[] }>(`/api/tracking/orders${trackingQuery({ search: appliedSearch, status: filter, archived: "false" })}`);
        downloadCsv("قاعدة-بيانات-التراكينج.csv", (payload.orders || []).map((order) => ({
          "رقم الطلب": order.sales_order_no,
          "العميل": order.customer_name,
          "الجوال": order.customer_mobile,
          "الفرع": order.branch,
          "المندوب": order.sales_person,
          "عدد السيارات": order.vehicles_count,
          "الحالة": trackingStatusLabel(order.status, Boolean(order.is_archived), Boolean(order.is_cancelled)),
          "التقدم": `${progress(order)}%`,
          "تاريخ التسليم": formatTrackingDate(order.delivery_date, false),
          "آخر تحديث": formatTrackingDate(order.updated_at),
        })));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير قاعدة البيانات");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filterOptions = active === "crm"
    ? [...new Map((crmMeta?.statuses || []).map((item) => [item.value, item.label])).entries()].map(([value, label]) => ({ value, label }))
    : active === "marketing"
      ? [{ value: "campaign", label: "الحملات" }, { value: "agenda", label: "الأجندات" }]
      : active === "operations"
        ? (operationsMeta?.statuses || []).map((item) => ({ value: item.code, label: item.name }))
        : [{ value: "not_started", label: "لم يبدأ" }, { value: "in_progress", label: "تحت الإجراء" }, { value: "completed", label: "مكتمل" }];

  return (
    <div className="module-page unified-center-page">
      {tabs.length ? (
        <>
          <nav className="unified-system-tabs" aria-label="أنظمة قاعدة البيانات">
            {tabs.map((tab) => <button type="button" key={tab} className={active === tab ? "active" : ""} onClick={() => setActive(tab)}>{tab === "crm" ? <UsersThree size={19} /> : tab === "marketing" ? <Megaphone size={19} /> : tab === "operations" ? <Briefcase size={19} /> : <Truck size={19} />}<span>{tabLabels[tab]}</span></button>)}
          </nav>

          <section className="panel unified-database-panel">
            <header className="unified-database-toolbar">
              <div className="unified-database-title"><span>{tabLabels[active]}</span><strong>{total.toLocaleString("ar-SA")} سجل</strong></div>
              <div className="unified-database-controls">
                <label className="unified-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في البيانات" /></label>
                <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="">كل الحالات / الأنواع</option>{filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                <button type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />تحديث</button>
                <button type="button" onClick={() => void exportAll()} disabled={loading || exporting}><DownloadSimple size={17} />{exporting ? "جاري التصدير..." : "تصدير البيانات"}</button>
                <Link to={detailsLinks[active]}>فتح الصفحة التفصيلية</Link>
              </div>
            </header>
            {error ? <div className="unified-data-alert"><WarningCircle size={18} />{error}</div> : null}
            <div className="unified-table-wrap unified-database-table">
              {active === "crm" ? <table><thead><tr><th>اسم العميل</th><th>الجوال</th><th>القسم</th><th>الفرع</th><th>الحالة</th><th>المصدر</th><th>السيارة</th><th>المسؤول</th><th>آخر تحديث</th></tr></thead><tbody>{(rows as CrmLead[]).map((row) => <tr key={row.id}><td><strong>{row.customer_name || "—"}</strong></td><td>{row.phone || row.phone_normalized || "—"}</td><td>{departmentLabel(row.department_code)}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.status_label || "—"}</td><td>{sourceLabel(row.source_code, row.source_name)}</td><td>{row.car_name || "—"}</td><td>{row.assigned_name || "—"}</td><td>{formatDate(row.updated_at)}</td></tr>)}</tbody></table> : null}
              {active === "marketing" ? <table><thead><tr><th>النوع</th><th>الكود</th><th>الاسم</th><th>التصنيف</th><th>الهدف</th><th>بداية النشر</th><th>نهاية النشر</th><th>الحالة</th></tr></thead><tbody>{(rows as MarketingRow[]).map((row) => <tr key={`${row.source_type}-${row.id}`}><td><span className="unified-record-badge">{row.source_type === "agenda" ? "أجندة" : "حملة"}</span></td><td>{row.code || "—"}</td><td><strong>{row.name || "—"}</strong></td><td>{row.type || "—"}</td><td>{row.objective || "—"}</td><td>{marketingDate(row.publish_start)}</td><td>{marketingDate(row.publish_end)}</td><td>{row.status || "—"}</td></tr>)}</tbody></table> : null}
              {active === "operations" ? <table><thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th><th>الموديل</th><th>الداخلي</th><th>الخارجي</th><th>المكان</th><th>الحالة</th><th>آخر تحديث</th></tr></thead><tbody>{(rows as VehicleRow[]).map((row) => <tr key={row.id}><td><strong>{row.vin}</strong></td><td>{row.car_name || "—"}</td><td>{row.statement || "—"}</td><td>{row.model_year || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.location_name || "—"}</td><td>{row.status_name || "—"}</td><td>{formatOperationsDate(row.updated_at)}</td></tr>)}</tbody></table> : null}
              {active === "tracking" ? <table><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الجوال</th><th>الفرع</th><th>المندوب</th><th>السيارات</th><th>الحالة</th><th>التقدم</th><th>تاريخ التسليم</th><th>آخر تحديث</th></tr></thead><tbody>{(rows as TrackingOrderRow[]).map((order) => <tr key={order.id}><td><strong>{order.sales_order_no}</strong></td><td>{order.customer_name || "—"}</td><td>{order.customer_mobile || "—"}</td><td>{order.branch || "—"}</td><td>{order.sales_person || "—"}</td><td>{Number(order.vehicles_count || 0).toLocaleString("ar-SA")}</td><td>{trackingStatusLabel(order.status, Boolean(order.is_archived), Boolean(order.is_cancelled))}</td><td>{progress(order).toLocaleString("ar-SA")}%</td><td>{formatTrackingDate(order.delivery_date, false)}</td><td>{formatTrackingDate(order.updated_at)}</td></tr>)}</tbody></table> : null}
              {!loading && !rows.length ? <div className="unified-empty-row">لا توجد بيانات مطابقة للبحث والفلاتر الحالية.</div> : null}
              {loading ? <div className="unified-empty-row">جاري تحميل البيانات...</div> : null}
            </div>
            <footer className="unified-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</button><span>صفحة {page.toLocaleString("ar-SA")} من {totalPages.toLocaleString("ar-SA")}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></footer>
          </section>
        </>
      ) : <section className="module-empty"><div><WarningCircle size={45} /><h2>لا توجد قواعد بيانات متاحة</h2><p>لا يملك الحساب صلاحية قراءة قواعد بيانات الأنظمة حاليًا.</p></div></section>}
    </div>
  );
}
