import { useEffect, useState } from "react";
import { ArrowCounterClockwise, Copy, Gift, ShareNetwork, SignOut, Sparkle, Star, Ticket, WhatsappLogo } from "@phosphor-icons/react";
import { ownersPublicGet, ownersPublicPost } from "./api";
import { RedemptionQr } from "./RedemptionQr";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ الطلب";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(String(value)));
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
  if (status === "sold") return "تم البيع";
  if (status === "qualified") return "مؤهل";
  if (status === "registered") return "تم التسجيل";
  if (status === "rejected") return "مرفوض";
  return "فتح الرابط";
}

function redemptionStatus(value: unknown) {
  const status = String(value || "");
  if (status === "approved") return "جاهز للاستبدال";
  if (status === "delivered") return "تم الاستبدال";
  if (status === "requested") return "بانتظار المراجعة";
  if (status === "rejected") return "مرفوض";
  if (status === "cancelled") return "ملغي";
  return status || "—";
}

export function OwnersPortalPage() {
  const [me, setMe] = useState<any>(null);
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cardFlipped, setCardFlipped] = useState(false);

  async function load() {
    try {
      setMe(await ownersPublicGet("me"));
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function requestOtp() {
    setBusy(true);
    setMessage("");
    try {
      const response = await ownersPublicPost({ action: "request_otp", phone });
      setChallenge(response.challengeId);
      setStage("otp");
      setMessage("تم إرسال رمز التحقق");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setMessage("");
    try {
      await ownersPublicPost({ action: "verify_otp", phone, challengeId: challenge, code });
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <div className="owners-public" dir="rtl">
        <div className="owners-login-card">
          <img src="/logo.png" alt="MZJ" />
          <span className="owners-eyebrow">MZJ Owners Community</span>
          <h1>مجموعة محمد بن ذعار العجمي</h1>
          <p>ادخل برقم الجوال المسجل في عملية الشراء، وسيصلك رمز تحقق على رقم الجوال المسجل.</p>
          {message ? <div className="owners-public-message">{message}</div> : null}
          {stage === "phone" ? (
            <>
              <label><span>رقم الجوال</span><input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xxxxxxxx" /></label>
              <button disabled={busy} onClick={() => void requestOtp()}>{busy ? "جاري الإرسال..." : "إرسال رمز التحقق"}</button>
            </>
          ) : (
            <>
              <label><span>رمز التحقق</span><input inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" /></label>
              <button disabled={busy || code.length !== 4} onClick={() => void verifyOtp()}>{busy ? "جاري التحقق..." : "دخول الحساب"}</button>
              <button className="owners-ghost" onClick={() => { setStage("phone"); setCode(""); setChallenge(""); }}>تغيير رقم الجوال</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const member = me.member || {};
  const referrals = Array.isArray(me.referrals) ? me.referrals : [];
  const rewards = Array.isArray(me.rewards) ? me.rewards : [];
  const redemptions = Array.isArray(me.redemptions) ? me.redemptions : [];
  const cardRewards = rewards.filter((reward: any) => reward.show_on_member_card === true);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(member.inviteUrl);
      setMessage("تم نسخ رابط دعوتك");
    } catch {
      setMessage("تعذر النسخ التلقائي. انسخ الرابط من الحقل مباشرة.");
    }
  }

  async function redeem(reward: any) {
    const pointsCost = Number(reward?.points_cost || 0);
    const currentPoints = Number(member.points || 0);
    if (currentPoints < pointsCost) return;
    const afterPoints = currentPoints - pointsCost;
    if (!window.confirm(`تأكيد استبدال «${reward?.name || "المكافأة"}»؟\nسيتم خصم ${pointsCost.toLocaleString("ar-SA-u-nu-latn")} نقطة.\nرصيدك بعد الاستبدال: ${afterPoints.toLocaleString("ar-SA-u-nu-latn")} نقطة.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await ownersPublicPost({ action: "redeem", rewardId: reward.id });
      await load();
      setMessage(response?.redemption?.code ? `تم الاستبدال. كودك: ${response.redemption.code}` : "تم الاستبدال وأصبح جاهزًا للتسليم");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await ownersPublicPost({ action: "logout" }).catch(() => undefined);
    setMe(null);
    setStage("phone");
    setCode("");
    setChallenge("");
  }

  return (
    <div className="owners-public portal" dir="rtl">
      <header className="owners-public-head">
        <div><img src="/logo.png" alt="MZJ" /><div><span>MZJ Owners Community</span><strong>أهلًا {member.name || "بك"} 👋</strong></div></div>
        <button onClick={() => void logout()}><SignOut size={18} /> خروج</button>
      </header>
      <main>
        {message ? <div className="owners-public-message">{message}</div> : null}
        <section className={`owners-membership-shell ${cardFlipped ? "flipped" : ""}`} onClick={() => setCardFlipped((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setCardFlipped((value) => !value); }}>
          <div className="owners-membership-card">
            <div className="owners-membership-face front">
              <div className="owners-card-brand"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /><div><span>MZJ Owners Community</span><strong>بطاقة العضوية</strong></div></div>
              <div className="owners-card-name"><small>العضو</small><h2>{member.name || "عميل مجموعة محمد بن ذعار العجمي"}</h2></div>
              <div className="owners-card-metrics">
                <div><span>رصيد النقاط</span><strong>{Number(member.points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong><small>نقطة</small></div>
                <div><span>المستوى</span><b><Star size={18} weight="fill" /> {tierLabel(member.tier)}</b><small>{Number(member.lifetimePoints || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة مكتسبة</small></div>
              </div>
              <div className="owners-card-footer"><span>مجموعة محمد بن ذعار العجمي</span><small><ArrowCounterClockwise size={15} /> اضغط لعرض مزايا البطاقة</small></div>
            </div>
            <div className="owners-membership-face back">
              <div className="owners-card-back-head"><div><Sparkle size={22} weight="fill" /><strong>مزايا بطاقة العضوية</strong></div><img src="/logo.png" alt="MZJ" /></div>
              <div className="owners-card-back-rewards">
                {cardRewards.length ? cardRewards.slice(0, 4).map((reward: any) => <article key={reward.id}><span className="owners-card-reward-icon"><Gift size={16} weight="fill" /></span><div><strong>{reward.name}</strong><span>{rewardTypeLabel(reward.reward_type)}{reward.reward_value ? ` · ${reward.reward_value}` : ""}</span></div></article>) : <div className="owners-card-empty"><Sparkle size={22} weight="fill" /><strong>مزايا جديدة قريبًا تخصصها الإدارة لبطاقة العضوية</strong></div>}
              </div>
              <div className="owners-card-footer"><span>تاريخ تثق به</span><small><ArrowCounterClockwise size={15} /> اضغط للعودة</small></div>
            </div>
          </div>
        </section>

        <section className="owners-public-welcome owners-public-welcome-compact">
          <span>مرحبًا {member.name || "بك"}</span>
          <div className="owners-mini-badges"><span><Star size={16} weight="fill" /> {tierLabel(member.tier)}</span><span><Ticket size={16} /> {redemptions.length} طلب استبدال</span></div>
        </section>

        <section className="owners-invite-card">
          <div><ShareNetwork size={28} /><div><h2 className="owners-invite-title">شارك رابطك مع أصدقائك</h2></div></div>
          <div className="owners-invite-link">
            <input readOnly value={member.inviteUrl || ""} />
            <button onClick={() => void copyInvite()}><Copy size={18} /> نسخ</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`رابط دعوتي من مجموعة محمد بن ذعار العجمي: ${member.inviteUrl || ""}`)}`} target="_blank" rel="noreferrer"><WhatsappLogo size={18} /> واتساب</a>
          </div>
        </section>


        <section className="owners-public-section">
          <h2>المكافآت المتاحة</h2>
          <div className="owners-public-rewards">
            {rewards.length ? rewards.map((reward: any) => (
              <article key={reward.id}>
                <Gift size={25} />
                <h3>{reward.name}</h3>
                <span className="owners-public-reward-type">{rewardTypeLabel(reward.reward_type)}</span>
                {reward.reward_value ? <div className="owners-public-reward-value">{reward.reward_value}</div> : null}
                <p>{reward.description || "راجع تفاصيل المكافأة قبل الاستبدال"}</p>
                <strong>{Number(reward.points_cost).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong>
                {Number(member.points) >= Number(reward.points_cost) ? <button disabled={busy} onClick={() => void redeem(reward)}>استبدال {Number(reward.points_cost).toLocaleString("ar-SA-u-nu-latn")} نقطة</button> : <button disabled>تحتاج {(Number(reward.points_cost) - Number(member.points)).toLocaleString("ar-SA-u-nu-latn")} نقطة إضافية</button>}
              </article>
            )) : <p>لا توجد مكافآت متاحة حاليًا.</p>}
          </div>
        </section>

        <section className="owners-public-section">
          <h2>رحلة دعوتك</h2>
          <div className="owners-referral-list">
            {referrals.length ? referrals.map((referral: any) => (
              <article key={referral.id}><div><strong>{referral.referred_name || "صديق من دعوتك"}</strong><span>{referralStatus(referral.status)}</span></div><small>{formatDate(referral.registered_at || referral.created_at)}</small></article>
            )) : <p>لا توجد دعوات مسجلة حتى الآن.</p>}
          </div>
        </section>

        {redemptions.length ? (
          <section className="owners-public-section">
            <h2>استبدالاتي</h2>
            <div className="owners-redemption-cards">
              {redemptions.map((redemption: any) => (
                <article className={`owners-redemption-card ${redemption.status === "approved" ? "ready" : redemption.status === "delivered" ? "done" : ""}`} key={redemption.id}>
                  <div className="owners-redemption-card-head"><div><strong>{redemption.reward_name}</strong><span>{redemptionStatus(redemption.status)}</span></div><small>{formatDate(redemption.created_at)}</small></div>
                  <p>{Number(redemption.points_cost || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة</p>
                  {redemption.status === "approved" && /^\d{8}$/.test(String(redemption.redemption_code || "")) ? (
                    <div className="owners-redemption-ready">
                      <RedemptionQr code={String(redemption.redemption_code)} size={176} />
                      <div><span>كود الاستبدال</span><strong className="owners-redemption-code" dir="ltr">{redemption.redemption_code}</strong><small>اعرض QR أو الكود للمندوب عند استلام المكافأة.</small></div>
                    </div>
                  ) : null}
                  {redemption.status === "delivered" ? <div className="owners-redemption-delivered"><strong>تم تسليم المكافأة</strong><span>{formatDate(redemption.reviewed_at)}{redemption.reviewed_by_name ? ` · ${redemption.reviewed_by_name}` : ""}</span></div> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="owners-public-section">
          <h2>كشف النقاط</h2>
          <div className="owners-ledger">
            {(me.ledger || []).map((entry: any) => (
              <article key={entry.id}><span>{entry.description || entry.event_type}</span><strong className={Number(entry.points) >= 0 ? "plus" : "minus"}>{Number(entry.points) >= 0 ? "+" : ""}{entry.points}</strong><small>{formatDate(entry.created_at)}</small></article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
