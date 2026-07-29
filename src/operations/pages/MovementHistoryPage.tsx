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
      exportExcel("سجل-الحركات.xlsx", ["التاريخ والوقت","VIN","السيارة","البيان","المكان السابق","المكان الجديد","الحالة السابقة","الحالة الجديدة","منفذ الحركة","إداري العمليات","فرع المستخدم","الملاحظات","ملاحظات الحالة","حجز - نواقص - تحديد مكان","رقم الطلب","Batch ID"], all.map((row) => [row.created_at,row.vin,row.car_name,row.statement,row.from_location_name,row.to_location_name,row.old_status_name || row.old_status,row.new_status_name || row.new_status,row.performed_by_name,row.operations_admin_name,row.performed_by_branch,row.note,row.state_note,row.shortage_note,row.request_no || row.transfer_request_id,row.batch_id]));
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
      const win = window.open("", "_blank", "width=1800,height=1050");
      if (!win) throw new Error("تعذر فتح نافذة تصدير PDF. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");

      const safe = (value: unknown) => String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
      const present = (value: unknown) => {
        const text = String(value ?? "").trim();
        return text && text !== "—" ? text : "";
      };
      const mark = (value: unknown) => {
        const state = String(value || "").toLowerCase();
        if (state === "ok") return '<span class="check yes">✓</span>';
        if (state === "missing") return '<span class="check no">×</span>';
        return '<span class="check unknown">-</span>';
      };
      const approval = (value: unknown) => value === true
        ? '<span class="check yes">✓</span>'
        : '<span class="check no">×</span>';
      const lines = (items: Array<[string, unknown]>) => {
        const content = items
          .map(([label, value]) => [label, present(value)] as const)
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => `<span><b>${safe(label)}:</b> ${safe(value)}</span>`)
          .join("");
        return content || "—";
      };

      const body = all.map((row) => `<tr>
        <td class="vin">${safe(row.vin)}</td>
        <td>${safe(row.car_name)}</td>
        <td class="text-cell">${safe(row.statement)}</td>
        <td>${safe(row.agent_name)}</td>
        <td>${safe(row.interior_color)}</td>
        <td>${safe(row.exterior_color)}</td>
        <td>${safe(row.model_year)}</td>
        <td>${safe(row.plate_no)}</td>
        <td class="text-cell">${safe(row.batch_no)}</td>
        <td class="date-cell">${safe(formatOperationsDate(row.created_at))}</td>
        <td class="stack-cell">${lines([["الحالي", row.to_location_name], ["السابق", row.from_location_name]])}</td>
        <td class="stack-cell notes-cell">${lines([["السيارة", row.vehicle_notes], ["الحركة", row.note], ["الحالة", row.state_note]])}</td>
        <td class="stack-cell notes-cell">${lines([["الحجز/النواقص", row.shortage_note]])}</td>
        <td class="stack-cell">${lines([["الحالية", row.new_status_name || row.new_status], ["السابقة", row.old_status_name || row.old_status]])}</td>
        <td>${mark(row.sensor_status)}</td>
        <td>${mark(row.camera_status)}</td>
        <td>${mark(row.ac_status)}</td>
        <td>${mark(row.radio_status)}</td>
        <td>${mark(row.screen_status)}</td>
        <td>${mark(row.remote_status)}</td>
        <td>${mark(row.mats_status)}</td>
        <td>${mark(row.extinguisher_status)}</td>
        <td>${mark(row.safety_bag_status)}</td>
        <td>${mark(row.spare_tire_status)}</td>
        <td>${approval(row.financial_approved)}</td>
        <td>${approval(row.administrative_approved)}</td>
        <td class="stack-cell">${lines([["الاسم", row.performed_by_name], ["الفرع", row.performed_by_branch]])}</td>
        <td class="stack-cell">${lines([["المسؤول", row.operations_admin_name]])}</td>
        <td class="stack-cell">${lines([["النوع", row.movement_type], ["الطلب", row.request_no || row.transfer_request_id], ["Batch", row.batch_id]])}</td>
      </tr>`).join("");

      const filterSummary = [
        filters.search ? `بحث: ${filters.search}` : "",
        filters.from ? `من المكان: ${meta.locations.find((item) => item.code === filters.from)?.name || filters.from}` : "",
        filters.to ? `إلى المكان: ${meta.locations.find((item) => item.code === filters.to)?.name || filters.to}` : "",
        filters.status ? `الحالة: ${meta.statuses.find((item) => item.code === filters.status)?.name || filters.status}` : "",
        filters.dateFrom ? `من تاريخ: ${filters.dateFrom}` : "",
        filters.dateTo ? `إلى تاريخ: ${filters.dateTo}` : "",
        filters.timeFrom ? `من الساعة: ${filters.timeFrom}` : "",
        filters.timeTo ? `إلى الساعة: ${filters.timeTo}` : "",
        filters.user ? `المستخدم: ${filters.user}` : "",
      ].filter(Boolean).join(" • ") || "كل الحركات";

      win.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>سجل الحركات</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;800;900&display=swap');
    @page { size: 420mm 297mm; margin: 4mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: "Tajawal", Arial, sans-serif; color: #241b18; font-weight: 700; }
    .print-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; min-height: 13mm; padding: 0 1mm 2.5mm; border-bottom: 1.2px solid #4d403b; margin-bottom: 2.5mm; break-inside: avoid; }
    .print-head h1 { margin: 0; font-size: 15pt; line-height: 1.1; font-weight: 900; }
    .print-head p { margin: 1.5mm 0 0; max-width: 330mm; color: #645650; font-size: 7.2pt; line-height: 1.45; }
    .print-count { min-width: 20mm; padding: 2mm 3mm; border: 1px solid #7f6f68; border-radius: 2mm; text-align: center; }
    .print-count small { display: block; color: #6f615b; font-size: 6.2pt; }
    .print-count b { display: block; margin-top: .5mm; font-size: 12pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.25pt; line-height: 1.35; }
    col.vin { width: 15mm; } col.car { width: 14mm; } col.statement { width: 30mm; } col.agent { width: 14mm; }
    col.color { width: 11mm; } col.model { width: 8mm; } col.plate { width: 10mm; } col.batch { width: 20mm; }
    col.date { width: 18mm; } col.location { width: 19mm; } col.notes { width: 32mm; } col.shortage { width: 30mm; }
    col.status { width: 19mm; } col.check { width: 7mm; } col.approval { width: 9mm; } col.actor { width: 22mm; }
    col.admin { width: 22mm; } col.movement { width: 23mm; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border: .45px solid #9f9a97; padding: 1.35mm .75mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; word-break: normal; }
    th { background: #f4f3f2; color: #201916; font-size: 6.1pt; font-weight: 900; line-height: 1.25; }
    tbody tr:nth-child(even) { background: #fbfbfb; }
    .vin { direction: ltr; font-family: Arial, sans-serif; font-weight: 900; white-space: nowrap; }
    .text-cell, .notes-cell { text-align: right; }
    .date-cell { direction: rtl; white-space: normal; }
    .stack-cell { white-space: normal; }
    .stack-cell span { display: block; margin: 0 0 .45mm; }
    .stack-cell span:last-child { margin-bottom: 0; }
    .stack-cell b { font-size: 5.65pt; color: #6c5e58; }
    .check { display: inline-grid; place-items: center; width: 4.2mm; height: 4.2mm; margin: auto; font-family: Arial, sans-serif; font-size: 8pt; font-weight: 900; line-height: 1; }
    .check.yes { color: #1e6d36; } .check.no { color: #9b2832; } .check.unknown { color: #8c827e; }
    .empty { padding: 12mm; font-size: 10pt; }
    @media print {
      html, body { width: 100%; }
      .print-head, th, .check, tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <header class="print-head">
    <div><h1>سجل الحركات</h1><p>${safe(filterSummary)}</p></div>
    <div class="print-count"><small>عدد الحركات</small><b>${all.length.toLocaleString("ar-SA")}</b></div>
  </header>
  <table>
    <colgroup>
      <col class="vin"><col class="car"><col class="statement"><col class="agent"><col class="color"><col class="color"><col class="model"><col class="plate"><col class="batch"><col class="date"><col class="location"><col class="notes"><col class="shortage"><col class="status">
      ${Array.from({ length: 10 }, () => '<col class="check">').join("")}
      <col class="approval"><col class="approval"><col class="actor"><col class="admin"><col class="movement">
    </colgroup>
    <thead><tr>
      <th>رقم الهيكل<br>(VIN)</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>اللون الداخلي</th><th>اللون الخارجي</th><th>موديل</th><th>اللوحة</th><th>اسم الدفعة</th><th>التاريخ والوقت</th>
      <th>المكان</th><th>ملاحظات في السيارة والحركة</th><th>حجز - نواقص - تحديد مكان</th><th>الحالة</th>
      <th>حساس</th><th>كاميرا</th><th>مكيف</th><th>مسجل</th><th>شاشة</th><th>ريموت</th><th>فرشات</th><th>طفاية</th><th>شنطة سلامة</th><th>اسبير</th>
      <th>الموافقة المالية</th><th>الموافقة الإدارية</th><th>منفذ الحركة</th><th>إداري العمليات</th><th>نوع الحركة والطلب</th>
    </tr></thead>
    <tbody>${body || '<tr><td class="empty" colspan="29">لا توجد بيانات مطابقة للفلاتر المحددة</td></tr>'}</tbody>
  </table>
</body>
</html>`);
      win.document.close();
      win.focus();
      const print = () => win.setTimeout(() => win.print(), 250);
      if (win.document.fonts?.ready) win.document.fonts.ready.then(print).catch(print);
      else print();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="module-page operations-page operations-history-page">
      <header className="module-page-head"><div><h1>سجل الحركات</h1><p>عرض الحركات الفعلية المسجلة لكل سيارة مع الفلاتر والتصدير وتغيير عرض الأعمدة بالسحب.</p></div><div className="operations-header-actions"><span className="operations-count">{total.toLocaleString("ar-SA")}</span>{meta.permissions.canExport ? <><button type="button" onClick={() => void exportAll()} disabled={loading}><FileXls size={17} />تصدير Excel</button><button type="button" className="operations-pdf-button" onClick={() => void exportPdfA3()} disabled={loading}><FilePdf size={17} />تصدير PDF</button></> : null}</div></header>
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
