import { useEffect, useState } from "react";
import { ArrowRight, ArrowsClockwise, Gift, IdentificationCard, ShareNetwork, Sparkle } from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import { ownersAdminGet } from "./api";
import { OwnersDiscountCalculator } from "./OwnersDiscountCalculator";
import { ownersCustomerCategoryFromPoints } from "./customerCategory";
import { PurchaseInvoiceActions } from "./PurchaseInvoiceActions";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تحميل صفحة عضوية العميل";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}


function rewardTypeLabel(value: unknown) {
  const type = String(value || "gift");
  if (type === "discount") return "خصم";
  if (type === "service") return "خدمة";
  if (type === "voucher") return "قسيمة";
  return "هدية";
}

function movementLabel(entry: any) {
  const type = String(entry?.event_type || "");
  const description = String(entry?.description || "");
  const purchaseKind = String(entry?.metadata?.purchaseKind || "");
  if (type === "purchase" && (purchaseKind === "repurchase" || description.includes("إعادة شراء"))) return "إعادة الشراء";
  if (type === "purchase") return "شراء العميل";
  if (type === "unique_open") return "إرسال دعوة لصديق";
  if (type === "sale") return "إرسال دعوة لصديق - تم الشراء";
  if (type === "registration") return "تسجيل صديق";
  if (type === "qualified") return "عميل مؤهل";
  if (type === "redemption") return "استبدال مكافأة";
  return description || type || "حركة نقاط";
}


