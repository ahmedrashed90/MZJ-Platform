import { Copy, DownloadSimple, QrCode } from "@phosphor-icons/react";
import { useState } from "react";

const PUBLIC_URL = "https://mzj-platform.vercel.app/cash-register";

export function CrmCashQrSettings() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(PUBLIC_URL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="crm-panel crm-cash-qr-panel">
      <header><div><h2><QrCode size={25} /> إنشاء QR كود</h2><p>QR مخصص لتسجيل عملاء مبيعات الكاش من الاسم ورقم الجوال فقط.</p></div></header>
      <div className="crm-cash-qr-layout">
        <div className="crm-cash-qr-preview"><img src="/cash-register-qr.svg" alt="QR تسجيل عملاء مبيعات الكاش" /></div>
        <div className="crm-cash-qr-copy">
          <h3>طريقة العمل</h3>
          <ol>
            <li>العميل يمسح QR ويكتب الاسم ورقم الجوال.</li>
            <li>العميل يدخل CRM تلقائيًا بحالة «عميل جديد» وقسم «مبيعات الكاش» والدفع «كاش»، ويظهر له كوده بعد التسجيل ليحفظه.</li>
            <li>المسؤول والفرع يتم تحديدهما من محرك توزيع مناديب الكاش الحالي.</li>
          </ol>
          <label><span>رابط التسجيل</span><input value={PUBLIC_URL} readOnly dir="ltr" /></label>
          <div className="crm-cash-qr-actions">
            <button type="button" className="crm-secondary-button" onClick={() => void copyLink()}><Copy size={18} />{copied ? "تم النسخ" : "نسخ الرابط"}</button>
            <a className="crm-primary-button" href="/cash-register-qr.svg" download="MZJ-Cash-Customer-QR.svg"><DownloadSimple size={18} />تنزيل QR كود</a>
          </div>
        </div>
      </div>
    </section>
  );
}
