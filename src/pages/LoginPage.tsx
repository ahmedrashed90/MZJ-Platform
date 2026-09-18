import { useState } from "react";
import { LockKey, MapPin, SignIn, WarningCircle } from "@phosphor-icons/react";
import { AttendanceLoginRequiredError, useAuth } from "../auth/AuthContext";

function getBrowserLocation() {
  return new Promise<{ latitude: number; longitude: number; accuracy: number | null }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("المتصفح لا يدعم تحديد الموقع"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
      }),
      () => reject(new Error("تعذر تحديد موقعك. اسمح للموقع بالوصول إلى اللوكيشن ثم حاول مرة أخرى.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attendanceMessage, setAttendanceMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setAttendanceMessage("");
    try {
      await login(identifier, password);
    } catch (loginError) {
      if (loginError instanceof AttendanceLoginRequiredError) {
        const requirement = loginError.requirement;
        const periodText = [requirement.periodName, requirement.startTime && requirement.endTime ? `${requirement.startTime} - ${requirement.endTime}` : ""].filter(Boolean).join(" • ");
        setAttendanceMessage(periodText ? `الفترة الحالية: ${periodText}` : "جاري تسجيل الحضور للفترة الحالية");
        try {
          const location = requirement.locationRequired ? await getBrowserLocation() : null;
          await login(identifier, password, { attendanceCheckIn: true, location });
          return;
        } catch (attendanceError) {
          setAttendanceMessage("");
          setError(attendanceError instanceof Error ? attendanceError.message : "تعذر تسجيل الحضور");
        }
      } else {
        setError(loginError instanceof Error ? loginError.message : "تعذر تسجيل الدخول");
      }
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
        {attendanceMessage ? <div className="attendance-login-note"><MapPin size={19} weight="duotone" /><span>{attendanceMessage}</span></div> : null}
        {error ? <div className="auth-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
        <form className="auth-form" onSubmit={submit}>
          <label><span>بيانات الدخول</span><input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
          <label><span>كلمة المرور</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-auth-button" type="submit" disabled={loading}>
            <SignIn size={20} />
            {loading ? "جاري التحقق وتسجيل الحضور..." : "تسجيل حضور ودخول المنصة"}
          </button>
        </form>
      </section>
    </main>
  );
}
