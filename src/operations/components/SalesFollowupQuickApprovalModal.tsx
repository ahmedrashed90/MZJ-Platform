import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle, CurrencyCircleDollar, MagnifyingGlass, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { operationsFetch, queryString } from "../api";
import type { SalesOrderFollowupRow, SalesOrdersFollowupResponse } from "../types";

type ApprovalType = "financial" | "administrative";

export function SalesFollowupQuickApprovalModal({ open, onClose, onChanged }: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<SalesOrdersFollowupResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    void operationsFetch<SalesOrdersFollowupResponse>(
      `/api/operations${queryString({ resource: "sales_followup_approval_candidates", page, pageSize: 25, search })}`,
    ).then((result) => {
      if (!alive) return;
      setPayload(result);
      setSelectedId((previous) => result.rows.some((row) => row.tracking_vehicle_id === previous)
        ? previous : (result.rows[0]?.tracking_vehicle_id || ""));
    }).catch((failure) => {
      if (!alive) return;
      setError(failure instanceof Error ? failure.message : "تعذر جلب السيارات التي تحتاج موافقات");
      setPayload(null);
      setSelectedId("");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, search, page, refreshToken]);

  const selected = useMemo<SalesOrderFollowupRow | null>(
    () => payload?.rows.find((row) => row.tracking_vehicle_id === selectedId) || null,
    [payload, selectedId],
  );

  function searchVehicles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
    setNotice("");
  }

  async function approve(type: ApprovalType) {
    if (!selected?.operations_vehicle_id || saving || loading) return;
    if (type === "financial" && selected.stage_6_completed) return;
    if (type === "administrative" && selected.stage_7_completed) return;
    const label = type === "financial" ? "المالية" : "الإدارية";
    if (!window.confirm(`اعتماد الموافقة ${label} لرقم الهيكل ${selected.vin}؟`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await operationsFetch("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "sales_followup_approval_action",
          trackingVehicleId: selected.tracking_vehicle_id,
          vehicleId: selected.operations_vehicle_id,
          approvalType: type,
          approvalAction: "approve",
          note: note.trim(),
        }),
      });
      setNote("");
      setNotice(`تم اعتماد الموافقة ${label} للسيارة ${selected.vin} وتحديث مراحل التراكينج.`);
      setRefreshToken((current) => current + 1);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر اعتماد الموافقة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title="اعتماد السيارات الناقصة" subtitle="اختَر رقم الهيكل من طلبات البيع الجارية، ثم اعتمد المالية أو الإدارية. هذا الإجراء خاص بمدير النظام." className="sales-followup-quick-approval-modal">
      <div className="sales-followup-quick-approval" dir="rtl">
        <form onSubmit={searchVehicles} className="sales-followup-approval-search">
          <label><MagnifyingGlass size={18} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ابحث برقم الهيكل أو رقم الطلب أو العميل" /></label>
          <button type="submit" disabled={loading || saving}><MagnifyingGlass size={17} />بحث</button>
          <button type="button" className="outline" disabled={loading || saving} onClick={() => setRefreshToken((current) => current + 1)}>تحديث القائمة</button>
        </form>
        {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
        {notice ? <div className="operations-alert success"><CheckCircle size={18} />{notice}</div> : null}
        <div className="sales-followup-approval-layout">
          <section className="sales-followup-approval-choices" aria-label="السيارات ذات الموافقات الناقصة">
            <header><strong>أرقام الهيكل</strong><small>{payload?.pagination.total ?? "—"} سيارة تحتاج موافقة</small></header>
            {loading ? <p className="sales-followup-approval-empty">جاري تحميل أرقام الهياكل...</p> : payload?.rows.length ? (
              <div className="sales-followup-approval-list">
                {payload.rows.map((row) => (
                  <label key={row.tracking_vehicle_id} className={selectedId === row.tracking_vehicle_id ? "active" : ""}>
                    <input type="radio" name="sales-followup-approval-vehicle" value={row.tracking_vehicle_id} checked={selectedId === row.tracking_vehicle_id} onChange={() => { setSelectedId(row.tracking_vehicle_id); setNote(""); setNotice(""); }} />
                    <span><b dir="ltr">{row.vin}</b><small dir="ltr">{row.sales_order_no}</small><small>{row.customer_name || "بدون اسم عميل"}</small></span>
                    <span className="sales-followup-approval-flags"><em className={row.stage_6_completed ? "done" : "pending"}>مالي: {row.stage_6_completed ? "تم" : "ناقص"}</em><em className={row.stage_7_completed ? "done" : "pending"}>إداري: {row.stage_7_completed ? "تم" : "ناقص"}</em></span>
                  </label>
                ))}
              </div>
            ) : <p className="sales-followup-approval-empty">لا توجد سيارات بحاجة إلى موافقات ضمن البحث الحالي.</p>}
            {payload && payload.pagination.pages > 1 ? <footer><button type="button" disabled={loading || saving || page <= 1} onClick={() => setPage((current) => current - 1)}>السابق</button><span>{page} / {payload.pagination.pages}</span><button type="button" disabled={loading || saving || page >= payload.pagination.pages} onClick={() => setPage((current) => current + 1)}>التالي</button></footer> : null}
          </section>
          <section className="sales-followup-approval-actions" aria-label="إجراء الموافقة">
            <header><strong>اعتماد السيارة المحددة</strong><small>التحديث ينعكس في الموافقات ومتابعة البيع والخطوتين 6 و7 بالتراكينج.</small></header>
            {selected ? <>
              <div className="sales-followup-approval-selected"><span>رقم الهيكل</span><b dir="ltr">{selected.vin}</b><small>{selected.customer_name || "بدون اسم عميل"}</small></div>
              <label className="sales-followup-approval-note"><span>ملاحظة الاعتماد (اختيارية)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} disabled={saving} placeholder="اكتب ملاحظة خاصة بالموافقة المطلوبة" /></label>
              <button type="button" className="sales-followup-approval-financial" disabled={saving || loading || selected.stage_6_completed} onClick={() => void approve("financial")}><CurrencyCircleDollar size={20} />{selected.stage_6_completed ? "الموافقة المالية مكتملة" : "اعتماد الموافقة المالية"}</button>
              <button type="button" className="sales-followup-approval-administrative" disabled={saving || loading || selected.stage_7_completed} onClick={() => void approve("administrative")}><ShieldCheck size={20} />{selected.stage_7_completed ? "الموافقة الإدارية مكتملة" : "اعتماد الموافقة الإدارية"}</button>
            </> : <p className="sales-followup-approval-empty">اختَر رقم الهيكل من القائمة لتنفيذ الاعتماد.</p>}
          </section>
        </div>
      </div>
    </Modal>
  );
}
