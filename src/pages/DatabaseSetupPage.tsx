import { ArrowClockwise, Database, Key, PlugsConnected, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

export function DatabaseSetupPage() {
  const { status, refresh } = useAuth();
  const unreachable = status?.databaseConfigured && !status.databaseReachable;

  return (
    <main className="auth-shell">
      <section className="auth-card setup-information-card">
        <div className="auth-logo"><img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" /></div>
        <div className="setup-icon"><Database size={33} weight="duotone" /></div>
        <h1>{unreachable ? "تعذر الاتصال بقاعدة PostgreSQL" : "ربط قاعدة PostgreSQL"}</h1>
        <p>
          {unreachable
            ? "DATABASE_URL موجود، لكن الاتصال بقاعدة البيانات لم ينجح. راجع رابط الاتصال وصلاحية قاعدة البيانات ثم أعد الفحص."
            : "المنصة لا تستخدم بيانات تجريبية. يجب ربط قاعدة PostgreSQL الحقيقية قبل إنشاء أول مستخدم."}
        </p>

        {status?.error ? <div className="auth-error"><WarningCircle size={19} weight="fill" /><span>{status.error}</span></div> : null}

        <div className="setup-steps">
          <div><span>1</span><div><strong>أنشئ PostgreSQL</strong><small>من Vercel Marketplace واربطها بنفس مشروع المنصة.</small></div><PlugsConnected size={21} /></div>
          <div><span>2</span><div><strong>تأكد من DATABASE_URL</strong><small>يجب أن يظهر تلقائيًا في Environment Variables بعد الربط.</small></div><Database size={21} /></div>
          <div><span>3</span><div><strong>أضف MZJ_SETUP_KEY</strong><small>ضع قيمة سرية طويلة تستخدم مرة واحدة عند إنشاء أول مدير للنظام.</small></div><Key size={21} /></div>
        </div>

        <button className="primary-auth-button" type="button" onClick={() => void refresh()}>
          <ArrowClockwise size={20} />
          إعادة فحص الاتصال
        </button>
      </section>
    </main>
  );
}
