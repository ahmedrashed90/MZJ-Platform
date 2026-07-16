import { useState } from "react";
import { Database, ShieldCheck, UserCirclePlus, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

const emptyForm = {
  fullName: "",
  employeeNo: "",
  email: "",
  mobile: "",
  password: "",
  confirmPassword: "",
  setupKey: "",
};

export function FirstAdminSetupPage() {
  const { initialize, status } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("تأكيد كلمة المرور غير مطابق");
      return;
    }
    setSaving(true);
    try {
      await initialize({
        fullName: form.fullName,
        employeeNo: form.employeeNo,
        email: form.email,
        mobile: form.mobile,
        password: form.password,
        setupKey: form.setupKey,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر تهيئة المنصة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card first-admin-card">
        <div className="auth-logo"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /></div>
        <div className="setup-icon"><ShieldCheck size={34} weight="duotone" /></div>
        <h1>تهيئة المنصة وإنشاء مدير النظام</h1>
        <p>سيتم إنشاء الجداول الفعلية داخل PostgreSQL ثم إنشاء أول حساب إداري بالبيانات التي تدخلها فقط.</p>

        {!status?.setupKeyConfigured ? (
          <div className="auth-error"><WarningCircle size={19} weight="fill" /><span>أضف MZJ_SETUP_KEY في Vercel ثم اعمل Redeploy قبل المتابعة.</span></div>
        ) : null}
        {error ? <div className="auth-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}

        <form className="auth-form setup-form" onSubmit={submit}>
          <label><span>اسم مدير النظام</span><input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
          <div className="form-row">
            <label><span>رقم الموظف</span><input value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} /></label>
            <label><span>رقم الجوال</span><input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></label>
          </div>
          <label><span>البريد الإلكتروني</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <div className="form-row">
            <label><span>كلمة المرور</span><input required minLength={10} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label><span>تأكيد كلمة المرور</span><input required minLength={10} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
          </div>
          <label><span>مفتاح التهيئة MZJ_SETUP_KEY</span><input required type="password" value={form.setupKey} onChange={(event) => setForm({ ...form, setupKey: event.target.value })} /></label>
          <button className="primary-auth-button" type="submit" disabled={saving || !status?.setupKeyConfigured}>
            {saving ? <Database className="spin" size={20} /> : <UserCirclePlus size={20} />}
            {saving ? "جاري إنشاء قاعدة المنصة..." : "تهيئة المنصة وإنشاء الحساب"}
          </button>
        </form>
      </section>
    </main>
  );
}
