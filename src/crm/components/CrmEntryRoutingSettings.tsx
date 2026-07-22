import { CheckCircle, GitBranch, UserCirclePlus } from "@phosphor-icons/react";

export function CrmEntryRoutingSettings() {
  return (
    <div className="crm-entry-routing-settings">
      <section className="crm-entry-routing-flow">
        <article><UserCirclePlus size={28} weight="duotone" /><span><b>1</b><strong>استقبال العميل</strong><small>تُحفظ المحادثة والرسالة الواردة أولًا داخل CRM.</small></span></article>
        <article><GitBranch size={28} weight="duotone" /><span><b>2</b><strong>الأوتوميشن</strong><small>تشغيل الرسائل والاختيارات والفلو يتم من تبويب إعدادات الأوتوميشن.</small></span></article>
        <article><CheckCircle size={28} weight="duotone" /><span><b>3</b><strong>التوزيع</strong><small>بعد اختيار الخدمة يستخدم النظام محرك التوزيع الحالي دون تغيير قواعده.</small></span></article>
      </section>

      <div className="crm-settings-grid crm-entry-routing-grid">
        <section className="crm-panel settings-card">
          <h2>إعدادات دخول العميل</h2>
          <div className="crm-rule-safety">
            <span>✓ الرسائل والاختيارات والفلو من تبويب إعدادات الأوتوميشن.</span>
            <span>✓ المحادثة تُحفظ حتى لو كان الأوتوميشن متوقفًا.</span>
            <span>✓ لا يتم تشغيل فلوين نشطين لنفس العميل.</span>
          </div>
        </section>

        <section className="crm-panel settings-card">
          <h2>إعدادات التوزيع</h2>
          <div className="crm-rule-safety">
            <span>✓ قواعد الموظفين وترتيب الدور من تبويب توزيع العملاء.</span>
            <span>✓ اختيار الخدمة يستدعي محرك التوزيع الحالي مرة واحدة.</span>
            <span>✓ إعدادات الأوتوميشن لا تغيّر قواعد التوزيع.</span>
          </div>
        </section>

        <section className="crm-panel settings-card full crm-entry-routing-boundary">
          <h2>فصل المسؤوليات</h2>
          <p>هذا التبويب يوضح مسار دخول العميل فقط. لا توجد هنا نسخة ثانية من رسائل الأوتوميشن أو اختيارات الخدمة، حتى تظل إعدادات الأوتوميشن هي المصدر الوحيد للتشغيل.</p>
        </section>
      </div>
    </div>
  );
}
