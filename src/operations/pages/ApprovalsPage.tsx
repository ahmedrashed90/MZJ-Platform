import { useEffect, useMemo, useState } from "react";
import { CheckCircle, MagnifyingGlass, ShieldCheck, WarningCircle, XCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { operationsFetch, queryString } from "../api";
import { useOperations } from "../useOperations";

type ApprovalRow = {
  id: string; vehicle_id: string; cycle_no: number; financial_approved: boolean; administrative_approved: boolean;
  financial_note?: string | null; administrative_note?: string | null; financial_approved_by_name?: string | null; administrative_approved_by_name?: string | null;
  vin: string; car_name?: string | null; statement?: string | null; model_year?: string | null; location_name?: string | null; status_code: string;
};

export function ApprovalsPage() {
  const { meta } = useOperations();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [selected, setSelected] = useState<ApprovalRow | null>(null);
  const [financialNote, setFinancialNote] = useState("");
  const [administrativeNote, setAdministrativeNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<{ rows: ApprovalRow[] }>(`/api/operations${queryString({ resource: "approvals", filter, search })}`); setRows(payload.rows); if (selected) { const updated = payload.rows.find((row) => row.vehicle_id === selected.vehicle_id); if (updated) setSelected(updated); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الموافقات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [filter]);
  useEffect(() => { if (selected) { setFinancialNote(selected.financial_note || ""); setAdministrativeNote(selected.administrative_note || ""); } }, [selected]);

  async function act(type: "financial" | "administrative", action: "approve" | "revert" | "note") {
    if (!selected) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "approval_action", vehicleId: selected.vehicle_id, approvalType: type, approvalAction: action, note: type === "financial" ? financialNote : administrativeNote }) });
      setMessage(payload.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث الموافقة"); }
    finally { setLoading(false); }
  }

  async function reset() {
    if (!selected) return;
    setLoading(true); setError("");
    try { await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "approval_action", vehicleId: selected.vehicle_id, approvalType: "financial", approvalAction: "reset", note: "إلغاء الطلب (مسح الموافقات)" }) }); setMessage("تم مسح الموافقات مع الحفاظ على السجل"); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر مسح الموافقات"); }
    finally { setLoading(false); }
  }

  const counts = useMemo(() => ({ all: rows.length, missingFinancial: rows.filter((r) => !r.financial_approved).length, missingAdministrative: rows.filter((r) => !r.administrative_approved).length, completed: rows.filter((r) => r.financial_approved && r.administrative_approved).length }), [rows]);

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>الموافقات المالية والإدارية</h1><p>الموافقتان مستقلتان، وكلتاهما مطلوبة قبل الانتقال إلى مباع تم التسليم.</p></div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}
      <section className="panel operations-approvals-panel">
        <div className="operations-approval-filters">
          {[ ["", "كل السيارات", counts.all], ["missing_financial", "ناقص مالي", counts.missingFinancial], ["missing_administrative", "ناقص إداري", counts.missingAdministrative], ["completed", "مكتملة", counts.completed] ].map(([key,label,count]) => <button key={String(key)} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(String(key))}><span>{label}</span><b>{count}</b></button>)}
        </div>
        <div className="operations-filters"><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} placeholder="بحث برقم الهيكل أو السيارة" /></label><button type="button" onClick={() => void load()}><MagnifyingGlass size={17} />بحث</button></div>
        <div className="operations-approval-list">{!loading && !rows.length ? <div className="operations-empty-state"><ShieldCheck size={42} /><strong>لا توجد سيارات مطابقة</strong></div> : rows.map((row) => <button key={row.id} type="button" onClick={() => setSelected(row)}><div><b>{row.vin}</b><span>{row.car_name || "—"} · {row.statement || "—"}</span><small>{row.location_name || "—"}</small></div><span className={row.financial_approved ? "ok" : "pending"}>{row.financial_approved ? "مالي ✓" : "ناقص مالي"}</span><span className={row.administrative_approved ? "ok" : "pending"}>{row.administrative_approved ? "إداري ✓" : "ناقص إداري"}</span></button>)}</div>
      </section>

      <Modal open={Boolean(selected)} title={selected?.vin || "موافقات السيارة"} subtitle={selected ? `${selected.car_name || "—"} · ${selected.statement || "—"}` : undefined} onClose={() => setSelected(null)} className="operations-approval-modal">
        {selected ? <div className="operations-approval-cards">
          <article><header><ShieldCheck size={24} /><div><h3>الموافقة المالية</h3><span className={selected.financial_approved ? "ok" : "pending"}>{selected.financial_approved ? "تم" : "لم يتم"}</span></div></header><textarea value={financialNote} onChange={(e) => setFinancialNote(e.target.value)} placeholder="ملاحظة مالية" /><div>{meta.permissions.canApproveFinancial ? <><button type="button" onClick={() => void act("financial", "note")} disabled={loading}>حفظ الملاحظة</button>{selected.financial_approved ? <button type="button" className="danger" onClick={() => void act("financial", "revert")} disabled={loading}><XCircle size={17} />تراجع</button> : <button type="button" className="primary" onClick={() => void act("financial", "approve")} disabled={loading}><CheckCircle size={17} />موافقة مالية</button>}</> : <span>لا توجد صلاحية</span>}</div></article>
          <article><header><CheckCircle size={24} /><div><h3>الموافقة الإدارية</h3><span className={selected.administrative_approved ? "ok" : "pending"}>{selected.administrative_approved ? "تم" : "لم يتم"}</span></div></header><textarea value={administrativeNote} onChange={(e) => setAdministrativeNote(e.target.value)} placeholder="ملاحظة إدارية" /><div>{meta.permissions.canApproveAdministrative ? <><button type="button" onClick={() => void act("administrative", "note")} disabled={loading}>حفظ الملاحظة</button>{selected.administrative_approved ? <button type="button" className="danger" onClick={() => void act("administrative", "revert")} disabled={loading}><XCircle size={17} />تراجع</button> : <button type="button" className="primary" onClick={() => void act("administrative", "approve")} disabled={loading}><CheckCircle size={17} />موافقة إدارية</button>}</> : <span>لا توجد صلاحية</span>}</div></article>
          <button type="button" className="operations-reset-approvals" onClick={() => void reset()} disabled={loading}>إلغاء الطلب (مسح الموافقات)</button>
        </div> : null}
      </Modal>
    </div>
  );
}
