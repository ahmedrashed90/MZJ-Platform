import { CircleNotch } from "@phosphor-icons/react";

export function PlatformLoadingPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card loading-card">
        <img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" />
        <CircleNotch className="spin" size={28} />
        <strong>جاري فحص إعداد المنصة...</strong>
      </section>
    </main>
  );
}
