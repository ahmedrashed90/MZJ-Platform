import { useState } from "react";
import { LockKey, SignIn, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(identifier, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "تعذر تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card login-card">
        <div className="auth-logo"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /></div>
        <div className="setup-icon"><LockKey size={33} weight="duotone" /></div>
        <h1>تسجيل الدخول</h1>
        <p>استخدم البريد الإلكتروني أو رقم الجوال أو رقم الموظف.</p>
        {error ? <div className="auth-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
        <form className="auth-form" onSubmit={submit}>
          <label><span>بيانات الدخول</span><input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
          <label><span>كلمة المرور</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-auth-button" type="submit" disabled={loading}>
            <SignIn size={20} />
            {loading ? "جاري تسجيل الدخول..." : "دخول المنصة"}
          </button>
        </form>
      </section>
    </main>
  );
}
