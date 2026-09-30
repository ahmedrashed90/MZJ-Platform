import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CalendarBlank,
  ClockCountdown,
  ClockCounterClockwise,
  CreditCard,
  CurrencyCircleDollar,
  MagnifyingGlass,
  Plus,
  Receipt,
  WarningCircle,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../components/Modal";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";
import { marketingFetch, marketingDate } from "../api";
import {
  BILLING_CYCLE_LABELS,
  PRICING_MODEL_LABELS,
  addSubscriptionCycle,
  formatSubscriptionMoney,
  formatSubscriptionUsage,
  localDateKey,
  type MarketingSubscription,
  type MarketingSubscriptionsPayload,
  type SubscriptionBillingCycle,
  type SubscriptionHistoryPayload,
  type SubscriptionPricingModel,
} from "../subscriptions";
import "../marketing.css";

type StatusFilter = "all" | "active" | "soon" | "expired";
type CycleFilter = "all" | SubscriptionBillingCycle;
type PricingFilter = "all" | SubscriptionPricingModel;

type RenewalDraft = {
  actualRenewalDate: string;
  nextRenewalDate: string;
  amount: string;
  unitPrice: string;
  usageQuantity: string;
  usageLimit: string;
  usageUnit: string;
  note: string;
};

function remainingLabel(row: MarketingSubscription) {
  if (row.days_remaining < 0) return `منتهي منذ ${Math.abs(row.days_remaining).toLocaleString("ar-SA-u-nu-latn")} يوم`;
  if (row.days_remaining === 0) return "التجديد اليوم";
  return `${row.days_remaining.toLocaleString("ar-SA-u-nu-latn")} يوم`;
}

function remainingTone(row: MarketingSubscription) {
  if (row.days_remaining < 0) return "danger";
  if (row.days_remaining <= 7) return "warning";
  return "success";
}

function usageText(row: MarketingSubscription) {
  if (row.pricing_model === "fixed") return "غير مرتبط بالاستخدام";
  const current = formatSubscriptionUsage(row.usage_quantity, row.usage_unit);
  if (row.usage_limit === null || row.usage_limit === undefined) return current;
  return `${current} من ${formatSubscriptionUsage(row.usage_limit, row.usage_unit)}`;
}

function priceDetails(row: MarketingSubscription) {
  if (row.pricing_model === "per_unit" && row.unit_price !== null) {
    return `${formatSubscriptionMoney(row.unit_price)} / ${row.usage_unit || "وحدة"}`;
  }
  if (row.pricing_model === "usage") return "القيمة الحالية حسب الاستخدام";
  return `/${BILLING_CYCLE_LABELS[row.billing_cycle]}`;
}

