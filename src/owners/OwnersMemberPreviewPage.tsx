import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowsClockwise, Gift, IdentificationCard, ShareNetwork, Sparkle, Star, Ticket } from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import { ownersAdminGet } from "./api";

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

function tierLabel(value: unknown) {
  const tier = String(value || "member");
  if (tier === "platinum") return "Platinum";
  if (tier === "gold") return "Gold";
  if (tier === "silver") return "Silver";
  return "Member";
}

function rewardTypeLabel(value: unknown) {
  const type = String(value || "gift");
  if (type === "discount") return "خصم";
  if (type === "service") return "خدمة";
  if (type === "voucher") return "قسيمة";
  return "هدية";
}

function referralStatus(value: unknown) {
  const status = String(value || "");
  if (status === "sold") return "تم الشراء";
  if (status === "qualified") return "مؤهل";
  if (status === "registered") return "تم التسجيل";
  if (status === "rejected") return "مرفوض";
  return "فتح الرابط";
}

function ledgerDescription(entry: any) {
  if (entry?.event_type === "unique_open") return "إرسال دعوة لصديق";
  if (entry?.event_type === "sale") return "إرسال دعوة لصديق - تم الشراء";
  if (entry?.event_type === "purchase" && String(entry?.description || "").includes("إعادة شراء")) return "إعادة الشراء";
  return entry?.description || entry?.event_type || "حركة نقاط";
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
  const cardRewards = Array.isArray(data?.cardRewards) ? data.cardRewards : [];
  const ledger = Array.isArray(data?.ledger) ? data.ledger : [];
  const referrals = Array.isArray(data?.referrals) ? data.referrals : [];
  const referralVisits = Array.isArray(data?.referralVisits) ? data.referralVisits : [];
  const redemptions = Array.isArray(data?.redemptions) ? data.redemptions : [];

  const referralActivity = useMemo(() => [
    ...referralVisits.map((visit: any) => ({ id: `visit-${visit.id}`, label: "إرسال دعوة لصديق", status: "فتح الرابط", occurredAt: visit.created_at })),
    ...referrals.flatMap((referral: any) => {
      const label = referral.referred_name || "صديق من دعوة العميل";
      const events: any[] = [];
      if (referral.registered_at) events.push({ id: `registered-${referral.id}`, label, status: "تم التسجيل", occurredAt: referral.registered_at });
      if (referral.qualified_at) events.push({ id: `qualified-${referral.id}`, label, status: "مؤهل", occurredAt: referral.qualified_at });
      if (referral.sold_at) events.push({ id: `sold-${referral.id}`, label, status: "تم الشراء", occurredAt: referral.sold_at });
      if (!events.length || referral.status === "rejected") events.push({ id: `status-${referral.id}`, label, status: referralStatus(referral.status), occurredAt: referral.created_at });
      return events;
    }),
  ].sort((left: any, right: any) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime()), [referralVisits, referrals]);

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
        <button type="button" className="owners-link-btn" onClick={() => navigate("/owners-community")}><ArrowRight size={18} /> رجوع إلى MZJ Owners</button>
      </header>

      {loading ? <div className="owners-panel owners-loading">جاري تحميل صفحة العضوية...</div> : null}
      {!loading && message ? <div className="owners-notice"><strong>{message}</strong><button type="button" className="owners-link-btn" onClick={() => void load()}><ArrowsClockwise size={16} /> إعادة المحاولة</button></div> : null}

      {!loading && data ? (
        <main className="owners-member-preview-body">
          {kind === "legacy" ? <div className="owners-notice">العميل ما زال ضمن «العملاء الجديدة». النقاط والمكافآت تظهر بعد وجود رصيد فعلي للعضوية.</div> : null}

          <section className={`owners-membership-shell ${cardFlipped ? "flipped" : ""}`} onClick={() => setCardFlipped((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setCardFlipped((value) => !value); }}>
            <div className="owners-membership-card">
              <div className="owners-membership-face front">
                <div className="owners-card-brand"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /><div><span>MZJ Owners</span><strong>بطاقة العضوية</strong></div></div>
                <div className="owners-card-name"><small>العميل</small><h2>{member.name || "عميل مجموعة محمد بن ذعار العجمي"}</h2></div>
                <div className="owners-card-metrics">
                  <div><span>رصيد النقاط</span><strong>{Number(member.points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong><small>نقطة</small></div>
                  <div><span>المستوى</span><b><Star size={18} weight="fill" /> {tierLabel(member.tier)}</b><small>{Number(member.lifetimePoints || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة مكتسبة</small></div>
                </div>
                <div className="owners-card-footer"><span>{member.referralCode ? `الكود: ${member.referralCode}` : "MZJ Owners"}</span><small><ArrowsClockwise size={15} /> اضغط لعرض المزايا</small></div>
              </div>
              <div className="owners-membership-face back">
                <div className="owners-card-back-head"><div><Sparkle size={22} weight="fill" /><strong>مزايا بطاقة العضوية</strong></div><img src="/logo.png" alt="MZJ" /></div>
                <div className="owners-card-back-rewards">
                  {cardRewards.length ? cardRewards.slice(0, 4).map((reward: any) => <article key={reward.id}><span className="owners-card-reward-icon"><Gift size={16} weight="fill" /></span><div><strong>{reward.name}</strong><span>{rewardTypeLabel(reward.reward_type)}{reward.reward_value ? ` · ${reward.reward_value}` : ""}</span></div></article>) : <div className="owners-card-empty"><Sparkle size={22} weight="fill" /><strong>لا توجد مزايا بطاقة ظاهرة لهذا العميل حاليًا</strong></div>}
                </div>
                <div className="owners-card-footer"><span>تاريخ تثق به</span><small><ArrowsClockwise size={15} /> اضغط للعودة</small></div>
              </div>
            </div>
          </section>

          <section className="owners-public-section owners-points-list-section">
            <h2>قائمة النقاط</h2>
            <div className="owners-ledger">
              {ledger.length ? ledger.map((entry: any) => (
                <article key={entry.id}><span>{ledgerDescription(entry)}</span><strong className={Number(entry.points) >= 0 ? "plus" : "minus"}>{Number(entry.points) >= 0 ? "+" : ""}{entry.points}</strong><small>{formatDate(entry.created_at)}</small></article>
              )) : <p>لا توجد حركات نقاط حتى الآن.</p>}
            </div>
          </section>

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

          <section className="owners-public-section">
            <h2>سجل الدعوات</h2>
            <div className="owners-ledger owners-referral-ledger">
              {referralActivity.length ? referralActivity.map((activity: any) => (
                <article key={activity.id}><span>{activity.label}</span><strong>{activity.status}</strong><small>{formatDate(activity.occurredAt)}</small></article>
              )) : <p>لا توجد أنشطة مرتبطة بالدعوات حتى الآن.</p>}
            </div>
          </section>

          {member.inviteUrl ? (
            <section className="owners-invite-card owners-admin-invite-card">
              <div><ShareNetwork size={28} /><div><h2>رابط دعوة العميل</h2><p>{member.phone || ""}</p></div></div>
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

          <section className="owners-public-welcome owners-public-welcome-compact">
            <span>{kind === "legacy" ? member.statusLabel || "عميل جديد" : "عضوية فعالة"}</span>
            <div className="owners-mini-badges"><span><Star size={16} weight="fill" /> {tierLabel(member.tier)}</span><span><Ticket size={16} /> {redemptions.length} استبدال</span></div>
          </section>
        </main>
      ) : null}
    </div>
  );
}
