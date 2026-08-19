import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Crown,
  FileXls,
  Gift,
  NotePencil,
  PaperPlaneTilt,
  ShareNetwork,
  Trash,
  UserPlus,
  UsersThree,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { ownersAdminGet, ownersAdminPost } from "./api";
import { readXlsx } from "../crm/xlsxReader";

type Tab = "members" | "legacy" | "import" | "referrals" | "points" | "rewards" | "redemptions";
type RewardsView = "catalog" | "memberCard";
type MembersView = "all" | "points";
type ReferralsView = "all" | "sold";
type RedemptionsView = "all" | "ready";


type ImportMapping = { name: string; phone: string; purchaseDate: string; vehicle: string; branch: string; orderId: string };
const emptyMapping: ImportMapping = { name: "", phone: "", purchaseDate: "", vehicle: "", branch: "", orderId: "" };

function normalizedHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, "");
}

function guessHeader(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizedHeader);
  return headers.find((header) => normalizedAliases.includes(normalizedHeader(header))) || "";
}

type RewardDraft = {
  id: string;
  name: string;
  description: string;
  rewardType: "gift" | "discount" | "service" | "voucher";
  rewardValue: string;
  showOnMemberCard: boolean;
  availableForReferralPurchase: boolean;
  availableForExistingCustomerPurchase: boolean;
  checkoutDiscountType: "amount" | "percentage";
  checkoutDiscountValue: string;
  pointsCost: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

type PointsDraft = {
  pointsPurchaseEnabled: boolean;
  pointsPurchase: number;
  pointsUniqueOpenEnabled: boolean;
  pointsUniqueOpen: number;
  pointsRegistrationEnabled: boolean;
  pointsRegistration: number;
  pointsQualifiedEnabled: boolean;
  pointsQualified: number;
  pointsSaleEnabled: boolean;
  pointsSale: number;
  dailyOpenPointsCap: number;
};

const emptyPointsDraft: PointsDraft = {
  pointsPurchaseEnabled: false,
  pointsPurchase: 500,
  pointsUniqueOpenEnabled: true,
  pointsUniqueOpen: 1,
  pointsRegistrationEnabled: true,
  pointsRegistration: 10,
  pointsQualifiedEnabled: true,
  pointsQualified: 25,
  pointsSaleEnabled: true,
  pointsSale: 500,
  dailyOpenPointsCap: 25,
};

function pointsDraftFromSettings(settings: any): PointsDraft {
  return {
    pointsPurchaseEnabled: settings?.points_purchase_enabled === true,
    pointsPurchase: Number(settings?.points_purchase ?? 500),
    pointsUniqueOpenEnabled: settings?.points_unique_open_enabled !== false,
    pointsUniqueOpen: Number(settings?.points_unique_open ?? 1),
    pointsRegistrationEnabled: settings?.points_registration_enabled !== false,
    pointsRegistration: Number(settings?.points_registration ?? 10),
    pointsQualifiedEnabled: settings?.points_qualified_enabled !== false,
    pointsQualified: Number(settings?.points_qualified ?? 25),
    pointsSaleEnabled: settings?.points_sale_enabled !== false,
    pointsSale: Number(settings?.points_sale ?? 500),
    dailyOpenPointsCap: Number(settings?.daily_open_points_cap ?? 25),
  };
}

const emptyReward: RewardDraft = {
  id: "",
  name: "",
  description: "",
  rewardType: "gift",
  rewardValue: "",
  showOnMemberCard: false,
  availableForReferralPurchase: false,
  availableForExistingCustomerPurchase: false,
  checkoutDiscountType: "amount",
  checkoutDiscountValue: "",
  pointsCost: 500,
  startsAt: "",
  endsAt: "",
  isActive: true,
};


function rewardTypeLabel(value: RewardDraft["rewardType"] | string) {
  if (value === "discount") return "خصم";
  if (value === "service") return "خدمة";
  if (value === "voucher") return "قسيمة";
  return "هدية";
}

function rewardValueLabel(value: RewardDraft["rewardType"]) {
  if (value === "discount") return "قيمة الخصم";
  if (value === "service") return "نوع الخدمة";
  if (value === "voucher") return "تفاصيل القسيمة";
  return "تفاصيل الهدية";
}

function rewardValuePlaceholder(value: RewardDraft["rewardType"]) {
  if (value === "discount") return "مثال: 15% أو 500 ريال";
  if (value === "service") return "مثال: تغيير زيت مجاني";
  if (value === "voucher") return "مثال: قسيمة صيانة بقيمة 300 ريال";
  return "مثال: حقيبة سفر أو عازل حراري";
}

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

function redemptionStatusLabel(value: unknown) {
  const status = String(value || "");
  if (status === "approved") return "جاهز للاستبدال";
  if (status === "delivered") return "تم الاستبدال";
  if (status === "requested") return "طلب قديم بانتظار المراجعة";
  if (status === "rejected") return "مرفوض";
  if (status === "cancelled") return "ملغي";
  return status || "—";
}

export function OwnersCommunityPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "owners.community.manage");
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("members");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState<RewardDraft>(emptyReward);
  const [pointsDraft, setPointsDraft] = useState<PointsDraft>(emptyPointsDraft);
  const [rewardsView, setRewardsView] = useState<RewardsView>("catalog");
  const [testMember, setTestMember] = useState({ name: "", phone: "" });
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping);
  const [importSummary, setImportSummary] = useState<any>(null);
  const [rewardUsage, setRewardUsage] = useState<any>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [membersView, setMembersView] = useState<MembersView>("all");
  const [referralsView, setReferralsView] = useState<ReferralsView>("all");
  const [redemptionsView, setRedemptionsView] = useState<RedemptionsView>("all");
  const [initialLoading, setInitialLoading] = useState(true);

  async function load() {
    const next = await ownersAdminGet();
    setData(next);
    setPointsDraft(pointsDraftFromSettings(next?.settings));
  }

  useEffect(() => {
    void load()
      .catch((error) => setMessage(errorMessage(error)))
      .finally(() => setInitialLoading(false));
  }, []);

  async function retryInitialLoad() {
    setInitialLoading(true);
    setMessage("");
    try {
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setInitialLoading(false);
    }
  }

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

  async function savePointsSettings() {
    await act({ action: "save_points_settings", ...pointsDraft }, "تم حفظ إعدادات النقاط وتحديث أرصدة العملاء");
  }

  function setPointValue(key: keyof PointsDraft, value: string) {
    setPointsDraft((current) => ({ ...current, [key]: Number(value) }));
  }

  async function deleteReward(item: any) {
    if (!window.confirm(`هل تريد حذف المكافأة «${item.name || ""}»؟`)) return;
    const deleted = await act({ action: "delete_reward", id: item.id }, "تم حذف المكافأة");
    if (deleted && reward.id === item.id) setReward(emptyReward);
  }

  async function openRewardUsage(item: any) {
    setUsageBusy(true);
    setMessage("");
    try {
      const usage = await ownersAdminPost({ action: "reward_usage", id: item.id });
      setRewardUsage(usage);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setUsageBusy(false);
    }
  }

  async function createTestMember() {
    const ok = await act({ action: "create_test_member", ...testMember }, "تمت إضافة العضو التجريبي");
    if (ok) setTestMember({ name: "", phone: "" });
  }

  async function loadImportFile(file: File | null) {
    if (!file) return;
    setMessage("");
    setImportSummary(null);
    try {
      const rows = await readXlsx(file);
      if (!rows.length) throw new Error("ملف Excel لا يحتوي على بيانات");
      const headers = Object.keys(rows[0]);
      setImportRows(rows);
      setImportFileName(file.name);
      setMapping({
        name: guessHeader(headers, ["الاسم", "اسم العميل", "العميل", "name", "customer name", "customer_name"]),
        phone: guessHeader(headers, ["الجوال", "رقم الجوال", "الهاتف", "الموبايل", "phone", "mobile", "phone_number"]),
        purchaseDate: guessHeader(headers, ["تاريخ الشراء", "تاريخ البيع", "purchase date", "sale date", "sold date"]),
        vehicle: guessHeader(headers, ["السيارة", "اسم السيارة", "الموديل", "vehicle", "car", "model"]),
        branch: guessHeader(headers, ["الفرع", "branch"]),
        orderId: guessHeader(headers, ["رقم الطلب", "طلب البيع", "order id", "order", "sales order"]),
      });
    } catch (error) {
      setImportRows([]);
      setImportFileName("");
      setMessage(errorMessage(error));
    }
  }

  async function importMembers() {
    if (!mapping.name || !mapping.phone) { setMessage("حدد عمود اسم العميل وعمود رقم الجوال أولًا"); return; }
    const mapped = importRows.map((row) => ({
      name: row[mapping.name] || "", phone: row[mapping.phone] || "",
      purchaseDate: mapping.purchaseDate ? row[mapping.purchaseDate] || "" : "",
      vehicle: mapping.vehicle ? row[mapping.vehicle] || "" : "",
      branch: mapping.branch ? row[mapping.branch] || "" : "",
      orderId: mapping.orderId ? row[mapping.orderId] || "" : "",
    }));
    setBusy(true); setMessage(""); setImportSummary(null);
    const total = { total: mapped.length, created: 0, matched: 0, duplicates: 0, invalid: 0 };
    try {
      for (let index = 0; index < mapped.length; index += 400) {
        const result = await ownersAdminPost({ action: "import_members", rows: mapped.slice(index, index + 400) });
        for (const key of ["created", "matched", "duplicates", "invalid"] as const) total[key] += Number(result.summary?.[key] || 0);
      }
      setImportSummary(total);
      await load();
      setMessage("اكتمل الاستيراد وتمت إضافة العملاء ضمن عملاء تم البيع");
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }

  function openTab(next: Tab) {
    setTab(next);
    if (next === "members") setMembersView("all");
    if (next === "referrals") setReferralsView("all");
    if (next === "redemptions") setRedemptionsView("all");
  }

  function openMembersPoints() {
    setMembersView("points");
    setTab("members");
  }

  function openSoldReferrals() {
    setReferralsView("sold");
    setTab("referrals");
  }

  function openReadyRedemptions() {
    setRedemptionsView("ready");
    setTab("redemptions");
  }

  function editReward(item: any) {
    setReward({
      id: item.id || "",
      name: item.name || "",
      description: item.description || "",
      rewardType: ["gift", "discount", "service", "voucher"].includes(item.reward_type) ? item.reward_type : "gift",
      rewardValue: item.reward_value || "",
      showOnMemberCard: item.show_on_member_card === true,
      availableForReferralPurchase: item.available_for_referral_purchase === true,
      availableForExistingCustomerPurchase: item.available_for_existing_customer_purchase === true,
      checkoutDiscountType: item.checkout_discount_type === "percentage" ? "percentage" : "amount",
      checkoutDiscountValue: Number(item.checkout_discount_value || item.checkout_discount_amount || 0) > 0 ? String(item.checkout_discount_value || item.checkout_discount_amount) : "",
      pointsCost: Number(item.points_cost || 1),
      startsAt: toLocalDateTime(item.starts_at),
      endsAt: toLocalDateTime(item.ends_at),
      isActive: item.is_active !== false,
    });
    setTab("rewards");
  }

  const stats = data?.stats || {};
  const members = Array.isArray(data?.members) ? data.members : [];
  const legacyCustomers = Array.isArray(data?.legacyCustomers) ? data.legacyCustomers : [];
  const referrals = Array.isArray(data?.referrals) ? data.referrals : [];
  const rewards = Array.isArray(data?.rewards) ? data.rewards : [];
  const redemptions = Array.isArray(data?.redemptions) ? data.redemptions : [];
  const importHeaders = importRows.length ? Object.keys(importRows[0]) : [];
  const testMembersCount = members.filter((member: any) => member.member_kind === "test").length;
  const visibleMembers = membersView === "points"
    ? members
        .filter((member: any) => member.member_kind !== "test" && Number(member.points_balance || 0) > 0)
        .slice()
        .sort((left: any, right: any) => Number(right.points_balance || 0) - Number(left.points_balance || 0))
    : members;
  const visibleReferrals = referralsView === "sold" ? referrals.filter((referral: any) => referral.status === "sold") : referrals;
  const visibleRedemptions = redemptionsView === "ready" ? redemptions.filter((redemption: any) => redemption.status === "approved") : redemptions;
  const soldRate = useMemo(
    () => Number(stats.referrals || 0) ? Math.round(Number(stats.referral_sales || 0) * 100 / Number(stats.referrals || 1)) : 0,
    [stats.referrals, stats.referral_sales],
  );

  if (!data) {
    return (
      <div className="module-page">
        <div className="owners-panel owners-loading">
          {initialLoading ? (
            "جاري تحميل MZJ Owners Community..."
          ) : (
            <>
              <strong>تعذر تحميل MZJ Owners Community</strong>
              <span>{message || "تعذر تحميل البيانات. حاول مرة أخرى."}</span>
              <button type="button" className="owners-link-btn" onClick={() => void retryInitialLoad()}>
                <ArrowsClockwise size={16} /> إعادة المحاولة
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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
        <button type="button" className="owners-stat-card" onClick={() => openTab("members")}><UsersThree size={24} /><div><span>عملاء تم البيع</span><strong>{Number(stats.members || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></button>
        <button type="button" className="owners-stat-card" onClick={() => openTab("legacy")}><UsersThree size={24} /><div><span>العملاء الجديدة</span><strong>{Number(stats.legacy_customers || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></button>
        <button type="button" className="owners-stat-card" onClick={() => openTab("referrals")}><ShareNetwork size={24} /><div><span>الدعوات المسجلة</span><strong>{Number(stats.referrals || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></button>
        <button type="button" className="owners-stat-card" onClick={openSoldReferrals}><CheckCircle size={24} /><div><span>مبيعات من الدعوات</span><strong>{Number(stats.referral_sales || 0).toLocaleString("ar-SA-u-nu-latn")} <small>{soldRate}%</small></strong></div></button>
        <button type="button" className="owners-stat-card" onClick={openMembersPoints}><Wallet size={24} /><div><span>النقاط القائمة</span><strong>{Number(stats.outstanding_points || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></button>
        <button type="button" className="owners-stat-card" onClick={openReadyRedemptions}><Gift size={24} /><div><span>استبدالات جاهزة للتسليم</span><strong>{Number(stats.ready_redemptions || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></button>
      </section>

      <nav className="owners-tabs">
        <button className={tab === "members" ? "active" : ""} onClick={() => openTab("members")}>عملاء تم البيع</button>
        <button className={tab === "legacy" ? "active" : ""} onClick={() => openTab("legacy")}>العملاء الجديدة</button>
        {canManage ? <button className={tab === "import" ? "active" : ""} onClick={() => openTab("import")}>استيراد العملاء السابقين</button> : null}
        <button className={tab === "referrals" ? "active" : ""} onClick={() => openTab("referrals")}>الدعوات</button>
        {canManage ? <button className={tab === "points" ? "active" : ""} onClick={() => openTab("points")}>إعدادات النقاط</button> : null}
        <button className={tab === "rewards" ? "active" : ""} onClick={() => openTab("rewards")}>المكافآت</button>
        <button className={tab === "redemptions" ? "active" : ""} onClick={() => openTab("redemptions")}>طلبات الاستبدال</button>
      </nav>

      {tab === "members" ? (
        <>
          {canManage && membersView === "all" ? (
            <section className="owners-table-card owners-test-member-card">
              <header><div><h2>إضافة عضو تجريبي</h2><span>للاختبار فقط — لا يدخل في أرقام وتقارير البرنامج الفعلية ولا ينشئ Lead في CRM عند تجربة رابط الدعوة.</span></div></header>
              <div className="owners-inline-form">
                <label><span>اسم العضو التجريبي</span><input value={testMember.name} onChange={(event) => setTestMember({ ...testMember, name: event.target.value })} placeholder="اكتب اسم العضو" /></label>
                <label><span>رقم الجوال</span><input value={testMember.phone} onChange={(event) => setTestMember({ ...testMember, phone: event.target.value })} placeholder="05xxxxxxxx" dir="ltr" /></label>
                <button className="owners-primary" disabled={busy || !testMember.name.trim() || !testMember.phone.trim()} onClick={() => void createTestMember()}><UserPlus size={18} /> إضافة عضو تجريبي</button>
              </div>
            </section>
          ) : null}
          <section className="owners-table-card">
            <header><h2>{membersView === "points" ? "تفاصيل النقاط القائمة" : "عملاء تم البيع"}</h2><span>{membersView === "points" ? `إجمالي الرصيد المتاح ${Number(stats.outstanding_points || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة` : `تم البيع · ${members.length - testMembersCount} حقيقي · ${testMembersCount} تجريبي`}</span></header>
            <div className="owners-table-wrap">
              <table>
                <thead><tr><th>العميل</th><th>النوع</th><th>الجوال</th><th>كود الدعوة</th><th>المستوى</th><th>النقاط</th><th>الدعوات</th><th>المبيعات</th><th>آخر شراء</th><th>حالة الترحيب</th><th>الإجراءات</th></tr></thead>
                <tbody>
                  {visibleMembers.map((member: any) => (
                    <tr key={member.id}>
                      <td><strong>{member.customer_name || "عميل MZJ"}</strong></td>
                      <td><span className={`owners-member-type ${member.member_kind === "test" ? "test" : member.is_special_customer ? "special" : "real"}`}>{member.member_kind === "test" ? "تجريبي" : member.is_special_customer ? "عميل مميز" : member.enrollment_source?.startsWith("excel_import") ? "مستورد" : "حقيقي"}</span></td>
                      <td>{member.phone_normalized}</td>
                      <td><code>{member.referral_code}</code></td>
                      <td>{tierLabel(member.tier_code)}</td>
                      <td>{Number(member.points_balance || 0).toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td>{member.referrals_count || 0}</td>
                      <td>{member.sales_count || 0}</td>
                      <td>{formatDate(member.last_sale_at)}</td>
                      <td><span className={`owners-welcome-status ${member.welcome_sent_at ? "sent" : "pending"}`}>{member.welcome_sent_at ? "تم الإرسال" : "لم يتم الإرسال"}</span></td>
                      <td>
                        {canManage ? (
                          <div className="owners-actions">
                            <button className="owners-link-btn" disabled={busy || Boolean(member.welcome_sent_at)} onClick={() => void act({ action: "send_welcome", memberId: member.id }, "تمت إضافة رسالة الترحيب إلى SMS+") }><PaperPlaneTilt size={16} /> {member.welcome_sent_at ? "تم الإرسال" : "إرسال الترحيب"}</button>
                            <button className="owners-link-btn danger" disabled={busy} onClick={() => window.confirm(`هل تريد حذف العميل «${member.customer_name || "عميل MZJ"}» من Owners Community؟`) && void act({ action: "delete_member", memberId: member.id }, "تم حذف العميل") }><Trash size={16} /> مسح</button>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                {!visibleMembers.length ? <tr><td colSpan={11}>{membersView === "points" ? "لا توجد أرصدة نقاط قائمة." : "لا يوجد عملاء تم البيع لهم."}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "legacy" ? (
        <section className="owners-table-card">
          <header><h2>العملاء الجديدة</h2><span>عملاء CRM الذين لم يتم البيع لهم · {legacyCustomers.length.toLocaleString("ar-SA-u-nu-latn")}</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>الجوال</th><th>كود الدعوة</th><th>الحالة</th><th>الفرع</th><th>المصدر</th><th>القسم</th><th>المسؤول</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead>
              <tbody>
                {legacyCustomers.map((customer: any) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.customer_name || "عميل MZJ"}</strong></td>
                    <td>{customer.phone_normalized || "—"}</td>
                    <td><code>{customer.referral_code}</code></td>
                    <td>{customer.status_label || "عميل جديد"}</td>
                    <td>{customer.branch_name || customer.branch_code || "—"}</td>
                    <td>{customer.catalog_source_name || customer.source_name || customer.source_code || "—"}</td>
                    <td>{customer.department_code === "cash_sales" ? "مبيعات الكاش" : customer.department_code === "finance_sales" ? "مبيعات التمويل" : customer.department_code === "customer_service" ? "خدمة العملاء" : customer.department_code || "—"}</td>
                    <td>{customer.assigned_name || "—"}</td>
                    <td>{formatDate(customer.registered_at || customer.created_at)}</td>
                    <td>{formatDate(customer.updated_at)}</td>
                  </tr>
                ))}
                {!legacyCustomers.length ? <tr><td colSpan={10}>لا يوجد عملاء جديدة في CRM حاليًا.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "import" && canManage ? (
        <section className="owners-table-card owners-import-card">
          <header><div><h2>استيراد العملاء السابقين من Excel</h2><span>يتم منع التكرار برقم الجوال، ويظهر العميل المستورد ضمن «عملاء تم البيع» مع مطابقة المبيعات الحالية عند وجود تطابق.</span></div></header>
          <div className="owners-import-upload">
            <FileXls size={32} />
            <div><strong>{importFileName || "اختر ملف Excel بصيغة .xlsx"}</strong><span>الصف الأول يجب أن يحتوي على أسماء الأعمدة. الحد الأقصى 20MB.</span></div>
            <label className="owners-primary"><FileXls size={18} /> اختيار الملف<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void loadImportFile(event.target.files?.[0] || null)} /></label>
          </div>
          {importRows.length ? (
            <>
              <div className="owners-form-grid">
                {([
                  ["name", "اسم العميل *"], ["phone", "رقم الجوال *"], ["purchaseDate", "تاريخ الشراء"],
                  ["vehicle", "السيارة"], ["branch", "الفرع"], ["orderId", "رقم الطلب"],
                ] as Array<[keyof ImportMapping, string]>).map(([key, label]) => (
                  <label key={key}><span>{label}</span><select value={mapping[key]} onChange={(event) => setMapping({ ...mapping, [key]: event.target.value })}><option value="">غير محدد</option>{importHeaders.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
                ))}
              </div>
              <div className="owners-import-preview">
                <strong>معاينة أول {Math.min(5, importRows.length)} من {importRows.length} صف</strong>
                <div className="owners-table-wrap"><table><thead><tr><th>الاسم</th><th>الجوال</th><th>تاريخ الشراء</th><th>السيارة</th><th>الفرع</th><th>رقم الطلب</th></tr></thead><tbody>{importRows.slice(0,5).map((row,index)=><tr key={index}><td>{mapping.name ? row[mapping.name] : "—"}</td><td>{mapping.phone ? row[mapping.phone] : "—"}</td><td>{mapping.purchaseDate ? row[mapping.purchaseDate] : "—"}</td><td>{mapping.vehicle ? row[mapping.vehicle] : "—"}</td><td>{mapping.branch ? row[mapping.branch] : "—"}</td><td>{mapping.orderId ? row[mapping.orderId] : "—"}</td></tr>)}</tbody></table></div>
              </div>
              {importSummary ? <div className="owners-import-summary"><span>إجمالي <b>{importSummary.total}</b></span><span>جديد <b>{importSummary.created}</b></span><span>طابق المبيعات <b>{importSummary.matched}</b></span><span>مكرر <b>{importSummary.duplicates}</b></span><span>غير صالح <b>{importSummary.invalid}</b></span></div> : null}
              <div className="owners-save-row"><button className="owners-primary" disabled={busy || !mapping.name || !mapping.phone} onClick={() => void importMembers()}><FileXls size={18} />{busy ? "جاري الاستيراد..." : `استيراد ${importRows.length} عميل`}</button></div>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === "referrals" ? (
        <section className="owners-table-card">
          <header><h2>{referralsView === "sold" ? "مبيعات من الدعوات" : "رحلة الدعوات"}</h2><span>{referralsView === "sold" ? `${visibleReferrals.length.toLocaleString("ar-SA-u-nu-latn")} دعوة تحولت إلى بيع` : "مرتبطة بالـCRM والمبيعات"}</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>صاحب الدعوة</th><th>الصديق</th><th>الجوال</th><th>الحالة</th><th>التسجيل</th><th>التأهيل</th><th>البيع</th></tr></thead>
              <tbody>
                {visibleReferrals.map((referral: any) => (
                  <tr key={referral.id}>
                    <td>{referral.referrer_name}{referral.referrer_member_kind === "test" ? <span className="owners-member-type test">تجريبي</span> : null}<small className="owners-sub">{referral.referral_code}</small></td>
                    <td>{referral.referred_name || "—"}</td>
                    <td>{referral.referred_phone_normalized || "—"}</td>
                    <td><span className={`owners-status ${referral.status}`}>{referralStatusLabel(referral.status)}</span></td>
                    <td>{formatDate(referral.registered_at)}</td>
                    <td>{formatDate(referral.qualified_at)}</td>
                    <td>{formatDate(referral.sold_at)}</td>
                  </tr>
                ))}
              {!visibleReferrals.length ? <tr><td colSpan={7}>{referralsView === "sold" ? "لا توجد مبيعات من الدعوات." : "لا توجد دعوات مسجلة."}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "points" && canManage ? (
        <section className="owners-table-card owners-points-settings-card">
          <header><div><h2>إعدادات النقاط</h2><span>تحكم في نقاط الشراء والدعوات. تفعيل نقاط الشراء يضيفها للعملاء المشترين المسجلين الذين لم تُحتسب لهم من قبل.</span></div></header>
          <div className="owners-point-rules">
            <article className="owners-point-rule">
              <div><strong>شراء العميل</strong><small>النقاط تضاف مرة واحدة للعميل لكل طلب بيع مكتمل، بغض النظر عن عدد السيارات.</small></div>
              <select value={pointsDraft.pointsPurchaseEnabled ? "on" : "off"} onChange={(event) => setPointsDraft({ ...pointsDraft, pointsPurchaseEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
              <label><span>النقاط</span><input type="number" min="0" disabled={!pointsDraft.pointsPurchaseEnabled} value={pointsDraft.pointsPurchase} onChange={(event) => setPointValue("pointsPurchase", event.target.value)} /></label>
            </article>
            <article className="owners-point-rule">
              <div><strong>فتح رابط الدعوة</strong><small>النقاط تضاف لصاحب رابط الدعوة عند الفتح الفريد.</small></div>
              <select value={pointsDraft.pointsUniqueOpenEnabled ? "on" : "off"} onChange={(event) => setPointsDraft({ ...pointsDraft, pointsUniqueOpenEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
              <label><span>النقاط</span><input type="number" min="0" disabled={!pointsDraft.pointsUniqueOpenEnabled} value={pointsDraft.pointsUniqueOpen} onChange={(event) => setPointValue("pointsUniqueOpen", event.target.value)} /></label>
            </article>
            <article className="owners-point-rule">
              <div><strong>تسجيل الاسم ورقم الجوال</strong><small>النقاط تضاف لصاحب الدعوة بعد تسجيل الصديق بياناته.</small></div>
              <select value={pointsDraft.pointsRegistrationEnabled ? "on" : "off"} onChange={(event) => setPointsDraft({ ...pointsDraft, pointsRegistrationEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
              <label><span>النقاط</span><input type="number" min="0" disabled={!pointsDraft.pointsRegistrationEnabled} value={pointsDraft.pointsRegistration} onChange={(event) => setPointValue("pointsRegistration", event.target.value)} /></label>
            </article>
            <article className="owners-point-rule">
              <div><strong>عميل مؤهل</strong><small>النقاط تضاف لصاحب الدعوة عندما يصبح العميل مؤهلًا في CRM.</small></div>
              <select value={pointsDraft.pointsQualifiedEnabled ? "on" : "off"} onChange={(event) => setPointsDraft({ ...pointsDraft, pointsQualifiedEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
              <label><span>النقاط</span><input type="number" min="0" disabled={!pointsDraft.pointsQualifiedEnabled} value={pointsDraft.pointsQualified} onChange={(event) => setPointValue("pointsQualified", event.target.value)} /></label>
            </article>
            <article className="owners-point-rule">
              <div><strong>تم البيع من الدعوة</strong><small>النقاط تضاف لصاحب الدعوة عند إتمام البيع للعميل المدعو.</small></div>
              <select value={pointsDraft.pointsSaleEnabled ? "on" : "off"} onChange={(event) => setPointsDraft({ ...pointsDraft, pointsSaleEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
              <label><span>النقاط</span><input type="number" min="0" disabled={!pointsDraft.pointsSaleEnabled} value={pointsDraft.pointsSale} onChange={(event) => setPointValue("pointsSale", event.target.value)} /></label>
            </article>
          </div>
          <div className="owners-form-grid owners-points-cap-row">
            <label><span>حد نقاط فتح روابط الدعوة يوميًا</span><input type="number" min="0" value={pointsDraft.dailyOpenPointsCap} onChange={(event) => setPointValue("dailyOpenPointsCap", event.target.value)} /></label>
          </div>
          <button className="owners-primary" disabled={busy} onClick={() => void savePointsSettings()}>{busy ? "جاري الحفظ..." : "حفظ إعدادات النقاط"}</button>
        </section>
      ) : null}

      {tab === "rewards" ? (
        <>
          <div className="owners-rewards-subtabs">
            <button className={rewardsView === "catalog" ? "active" : ""} onClick={() => setRewardsView("catalog")}>كتالوج المكافآت</button>
            <button className={rewardsView === "memberCard" ? "active" : ""} onClick={() => setRewardsView("memberCard")}>بطاقة العضوية</button>
          </div>

          {rewardsView === "catalog" ? <>
            <section className="owners-table-card">
              <header><h2>كتالوج المكافآت</h2><span>كل مكافأة تعرض للعميل بنوعها وقيمتها أو تفاصيلها بوضوح</span></header>
              <div className="owners-rewards-grid">
                {rewards.map((item: any) => (
                  <article key={item.id}>
                    <div className="owners-reward-type">{rewardTypeLabel(item.reward_type)}</div>
                    <Gift size={24} />
                    <strong>{item.name}</strong>
                    {item.reward_value ? <div className="owners-reward-value">{item.reward_value}</div> : null}
                    <p>{item.description || "تفاصيل المكافأة تظهر للعميل هنا"}</p>
                    <b>{Number(item.points_cost).toLocaleString("ar-SA-u-nu-latn")} نقطة</b>
                    <small>{item.is_active ? "مفعلة" : "متوقفة"}{item.show_on_member_card ? " · تظهر على بطاقة العضوية" : ""}{item.available_for_referral_purchase ? " · مكافأة عميل جديد" : ""}{item.available_for_existing_customer_purchase ? " · مكافأة عميل قديم" : ""}</small>
                    <small>استخدامات المكافأة: {(Number(item.redeemed_quantity || 0) + Number(item.referral_purchase_redeemed_quantity || 0)).toLocaleString("ar-SA-u-nu-latn")}</small>
                    {canManage ? <button className="owners-reward-usage-btn" disabled={usageBusy || (Number(item.redeemed_quantity || 0) + Number(item.referral_purchase_redeemed_quantity || 0)) === 0} onClick={() => void openRewardUsage(item)}><UsersThree size={15} /> عرض من استخدم المكافأة</button> : null}
                    {(item.available_for_referral_purchase || item.available_for_existing_customer_purchase) && item.reward_type === "discount" && Number(item.checkout_discount_value || item.checkout_discount_amount || 0) > 0 ? <small>خصم طلب الموقع: {item.checkout_discount_type === "percentage" ? `${Number(item.checkout_discount_value || 0).toLocaleString("ar-SA-u-nu-latn")}%` : `${Number(item.checkout_discount_value || item.checkout_discount_amount || 0).toLocaleString("ar-SA-u-nu-latn")} ر.س`}</small> : null}
                    {canManage ? <div className="owners-actions"><button className="owners-link-btn" onClick={() => editReward(item)}><NotePencil size={16} /> تعديل</button><button className="owners-link-btn danger" disabled={busy} onClick={() => void deleteReward(item)}><Trash size={16} /> حذف</button></div> : null}
                  </article>
                ))}
              </div>
            </section>

            {canManage ? (
              <section className="owners-table-card owners-reward-editor">
                <header><h2>{reward.id ? "تعديل المكافأة" : "إضافة مكافأة جديدة"}</h2>{reward.id ? <button className="owners-link-btn" onClick={() => setReward(emptyReward)}>إلغاء التعديل</button> : null}</header>
                <div className="owners-form-grid">
                  <label><span>اسم المكافأة</span><input value={reward.name} onChange={(event) => setReward({ ...reward, name: event.target.value })} placeholder="اسم واضح يظهر للعميل" /></label>
                  <label><span>نوع المكافأة</span><select value={reward.rewardType} onChange={(event) => { const rewardType = event.target.value as RewardDraft["rewardType"]; setReward({ ...reward, rewardType, rewardValue: "", checkoutDiscountValue: rewardType === "discount" ? reward.checkoutDiscountValue : "" }); }}><option value="gift">هدية</option><option value="discount">خصم</option><option value="service">خدمة</option><option value="voucher">قسيمة</option></select></label>
                  <label><span>{rewardValueLabel(reward.rewardType)}</span><input value={reward.rewardValue} onChange={(event) => setReward({ ...reward, rewardValue: event.target.value })} placeholder={rewardValuePlaceholder(reward.rewardType)} /></label>
                  <label><span>النقاط المطلوبة</span><input type="number" min="1" value={reward.pointsCost} onChange={(event) => setReward({ ...reward, pointsCost: Number(event.target.value) })} /></label>
                  <label><span>تبدأ في</span><input type="datetime-local" value={reward.startsAt} onChange={(event) => setReward({ ...reward, startsAt: event.target.value })} /></label>
                  <label><span>تنتهي في</span><input type="datetime-local" value={reward.endsAt} onChange={(event) => setReward({ ...reward, endsAt: event.target.value })} /></label>
                  <label><span>الحالة</span><select value={reward.isActive ? "on" : "off"} onChange={(event) => setReward({ ...reward, isActive: event.target.value === "on" })}><option value="on">مفعلة</option><option value="off">متوقفة</option></select></label>
                  <label className="owners-check-field"><input type="checkbox" checked={reward.showOnMemberCard} onChange={(event) => setReward({ ...reward, showOnMemberCard: event.target.checked })} /><span>إظهار المكافأة على ظهر بطاقة العضوية</span></label>
                  <label className="owners-check-field"><input type="checkbox" checked={reward.availableForReferralPurchase} onChange={(event) => setReward({ ...reward, availableForReferralPurchase: event.target.checked })} /><span>متاحة للعميل الجديد عند استخدام كود الدعوة في طلب الشراء</span></label>
                  <label className="owners-check-field"><input type="checkbox" checked={reward.availableForExistingCustomerPurchase} onChange={(event) => setReward({ ...reward, availableForExistingCustomerPurchase: event.target.checked })} /><span>متاحة للعميل القديم عند استخدام كود الدعوة في طلب الشراء</span></label>
                  {(reward.availableForReferralPurchase || reward.availableForExistingCustomerPurchase) && reward.rewardType === "discount" ? <label><span>طريقة الخصم في طلب الموقع</span><select value={reward.checkoutDiscountType} onChange={(event) => setReward({ ...reward, checkoutDiscountType: event.target.value === "percentage" ? "percentage" : "amount" })}><option value="amount">قيمة خصم</option><option value="percentage">نسبة خصم</option></select></label> : null}
                  {(reward.availableForReferralPurchase || reward.availableForExistingCustomerPurchase) && reward.rewardType === "discount" ? <label><span>{reward.checkoutDiscountType === "percentage" ? "نسبة الخصم في طلب الموقع (%)" : "قيمة الخصم في طلب الموقع (ريال)"}</span><input type="number" min="0.01" max={reward.checkoutDiscountType === "percentage" ? "100" : undefined} step="0.01" value={reward.checkoutDiscountValue} onChange={(event) => setReward({ ...reward, checkoutDiscountValue: event.target.value })} placeholder={reward.checkoutDiscountType === "percentage" ? "مثال: 10" : "مثال: 1000"} /></label> : null}
                  <label className="wide"><span>الوصف</span><textarea value={reward.description} onChange={(event) => setReward({ ...reward, description: event.target.value })} placeholder="اكتب الشروط أو التفاصيل التي يحتاج العميل معرفتها قبل الاستبدال أو الاختيار بكود الدعوة" /></label>
                </div>
                <button className="owners-primary" disabled={busy || !reward.name.trim() || !reward.rewardValue.trim()} onClick={() => void saveReward()}><Gift size={18} />{reward.id ? "حفظ التعديل" : "إضافة المكافأة"}</button>
              </section>
            ) : null}
          </> : (
            <section className="owners-table-card owners-member-card-admin">
              <header><h2>بطاقة العضوية</h2><span>حدد المكافآت التي تظهر على ظهر بطاقة العميل عند الضغط عليها</span></header>
              <div className="owners-card-reward-list">
                {rewards.length ? rewards.map((item: any) => (
                  <article key={item.id}>
                    <div><strong>{item.name}</strong><span>{rewardTypeLabel(item.reward_type)}{item.reward_value ? ` · ${item.reward_value}` : ""}</span></div>
                    <label className="owners-card-toggle"><input type="checkbox" disabled={!canManage || busy} checked={item.show_on_member_card === true} onChange={() => void act({ action: "save_reward", id: item.id, name: item.name, description: item.description || "", rewardType: item.reward_type, rewardValue: item.reward_value || "", showOnMemberCard: item.show_on_member_card !== true, availableForReferralPurchase: item.available_for_referral_purchase === true, availableForExistingCustomerPurchase: item.available_for_existing_customer_purchase === true, checkoutDiscountType: item.checkout_discount_type === "percentage" ? "percentage" : "amount", checkoutDiscountValue: item.checkout_discount_value || item.checkout_discount_amount || "", pointsCost: item.points_cost, startsAt: item.starts_at || "", endsAt: item.ends_at || "", isActive: item.is_active !== false }, item.show_on_member_card ? "تم إخفاء المكافأة من بطاقة العضوية" : "تمت إضافة المكافأة إلى بطاقة العضوية")} /><span>{item.show_on_member_card ? "ظاهرة على البطاقة" : "غير ظاهرة"}</span></label>
                  </article>
                )) : <p>أضف مكافآت أولًا ثم اختر ما يظهر منها على بطاقة العضوية.</p>}
              </div>
            </section>
          )}
        </>
      ) : null}

      {tab === "redemptions" ? (
        <section className="owners-table-card">
          <header><h2>{redemptionsView === "ready" ? "استبدالات جاهزة للتسليم" : "استبدالات النقاط"}</h2><span>{redemptionsView === "ready" ? `${visibleRedemptions.length.toLocaleString("ar-SA-u-nu-latn")} طلب جاهز للتسليم` : "الاستبدال الجديد يصبح جاهزًا مباشرة، والتسليم يتم من صفحة Owners Community داخل CRM."}</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>المكافأة</th><th>الكود</th><th>النقاط</th><th>الحالة</th><th>تاريخ الطلب</th><th>التسليم</th><th>الإجراء</th></tr></thead>
              <tbody>
                {visibleRedemptions.map((redemption: any) => (
                  <tr key={redemption.id}>
                    <td>{redemption.customer_name}<small className="owners-sub">{redemption.phone_normalized}</small></td>
                    <td>{redemption.reward_name}</td>
                    <td><code dir="ltr">{redemption.redemption_code || "—"}</code></td>
                    <td>{Number(redemption.points_cost || 0).toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{redemptionStatusLabel(redemption.status)}</td>
                    <td>{formatDate(redemption.created_at)}</td>
                    <td>{redemption.status === "delivered" ? <><strong>{redemption.reviewed_by_name || "—"}</strong><small className="owners-sub">{formatDate(redemption.reviewed_at)}</small></> : "—"}</td>
                    <td>
                      {canManage && redemption.status === "requested" ? (
                        <div className="owners-actions">
                          <button disabled={busy} onClick={() => void act({ action: "redemption", id: redemption.id, status: "approved" }, "تم تحويل الطلب القديم إلى جاهز للاستبدال")}>تجهيز الطلب القديم</button>
                          <button disabled={busy} onClick={() => void act({ action: "redemption", id: redemption.id, status: "rejected" }, "تم رفض الطلب وإرجاع النقاط")}>رفض</button>
                        </div>
                      ) : redemption.status === "approved" ? "يُسلّم من CRM" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {rewardUsage ? (
        <div className="owners-reward-usage-backdrop" role="presentation" onClick={() => setRewardUsage(null)}>
          <section className="owners-reward-usage-dialog" role="dialog" aria-modal="true" aria-label={`استخدامات ${rewardUsage.reward?.name || "المكافأة"}`} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>استخدامات المكافأة</h2>
                <p>{rewardUsage.reward?.name || "—"}</p>
              </div>
              <button type="button" className="owners-reward-usage-close" onClick={() => setRewardUsage(null)} aria-label="إغلاق"><X size={20} /></button>
            </header>
            <div className="owners-reward-usage-stats">
              <span>الإجمالي <strong>{Number(rewardUsage.counts?.total || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></span>
              <span>طلبات الموقع <strong>{Number(rewardUsage.counts?.websitePurchases || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></span>
              <span>استبدال النقاط <strong>{Number(rewardUsage.counts?.memberRedemptions || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></span>
            </div>
            <div className="owners-table-wrap owners-reward-usage-table">
              <table>
                <thead><tr><th>العميل</th><th>الجوال</th><th>طريقة الاستخدام</th><th>نوع العميل</th><th>كود الدعوة</th><th>صاحب الكود</th><th>طلب الموقع</th><th>Next ERP</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {(rewardUsage.usages || []).length ? (rewardUsage.usages || []).map((usage: any) => (
                    <tr key={`${usage.usage_type}-${usage.id}`}>
                      <td>{usage.customer_name || "—"}</td>
                      <td>{usage.phone || "—"}</td>
                      <td>{usage.usage_type === "website_purchase" ? "طلب شراء من الموقع" : "استبدال نقاط"}{usage.redemption_status ? <small className="owners-sub">{usage.redemption_status}</small> : null}</td>
                      <td>{usage.customer_kind === "new" ? "عميل جديد" : usage.customer_kind === "existing" ? "عميل قديم" : "عضو"}</td>
                      <td><code>{usage.referral_code || "—"}</code></td>
                      <td>{usage.code_owner_name || "—"}</td>
                      <td>{usage.website_order_id || "—"}</td>
                      <td>{usage.next_erp_sales_order || "—"}</td>
                      <td>{formatDate(usage.created_at)}</td>
                    </tr>
                  )) : <tr><td colSpan={9}>لا توجد استخدامات مسجلة لهذه المكافأة.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
