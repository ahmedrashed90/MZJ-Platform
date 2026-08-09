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
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { ownersAdminGet, ownersAdminPost } from "./api";
import { readXlsx } from "../crm/xlsxReader";

type Tab = "members" | "import" | "referrals" | "rewards" | "redemptions";


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
  const [testMember, setTestMember] = useState({ name: "", phone: "" });
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping);
  const [importSummary, setImportSummary] = useState<any>(null);

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
      setMessage("اكتمل استيراد العملاء السابقين");
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
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
  const importHeaders = importRows.length ? Object.keys(importRows[0]) : [];
  const testMembersCount = members.filter((member: any) => member.member_kind === "test").length;
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
        {canManage ? <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>استيراد العملاء السابقين</button> : null}
        <button className={tab === "referrals" ? "active" : ""} onClick={() => setTab("referrals")}>الدعوات</button>
        <button className={tab === "rewards" ? "active" : ""} onClick={() => setTab("rewards")}>المكافآت</button>
        <button className={tab === "redemptions" ? "active" : ""} onClick={() => setTab("redemptions")}>طلبات الاستبدال</button>
      </nav>

      {tab === "members" ? (
        <>
          {canManage ? (
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
            <header><h2>أعضاء MZJ Owners Community</h2><span>{members.length - testMembersCount} حقيقي · {testMembersCount} تجريبي</span></header>
            <div className="owners-table-wrap">
              <table>
                <thead><tr><th>العميل</th><th>النوع</th><th>الجوال</th><th>كود الدعوة</th><th>المستوى</th><th>النقاط</th><th>الدعوات</th><th>المبيعات</th><th>آخر شراء</th><th>الإجراءات</th></tr></thead>
                <tbody>
                  {members.map((member: any) => (
                    <tr key={member.id}>
                      <td><strong>{member.customer_name || "عميل MZJ"}</strong></td>
                      <td><span className={`owners-member-type ${member.member_kind === "test" ? "test" : "real"}`}>{member.member_kind === "test" ? "تجريبي" : member.enrollment_source?.startsWith("excel_import") ? "مستورد" : "حقيقي"}</span></td>
                      <td>{member.phone_normalized}</td>
                      <td><code>{member.referral_code}</code></td>
                      <td>{tierLabel(member.tier_code)}</td>
                      <td>{Number(member.points_balance || 0).toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td>{member.referrals_count || 0}</td>
                      <td>{member.sales_count || 0}</td>
                      <td>{formatDate(member.last_sale_at)}</td>
                      <td>
                        {canManage ? (
                          <div className="owners-actions">
                            <button className="owners-link-btn" disabled={busy} onClick={() => void act({ action: "send_welcome", memberId: member.id }, "تمت إضافة رسالة الترحيب إلى SMS+") }><PaperPlaneTilt size={16} /> إرسال الترحيب</button>
                            {member.member_kind === "test" ? <button className="owners-link-btn danger" disabled={busy} onClick={() => window.confirm("حذف العضو التجريبي وكل بيانات تجربته؟") && void act({ action: "delete_test_member", memberId: member.id }, "تم حذف العضو التجريبي") }><Trash size={16} /> حذف</button> : null}
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "import" && canManage ? (
        <section className="owners-table-card owners-import-card">
          <header><div><h2>استيراد العملاء السابقين من Excel</h2><span>يتم منع التكرار برقم الجوال، ومطابقة العميل تلقائيًا مع المبيعات الحالية عند وجود تطابق.</span></div></header>
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
          <header><h2>رحلة الدعوات</h2><span>مرتبطة بالـCRM والمبيعات</span></header>
          <div className="owners-table-wrap">
            <table>
              <thead><tr><th>صاحب الدعوة</th><th>الصديق</th><th>الجوال</th><th>الحالة</th><th>التسجيل</th><th>التأهيل</th><th>البيع</th></tr></thead>
              <tbody>
                {referrals.map((referral: any) => (
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
