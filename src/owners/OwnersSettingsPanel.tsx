import { useEffect, useState } from "react";
import { ChatCircleText, FloppyDisk, Gift, Medal, ShieldCheck } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { ownersAdminGet, ownersAdminPost } from "./api";

type OwnersSettingsForm = {
  isEnabled: boolean;
  welcomeMessageEnabled: boolean;
  otpExpiryMinutes: number;
  otpResendSeconds: number;
  otpMaxAttempts: number;
  otpHourlyLimit: number;
  pointsPurchaseEnabled: boolean;
  pointsPurchase: number;
  pointsRepurchaseEnabled: boolean;
  pointsRepurchase: number;
  pointsUniqueOpenEnabled: boolean;
  pointsUniqueOpen: number;
  pointsRegistrationEnabled: boolean;
  pointsRegistration: number;
  pointsQualifiedEnabled: boolean;
  pointsQualified: number;
  pointsSaleEnabled: boolean;
  pointsSale: number;
  dailyOpenPointsCap: number;
  silverPoints: number;
  goldPoints: number;
  platinumPoints: number;
  referralDefaultService: string;
  referralDefaultBranch: string;
  friendBenefitTitle: string;
  friendBenefitText: string;
};

const emptyForm: OwnersSettingsForm = {
  isEnabled: true,
  welcomeMessageEnabled: false,
  otpExpiryMinutes: 5,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  otpHourlyLimit: 5,
  pointsPurchaseEnabled: true,
  pointsPurchase: 500,
  pointsRepurchaseEnabled: true,
  pointsRepurchase: 500,
  pointsUniqueOpenEnabled: true,
  pointsUniqueOpen: 50,
  pointsRegistrationEnabled: true,
  pointsRegistration: 10,
  pointsQualifiedEnabled: true,
  pointsQualified: 25,
  pointsSaleEnabled: true,
  pointsSale: 700,
  dailyOpenPointsCap: 50,
  silverPoints: 1000,
  goldPoints: 3000,
  platinumPoints: 7000,
  referralDefaultService: "cash",
  referralDefaultBranch: "online",
  friendBenefitTitle: "دعوة من مجموعة محمد بن ذعار العجمي",
  friendBenefitText: "سجل بياناتك من رابط الدعوة للاستفادة من المزايا المتاحة.",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ الطلب";
}

