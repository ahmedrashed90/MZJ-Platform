import { useEffect, useState } from "react";
import { FilePdf, FileXls, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { MovementHistoryTable, type MovementHistoryRow } from "../components/MovementHistoryTable";
import { exportExcel, formatOperationsDate, operationsFetch, queryString } from "../api";
import { useOperations } from "../useOperations";

export function MovementHistoryPage() {
  const { meta } = useOperations();
  const [rows, setRows] = useState<MovementHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", from: "", to: "", status: "", user: "", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  async function fetchPage(targetPage: number, targetSize: number) {
    return operationsFetch<{ rows: MovementHistoryRow[]; total: number }>(`/api/operations${queryString({ resource: "movements", ...filters, page: targetPage, pageSize: targetSize })}`);
  }

  async function fetchAllRows() {
    const first = await fetchPage(1, 200);
    const all = [...first.rows];
    const pages = Math.max(1, Math.ceil(first.total / 200));
    for (let current = 2; current <= pages; current += 1) all.push(...(await fetchPage(current, 200)).rows);
    return all;
  }

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPage(targetPage, pageSize);
      setRows(payload.rows);
      setTotal(payload.total);
    } catch (failure) {
      setRows([]);
      setTotal(0);
      setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل الحركات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(page); }, [page]);

  async function applyFilters() {
    if (page !== 1) setPage(1);
    else await load(1);
  }

  async function exportAll() {
    setLoading(true);
    setError("");
    try {
      const all = await fetchAllRows();
      exportExcel("سجل-الحركات.xlsx", ["التاريخ والوقت","VIN","السيارة","البيان","المكان السابق","المكان الجديد","الحالة السابقة","الحالة الجديدة","منفذ الحركة","فرع المستخدم","الملاحظات","ملاحظات الحالة","حجز - نواقص - تحديد مكان","رقم الطلب","Batch ID"], all.map((row) => [row.created_at,row.vin,row.car_name,row.statement,row.from_location_name,row.to_location_name,row.old_status_name || row.old_status,row.new_status_name || row.new_status,row.performed_by_name,row.performed_by_branch,row.note,row.state_note,row.shortage_note,row.request_no || row.transfer_request_id,row.batch_id]));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير سجل الحركات");
    } finally {
      setLoading(false);
    }
  }

  async function exportPdfA3() {
    setLoading(true);
    setError("");
    try {
      const all = await fetchAllRows();
      const win = window.open("", "_blank", "width=1600,height=1000");
      if (!win) throw new Error("تعذر فتح نافذة تصدير PDF. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");
      const safe = (value: unknown) => String(value ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      const mark = (value: unknown) => String(value || "").toLowerCase() === "ok" ? '<span class="mark yes">✓</span>' : '<span class="mark no">✕</span>';
      const approval = (value: unknown) => value === true ? '<span class="mark yes">✓</span>' : '<span class="mark no">✕</span>';
      const body = all.map((row) => `<tr>
        <td class="vin">${safe(row.vin)}</td><td>${safe(row.car_name)}</td><td>${safe(row.statement)}</td><td>${safe(row.agent_name)}</td>
        <td>${safe(row.interior_color)}</td><td>${safe(row.exterior_color)}</td><td>${safe(row.model_year)}</td><td>${safe(row.plate_no)}</td>
        <td>${safe(row.batch_no)}</td><td>${safe(formatOperationsDate(row.created_at))}</td><td>${safe(row.from_location_name)}</td><td>${safe(row.to_location_name)}</td>
        <td class="wrap">${safe(row.vehicle_notes)}</td><td class="wrap">${safe(row.shortage_note)}</td><td>${safe(row.old_status_name || row.old_status)}</td><td>${safe(row.new_status_name || row.new_status)}</td>
        <td>${mark(row.sensor_status)}</td><td>${mark(row.camera_status)}</td><td>${mark(row.ac_status)}</td><td>${mark(row.radio_status)}</td><td>${mark(row.screen_status)}</td>
        <td>${mark(row.remote_status)}</td><td>${mark(row.mats_status)}</td><td>${mark(row.extinguisher_status)}</td><td>${mark(row.safety_bag_status)}</td><td>${mark(row.spare_tire_status)}</td>
        <td>${approval(row.financial_approved)}</td><td>${approval(row.administrative_approved)}</td><td>${safe(row.performed_by_name)}</td><td>${safe(row.request_no || row.transfer_request_id)}</td>
      </tr>`).join("");
      const filterSummary = [
        filters.search ? `بحث: ${filters.search}` : "",
        filters.dateFrom ? `من: ${filters.dateFrom}` : "",
        filters.dateTo ? `إلى: ${filters.dateTo}` : "",
        filters.user ? `المستخدم: ${filters.user}` : "",
      ].filter(Boolean).join(" • ") || "كل الحركات";
      win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل الحركات - A3</title><style>
        @page{size:A3 landscape;margin:6mm}
        *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{font-family:Tajawal,Arial,sans-serif;color:#35221c;font-weight:700}
        header{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#74382b;color:#fff;padding:8px 11px;border-radius:8px;margin-bottom:6px;break-inside:avoid}
        header h1{font-size:17px;margin:0}header p{font-size:8px;margin:3px 0 0;opacity:.9}header b{font-size:18px;min-width:42px;text-align:center}
        table{width:100%;border-collapse:collapse;table-layout:auto;font-size:5.7px;line-height:1.25}
        thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #d8c5bc;padding:2.2px 2.8px;text-align:center;vertical-align:middle;white-space:nowrap}
        th{background:#f3e5de;color:#4f2c22;font-weight:900;font-size:5.8px}.vin{direction:ltr;font-family:Arial,sans-serif;font-weight:900}.wrap{white-space:normal;min-width:27mm;max-width:38mm;overflow-wrap:anywhere}
        .mark{display:inline-grid;place-items:center;width:13px;height:13px;border-radius:50%;font-size:8px;font-family:Arial,sans-serif;font-weight:900}.yes{background:#e3f5e8;color:#1d7538}.no{background:#fde7e7;color:#a32631}
        tbody tr:nth-child(even){background:#fcf9f7}@media print{header,th,.mark{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header><div><h1>سجل الحركات</h1><p>${safe(filterSummary)}</p></div><b>${all.length.toLocaleString("ar-SA")}</b></header><table><thead><tr>
        <th>رقم الهيكل (VIN)</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>اللون الداخلي</th><th>اللون الخارجي</th><th>موديل</th><th>اللوحة</th><th>اسم الدفعة بالتاريخ</th><th>التاريخ</th>
        <th>المكان السابق</th><th>المكان الحالي</th><th>ملاحظات في السيارة</th><th>حجز - نواقص - تحديد مكان</th><th>الحالة السابقة</th><th>الحالة الحالية</th>
        <th>حساس</th><th>كاميرا</th><th>مكيف</th><th>مسجل</th><th>شاشة</th><th>ريموت</th><th>فرشات</th><th>طفاية</th><th>شنطة سلامة</th><th>اسبير</th>
        <th>الموافقة المالية</th><th>الموافقة الإدارية</th><th>منفذ الحركة</th><th>رقم الطلب</th>
      </tr></thead><tbody>${body || '<tr><td colspan="30">لا توجد بيانات مطابقة</td></tr>'}</tbody></table></body></html>`);
      win.document.close();
      win.focus();
      win.setTimeout(() => win.print(), 300);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="module-page operations-page operations-history-page">
      <header className="module-page-head"><div><h1>سجل الحركات</h1><p>عرض الحركات الفعلية المسجلة لكل سيارة مع الفلاتر والتصدير وتغيير عرض الأعمدة بالسحب.</p></div><div className="operations-header-actions"><span className="operations-count">{total.toLocaleString("ar-SA")}</span>{meta.permissions.canExport ? <><button type="button" onClick={() => void exportAll()} disabled={loading}><FileXls size={17} />تصدير Excel</button><button type="button" className="operations-pdf-button" onClick={() => void exportPdfA3()} disabled={loading}><FilePdf size={17} />تصدير PDF A3</button></> : null}</div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <section className="panel operations-data-panel">
        <div className="operations-history-filters">
          <label className="operations-search"><MagnifyingGlass size={18} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") void applyFilters(); }} placeholder="VIN أو السيارة أو البيان أو الملاحظة" /></label>
          <select value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })}><option value="">من كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })}><option value="">إلى كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">كل الحالات الجديدة</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <input value={filters.user} onChange={(event) => setFilters({ ...filters, user: event.target.value })} placeholder="المستخدم" />
          <label><span>من تاريخ</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <label><span>من ساعة</span><input type="time" value={filters.timeFrom} onChange={(event) => setFilters({ ...filters, timeFrom: event.target.value })} /></label>
          <label><span>إلى ساعة</span><input type="time" value={filters.timeTo} onChange={(event) => setFilters({ ...filters, timeTo: event.target.value })} /></label>
          <button className="operations-apply-filters-button" type="button" onClick={() => void applyFilters()} disabled={loading}><MagnifyingGlass size={18} />{loading ? "جاري التطبيق..." : "تطبيق الفلاتر"}</button>
        </div>
        <MovementHistoryTable rows={rows} />
        <div className="operations-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
    </div>
  );
}
