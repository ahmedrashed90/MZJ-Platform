import { useEffect, useMemo, useState } from "react";
import { CalendarBlank, CreditCard, FloppyDisk, PencilSimple, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
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
  type SubscriptionPricingModel,
} from "../subscriptions";

type SubscriptionDraft = {
  id: string;
  serviceName: string;
  billingCycle: SubscriptionBillingCycle;
  pricingModel: SubscriptionPricingModel;
  amount: string;
  unitPrice: string;
  usageQuantity: string;
  usageLimit: string;
  usageUnit: string;
  startDate: string;
  renewalDate: string;
  notes: string;
};

function newDraft(): SubscriptionDraft {
  const startDate = localDateKey();
  return {
    id: "",
    serviceName: "",
    billingCycle: "monthly",
    pricingModel: "fixed",
    amount: "",
    unitPrice: "",
    usageQuantity: "",
    usageLimit: "",
    usageUnit: "",
    startDate,
    renewalDate: addSubscriptionCycle(startDate, "monthly"),
    notes: "",
  };
}

export function SubscriptionSettings({ readOnly = false }: { readOnly?: boolean }) {
  const [payload, setPayload] = useState<MarketingSubscriptionsPayload | null>(null);
  const [draft, setDraft] = useState<SubscriptionDraft>(() => newDraft());
  const [renewalTouched, setRenewalTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<MarketingSubscriptionsPayload>("/api/marketing?resource=subscription_settings");
      setPayload(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات الاشتراكات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.rows || []).filter((row) => !query || `${row.service_name} ${row.usage_unit || ""}`.toLowerCase().includes(query));
  }, [payload, search]);

  function updateStartDate(startDate: string) {
    setDraft((current) => ({
      ...current,
      startDate,
      renewalDate: renewalTouched ? current.renewalDate : addSubscriptionCycle(startDate, current.billingCycle),
    }));
  }

  function updateBillingCycle(billingCycle: SubscriptionBillingCycle) {
    setDraft((current) => ({
      ...current,
      billingCycle,
      renewalDate: renewalTouched ? current.renewalDate : addSubscriptionCycle(current.startDate, billingCycle),
    }));
  }

  function updatePricingModel(pricingModel: SubscriptionPricingModel) {
    setDraft((current) => ({
      ...current,
      pricingModel,
      unitPrice: pricingModel === "per_unit" ? current.unitPrice : "",
      usageQuantity: pricingModel === "fixed" ? "" : current.usageQuantity,
      usageLimit: pricingModel === "fixed" ? "" : current.usageLimit,
      usageUnit: pricingModel === "fixed" ? "" : current.usageUnit,
    }));
  }

  function edit(row: MarketingSubscription) {
    setDraft({
      id: row.id,
      serviceName: row.service_name,
      billingCycle: row.billing_cycle,
      pricingModel: row.pricing_model,
      amount: String(row.amount ?? 0),
      unitPrice: row.unit_price === null ? "" : String(row.unit_price),
      usageQuantity: row.usage_quantity === null ? "" : String(row.usage_quantity),
      usageLimit: row.usage_limit === null ? "" : String(row.usage_limit),
      usageUnit: row.usage_unit || "",
      startDate: row.start_date,
      renewalDate: row.renewal_date,
      notes: row.notes || "",
    });
    setRenewalTouched(true);
    setMessage("");
    setError("");
    document.querySelector(".marketing-subscription-settings-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset() {
    setDraft(newDraft());
    setRenewalTouched(false);
    setError("");
    setMessage("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_subscription",
          ...draft,
          amount: draft.pricingModel === "per_unit" ? String(effectivePreview) : draft.amount,
        }),
      });
      reset();
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الاشتراك");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: MarketingSubscription) {
    if (!window.confirm(`إيقاف اشتراك ${row.service_name}؟ سيختفي من صفحة الاشتراكات مع الاحتفاظ بسجل البيانات.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_subscription", id: row.id }),
      });
      if (draft.id === row.id) reset();
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إيقاف الاشتراك");
    } finally {
      setBusy(false);
    }
  }

  const effectivePreview = draft.pricingModel === "per_unit" && draft.unitPrice !== "" && draft.usageQuantity !== ""
    ? Number(draft.unitPrice || 0) * Number(draft.usageQuantity || 0)
    : Number(draft.amount || 0);

  return (
    <section className="marketing-subscription-settings">
      {readOnly ? <div className="connection-banner"><WarningCircle size={18} /><span>لا توجد صلاحية لإدارة الاشتراكات. اطلب صلاحية «إدارة الاشتراكات» من صلاحيات التسويق.</span></div> : null}
      {error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="success-banner">{message}</div> : null}

      <section className="panel marketing-settings-panel marketing-subscription-settings-form">
        <div className="marketing-subscription-settings-title">
          <div>
            <span className="marketing-subscription-settings-icon"><CreditCard size={23} weight="duotone" /></span>
            <div><h3>{draft.id ? "تعديل الاشتراك" : "إضافة اشتراك جديد"}</h3><p>سجل قيمة الخدمة كقيمة ثابتة أو اربطها بوحدة استخدام مثل مستخدم، طلب، توكن أو جيجابايت.</p></div>
          </div>
          {draft.id ? <button type="button" className="secondary compact-button" onClick={reset}>إضافة جديد بدلًا منه</button> : null}
        </div>

        <fieldset disabled={readOnly || busy} className="marketing-subscription-settings-fieldset">
          <div className="marketing-subscription-settings-grid">
            <label className="span-2"><span>اسم الخدمة *</span><input value={draft.serviceName} onChange={(event) => setDraft({ ...draft, serviceName: event.target.value })} placeholder="مثال: ChatGPT Plus أو Zoho CRM" /></label>
            <label><span>نوع الاشتراك *</span><select value={draft.billingCycle} onChange={(event) => updateBillingCycle(event.target.value as SubscriptionBillingCycle)}><option value="monthly">شهري</option><option value="annual">سنوي</option></select></label>
            <label><span>طريقة الاحتساب *</span><select value={draft.pricingModel} onChange={(event) => updatePricingModel(event.target.value as SubscriptionPricingModel)}><option value="fixed">مبلغ ثابت</option><option value="per_unit">حسب الوحدة</option><option value="usage">حسب الاستخدام</option></select></label>
            {draft.pricingModel === "per_unit" ? <label><span>سعر الوحدة *</span><div className="marketing-subscription-money-input"><input type="number" min="0" step="0.0001" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} placeholder="0.00" /><b>ر.س</b></div></label> : <label><span>{draft.pricingModel === "usage" ? "القيمة الحالية حسب الاستخدام *" : "قيمة الاشتراك *"}</span><div className="marketing-subscription-money-input"><input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0.00" /><b>ر.س</b></div></label>}
            {draft.pricingModel !== "fixed" ? <>
              <label><span>وحدة الاستخدام *</span><input value={draft.usageUnit} onChange={(event) => setDraft({ ...draft, usageUnit: event.target.value })} placeholder="مستخدم / طلب / توكن / GB" /></label>
              <label><span>الاستخدام الحالي</span><input type="number" min="0" step="0.0001" value={draft.usageQuantity} onChange={(event) => setDraft({ ...draft, usageQuantity: event.target.value })} /></label>
              <label><span>حد الاستخدام</span><input type="number" min="0" step="0.0001" value={draft.usageLimit} onChange={(event) => setDraft({ ...draft, usageLimit: event.target.value })} placeholder="اختياري" /></label>
              {draft.pricingModel === "per_unit" ? <label><span>القيمة المحتسبة حاليًا</span><input disabled value={formatSubscriptionMoney(effectivePreview)} /></label> : null}
            </> : null}
            <label><span>تاريخ بداية الاشتراك *</span><input type="date" value={draft.startDate} onChange={(event) => updateStartDate(event.target.value)} /></label>
            <label><span>تاريخ التجديد *</span><input type="date" value={draft.renewalDate} onChange={(event) => { setRenewalTouched(true); setDraft({ ...draft, renewalDate: event.target.value }); }} /></label>
            <label className="span-2"><span>ملاحظات</span><textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="رقم الحساب، الباقة، أو أي تفاصيل داخلية مهمة..." /></label>
          </div>
          <div className="marketing-subscription-settings-preview">
            <span><CalendarBlank size={17} />{BILLING_CYCLE_LABELS[draft.billingCycle]}</span>
            <span>{PRICING_MODEL_LABELS[draft.pricingModel]}</span>
            {draft.pricingModel !== "fixed" && draft.usageQuantity ? <span>{formatSubscriptionUsage(Number(draft.usageQuantity), draft.usageUnit)}</span> : null}
            <strong>{formatSubscriptionMoney(effectivePreview)}</strong>
          </div>
          <div className="marketing-row-actions marketing-subscription-settings-actions">
            <button type="button" className="primary" onClick={() => void save()} disabled={busy}><FloppyDisk size={18} />{busy ? "جاري الحفظ..." : draft.id ? "حفظ تعديل الاشتراك" : "إضافة الاشتراك"}</button>
            {draft.id ? <button type="button" className="secondary" onClick={reset}>إلغاء التعديل</button> : null}
          </div>
        </fieldset>
      </section>

      <section className="panel marketing-settings-panel marketing-subscription-settings-list-panel">
        <div className="marketing-subscription-settings-list-head">
          <div><h3>الاشتراكات المسجلة</h3><p>التعديل هنا يغيّر البيانات الأساسية فقط؛ التجديد يتم من صفحة الاشتراكات.</p></div>
          <label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الخدمة..." /></label>
        </div>
        {loading ? <div className="marketing-empty">جاري تحميل الاشتراكات...</div> : rows.length ? <div className="marketing-subscription-settings-cards">
          {rows.map((row) => <article key={row.id}>
            <span className="marketing-subscription-service-mark">{row.service_name.slice(0, 1).toUpperCase()}</span>
            <div className="marketing-subscription-settings-card-copy"><strong>{row.service_name}</strong><small>{BILLING_CYCLE_LABELS[row.billing_cycle]} · {PRICING_MODEL_LABELS[row.pricing_model]}</small><p>{marketingDate(row.start_date)} ← {marketingDate(row.renewal_date)}</p></div>
            <div className="marketing-subscription-settings-card-price"><strong>{formatSubscriptionMoney(row.effective_amount)}</strong><small>{row.pricing_model === "fixed" ? `/${BILLING_CYCLE_LABELS[row.billing_cycle]}` : row.pricing_model === "per_unit" ? `${formatSubscriptionMoney(row.unit_price)} / ${row.usage_unit || "وحدة"}` : "حسب الاستخدام"}</small></div>
            <div className="marketing-row-actions"><button type="button" className="secondary compact-button" disabled={readOnly || busy} onClick={() => edit(row)}><PencilSimple size={15} />تعديل</button><button type="button" className="danger compact-button" disabled={readOnly || busy} onClick={() => void remove(row)}><Trash size={15} />إيقاف</button></div>
          </article>)}
        </div> : <div className="marketing-empty"><CreditCard size={27} /><strong>لا توجد اشتراكات مسجلة</strong><span>استخدم النموذج بالأعلى لإضافة أول اشتراك.</span></div>}
      </section>
    </section>
  );
}
