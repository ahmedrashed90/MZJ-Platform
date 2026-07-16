import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, MagnifyingGlass, PencilSimple, X } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";

const emptyForm = { userId: "", periodStart: "", periodEnd: "", totalSales: "0", speedScore: "0", efficiencyScore: "0", disciplineScore: "0", valueScore: "0", notes: "" };

export function CrmKpiPage() {
  const [tab, setTab] = useState<"add" | "reports">("add");
  const [filters, setFilters] = useState({ from: "", to: "", q: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load(); }, [filters.from, filters.to]);

  async function load() {
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[]; agents: any[] }>(`/api/crm/kpi${queryString({ from: filters.from, to: filters.to })}`);
      setRows(result.rows || []); setAgents(result.agents || []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل تقييمات KPI"); }
  }

  const visibleRows = useMemo(() => rows.filter((row) => !filters.q || [row.full_name,row.rating,row.departments,row.branches].join(" ").toLowerCase().includes(filters.q.toLowerCase())), [rows, filters.q]);
  const totalScore = Math.round(((Number(form.speedScore) + Number(form.efficiencyScore) + Number(form.disciplineScore) + Number(form.valueScore)) / 4) * 100) / 100;

  function set(key: string, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  function open(agent?: any, row?: any) {
    setForm(row ? { userId: row.user_id, periodStart: String(row.period_start).slice(0, 10), periodEnd: String(row.period_end).slice(0, 10), totalSales: String(row.total_sales ?? row.calculated_sales ?? 0), speedScore: String(row.speed_score || 0), efficiencyScore: String(row.efficiency_score || 0), disciplineScore: String(row.discipline_score || 0), valueScore: String(row.value_score || 0), notes: row.notes || "" } : { ...emptyForm, userId: agent?.id || "" });
    setModal(true);
  }

  async function save() {
    setSaving(true);
    try {
      await crmFetch("/api/crm/kpi", { method: "POST", body: JSON.stringify(form) });
      setNotice("تم حفظ تقييم المندوب"); setModal(false); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر حفظ التقييم"); }
    finally { setSaving(false); }
  }

  function print(row: any) {
    const win = window.open("", "_blank", "width=1000,height=800"); if (!win) return;
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقييم KPI</title><style>body{font-family:Tajawal,Arial;padding:24px;color:#35221c}.cover,.card{border:1px solid #e5cdbf;border-radius:18px;padding:18px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card b{display:block;font-size:28px;margin-top:8px}</style></head><body><div class="cover"><h1>تقييم المناديب KPI</h1><h2>${row.full_name}</h2><p>الفترة: ${String(row.period_start).slice(0,10)} إلى ${String(row.period_end).slice(0,10)}</p></div><div class="grid"><div class="card">السرعة<b>${row.speed_score}%</b></div><div class="card">الكفاءة<b>${row.efficiency_score}%</b></div><div class="card">الانضباط<b>${row.discipline_score}%</b></div><div class="card">القيمة<b>${row.value_score}%</b></div></div><div class="card"><h2>النتيجة المحسوبة</h2><b>${row.total_score}% - ${row.rating || ""}</b><p>إجمالي المبيعات: ${row.total_sales ?? row.calculated_sales ?? 0}</p><p>${row.notes || ""}</p></div><script>window.onload=()=>window.print()</script></body></html>`); win.document.close();
  }

  return (
    <div className="crm-page kpi-page">
      <header className="crm-page-head"><div><h1>تقييم المناديب KPI</h1><p>تقييم السرعة والكفاءة والانضباط والقيمة والنتيجة المحسوبة.</p></div><button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button></header>
      <div className="crm-department-tabs"><button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}>إضافة تقييم المناديب</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>التقارير</button></div>
      <div className="crm-filter-panel reports"><label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label><label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label><label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="بحث باسم المندوب" /></label></div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      {tab === "add" ? <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>المندوب</th><th>القسم</th><th>الفرع</th><th>إجمالي المبيعات</th><th>آخر درجة</th><th>الإجراء</th></tr></thead><tbody>{agents.filter((agent) => !filters.q || agent.full_name.toLowerCase().includes(filters.q.toLowerCase())).map((agent) => { const last = rows.find((row) => row.user_id === agent.id); return <tr key={agent.id}><td><div className="kpi-agent-cell"><strong>{agent.full_name}</strong><small>{agent.employee_no || ""}</small></div></td><td>{(agent.departments || []).join("، ") || "—"}</td><td>{(agent.branches || []).join("، ") || "—"}</td><td>{last?.calculated_sales ?? last?.total_sales ?? 0}</td><td>{last ? <span className={`kpi-rating-pill ${Number(last.total_score) >= 80 ? "rate-good" : Number(last.total_score) >= 60 ? "rate-mid" : "rate-bad"}`}>{last.total_score}%</span> : "—"}</td><td><button className="crm-primary-button small" onClick={() => open(agent, last)}>إضافة / تعديل التقييم</button></td></tr>})}{!agents.length ? <tr><td colSpan={6}><div className="crm-empty-state">لا يوجد مستخدمون مرتبطون بأقسام CRM</div></td></tr> : null}</tbody></table></div> : null}

      {tab === "reports" ? <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>المندوب</th><th>الفترة</th><th>المبيعات</th><th>السرعة</th><th>الكفاءة</th><th>الانضباط</th><th>القيمة</th><th>KPI %</th><th>التقييم</th><th>إجراءات</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id}><td>{row.full_name}</td><td>{String(row.period_start).slice(0,10)} إلى {String(row.period_end).slice(0,10)}</td><td>{row.calculated_sales ?? row.total_sales}</td><td>{row.speed_score}%</td><td>{row.efficiency_score}%</td><td>{row.discipline_score}%</td><td>{row.value_score}%</td><td><strong>{row.total_score}%</strong></td><td>{row.rating}</td><td><div className="crm-row-actions"><button title="تعديل" onClick={() => open(null, row)}><PencilSimple size={16} /></button><button title="PDF" onClick={() => print(row)}><FilePdf size={16} /></button></div></td></tr>)}{!visibleRows.length ? <tr><td colSpan={10}><div className="crm-empty-state">لا توجد تقييمات ضمن الفترة</div></td></tr> : null}</tbody></table></div> : null}

      {modal ? <div className="crm-modal-backdrop" onMouseDown={() => setModal(false)}><div className="crm-modal-card kpi-modal-card" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>إضافة تقييم المناديب</h2><p>النتيجة تحسب من متوسط السرعة والكفاءة والانضباط والقيمة.</p></div><button className="crm-icon-button" onClick={() => setModal(false)}><X size={18} /></button></header><div className="crm-form-grid"><label><span>المندوب</span><select value={form.userId} onChange={(event) => set("userId", event.target.value)}><option value="">اختر المندوب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label><label><span>من تاريخ</span><input type="date" value={form.periodStart} onChange={(event) => set("periodStart", event.target.value)} /></label><label><span>إلى تاريخ</span><input type="date" value={form.periodEnd} onChange={(event) => set("periodEnd", event.target.value)} /></label><label><span>إجمالي المبيعات</span><input type="number" value={form.totalSales} onChange={(event) => set("totalSales", event.target.value)} /></label><label><span>تقييم السرعة</span><input type="number" min="0" max="100" value={form.speedScore} onChange={(event) => set("speedScore", event.target.value)} /></label><label><span>تقييم الكفاءة</span><input type="number" min="0" max="100" value={form.efficiencyScore} onChange={(event) => set("efficiencyScore", event.target.value)} /></label><label><span>الانضباط</span><input type="number" min="0" max="100" value={form.disciplineScore} onChange={(event) => set("disciplineScore", event.target.value)} /></label><label><span>القيمة</span><input type="number" min="0" max="100" value={form.valueScore} onChange={(event) => set("valueScore", event.target.value)} /></label><label className="crm-field-wide"><span>ملاحظات</span><textarea rows={4} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label></div><div className="crm-kpi-result"><span>النتيجة المحسوبة</span><strong>{totalScore}%</strong></div><div className="crm-modal-actions"><button className="crm-secondary-button" onClick={() => setModal(false)}>إلغاء</button><button className="crm-primary-button" disabled={saving || !form.userId || !form.periodStart || !form.periodEnd} onClick={() => void save()}>{saving ? "جاري الحفظ..." : "حفظ التقييم"}</button></div></div></div> : null}
    </div>
  );
}
