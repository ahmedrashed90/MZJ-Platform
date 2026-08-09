import { useEffect, useState } from "react";
import { Copy, Gift, ShareNetwork, SignOut, Star, WhatsappLogo } from "@phosphor-icons/react";
import { ownersPublicGet, ownersPublicPost } from "./api";

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

function referralStatus(value: unknown) {
  const status = String(value || "");
  if (status === "sold") return "تم البيع";
  if (status === "qualified") return "مؤهل";
  if (status === "registered") return "تم التسجيل";
  if (status === "rejected") return "مرفوض";
  return "فتح الرابط";
}

export function OwnersPortalPage() {
  const [me, setMe] = useState<any>(null);
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
      setMessage("تم إرسال رمز التحقق إلى واتساب");
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
          <h1>مجتمع ملاك MZJ</h1>
          <p>ادخل برقم الجوال المسجل في عملية الشراء. سنرسل لك رمز تحقق عبر واتساب من خلال قالب مرسال المعتمد.</p>
          {message ? <div className="owners-public-message">{message}</div> : null}
          {stage === "phone" ? (
            <>
              <label><span>رقم الجوال</span><input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xxxxxxxx" /></label>
              <button disabled={busy} onClick={() => void requestOtp()}><WhatsappLogo size={20} />{busy ? "جاري الإرسال..." : "إرسال رمز التحقق"}</button>
            </>
          ) : (
            <>
              <label><span>رمز التحقق</span><input inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></label>
              <button disabled={busy || code.length !== 6} onClick={() => void verifyOtp()}>{busy ? "جاري التحقق..." : "دخول الحساب"}</button>
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

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(member.inviteUrl);
      setMessage("تم نسخ رابط دعوتك");
    } catch {
      setMessage("تعذر النسخ التلقائي. انسخ الرابط من الحقل مباشرة.");
    }
  }

  async function redeem(rewardId: string) {
    setBusy(true);
    setMessage("");
    try {
      await ownersPublicPost({ action: "redeem", rewardId });
      await load();
      setMessage("تم إرسال طلب الاستبدال");
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
        <section className="owners-member-card">
          <div><span>رصيدك الحالي</span><strong>{Number(member.points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong><small>نقطة</small></div>
          <div><span>مستوى العضوية</span><b><Star size={18} weight="fill" /> {tierLabel(member.tier)}</b><small>{Number(member.lifetimePoints || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة مكتسبة</small></div>
        </section>

        <section className="owners-invite-card">
          <div><ShareNetwork size={28} /><div><h2>شارك MZJ مع أصحابك</h2><p>كل صديق جديد يفتح الرابط أو يسجل أو يتأهل أو يشتري يضيف نقاطًا حسب إعدادات البرنامج.</p></div></div>
          <div className="owners-invite-link">
            <input readOnly value={member.inviteUrl || ""} />
            <button onClick={() => void copyInvite()}><Copy size={18} /> نسخ</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`ميزة خاصة من MZJ عبر رابط دعوتي: ${member.inviteUrl || ""}`)}`} target="_blank" rel="noreferrer"><WhatsappLogo size={18} /> واتساب</a>
          </div>
        </section>

        <section className="owners-public-stats">
          <article><strong>{referrals.length}</strong><span>أصدقاء مسجلون</span></article>
          <article><strong>{referrals.filter((referral: any) => referral.status === "qualified" || referral.status === "sold").length}</strong><span>عملاء مؤهلون</span></article>
          <article><strong>{referrals.filter((referral: any) => referral.status === "sold").length}</strong><span>مبيعات ناجحة</span></article>
        </section>

        <section className="owners-public-section">
          <h2>المكافآت المتاحة</h2>
          <div className="owners-public-rewards">
            {rewards.length ? rewards.map((reward: any) => (
              <article key={reward.id}>
                <Gift size={25} />
                <h3>{reward.name}</h3>
                <p>{reward.description || "مكافأة لأعضاء MZJ Owners Community"}</p>
                <strong>{Number(reward.points_cost).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong>
                <button disabled={busy || Number(member.points) < Number(reward.points_cost)} onClick={() => void redeem(reward.id)}>استبدال النقاط</button>
              </article>
            )) : <p>لا توجد مكافآت متاحة حاليًا.</p>}
          </div>
        </section>

        <section className="owners-public-section">
          <h2>رحلة دعوتك</h2>
          <div className="owners-referral-list">
            {referrals.length ? referrals.map((referral: any) => (
              <article key={referral.id}><div><strong>{referral.referred_name || "صديق من دعوتك"}</strong><span>{referralStatus(referral.status)}</span></div><small>{formatDate(referral.registered_at || referral.created_at)}</small></article>
            )) : <p>لسه مفيش دعوات مسجلة. شارك رابطك وابدأ تجمع نقاط.</p>}
          </div>
        </section>

        {redemptions.length ? (
          <section className="owners-public-section">
            <h2>طلبات الاستبدال</h2>
            <div className="owners-referral-list">
              {redemptions.map((redemption: any) => <article key={redemption.id}><div><strong>{redemption.reward_name}</strong><span>{redemption.status}</span></div><small>{formatDate(redemption.created_at)}</small></article>)}
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
