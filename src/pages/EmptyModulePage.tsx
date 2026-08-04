import { Database, PlugsConnected } from "@phosphor-icons/react";

export function EmptyModulePage({ title, description }: { title: string; description: string }) {
  return (
    <div className="module-page">
      <header className="module-page-head">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <section className="module-empty">
        <div>
          <PlugsConnected size={48} weight="duotone" />
          <h2>لا توجد بيانات متصلة حاليًا</h2>
          <p>هذه الصفحة لا تعرض بيانات افتراضية. ستظهر بيانات النظام الفعلية بعد ربط PostgreSQL وتشغيل مسارات الاستيراد الخاصة به.</p>
          <Database size={25} weight="duotone" style={{ marginTop: 18 }} />
        </div>
      </section>
    </div>
  );
}
