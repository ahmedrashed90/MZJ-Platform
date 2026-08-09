import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Crown,
  Gift,
  NotePencil,
  PaperPlaneTilt,
  ShareNetwork,
  UsersThree,
  Wallet,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { ownersAdminGet, ownersAdminPost } from "./api";

type Tab = "members" | "referrals" | "rewards" | "redemptions";

type RewardDraft = {
  id: string;
  name: string;
  description: string;
  rewardType: "gift" | "discount" | "service" | "voucher";
  pointsCost: number;
  stockQuantity: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const emptyReward: RewardDraft = {
  id: "",
  name: "",
  description: "",
  rewardType: "gift",
  pointsCost: 500,
  stockQuantity: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ العملية";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function toLocalDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function tierLabel(value: unknown) {
  const tier = String(value || "member");
  if (tier === "platinum") return "Platinum";
  if (tier === "gold") return "Gold";
  if (tier === "silver") return "Silver";
  return "Member";
}

function referralStatusLabel(value: unknown) {
  const status = String(value || "");
  if (status === "sold") return "تم البيع";
  if (status === "qualified") return "مؤهل";
  if (status === "registered") return "مسجل";
  if (status === "rejected") return "مرفوض";
  return "فتح الرابط";
}

export function OwnersCommunityPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "owners.community.manage");
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("members");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState<RewardDraft>(emptyReward);

  async function load() {
    setData(await ownersAdminGet());
  }

  useEffect(() => {
    void load().catch((error) => setMessage(errorMessage(error)));
  }, []);

  async function act(payload: Record<string, unknown>, successMessage = "تم تنفيذ العملية بنجاح") {
    setBusy(true);
    setMessage("");
    try {
      await ownersAdminPost(payload);
      await load();
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveReward() {
    const saved = await act({ action: "save_reward", ...reward }, reward.id ? "تم تحديث المكافأة" : "تمت إضافة المكافأة");
    if (saved) setReward(emptyReward);
  }

  function editReward(item: any) {
    setReward({
      id: item.id || "",
      name: item.name || "",
      description: item.description || "",
      rewardType: ["gift", "discount", "service", "voucher"].includes(item.reward_type) ? item.reward_type : "gift",
      pointsCost: Number(item.points_cost || 1),
      stockQuantity: item.stock_quantity == null ? "" : String(item.stock_quantity),
      startsAt: toLocalDateTime(item.starts_at),
      endsAt: toLocalDateTime(item.ends_at),
      isActive: item.is_active !== false,
    });
    setTab("rewards");
  }

  const stats = data?.stats || {};
  const members = Array.isArray(data?.members) ? data.members : [];
  const referrals = Array.isArray(data?.referrals) ? data.referrals : [];
  const rewards = Array.isArray(data?.rewards) ? data.rewards : [];
  const redemptions = Array.isArray(data?.redemptions) ? data.redemptions : [];
  const soldRate = useMemo(
    () => Number(stats.referrals || 0) ? Math.round(Number(stats.referral_sales || 0) * 100 / Number(stats.referrals || 1)) : 0,
    [stats.referrals, stats.referral_sales],
  );

  if (!data) return <div className="module-page"><div className="owners-panel owners-loading">جاري تحميل MZJ Owners Community...</div></div>;

  return (
    <div className="module-page owners-admin-page" dir="rtl">
      <header className="owners-hero">
        <div>
          <span className="owners-hero-icon"><Crown size={30} weight="duotone" /></span>
          <div>
            <h1>MZJ Owners Community</h1>
            <p>إدارة مجتمع ملاك MZJ، الدعوات، النقاط، المكافآت والمبيعات الناتجة من العملاء.</p>
          </div>
        </div>
        {canManage ? (
          <button className="owners-primary" disabled={busy} onClick={() => void act({ action: "sync_members" }, "تمت مزامنة المبيعات والدعوات") }>
            <ArrowsClockwise size={18} />{busy ? "جاري المزامنة..." : "مزامنة المبيعات والدعوات"}
          </button>
        ) : null}
      </header>

      {message ? <div className="owners-notice">{message}</div> : null}

      <section className="owners-stat-grid">
        <article><UsersThree size={24} /><div><span>الأعضاء</span><strong>{Number(stats.members || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><ShareNetwork size={24} /><div><span>الدعوات المسجلة</span><strong>{Number(stats.referrals || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><CheckCircle size={24} /><div><span>مبيعات من الدعوات</span><strong>{Number(stats.referral_sales || 0).toLocaleString("ar-SA-u-nu-latn")} <small>{soldRate}%</small></strong></div></article>
        <article><Wallet size={24} /><div><span>النقاط القائمة</span><strong>{Number(stats.outstanding_points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><Gift size={24} /><div><span>استبدالات تنتظر المراجعة</span><strong>{Number(stats.pending_redemptions || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
      </section>

      <nav className="owners-tabs">
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>الأعضاء</button>
        <button className={tab === "referrals" ? "active" : ""} onClick={() => setTab("referrals")}>الدعوات</button>
        <button className={tab === "rewards" ? "active" : ""} onClick={() => setTab("rewards")}>المكافآت</button>
        <button className={tab === "redemptions" ? "active" : ""} onClick={() => setTab("redemptions")}>طلبات الاستبدال</button>
      </nav>

      {tab === "members" ? (
        <section className="owners-table-card">
          <header><h2>أعضاء MZJ Owners Community</h2><span>{members.length} عضو ظاهر</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>الجوال</th><th>كود الدعوة</th><th>المستوى</th><th>النقاط</th><th>الدعوات</th><th>المبيعات</th><th>آخر شراء</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {members.map((member: any) => (
                  <tr key={member.id}>
                    <td><strong>{member.customer_name || "عميل MZJ"}</strong></td>
                    <td>{member.phone_normalized}</td>
                    <td><code>{member.referral_code}</code></td>
                    <td>{tierLabel(member.tier_code)}</td>
                    <td>{Number(member.points_balance || 0).toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{member.referrals_count || 0}</td>
                    <td>{member.sales_count || 0}</td>
                    <td>{formatDate(member.last_sale_at)}</td>
                    <td>
                      {canManage ? (
                        <button className="owners-link-btn" disabled={busy} onClick={() => void act({ action: "send_welcome", memberId: member.id }, "تمت إضافة رسالة الترحيب إلى مسار مرسال") }>
                          <PaperPlaneTilt size={16} /> إرسال الترحيب
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "referrals" ? (
        <section className="owners-table-card">
          <header><h2>رحلة الدعوات</h2><span>مرتبطة بالـCRM والمبيعات</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>صاحب الدعوة</th><th>الصديق</th><th>الجوال</th><th>الحالة</th><th>التسجيل</th><th>التأهيل</th><th>البيع</th></tr></thead>
              <tbody>
                {referrals.map((referral: any) => (
                  <tr key={referral.id}>
                    <td>{referral.referrer_name}<small className="owners-sub">{referral.referral_code}</small></td>
                    <td>{referral.referred_name || "—"}</td>
                    <td>{referral.referred_phone_normalized || "—"}</td>
                    <td><span className={`owners-status ${referral.status}`}>{referralStatusLabel(referral.status)}</span></td>
                    <td>{formatDate(referral.registered_at)}</td>
                    <td>{formatDate(referral.qualified_at)}</td>
                    <td>{formatDate(referral.sold_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "rewards" ? (
        <>
          <section className="owners-table-card">
            <header><h2>كتالوج المكافآت</h2><span>يمكن تغيير المكافآت بدون تغيير أرصدة العملاء</span></header>
            <div className="owners-rewards-grid">
              {rewards.map((item: any) => (
                <article key={item.id}>
                  <Gift size={24} />
                  <strong>{item.name}</strong>
                  <p>{item.description || "مكافأة لأعضاء المجتمع"}</p>
                  <b>{Number(item.points_cost).toLocaleString("ar-SA-u-nu-latn")} نقطة</b>
                  <small>{item.stock_quantity == null ? "كمية مفتوحة" : `المتبقي ${Math.max(0, Number(item.stock_quantity) - Number(item.redeemed_quantity || 0))}`}</small>
                  <small>{item.is_active ? "مفعلة" : "متوقفة"}</small>
                  {canManage ? <button className="owners-link-btn" onClick={() => editReward(item)}><NotePencil size={16} /> تعديل</button> : null}
                </article>
              ))}
            </div>
          </section>

          {canManage ? (
            <section className="owners-table-card owners-reward-editor">
              <header><h2>{reward.id ? "تعديل المكافأة" : "إضافة مكافأة جديدة"}</h2>{reward.id ? <button className="owners-link-btn" onClick={() => setReward(emptyReward)}>إلغاء التعديل</button> : null}</header>
              <div className="owners-form-grid">
                <label><span>اسم المكافأة</span><input value={reward.name} onChange={(event) => setReward({ ...reward, name: event.target.value })} /></label>
                <label><span>نوع المكافأة</span><select value={reward.rewardType} onChange={(event) => setReward({ ...reward, rewardType: event.target.value as RewardDraft["rewardType"] })}><option value="gift">هدية</option><option value="discount">خصم</option><option value="service">خدمة</option><option value="voucher">قسيمة</option></select></label>
                <label><span>النقاط المطلوبة</span><input type="number" min="1" value={reward.pointsCost} onChange={(event) => setReward({ ...reward, pointsCost: Number(event.target.value) })} /></label>
                <label><span>الكمية المتاحة</span><input type="number" min="0" placeholder="اتركها فارغة لكمية مفتوحة" value={reward.stockQuantity} onChange={(event) => setReward({ ...reward, stockQuantity: event.target.value })} /></label>
                <label><span>تبدأ في</span><input type="datetime-local" value={reward.startsAt} onChange={(event) => setReward({ ...reward, startsAt: event.target.value })} /></label>
                <label><span>تنتهي في</span><input type="datetime-local" value={reward.endsAt} onChange={(event) => setReward({ ...reward, endsAt: event.target.value })} /></label>
                <label><span>الحالة</span><select value={reward.isActive ? "on" : "off"} onChange={(event) => setReward({ ...reward, isActive: event.target.value === "on" })}><option value="on">مفعلة</option><option value="off">متوقفة</option></select></label>
                <label className="wide"><span>الوصف</span><textarea value={reward.description} onChange={(event) => setReward({ ...reward, description: event.target.value })} /></label>
              </div>
              <button className="owners-primary" disabled={busy || !reward.name.trim()} onClick={() => void saveReward()}><Gift size={18} />{reward.id ? "حفظ التعديل" : "إضافة المكافأة"}</button>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "redemptions" ? (
        <section className="owners-table-card">
          <header><h2>طلبات استبدال النقاط</h2><span>الموافقة والتسليم بسجل واضح</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>المكافأة</th><th>النقاط</th><th>الحالة</th><th>تاريخ الطلب</th><th>الإجراء</th></tr></thead>
              <tbody>
                {redemptions.map((redemption: any) => (
                  <tr key={redemption.id}>
                    <td>{redemption.customer_name}<small className="owners-sub">{redemption.phone_normalized}</small></td>
                    <td>{redemption.reward_name}</td>
                    <td>{redemption.points_cost}</td>
                    <td>{redemption.status}</td>
                    <td>{formatDate(redemption.created_at)}</td>
                    <td>
                      {canManage && redemption.status === "requested" ? (
                        <div className="owners-actions">
                          <button disabled={busy} onClick={() => void act({ action: "redemption", id: redemption.id, status: "approved" }, "تم اعتماد طلب الاستبدال")}>اعتماد</button>
                          <button disabled={busy} onClick={() => void act({ action: "redemption", id: redemption.id, status: "rejected" }, "تم رفض الطلب وإرجاع النقاط")}>رفض</button>
                        </div>
                      ) : canManage && redemption.status === "approved" ? (
                        <button className="owners-link-btn" disabled={busy} onClick={() => void act({ action: "redemption", id: redemption.id, status: "delivered" }, "تم تسجيل تسليم المكافأة")}>تم التسليم</button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
