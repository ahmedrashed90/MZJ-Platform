import { useEffect, useMemo, useState } from "react";
import { CheckCircle, ShareNetwork } from "@phosphor-icons/react";
import { useParams } from "react-router-dom";
import { ownersPublicGet, ownersPublicPost } from "./api";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ الطلب";
}

export function OwnersInvitePage() {
  const { code = "" } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const visitor = useMemo(() => {
    const key = "mzj_owner_visitor";
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(key, value);
    }
    return value;
  }, []);

  useEffect(() => {
    void ownersPublicGet("invite", { code, visitor })
      .then(setInfo)
      .catch((error) => setMessage(errorMessage(error)));
  }, [code, visitor]);

  async function register() {
    setBusy(true);
    setMessage("");
    try {
      const response = await ownersPublicPost({ action: "register_referral", code, name, phone });
      setMessage(response.message || "تم تسجيل بياناتك");
      setDone(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="owners-public invite" dir="rtl">
      <div className="owners-invite-public-card">
        <img src="/logo.png" alt="MZJ" />
        <span className="owners-eyebrow">دعوة من {info?.referrerName || "أحد عملاء مجموعة محمد بن ذعار العجمي"}</span>
        <ShareNetwork size={38} />
        <h1>مجموعة محمد بن ذعار العجمي</h1>
        <p>سجل بياناتك من رابط الدعوة وسيقوم فريق مجموعة محمد بن ذعار العجمي بالتواصل معك.</p>
        {message ? <div className="owners-public-message">{message}</div> : null}
        {done ? (
          <div className="owners-success"><CheckCircle size={46} weight="fill" /><strong>تم تسجيل بياناتك</strong><span>فريق مجموعة محمد بن ذعار العجمي سيتواصل معك.</span></div>
        ) : (
          <div className="owners-invite-form">
            <label><span>الاسم</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>رقم الجوال</span><input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xxxxxxxx" /></label>
            <button disabled={busy || !name.trim() || !phone.trim()} onClick={() => void register()}>{busy ? "جاري التسجيل..." : "تسجيل البيانات"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
