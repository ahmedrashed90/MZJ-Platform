import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  ClipboardText,
  CurrencyCircleDollar,
  MagnifyingGlass,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { operationsFetch, queryString } from "../api";
import type { SalesOrderFollowupRow, SalesOrdersFollowupResponse } from "../types";
import { useOperations } from "../useOperations";

const statusOptions = [
  ["", "كل الحالات"],
  ["pending_settlement", "لم يتم استيفاء المبالغ المتبقية"],
  ["pending_financial", "بانتظار الموافقة المالية"],
  ["pending_administrative", "بانتظار الموافقة الإدارية"],
  ["pending_delivery", "لم يتم التسليم"],
  ["delivered", "تم التسليم"],
  ["completed", "مكتمل بالكامل"],
] as const;

function money(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
    : "0.00 ر.س";
}

function visibleVin(row: SalesOrderFollowupRow) {
  const vin = String(row.vin || "").trim();
  return !vin || vin.toUpperCase().startsWith("PENDING-") ? "—" : vin;
}

function StateBadge({ done }: { done: boolean }) {
  return (
    <span className={`sales-orders-followup-badge ${done ? "done" : "pending"}`}>
      {done ? <CheckCircle size={16} weight="fill" /> : <XCircle size={16} weight="fill" />}
      {done ? "تم" : "لم يتم"}
    </span>
  );
}

export function SalesOrdersFollowupPage() {
  const { meta } = useOperations();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<SalesOrdersFollowupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    try {
      const result = await operationsFetch<SalesOrdersFollowupResponse>(
        `/api/operations${queryString({
          resource: "sales_orders_followup",
          search,
          status,
          branch,
          page: targetPage,
          pageSize: 25,
        })}`,
      );
      setPayload(result);
      setPage(result.pagination.page);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل متابعة طلبات البيع");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
    void load(1);
  }, [search, status, branch]);

  const branches = useMemo(() => {
    const values = new Map<string, string>();
    meta.locations.forEach((location) => {
      values.set(location.code, location.name);
      if (location.branch_code && !values.has(location.branch_code)) values.set(location.branch_code, location.name);
    });
    payload?.branches.forEach((item) => values.set(item.code, item.name));
    return [...values.entries()].map(([code, name]) => ({ code, name }));
  }, [meta.locations, payload?.branches]);

  const summary = payload?.summary || {
    total: 0,
    pending_settlement: 0,
    pending_financial: 0,
    pending_administrative: 0,
    delivered: 0,
  };

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <div className="module-page operations-page sales-orders-followup-page">
      <header className="sales-orders-followup-heading">
        <div className="sales-orders-followup-title-icon"><ClipboardText size={27} weight="duotone" /></div>
        <div>
          <h1>متابعة طلبات البيع</h1>
          <p>متابعة حالة طلبات البيع المرتبطة بالتراكينج والموافقات</p>
        </div>
      </header>

      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}

      <section className="sales-orders-followup-summary" aria-label="ملخص متابعة طلبات البيع">
        <article><span className="neutral"><ClipboardText size={22} /></span><div><small>إجمالي الطلبات</small><strong>{summary.total.toLocaleString("en-US")}</strong><em>سيارة</em></div></article>
        <article><span className="warning"><CurrencyCircleDollar size={22} /></span><div><small>بانتظار الاستيفاء</small><strong>{summary.pending_settlement.toLocaleString("en-US")}</strong><em>سيارة</em></div></article>
        <article><span className="warning"><CurrencyCircleDollar size={22} /></span><div><small>بانتظار الموافقة المالية</small><strong>{summary.pending_financial.toLocaleString("en-US")}</strong><em>سيارة</em></div></article>
        <article><span className="warning"><WarningCircle size={22} /></span><div><small>بانتظار الموافقة الإدارية</small><strong>{summary.pending_administrative.toLocaleString("en-US")}</strong><em>سيارة</em></div></article>
        <article><span className="success"><CheckCircle size={22} /></span><div><small>تم التسليم</small><strong>{summary.delivered.toLocaleString("en-US")}</strong><em>سيارة</em></div></article>
      </section>

      <section className="panel sales-orders-followup-panel">
        <form className="sales-orders-followup-toolbar" onSubmit={submitSearch}>
          <label className="sales-orders-followup-search">
            <MagnifyingGlass size={19} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="بحث برقم الطلب / رقم الهيكل / اسم العميل"
            />
          </label>
          <label>
            <span>الحالة</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>الفرع</span>
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option value="">كل الفروع</option>
              {branches.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <button type="submit" className="sales-orders-followup-primary"><MagnifyingGlass size={17} />بحث</button>
          <button type="button" className="sales-orders-followup-refresh" disabled={loading} onClick={() => void load(page)}>
            <ArrowClockwise size={17} className={loading ? "spin" : ""} />تحديث
          </button>
        </form>

        <div className="sales-orders-followup-table-wrap">
          <table className="sales-orders-followup-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>اسم العميل</th>
                <th>رقم الهيكل</th>
                <th>الإجمالي شامل الضريبة</th>
                <th>الدفعة المقدمة</th>
                <th>المتبقي</th>
                <th>استيفاء المبالغ المتبقية (خاص بالعميل)</th>
                <th>الموافقة المالية</th>
                <th>الموافقة الإدارية</th>
                <th>إتمام عملية التسليم بنجاح</th>
              </tr>
            </thead>
            <tbody>
              {loading && !payload ? (
                <tr><td colSpan={10} className="sales-orders-followup-empty">جاري تحميل طلبات البيع...</td></tr>
              ) : payload?.rows.length ? payload.rows.map((row) => (
                <tr key={row.tracking_vehicle_id}>
                  <td><strong className="sales-orders-followup-order" dir="ltr">{row.sales_order_no}</strong></td>
                  <td><span className="sales-orders-followup-customer">{row.customer_name || "—"}</span></td>
                  <td><strong className="sales-orders-followup-vin" dir="ltr">{visibleVin(row)}</strong></td>
                  <td><span className="sales-orders-followup-money">{money(row.total_incl_vat)}</span></td>
                  <td><span className="sales-orders-followup-money">{money(row.advance_paid)}</span></td>
                  <td><span className={`sales-orders-followup-money ${Number(row.remaining_amount || 0) > 0 ? "remaining" : "settled"}`}>{money(row.remaining_amount)}</span></td>
                  <td><StateBadge done={Boolean(row.stage_6_completed)} /></td>
                  <td><StateBadge done={Boolean(row.financial_approved)} /></td>
                  <td><StateBadge done={Boolean(row.administrative_approved)} /></td>
                  <td><StateBadge done={Boolean(row.stage_10_completed)} /></td>
                </tr>
              )) : (
                <tr><td colSpan={10} className="sales-orders-followup-empty">لا توجد طلبات مطابقة للفلاتر الحالية</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="sales-orders-followup-footer">
          <span>
            {payload ? `إظهار ${payload.pagination.total ? ((payload.pagination.page - 1) * payload.pagination.pageSize) + 1 : 0} إلى ${Math.min(payload.pagination.page * payload.pagination.pageSize, payload.pagination.total)} من ${payload.pagination.total.toLocaleString("en-US")} سيارة` : "—"}
          </span>
          <div>
            <button type="button" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>السابق</button>
            <b>{page.toLocaleString("en-US")} / {(payload?.pagination.pages || 1).toLocaleString("en-US")}</b>
            <button type="button" disabled={loading || page >= (payload?.pagination.pages || 1)} onClick={() => void load(page + 1)}>التالي</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