export function OwnersMemberPreviewPage() {
  const navigate = useNavigate();
  const params = useParams();
  const kind = params.kind === "legacy" ? "legacy" : "member";
  const id = String(params.id || "");
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [cardFlipped, setCardFlipped] = useState(false);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      setData(await ownersAdminGet("profile", { kind, id }));
    } catch (error) {
      setData(null);
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [kind, id]);

  const member = data?.member || {};
  const rewards = Array.isArray(data?.rewards) ? data.rewards : [];
  const ledger = Array.isArray(data?.ledger) ? data.ledger : [];
  const pointsMenu = data?.pointsMenu || {};
  const redemptions = Array.isArray(data?.redemptions) ? data.redemptions : [];
  const websiteCars = Array.isArray(data?.websiteCars) ? data.websiteCars : [];
  const category = ownersCustomerCategoryFromPoints(member.lifetimePoints);

  return (
    <div className="module-page owners-admin-page owners-member-preview" dir="rtl">
      <header className="owners-hero">
        <div>
          <span className="owners-hero-icon"><IdentificationCard size={30} weight="duotone" /></span>
          <div>
            <h1>صفحة عضوية العميل</h1>
            <p>{kind === "legacy" ? "معاينة العميل من تبويب العملاء الجديدة" : "معاينة عضوية العميل من تبويب عملاء تم البيع"}</p>
          </div>
        </div>
        <button type="button" className="owners-link-btn" onClick={() => navigate("/owners-community")}><ArrowRight size={18} /> رجوع إلى MZJ Club Community</button>
      </header>

      {loading ? <div className="owners-panel owners-loading">جاري تحميل صفحة العضوية...</div> : null}
      {!loading && message ? <div className="owners-notice"><strong>{message}</strong><button type="button" className="owners-link-btn" onClick={() => void load()}><ArrowsClockwise size={16} /> إعادة المحاولة</button></div> : null}

      {!loading && data ? (
        <main className="owners-member-preview-body">
          {kind === "legacy" ? <div className="owners-notice">العميل ما زال ضمن «العملاء الجديدة». النقاط والمكافآت تظهر بعد وجود رصيد فعلي للعضوية.</div> : null}

          <section className={`owners-membership-shell ${cardFlipped ? "flipped" : ""}`} onClick={() => setCardFlipped((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setCardFlipped((value) => !value); }}>
            <div className="owners-membership-card">
              <div className="owners-membership-face front">
                <div className="owners-card-brand"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /><div><span>MZJ Club Community</span><strong>بطاقة العضوية</strong></div></div>
                <div className="owners-card-name"><small>العميل</small><h2>{member.name || "عميل مجموعة محمد بن ذعار العجمي"}</h2></div>
                <div className="owners-card-metrics">
                  <div><span>رصيد النقاط</span><strong>{Number(member.points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong><small>نقطة</small></div>
                  <div><span>إجمالي النقاط المكتسبة</span><strong>{Number(member.lifetimePoints || 0).toLocaleString("ar-SA-u-nu-latn")}</strong><small>نقطة</small></div>
                </div>
                <div className="owners-card-footer"><span>{member.referralCode ? `الكود: ${member.referralCode}` : "MZJ Club Community"}</span><small><ArrowsClockwise size={15} /> اضغط لعرض فئة العميل</small></div>
              </div>
              <div className="owners-membership-face back">
                <div className="owners-card-back-head"><div><Sparkle size={22} weight="fill" /><strong>فئة العميل</strong></div><img src="/logo.png" alt="MZJ" /></div>
                <div className={`owners-card-category ${category.category}`}>
                  <span>فئة العميل</span>
                  <strong>{category.label}</strong>
                  <small>{category.category === "none" ? "تبدأ فئة تميز من 1,000 نقطة مكتسبة" : `${Number(member.lifetimePoints || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة مكتسبة`}</small>
                </div>
                <div className="owners-card-back-details">
                  <div><span>كود العميل</span><strong dir="ltr">{member.referralCode || "—"}</strong></div>
                  <div><span>تاريخ الانضمام</span><strong>{formatDate(member.joinedAt)}</strong></div>
                  <div><span>عدد مرات الشراء</span><strong>{Number(member.purchaseCount || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div>
                  <div><span>آخر شراء</span><strong>{formatDate(member.lastSaleAt)}</strong></div>
                </div>
                <div className="owners-card-footer"><span>تاريخ تثق به</span><small><ArrowsClockwise size={15} /> اضغط للعودة</small></div>
              </div>
            </div>
          </section>

          <section className="owners-public-section owners-points-list-section">
            <h2>قائمة النقاط</h2>
            <div className="owners-ledger">
              <article><span>إعادة الشراء</span><strong>{Number(pointsMenu.repurchase ?? 500).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong></article>
              <article><span>إرسال دعوة لصديق - تم الشراء</span><strong>{Number(pointsMenu.referralSale ?? 700).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong></article>
              <article><span>إرسال دعوة لصديق</span><strong>{Number(pointsMenu.referralSend ?? 50).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong></article>
            </div>
          </section>

          <OwnersDiscountCalculator websiteCars={websiteCars} referralCode={member.referralCode} />

          <section className="owners-public-section">
            <h2>المكافآت المتاحة حسب رصيد النقاط</h2>
            <div className="owners-public-rewards">
              {rewards.length ? rewards.map((reward: any) => (
                <article key={reward.id}>
                  <Gift size={25} />
                  <h3>{reward.name}</h3>
                  <span className="owners-public-reward-type">{rewardTypeLabel(reward.reward_type)}</span>
                  {reward.reward_value ? <div className="owners-public-reward-value">{reward.reward_value}</div> : null}
                  {reward.description ? <p>{reward.description}</p> : null}
                  <strong>{Number(reward.points_cost || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong>
                </article>
              )) : <p>لا توجد مكافآت تغطي رصيد العميل الحالي.</p>}
            </div>
          </section>

          <section className="owners-public-section owners-movement-section">
            <h2>سجل الحركة</h2>
            <div className="owners-movement-table">
              <div className="owners-movement-head"><span>التاريخ</span><span>البيان</span><span>النقاط</span></div>
              {ledger.length ? ledger.map((entry: any) => (
                <article key={entry.id}>
                  <small className="owners-movement-date">{formatDate(entry.created_at)}</small>
                  <span className="owners-movement-main">
                    <b>{movementLabel(entry)}</b>
                    {entry?.purchase?.vehicleLabel ? <small className="owners-purchase-vehicle">{entry.purchase.vehicleLabel}</small> : null}
                    {kind === "member" && entry?.purchase?.invoiceEligible ? <PurchaseInvoiceActions mode="admin" memberId={member.id} salesOrder={entry.purchase.salesOrderReference} /> : null}
                  </span>
                  <strong className={Number(entry.points) >= 0 ? "plus" : "minus"}>{Number(entry.points) >= 0 ? "+" : ""}{Number(entry.points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong>
                </article>
              )) : null}
            </div>
          </section>

          {member.inviteUrl ? (
            <section className="owners-invite-card owners-admin-invite-card">
              <div><ShareNetwork size={28} /><div><h2>إرسال الدعوة لصديق</h2><p>{member.phone || ""}</p></div></div>
              <div className="owners-invite-link"><input readOnly value={member.inviteUrl} /></div>
            </section>
          ) : null}

          {redemptions.length ? (
            <section className="owners-public-section">
              <h2>أكواد ومكافآت العميل</h2>
              <div className="owners-ledger">
                {redemptions.map((redemption: any) => <article key={redemption.id}><span>{redemption.reward_name || "مكافأة"}</span><strong>{redemption.redemption_code || "—"}</strong><small>{formatDate(redemption.created_at)}</small></article>)}
              </div>
            </section>
          ) : null}

        </main>
      ) : null}
    </div>
  );
}