export function OwnersSettingsPanel() {
  const { user } = useAuth();
  const editable = hasPermission(user, "settings.owners.manage") || hasPermission(user, "owners.community.manage");
  const [form, setForm] = useState<OwnersSettingsForm>(emptyForm);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await ownersAdminGet("settings");
    const settings = response.settings || {};
    setForm({
      isEnabled: settings.is_enabled !== false,
      welcomeMessageEnabled: settings.welcome_message_enabled === true,
      otpExpiryMinutes: Number(settings.otp_expiry_minutes || 5),
      otpResendSeconds: Number(settings.otp_resend_seconds || 60),
      otpMaxAttempts: Number(settings.otp_max_attempts || 5),
      otpHourlyLimit: Number(settings.otp_hourly_limit || 5),
      pointsPurchaseEnabled: settings.points_purchase_enabled === true,
      pointsPurchase: Number(settings.points_purchase ?? 500),
      pointsRepurchaseEnabled: settings.points_repurchase_enabled !== false,
      pointsRepurchase: Number(settings.points_repurchase ?? 500),
      pointsUniqueOpenEnabled: settings.points_unique_open_enabled !== false,
      pointsUniqueOpen: Number(settings.points_unique_open ?? 50),
      pointsRegistrationEnabled: settings.points_registration_enabled !== false,
      pointsRegistration: Number(settings.points_registration ?? 10),
      pointsQualifiedEnabled: settings.points_qualified_enabled !== false,
      pointsQualified: Number(settings.points_qualified ?? 25),
      pointsSaleEnabled: settings.points_sale_enabled !== false,
      pointsSale: Number(settings.points_sale ?? 700),
      dailyOpenPointsCap: Number(settings.daily_open_points_cap ?? 50),
      silverPoints: Number(settings.silver_points ?? 1000),
      goldPoints: Number(settings.gold_points ?? 3000),
      platinumPoints: Number(settings.platinum_points ?? 7000),
      referralDefaultService: settings.referral_default_service || "cash",
      referralDefaultBranch: settings.referral_default_branch || "online",
      friendBenefitTitle: settings.friend_benefit_title || emptyForm.friendBenefitTitle,
      friendBenefitText: settings.friend_benefit_text || emptyForm.friendBenefitText,
    });
    setLoaded(true);
  }

  useEffect(() => {
    void load().catch((error) => {
      setMessage(errorMessage(error));
      setLoaded(true);
    });
  }, []);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await ownersAdminPost({ action: "save_settings", ...form });
      setMessage("تم حفظ إعدادات MZJ Owners Community");
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function numericField<K extends keyof OwnersSettingsForm>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  if (!loaded) return <div className="owners-panel owners-loading">جاري تحميل إعدادات MZJ Owners Community...</div>;

  return (
    <div className="owners-panel owners-settings" dir="rtl">
      <header className="owners-section-head">
        <div>
          <ShieldCheck size={28} />
          <div>
            <h2>إعدادات MZJ Owners Community</h2>
            <p>إدارة التحقق عبر SMS+، قواعد النقاط، مستويات العضوية ورحلة الدعوة من مكان واحد.</p>
          </div>
        </div>
        <span className={form.isEnabled ? "owners-badge ok" : "owners-badge"}>
          {form.isEnabled ? "البرنامج مفعل" : "البرنامج متوقف"}
        </span>
      </header>

      {message ? <div className="owners-notice">{message}</div> : null}

      <section className="owners-settings-card">
        <h3><ChatCircleText size={21} /> قناة OTP والتحقق</h3>
        <div className="owners-form-grid">
          <label>
            <span>حالة البرنامج</span>
            <select disabled={!editable} value={form.isEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, isEnabled: event.target.value === "on" })}>
              <option value="on">مفعل</option>
              <option value="off">متوقف مؤقتًا</option>
            </select>
          </label>
          <label>
            <span>قناة رسائل البرنامج</span>
            <input disabled value="SMS+ عبر تطبيق التراكينج" />
          </label>
          <label>
            <span>صلاحية OTP بالدقائق</span>
            <input disabled={!editable} type="number" min="1" max="30" value={form.otpExpiryMinutes} onChange={(event) => numericField("otpExpiryMinutes", event.target.value)} />
          </label>
          <label>
            <span>إعادة الإرسال بعد (ثانية)</span>
            <input disabled={!editable} type="number" min="15" max="600" value={form.otpResendSeconds} onChange={(event) => numericField("otpResendSeconds", event.target.value)} />
          </label>
          <label>
            <span>أقصى محاولات للكود</span>
            <input disabled={!editable} type="number" min="1" max="20" value={form.otpMaxAttempts} onChange={(event) => numericField("otpMaxAttempts", event.target.value)} />
          </label>
          <label>
            <span>أقصى أكواد خلال الساعة</span>
            <input disabled={!editable} type="number" min="1" max="30" value={form.otpHourlyLimit} onChange={(event) => numericField("otpHourlyLimit", event.target.value)} />
          </label>
          <label>
            <span>رسالة الترحيب</span>
            <select disabled={!editable} value={form.welcomeMessageEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, welcomeMessageEnabled: event.target.value === "on" })}>
              <option value="off">إرسال يدوي من لوحة الأعضاء</option>
              <option value="on">مسموح بها عند تشغيل الإرسال التلقائي</option>
            </select>
          </label>
        </div>
      </section>

      <section className="owners-settings-card">
        <h3><Gift size={21} /> قواعد النقاط</h3>
        <p className="owners-settings-hint">كل قاعدة مستقلة ويمكن تشغيلها أو إيقافها وتغيير نقاطها في أي وقت. تفعيل نقاط الشراء يضيفها للعملاء المشترين المسجلين الذين لم تُحتسب لهم من قبل.</p>
        <div className="owners-point-rules">
          <article className="owners-point-rule">
            <div><strong>إتمام أول عملية شراء</strong><small>الرصيد الأساسي عند أول عملية شراء مكتملة.</small></div>
            <select disabled={!editable} value={form.pointsPurchaseEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsPurchaseEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsPurchaseEnabled} type="number" min="0" value={form.pointsPurchase} onChange={(event) => numericField("pointsPurchase", event.target.value)} /></label>
          </article>
          <article className="owners-point-rule">
            <div><strong>إعادة الشراء</strong><small>تضاف للعميل عند كل عملية شراء جديدة بعد أول عملية شراء.</small></div>
            <select disabled={!editable} value={form.pointsRepurchaseEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsRepurchaseEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsRepurchaseEnabled} type="number" min="0" value={form.pointsRepurchase} onChange={(event) => numericField("pointsRepurchase", event.target.value)} /></label>
          </article>
          <article className="owners-point-rule">
            <div><strong>إرسال دعوة لصديق</strong><small>تضاف لصاحب الدعوة عند أول فتح فريد للرابط من الصديق.</small></div>
            <select disabled={!editable} value={form.pointsUniqueOpenEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsUniqueOpenEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsUniqueOpenEnabled} type="number" min="0" value={form.pointsUniqueOpen} onChange={(event) => numericField("pointsUniqueOpen", event.target.value)} /></label>
          </article>
          <article className="owners-point-rule">
            <div><strong>تسجيل الاسم ورقم الجوال</strong><small>تضاف لصاحب الدعوة بعد تسجيل الصديق بياناته.</small></div>
            <select disabled={!editable} value={form.pointsRegistrationEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsRegistrationEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsRegistrationEnabled} type="number" min="0" value={form.pointsRegistration} onChange={(event) => numericField("pointsRegistration", event.target.value)} /></label>
          </article>
          <article className="owners-point-rule">
            <div><strong>عميل مؤهل</strong><small>تضاف لصاحب الدعوة عندما يصبح العميل مؤهلًا في CRM.</small></div>
            <select disabled={!editable} value={form.pointsQualifiedEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsQualifiedEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsQualifiedEnabled} type="number" min="0" value={form.pointsQualified} onChange={(event) => numericField("pointsQualified", event.target.value)} /></label>
          </article>
          <article className="owners-point-rule">
            <div><strong>إرسال دعوة لصديق - تم الشراء</strong><small>تضاف لصاحب الدعوة عند إتمام شراء العميل المدعو.</small></div>
            <select disabled={!editable} value={form.pointsSaleEnabled ? "on" : "off"} onChange={(event) => setForm({ ...form, pointsSaleEnabled: event.target.value === "on" })}><option value="on">مفعل</option><option value="off">متوقف</option></select>
            <label><span>النقاط</span><input disabled={!editable || !form.pointsSaleEnabled} type="number" min="0" value={form.pointsSale} onChange={(event) => numericField("pointsSale", event.target.value)} /></label>
          </article>
        </div>
        <div className="owners-form-grid">
          <label><span>حد نقاط فتح الروابط يوميًا</span><input disabled={!editable} type="number" min="0" value={form.dailyOpenPointsCap} onChange={(event) => numericField("dailyOpenPointsCap", event.target.value)} /></label>
          <label>
            <span>مسار العميل الافتراضي</span>
            <select disabled={!editable} value={form.referralDefaultService} onChange={(event) => setForm({ ...form, referralDefaultService: event.target.value })}>
              <option value="cash">مبيعات الكاش</option>
              <option value="finance">مبيعات التمويل</option>
              <option value="service">خدمة العملاء</option>
            </select>
          </label>
          <label><span>الفرع الافتراضي للدعوات</span><input disabled={!editable} value={form.referralDefaultBranch} onChange={(event) => setForm({ ...form, referralDefaultBranch: event.target.value })} /></label>
        </div>
      </section>

      <section className="owners-settings-card">
        <h3><Medal size={21} /> مستويات العضوية</h3>
        <div className="owners-form-grid">
          <label><span>Silver يبدأ من</span><input disabled={!editable} type="number" min="0" value={form.silverPoints} onChange={(event) => numericField("silverPoints", event.target.value)} /></label>
          <label><span>Gold يبدأ من</span><input disabled={!editable} type="number" min="0" value={form.goldPoints} onChange={(event) => numericField("goldPoints", event.target.value)} /></label>
          <label><span>Platinum يبدأ من</span><input disabled={!editable} type="number" min="0" value={form.platinumPoints} onChange={(event) => numericField("platinumPoints", event.target.value)} /></label>
        </div>
      </section>

      <section className="owners-settings-card">
        <h3>صفحة الصديق المدعو</h3>
        <div className="owners-form-grid">
          <label><span>عنوان الميزة</span><input disabled={!editable} value={form.friendBenefitTitle} onChange={(event) => setForm({ ...form, friendBenefitTitle: event.target.value })} /></label>
          <label className="wide"><span>وصف الميزة</span><textarea disabled={!editable} value={form.friendBenefitText} onChange={(event) => setForm({ ...form, friendBenefitText: event.target.value })} /></label>
        </div>
      </section>

      {editable ? (
        <div className="owners-save-row">
          <button className="owners-primary" disabled={busy} onClick={() => void save()}>
            <FloppyDisk size={19} />{busy ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
