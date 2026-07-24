import { useEffect, useMemo, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { MarketingPage, MarketingAlert } from "../components/MarketingPage";
import { marketingDate, marketingFetch, marketingLocalDateKey, marketingQuery } from "../api";
import type { MarketingMeta } from "../types";

type AttendanceSummary = {
  user_id: string;
  full_name: string;
  department_name: string;
  status: string;
  present: number;
  absent: number;
  late_count: number;
  late_total: number;
  no_checkout: number;
  work_total: number;
};
type AttendanceTotals = { present: number; absent: number; lateCount: number; lateTotal: number; noCheckout: number; workTotal: number };
type AttendancePayload = { ok: boolean; settings: any; today: any[]; rows: any[]; summary: AttendanceSummary[]; totals: AttendanceTotals; effectiveFrom?: string; mine: any; canManage: boolean };

function minutesLabel(value: number) {
  const minutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return hours ? `${hours} س ${remainder ? `${remainder} د` : ""}`.trim() : `${remainder} د`;
}
function statusLabel(value: string) {
  if (value === "late") return "متأخر";
  if (value === "no_checkout") return "بدون انصراف";
  if (value === "partial") return "حضور جزئي";
  if (value === "present") return "منتظم";
  return "لم يسجل";
}
function xml(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] || char)); }
function worksheet(name: string, rows: unknown[][]) {
  return `<Worksheet ss:Name="${xml(name)}"><Table>${rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
}

export function AttendancePage() {
  const todayIso = marketingLocalDateKey();
  const monthStart = `${todayIso.slice(0, 8)}01`;
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [filters, setFilters] = useState({ from: todayIso, to: todayIso, departmentId: "", userId: "", status: "" });
  const [settings, setSettings] = useState({ workStart: "09:00", workEnd: "18:00", graceMinutes: "15" });
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);

  async function load(nextFilters = filters) {
    setError("");
    try {
      const [metaPayload, attendance] = await Promise.all([
        marketingFetch<MarketingMeta>("/api/marketing?resource=meta"),
        marketingFetch<AttendancePayload>(`/api/marketing${marketingQuery({ resource: "attendance", ...nextFilters })}`),
      ]);
      setMeta(metaPayload); setData(attendance);
      setSettings({ workStart: String(attendance.settings.work_start || "09:00").slice(0, 5), workEnd: String(attendance.settings.work_end || "18:00").slice(0, 5), graceMinutes: String(attendance.settings.grace_minutes ?? 15) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الحضور والانصراف"); }
  }
  useEffect(() => { void load(); }, []);

  async function action(attendanceAction: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setMessage("");
    try { const result = await marketingFetch<{ message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "attendance", attendanceAction, ...extra }) }); setMessage(result.message || "تم الحفظ"); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }

  const todayTotals = useMemo(() => ({
    present: data?.today.filter((row) => row.status === "present").length || 0,
    late: data?.today.filter((row) => row.status === "late").length || 0,
    missing: data?.today.filter((row) => !row.check_in).length || 0,
    online: data?.today.filter((row) => row.online).length || 0,
  }), [data]);

  function setRange(kind: "today" | "month") {
    const next = { ...filters, from: kind === "today" ? todayIso : monthStart, to: todayIso };
    setFilters(next); void load(next);
  }

  function exportExcel() {
    const summaryRows: unknown[][] = [
      ["الموظف", "القسم", "الحالة", "أيام الحضور", "لم يسجل", "مرات التأخير", "إجمالي التأخير", "بدون انصراف", "إجمالي ساعات العمل"],
      ...(data?.summary || []).map((row) => [row.full_name, row.department_name || "", statusLabel(row.status), row.present, row.absent, row.late_count, minutesLabel(row.late_total), row.no_checkout, minutesLabel(row.work_total)]),
    ];
    const detailRows: unknown[][] = [
      ["التاريخ", "الموظف", "القسم", "الحالة", "وقت الحضور", "وقت الانصراف", "مدة التأخير", "ساعات العمل"],
      ...(data?.rows || []).map((row) => [row.attendance_date, row.full_name, row.department_name || "", statusLabel(row.status), marketingDate(row.check_in, true), marketingDate(row.check_out, true), minutesLabel(row.delay_minutes || 0), minutesLabel(row.work_minutes || 0)]),
    ];
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheet("ملخص الموظفين", summaryRows)}${worksheet("تفاصيل السجلات", detailRows)}</Workbook>`;
    const blob = new Blob(["\ufeff" + workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.href = url; link.download = `attendance-${filters.from}-${filters.to}.xls`; link.click(); URL.revokeObjectURL(url);
  }

  const totals = data?.totals || { present: 0, absent: 0, lateCount: 0, lateTotal: 0, noCheckout: 0, workTotal: 0 };
  return <MarketingPage title="الحضور والانصراف" description="تسجيل الحضور والانصراف ومتابعة اليوم وتقارير يوزرات سيستم التسويق.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    <section className="marketing-card attendance-actions-card">
      <div><h2>تسجيل اليوم</h2><p>{data?.mine?.check_in ? `تم تسجيل الحضور: ${marketingDate(data.mine.check_in, true)}` : "لم يتم تسجيل الحضور اليوم"}</p></div>
      {!data?.mine?.check_in ? <button className="marketing-primary" disabled={busy} onClick={() => void action("check_in")}>تسجيل حضور</button> : !data?.mine?.check_out ? <button className="marketing-primary" disabled={busy} onClick={() => void action("check_out")}>تسجيل انصراف</button> : <span className="marketing-status success">تم تسجيل الانصراف</span>}
    </section>
    {data?.canManage ? <>
      <section className="marketing-card"><h2>إعدادات الدوام</h2><div className="marketing-form-row three"><label>بداية الدوام<input type="time" value={settings.workStart} onChange={(e) => setSettings({ ...settings, workStart: e.target.value })} /></label><label>نهاية الدوام<input type="time" value={settings.workEnd} onChange={(e) => setSettings({ ...settings, workEnd: e.target.value })} /></label><label>فترة السماح بالدقائق<input type="number" min="0" value={settings.graceMinutes} onChange={(e) => setSettings({ ...settings, graceMinutes: e.target.value })} /></label></div><button className="marketing-primary" disabled={busy} onClick={() => void action("save_settings", settings)}>حفظ الإعدادات</button></section>
      <div className="marketing-metric-grid four"><article><strong>{todayTotals.present}</strong><span>حاضر</span></article><article><strong>{todayTotals.late}</strong><span>متأخر</span></article><article><strong>{todayTotals.missing}</strong><span>لم يسجل</span></article><article><strong>{todayTotals.online}</strong><span>أونلاين الآن</span></article></div>
      <section className="marketing-card"><h2>متابعة حضور اليوم</h2><div className="marketing-table-wrap"><table><thead><tr><th>الموظف</th><th>القسم</th><th>الحضور</th><th>الأونلاين</th><th>وقت الحضور</th><th>وقت الانصراف</th><th>مدة التأخير</th><th>آخر ظهور</th><th>آخر نشاط</th></tr></thead><tbody>{(data?.today || []).map((row) => <tr key={row.id || row.full_name}><td>{row.full_name}</td><td>{row.department_name || "—"}</td><td>{row.status ? statusLabel(row.status) : "لم يسجل"}</td><td>{row.online ? "أونلاين" : "أوفلاين"}</td><td>{marketingDate(row.check_in, true)}</td><td>{marketingDate(row.check_out, true)}</td><td>{minutesLabel(row.delay_minutes || 0)}</td><td>{marketingDate(row.last_activity_at, true)}</td><td>{row.last_activity_type || "—"}</td></tr>)}</tbody></table></div></section>
      <section className="marketing-card"><div className="marketing-section-head"><h2>تقارير الحضور والانصراف</h2><button className="marketing-secondary" onClick={exportExcel}><DownloadSimple />تصدير Excel</button></div><div className="marketing-form-row five"><label>من تاريخ<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label><label>إلى تاريخ<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label><label>القسم<select value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}><option value="">الكل</option>{meta?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>الموظف<select value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}><option value="">الكل</option>{meta?.users.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.fullName}</option>)}</select></label><label>الحالة<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">الكل</option><option value="present">حضور</option><option value="late">تأخير</option><option value="absent">لم يسجل</option><option value="no_checkout">بدون انصراف</option></select></label></div><div className="marketing-inline-actions"><button className="marketing-secondary" onClick={() => setRange("today")}>اليوم</button><button className="marketing-secondary" onClick={() => setRange("month")}>هذا الشهر</button><button className="marketing-primary" onClick={() => void load()}>عرض التقرير</button></div>{data?.effectiveFrom ? <p className="marketing-report-note">يتم احتساب أيام بدون حضور من {data.effectiveFrom} لأنه أول تاريخ تشغيل فعلي للحضور داخل الفترة المحددة.</p> : <p className="marketing-report-note">لا توجد سجلات حضور فعلية داخل الفترة المحددة، لذلك لا يتم احتساب أيام بدون حضور.</p>}
        <div className="marketing-stats five"><article><small>أيام الحضور</small><strong>{totals.present}</strong></article><article className="danger"><small>أيام بدون حضور</small><strong>{totals.absent}</strong></article><article><small>مرات التأخير</small><strong>{totals.lateCount}</strong><span>{minutesLabel(totals.lateTotal)}</span></article><article><small>بدون انصراف</small><strong>{totals.noCheckout}</strong></article><article><small>إجمالي ساعات العمل</small><strong>{minutesLabel(totals.workTotal)}</strong></article></div>
        <h3>ملخص الموظفين</h3><div className="marketing-table-wrap"><table><thead><tr><th>الموظف</th><th>القسم</th><th>الحالة</th><th>أيام الحضور</th><th>لم يسجل</th><th>مرات التأخير</th><th>إجمالي التأخير</th><th>بدون انصراف</th><th>إجمالي ساعات العمل</th></tr></thead><tbody>{(data?.summary || []).map((row) => <tr key={row.user_id}><td>{row.full_name}</td><td>{row.department_name || "—"}</td><td>{statusLabel(row.status)}</td><td>{row.present}</td><td>{row.absent}</td><td>{row.late_count}</td><td>{minutesLabel(row.late_total)}</td><td>{row.no_checkout}</td><td>{minutesLabel(row.work_total)}</td></tr>)}{!data?.summary?.length ? <tr><td colSpan={9}>لا توجد نتائج حسب الفلاتر الحالية.</td></tr> : null}</tbody></table></div>
        <h3>تفاصيل السجلات</h3><div className="marketing-table-wrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>القسم</th><th>الحالة</th><th>وقت الحضور</th><th>وقت الانصراف</th><th>مدة التأخير</th><th>ساعات العمل</th></tr></thead><tbody>{(data?.rows || []).map((row) => <tr key={row.id}><td>{marketingDate(row.attendance_date)}</td><td>{row.full_name}</td><td>{row.department_name || "—"}</td><td>{statusLabel(row.status)}</td><td>{marketingDate(row.check_in, true)}</td><td>{marketingDate(row.check_out, true)}</td><td>{minutesLabel(row.delay_minutes || 0)}</td><td>{minutesLabel(row.work_minutes || 0)}</td></tr>)}{!data?.rows?.length ? <tr><td colSpan={8}>لا توجد سجلات تفصيلية حسب الفلاتر الحالية.</td></tr> : null}</tbody></table></div>
      </section>
    </> : null}
  </MarketingPage>;
}
