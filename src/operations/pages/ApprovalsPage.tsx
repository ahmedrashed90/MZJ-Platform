import { useEffect, useMemo, useState } from "react";
import {
  Car,
  CheckCircle,
  CurrencyCircleDollar,
  MagnifyingGlass,
  MapPin,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { operationsFetch, queryString } from "../api";
import { ResizableOperationsTable, type ResizableOperationsColumn } from "../components/ResizableOperationsTable";
import { useOperations } from "../useOperations";

type ApprovalRow = {
  id: string;
  vehicle_id: string;
  cycle_no: number;
  financial_approved: boolean;
  administrative_approved: boolean;
  financial_note?: string | null;
  administrative_note?: string | null;
  financial_approved_by_name?: string | null;
  administrative_approved_by_name?: string | null;
  financial_approved_at?: string | null;
  administrative_approved_at?: string | null;
  updated_at?: string | null;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  model_year?: string | null;
  location_name?: string | null;
  status_code: string;
};

function formatApprovalDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ar-SA") : "—";
}

function ApprovalBadge({ approved, compact = false }: { approved: boolean; compact?: boolean }) {
  return (
    <span className={`operations-approval-status ${approved ? "complete" : "pending"} ${compact ? "compact" : ""}`.trim()}>
      {approved ? <CheckCircle size={compact ? 15 : 17} weight="fill" /> : <WarningCircle size={compact ? 15 : 17} />}
      {approved ? "مكتملة" : "ناقصة"}
    </span>
  );
}

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
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ rows: ApprovalRow[] }>(
        `/api/operations${queryString({ resource: "approvals", filter, search })}`,
      );
      setRows(payload.rows);
      if (selected) {
        const updated = payload.rows.find((row) => row.vehicle_id === selected.vehicle_id);
        if (updated) setSelected(updated);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الموافقات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  useEffect(() => {
    if (!selected) return;
    setFinancialNote(selected.financial_note || "");
    setAdministrativeNote(selected.administrative_note || "");
  }, [selected]);

  async function act(type: "financial" | "administrative", action: "approve" | "revert" | "note") {
    if (!selected) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "approval_action",
          vehicleId: selected.vehicle_id,
          approvalType: type,
          approvalAction: action,
          note: type === "financial" ? financialNote : administrativeNote,
        }),
      });
      setMessage(payload.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث الموافقة");
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await operationsFetch("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "approval_action",
          vehicleId: selected.vehicle_id,
          approvalType: "financial",
          approvalAction: "reset",
          note: "إلغاء الطلب (مسح الموافقات)",
        }),
      });
      setMessage("تم مسح الموافقات مع الحفاظ على السجل");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر مسح الموافقات");
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      missingFinancial: rows.filter((row) => !row.financial_approved).length,
      missingAdministrative: rows.filter((row) => !row.administrative_approved).length,
      completed: rows.filter((row) => row.financial_approved && row.administrative_approved).length,
    }),
    [rows],
  );

  const columns = useMemo<ResizableOperationsColumn<ApprovalRow>[]>(() => [
    {
      key: "vin",
      label: "رقم الهيكل",
      width: 150,
      min: 125,
      max: 240,
      value: (row) => row.vin,
      render: (row) => <strong dir="ltr">{row.vin}</strong>,
    },
    {
      key: "vehicle",
      label: "السيارة والبيان",
      width: 260,
      min: 190,
      max: 420,
      value: (row) => `${row.car_name || ""} ${row.statement || ""}`,
      render: (row) => (
        <div className="operations-cell-stack operations-approval-car-cell">
          <strong>{row.car_name || "—"}</strong>
          <small>{row.statement || "بدون بيان"}</small>
        </div>
      ),
    },
    {
      key: "model",
      label: "الموديل",
      width: 105,
      min: 90,
      max: 150,
      value: (row) => row.model_year,
      render: (row) => row.model_year || "—",
    },
    {
      key: "location",
      label: "المكان الحالي",
      width: 145,
      min: 120,
      max: 220,
      value: (row) => row.location_name,
      render: (row) => (
        <span className="operations-location-cell"><MapPin size={16} />{row.location_name || "—"}</span>
      ),
    },
    {
      key: "financial",
      label: "الموافقة المالية",
      width: 155,
      min: 135,
      max: 210,
      value: (row) => row.financial_approved ? "مكتملة" : "ناقصة",
      render: (row) => <ApprovalBadge approved={row.financial_approved} compact />,
    },
    {
      key: "administrative",
      label: "الموافقة الإدارية",
      width: 155,
      min: 135,
      max: 210,
      value: (row) => row.administrative_approved ? "مكتملة" : "ناقصة",
      render: (row) => <ApprovalBadge approved={row.administrative_approved} compact />,
    },
    {
      key: "action",
      label: "الإجراء",
      width: 125,
      min: 110,
      max: 170,
      render: (row) => (
        <button type="button" className="operations-table-action" onClick={() => setSelected(row)}>
          عرض الموافقات
        </button>
      ),
    },
  ], []);

  return (
    <div className="module-page operations-page operations-approvals-page">
      <header className="module-page-head">
        <div>
          <h1>الموافقات المالية والإدارية</h1>
          <p>عرض واضح لحالة كل سيارة، مع إدارة كل موافقة بشكل مستقل قبل التسليم.</p>
        </div>
      </header>

      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="operations-alert success">{message}</div> : null}

      <section className="panel operations-approvals-panel">
        <div className="operations-approval-filters" aria-label="فلترة الموافقات">
          {[
            ["", "كل السيارات", counts.all],
            ["missing_financial", "ناقص مالي", counts.missingFinancial],
            ["missing_administrative", "ناقص إداري", counts.missingAdministrative],
            ["completed", "مكتملة", counts.completed],
          ].map(([key, label, count]) => (
            <button
              key={String(key)}
              type="button"
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(String(key))}
            >
              <span>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>

        <div className="operations-approval-toolbar">
          <label className="operations-search">
            <MagnifyingGlass size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void load(); }}
              placeholder="بحث برقم الهيكل أو السيارة"
            />
          </label>
          <button type="button" onClick={() => void load()} disabled={loading}>
            <MagnifyingGlass size={17} />
            {loading ? "جاري البحث..." : "بحث"}
          </button>
        </div>

        <ResizableOperationsTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          storageKey="mzj.operations.approvals.columns.v1149"
          emptyText={loading ? "جاري تحميل الموافقات..." : "لا توجد سيارات مطابقة"}
          minTableWidth={1100}
          tableClassName="operations-approvals-table"
        />
      </section>

      <Modal
        open={Boolean(selected)}
        title={selected ? `موافقات السيارة ${selected.vin}` : "موافقات السيارة"}
        subtitle={selected ? `${selected.car_name || "—"} · ${selected.statement || "—"}` : undefined}
        onClose={() => setSelected(null)}
        className="wide operations-approval-modal"
      >
        {selected ? (
          <div className="operations-approval-modal-content">
            <section className="operations-approval-vehicle-summary">
              <div><Car size={20} /><span><small>السيارة</small><strong>{selected.car_name || "—"}</strong></span></div>
              <div><span><small>البيان</small><strong>{selected.statement || "—"}</strong></span></div>
              <div><span><small>الموديل</small><strong>{selected.model_year || "—"}</strong></span></div>
              <div><MapPin size={20} /><span><small>المكان الحالي</small><strong>{selected.location_name || "—"}</strong></span></div>
            </section>

            <div className="operations-approval-cards">
              <article className={selected.financial_approved ? "complete" : "pending"}>
                <header>
                  <span className="operations-approval-card-icon"><CurrencyCircleDollar size={25} /></span>
                  <div>
                    <h3>الموافقة المالية</h3>
                    <p>{selected.financial_approved ? `اعتمدها ${selected.financial_approved_by_name || "مستخدم النظام"}` : "في انتظار اعتماد المسؤول المالي"}</p>
                  </div>
                  <ApprovalBadge approved={selected.financial_approved} />
                </header>
                <div className="operations-approval-card-meta">
                  <span>آخر تنفيذ</span>
                  <strong>{selected.financial_approved ? formatApprovalDate(selected.financial_approved_at) : "لم يتم الاعتماد"}</strong>
                </div>
                <label>
                  <span>الملاحظة المالية</span>
                  <textarea value={financialNote} onChange={(event) => setFinancialNote(event.target.value)} placeholder="اكتب الملاحظة المالية هنا" />
                </label>
                <footer>
                  {meta.permissions.canApproveFinancial ? (
                    <>
                      <button type="button" onClick={() => void act("financial", "note")} disabled={loading}>حفظ الملاحظة</button>
                      {selected.financial_approved ? (
                        <button type="button" className="danger-outline" onClick={() => void act("financial", "revert")} disabled={loading}><XCircle size={17} />تراجع عن الموافقة</button>
                      ) : (
                        <button type="button" className="primary" onClick={() => void act("financial", "approve")} disabled={loading}><CheckCircle size={17} />اعتماد مالي</button>
                      )}
                    </>
                  ) : <span className="operations-no-permission">لا توجد صلاحية للموافقة المالية</span>}
                </footer>
              </article>

              <article className={selected.administrative_approved ? "complete" : "pending"}>
                <header>
                  <span className="operations-approval-card-icon"><ShieldCheck size={25} /></span>
                  <div>
                    <h3>الموافقة الإدارية</h3>
                    <p>{selected.administrative_approved ? `اعتمدها ${selected.administrative_approved_by_name || "مستخدم النظام"}` : "في انتظار اعتماد المسؤول الإداري"}</p>
                  </div>
                  <ApprovalBadge approved={selected.administrative_approved} />
                </header>
                <div className="operations-approval-card-meta">
                  <span>آخر تنفيذ</span>
                  <strong>{selected.administrative_approved ? formatApprovalDate(selected.administrative_approved_at) : "لم يتم الاعتماد"}</strong>
                </div>
                <label>
                  <span>الملاحظة الإدارية</span>
                  <textarea value={administrativeNote} onChange={(event) => setAdministrativeNote(event.target.value)} placeholder="اكتب الملاحظة الإدارية هنا" />
                </label>
                <footer>
                  {meta.permissions.canApproveAdministrative ? (
                    <>
                      <button type="button" onClick={() => void act("administrative", "note")} disabled={loading}>حفظ الملاحظة</button>
                      {selected.administrative_approved ? (
                        <button type="button" className="danger-outline" onClick={() => void act("administrative", "revert")} disabled={loading}><XCircle size={17} />تراجع عن الموافقة</button>
                      ) : (
                        <button type="button" className="primary" onClick={() => void act("administrative", "approve")} disabled={loading}><CheckCircle size={17} />اعتماد إداري</button>
                      )}
                    </>
                  ) : <span className="operations-no-permission">لا توجد صلاحية للموافقة الإدارية</span>}
                </footer>
              </article>
            </div>

            <div className="operations-approval-reset-row">
              <div>
                <strong>إلغاء طلب الموافقات</strong>
                <span>يمسح الموافقتين الحاليتين مع الاحتفاظ بسجل الإجراءات.</span>
              </div>
              <button type="button" className="operations-reset-approvals" onClick={() => void reset()} disabled={loading}>
                إلغاء الطلب ومسح الموافقات
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
