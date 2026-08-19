import { useState } from "react";
import { CheckCircle, Copy, Phone, User } from "@phosphor-icons/react";

async function submitLead(payload: Record<string, string>) {
  const response = await fetch("/api/crm/cash-qr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "تعذر تسجيل البيانات");
  return data;
}

export function CashQrRegistrationPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [customerCode, setCustomerCode] = useState("");
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await submitLead({ name, phone, website });
      setDone(true);
      setCustomerCode(String(result.customerCode || ""));
      setMessage(result.message || "تم تسجيل بياناتك بنجاح");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تسجيل البيانات");
    } finally {
      setBusy(false);
    }
  }

  async function copyCustomerCode() {
    if (!customerCode) return;
    await navigator.clipboard.writeText(customerCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="cash-qr-public-page" dir="rtl">
      <section className="cash-qr-public-card">
        <header className="cash-qr-public-brand">
          <span>مجموعة محمد بن ذعار العجمي</span>
        </header>
        {done ? (
          <div className="cash-qr-success">
            <CheckCircle size={44} weight="fill" />
            <h2>تم التسجيل بنجاح</h2>
            <p>{message}</p>
            {customerCode ? (
              <div className="cash-qr-customer-code">
                <span>احفظ كودك لاستخدامه لاحقًا</span>
                <code dir="ltr">{customerCode}</code>
                <button type="button" onClick={() => void copyCustomerCode()}><Copy size={17} />{copied ? "تم نسخ الكود" : "نسخ الكود"}</button>
              </div>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit}>
            <label><span>اسم العميل *</span><div><User size={20} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="اكتب الاسم" autoComplete="name" required /></div></label>
            <label><span>رقم الجوال *</span><div><Phone size={20} /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xxxxxxxx" inputMode="tel" autoComplete="tel" dir="ltr" required /></div></label>
            <input className="cash-qr-honeypot" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />
            {message ? <div className="cash-qr-error">{message}</div> : null}
            <button type="submit" disabled={busy || !name.trim() || !phone.trim()}>{busy ? "جاري التسجيل..." : "حفظ البيانات"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