export function SubscriptionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<MarketingSubscriptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [cycle, setCycle] = useState<CycleFilter>("all");
  const [pricing, setPricing] = useState<PricingFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [renewing, setRenewing] = useState<MarketingSubscription | null>(null);
  const [renewalDraft, setRenewalDraft] = useState<RenewalDraft>({ actualRenewalDate: "", nextRenewalDate: "", amount: "", unitPrice: "", usageQuantity: "", usageLimit: "", usageUnit: "", note: "" });
  const [nextDateTouched, setNextDateTouched] = useState(false);
  const [historyFor, setHistoryFor] = useState<MarketingSubscription | null>(null);
  const [history, setHistory] = useState<SubscriptionHistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const canRenew = payload?.permissions.canRenew ?? hasPermission(user, "marketing.subscriptions.renew");
  const canManage = payload?.permissions.canManage ?? hasPermission(user, "marketing.subscriptions.manage");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const next = await marketingFetch<MarketingSubscriptionsPayload>("/api/marketing?resource=subscriptions");
      setPayload(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الاشتراكات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.rows || []).filter((row) => {
      if (query && !`${row.service_name} ${row.usage_unit || ""}`.toLowerCase().includes(query)) return false;
      if (cycle !== "all" && row.billing_cycle !== cycle) return false;
      if (pricing !== "all" && row.pricing_model !== pricing) return false;
      if (status === "active" && row.days_remaining < 0) return false;
      if (status === "soon" && !(row.days_remaining >= 0 && row.days_remaining <= 30)) return false;
      if (status === "expired" && row.days_remaining >= 0) return false;
      return true;
    });
  }, [payload, search, cycle, pricing, status]);

  function openRenewal(row: MarketingSubscription) {
    const actualRenewalDate = localDateKey();
    setRenewing(row);
    setNextDateTouched(false);
    setRenewalDraft({
      actualRenewalDate,
      nextRenewalDate: addSubscriptionCycle(actualRenewalDate, row.billing_cycle),
      amount: String(row.amount ?? 0),
      unitPrice: row.unit_price === null ? "" : String(row.unit_price),
      usageQuantity: row.usage_quantity === null ? "" : String(row.usage_quantity),
      usageLimit: row.usage_limit === null ? "" : String(row.usage_limit),
      usageUnit: row.usage_unit || "",
      note: "",
    });
    setError("");
    setMessage("");
  }

  function updateActualRenewalDate(value: string) {
    setRenewalDraft((current) => ({
      ...current,
      actualRenewalDate: value,
      nextRenewalDate: nextDateTouched || !renewing ? current.nextRenewalDate : addSubscriptionCycle(value, renewing.billing_cycle),
    }));
  }

  async function confirmRenewal() {
    if (!renewing) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "renew_subscription",
          id: renewing.id,
          actualRenewalDate: renewalDraft.actualRenewalDate,
          nextRenewalDate: renewalDraft.nextRenewalDate,
          amount: renewing.pricing_model === "per_unit" && renewalDraft.unitPrice !== "" && renewalDraft.usageQuantity !== ""
            ? String(Number(renewalDraft.unitPrice) * Number(renewalDraft.usageQuantity))
            : renewalDraft.amount,
          unitPrice: renewalDraft.unitPrice,
          usageQuantity: renewalDraft.usageQuantity,
          usageLimit: renewalDraft.usageLimit,
          usageUnit: renewalDraft.usageUnit,
          note: renewalDraft.note,
        }),
      });
      setRenewing(null);
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تجديد الاشتراك");
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(row: MarketingSubscription) {
    setHistoryFor(row);
    setHistory(null);
    setHistoryLoading(true);
    setError("");
    try {
      const result = await marketingFetch<SubscriptionHistoryPayload>(`/api/marketing?resource=subscription_history&id=${encodeURIComponent(row.id)}`);
      setHistory(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل التجديد");
    } finally {
      setHistoryLoading(false);
    }
  }

  const stats = payload?.stats || { activeCount: 0, expiringSoonCount: 0, expiredCount: 0, totalCurrentCost: 0, usageBasedCost: 0 };
  const renewalEffectiveAmount = renewing?.pricing_model === "per_unit" && renewalDraft.unitPrice !== "" && renewalDraft.usageQuantity !== ""
    ? Number(renewalDraft.unitPrice) * Number(renewalDraft.usageQuantity)
    : Number(renewalDraft.amount || 0);

  return (
    <div className="marketing-page marketing-subscriptions-page">
      <header className="marketing-page-head marketing-subscriptions-head">
        <div>
          <span className="marketing-subscriptions-kicker"><CreditCard size={17} weight="duotone" /> إدارة المصروفات الرقمية</span>
          <h1>الاشتراكات والخدمات</h1>
          <p>متابعة الاشتراكات الشهرية والسنوية والقيم الثابتة أو المتغيرة حسب الاستخدام.</p>
        </div>
        {canManage ? <button type="button" className="primary" onClick={() => navigate("/settings?section=marketing&tab=subscriptions")}><Plus size={18} />إضافة اشتراك جديد</button> : null}
      </header>

      {error ? <div className="marketing-alert error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="success-banner"><Receipt size={18} />{message}</div> : null}

      <section className="marketing-subscription-kpis" aria-label="ملخص الاشتراكات">
        <article className="marketing-subscription-kpi kpi-primary">
          <span className="marketing-subscription-kpi-icon"><CreditCard size={28} weight="duotone" /></span>
          <div><small>الاشتراكات النشطة</small><strong>{stats.activeCount.toLocaleString("ar-SA-u-nu-latn")}</strong><p>اشتراك ساري داخل النظام</p></div>
        </article>
        <article className="marketing-subscription-kpi kpi-warning">
          <span className="marketing-subscription-kpi-icon"><ClockCountdown size={28} weight="duotone" /></span>
          <div><small>تجديد خلال 30 يوم</small><strong>{stats.expiringSoonCount.toLocaleString("ar-SA-u-nu-latn")}</strong><p>تحتاج للمتابعة قريبًا</p></div>
        </article>
        <article className="marketing-subscription-kpi kpi-danger">
          <span className="marketing-subscription-kpi-icon"><WarningCircle size={28} weight="duotone" /></span>
          <div><small>اشتراكات منتهية</small><strong>{stats.expiredCount.toLocaleString("ar-SA-u-nu-latn")}</strong><p>تجاوزت تاريخ التجديد</p></div>
        </article>
        <article className="marketing-subscription-kpi kpi-value">
          <span className="marketing-subscription-kpi-icon"><CurrencyCircleDollar size={28} weight="duotone" /></span>
          <div><small>إجمالي القيم الحالية</small><strong>{formatSubscriptionMoney(stats.totalCurrentCost)}</strong><p>منها {formatSubscriptionMoney(stats.usageBasedCost)} حسب الاستخدام</p></div>
        </article>
      </section>

      <section className="marketing-table-panel marketing-subscriptions-panel">
        <div className="marketing-subscription-tabs" role="tablist" aria-label="تبويبات الاشتراكات">
          <button type="button" disabled={!canManage} onClick={() => navigate("/settings?section=marketing&tab=subscriptions")}><Plus size={17} />إضافة اشتراك جديد</button>
          <button type="button" className="active"><CreditCard size={17} />الاشتراكات</button>
        </div>

        <div className="marketing-subscription-toolbar">
          <label className="marketing-subscription-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الخدمة..." /></label>
          <select value={cycle} onChange={(event) => setCycle(event.target.value as CycleFilter)}><option value="all">كل أنواع الاشتراك</option><option value="monthly">شهري</option><option value="annual">سنوي</option></select>
          <select value={pricing} onChange={(event) => setPricing(event.target.value as PricingFilter)}><option value="all">كل طرق الاحتساب</option><option value="fixed">مبلغ ثابت</option><option value="per_unit">حسب الوحدة</option><option value="usage">حسب الاستخدام</option></select>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">كل الحالات</option><option value="active">ساري</option><option value="soon">تجديد قريب</option><option value="expired">منتهي</option></select>
          <button type="button" className="secondary compact-button" disabled={loading} onClick={() => void load()}><ArrowsClockwise size={16} />تحديث</button>
        </div>

        {loading ? <div className="marketing-empty"><ArrowsClockwise size={24} className="marketing-subscription-spin" /><strong>جاري تحميل الاشتراكات...</strong></div> : rows.length ? (
          <div className="marketing-table-wrap marketing-subscription-table-wrap">
            <table className="marketing-subscription-table">
              <thead><tr><th>الخدمة</th><th>النوع</th><th>طريقة الاحتساب</th><th>بداية الاشتراك</th><th>تاريخ التجديد</th><th>الاستهلاك الحالي</th><th>قيمة الاشتراك</th><th>الأيام المتبقية</th><th>إجراء</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td><div className="marketing-subscription-service"><span>{row.service_name.slice(0, 1).toUpperCase()}</span><div><strong>{row.service_name}</strong>{row.notes ? <small>{row.notes}</small> : <small>{row.renewal_count ? `${row.renewal_count.toLocaleString("ar-SA-u-nu-latn")} تجديد مسجل` : "بدون تجديدات سابقة"}</small>}</div></div></td>
                  <td><span className={`marketing-subscription-pill cycle-${row.billing_cycle}`}>{BILLING_CYCLE_LABELS[row.billing_cycle]}</span></td>
                  <td><span className={`marketing-subscription-pill pricing-${row.pricing_model}`}>{PRICING_MODEL_LABELS[row.pricing_model]}</span></td>
                  <td>{marketingDate(row.start_date)}</td>
                  <td><strong>{marketingDate(row.renewal_date)}</strong></td>
                  <td><div className="marketing-subscription-usage"><strong>{usageText(row)}</strong>{row.pricing_model === "per_unit" && row.unit_price !== null ? <small>{formatSubscriptionMoney(row.unit_price)} لكل {row.usage_unit || "وحدة"}</small> : null}</div></td>
                  <td><div className="marketing-subscription-value"><strong>{formatSubscriptionMoney(row.effective_amount)}</strong><small>{priceDetails(row)}</small></div></td>
                  <td><span className={`marketing-status ${remainingTone(row)}`}>{remainingLabel(row)}</span></td>
                  <td><div className="marketing-subscription-actions">
                    <button type="button" className="secondary compact-button" disabled={!canRenew} onClick={() => openRenewal(row)}><ArrowsClockwise size={15} />تجديد</button>
                    <button type="button" className="marketing-subscription-icon-button" title="سجل التجديد" aria-label={`سجل تجديد ${row.service_name}`} onClick={() => void openHistory(row)}><ClockCounterClockwise size={17} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="marketing-empty"><CreditCard size={28} weight="duotone" /><strong>لا توجد اشتراكات مطابقة</strong><span>غيّر الفلاتر أو أضف اشتراكًا جديدًا من إعدادات سيستم التسويق.</span></div>}
      </section>

      <Modal
        open={Boolean(renewing)}
        title={renewing ? `تجديد ${renewing.service_name}` : "تجديد الاشتراك"}
        subtitle="حدد تاريخ التجديد الفعلي والقيمة الجديدة إن تغيرت، ثم اختر تاريخ التجديد القادم."
        onClose={() => !busy && setRenewing(null)}
        className="marketing-subscription-renew-modal"
        footer={<><button type="button" onClick={() => setRenewing(null)} disabled={busy}>إلغاء</button><button type="button" className="primary" disabled={busy} onClick={() => void confirmRenewal()}><ArrowsClockwise size={17} />{busy ? "جاري التجديد..." : "تأكيد التجديد"}</button></>}
      >
        {renewing ? <div className="marketing-subscription-renew-body">
          <div className="marketing-subscription-renew-summary">
            <span className="marketing-subscription-service-mark">{renewing.service_name.slice(0, 1).toUpperCase()}</span>
            <div><strong>{renewing.service_name}</strong><small>{BILLING_CYCLE_LABELS[renewing.billing_cycle]} · {PRICING_MODEL_LABELS[renewing.pricing_model]}</small></div>
            <b>{formatSubscriptionMoney(renewing.effective_amount)}</b>
          </div>
          <div className="marketing-form-row">
            <label><span>تاريخ التجديد الفعلي</span><input type="date" value={renewalDraft.actualRenewalDate} onChange={(event) => updateActualRenewalDate(event.target.value)} /></label>
            <label><span>تاريخ التجديد القادم</span><input type="date" value={renewalDraft.nextRenewalDate} onChange={(event) => { setNextDateTouched(true); setRenewalDraft((current) => ({ ...current, nextRenewalDate: event.target.value })); }} /></label>
          </div>
          <div className="marketing-form-row">
            {renewing.pricing_model === "per_unit" ? <label><span>سعر الوحدة</span><div className="marketing-subscription-money-input"><input type="number" min="0" step="0.0001" value={renewalDraft.unitPrice} onChange={(event) => setRenewalDraft((current) => ({ ...current, unitPrice: event.target.value }))} /><b>ر.س</b></div></label> : <label><span>{renewing.pricing_model === "usage" ? "القيمة الفعلية حسب الاستخدام" : "قيمة الاشتراك"}</span><div className="marketing-subscription-money-input"><input type="number" min="0" step="0.01" value={renewalDraft.amount} onChange={(event) => setRenewalDraft((current) => ({ ...current, amount: event.target.value }))} /><b>ر.س</b></div></label>}
            {renewing.pricing_model === "per_unit" ? <label><span>القيمة المحتسبة حاليًا</span><input disabled value={formatSubscriptionMoney(renewalEffectiveAmount)} /></label> : <label><span>طريقة الاحتساب</span><input disabled value={PRICING_MODEL_LABELS[renewing.pricing_model]} /></label>}
          </div>
          {renewing.pricing_model !== "fixed" ? <div className="marketing-form-row three">
            <label><span>الاستخدام الحالي</span><input type="number" min="0" step="0.0001" value={renewalDraft.usageQuantity} onChange={(event) => setRenewalDraft((current) => ({ ...current, usageQuantity: event.target.value }))} /></label>
            <label><span>حد الاستخدام</span><input type="number" min="0" step="0.0001" value={renewalDraft.usageLimit} onChange={(event) => setRenewalDraft((current) => ({ ...current, usageLimit: event.target.value }))} /></label>
            <label><span>وحدة الاستخدام</span><input value={renewalDraft.usageUnit} onChange={(event) => setRenewalDraft((current) => ({ ...current, usageUnit: event.target.value }))} placeholder="مستخدم / طلب / توكن..." /></label>
          </div> : null}
          <label><span>ملاحظة التجديد <small>اختياري</small></span><textarea rows={3} value={renewalDraft.note} onChange={(event) => setRenewalDraft((current) => ({ ...current, note: event.target.value }))} placeholder="مثال: تم التجديد بسعر جديد أو بعدد مستخدمين مختلف" /></label>
          {error ? <div className="marketing-alert error"><WarningCircle size={17} />{error}</div> : null}
        </div> : null}
      </Modal>

      <Modal
        open={Boolean(historyFor)}
        title={historyFor ? `سجل تجديد ${historyFor.service_name}` : "سجل التجديد"}
        subtitle="كل عملية تجديد محفوظة بتاريخها وقيمتها الفعلية."
        onClose={() => setHistoryFor(null)}
        className="marketing-subscription-history-modal"
      >
        {historyLoading ? <div className="marketing-empty">جاري تحميل سجل التجديد...</div> : history?.rows.length ? <div className="marketing-subscription-history-list">
          {history.rows.map((item) => <article key={item.id}>
            <span className="marketing-subscription-history-icon"><CalendarBlank size={18} weight="duotone" /></span>
            <div><strong>{marketingDate(item.actual_renewal_date)} ← {marketingDate(item.next_renewal_date)}</strong><small>{PRICING_MODEL_LABELS[item.pricing_model]} · {formatSubscriptionMoney(item.pricing_model === "per_unit" && item.unit_price !== null && item.usage_quantity !== null ? item.unit_price * item.usage_quantity : item.amount)}{item.usage_quantity !== null ? ` · ${formatSubscriptionUsage(item.usage_quantity, item.usage_unit)}` : ""}</small>{item.note ? <p>{item.note}</p> : null}</div>
            <time>{item.renewed_by_name || "—"}</time>
          </article>)}
        </div> : <div className="marketing-empty"><ClockCounterClockwise size={26} /><strong>لا توجد تجديدات سابقة</strong></div>}
      </Modal>
    </div>
  );
}
