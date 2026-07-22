import { CheckCircle, FlowArrow, GitBranch, UserCirclePlus } from "@phosphor-icons/react";

export function CrmEntryRoutingSettings() {
  return (
    <div className="crm-entry-routing-settings">
      <section className="crm-entry-routing-flow">
        <article><UserCirclePlus size={28} weight="duotone" /><span><b>1</b><strong>استقبال العميل</strong><small>تسجيل جهة الاتصال والمحادثة والرسالة الواردة مرة واحدة.</small></span></article>
        <article><FlowArrow size={28} weight="duotone" /><span><b>2</b><strong>الأوتوميشن يحدد الخدمة</strong><small>الرسائل والاختيارات والأسئلة تُدار حصريًا من تبويب إعدادات الأوتوميشن.</small></span></article>
        <article><GitBranch size={28} weight="duotone" /><span><b>3</b><strong>محرك التوزيع المركزي</strong><small>بعد اكتمال الفلو يستدعي الأوتوميشن قواعد التوزيع الحالية بدون اختيار مندوب بنفسه.</small></span></article>
      </section>

      <div className="crm-settings-grid crm-entry-routing-grid">
        <section className="crm-panel settings-card full">
          <header className="crm-settings-section-head"><div><h2>الفصل بين دخول العملاء والأوتوميشن</h2><p>هذا التبويب يوضح المسؤوليات فقط لمنع وجود منطقين متوازيين.</p></div><CheckCircle size={25} weight="duotone" /></header>
          <div className="crm-entry-routing-responsibilities">
            <article><strong>إعدادات الأوتوميشن</strong><span>التشغيل والإيقاف، سياسة التشغيل، رسالة اختيار الخدمة، الرسائل، الردود المقبولة، أسئلة الفلو، حفظ الإجابات، المنصات والـWorkers، والإجراء النهائي.</span></article>
            <article><strong>دخول وتوزيع العملاء</strong><span>قواعد الموظفين، ترتيب الدور، الأقسام والفروع، الموظفون المؤهلون، توزيع الكول سنتر، وتسجيل نتيجة التوزيع.</span></article>
          </div>
        </section>

        <section className="crm-panel settings-card">
          <h2>العميل الموجود وله طلب مفتوح</h2>
          <div className="crm-rule-safety"><span>✓ الرسالة تدخل نفس المحادثة.</span><span>✓ لا يتم إنشاء طلب مكرر.</span><span>✓ لا يتم تشغيل توزيع مكرر.</span><span>✓ تظل الملكية الحالية محفوظة.</span></div>
        </section>

        <section className="crm-panel settings-card">
          <h2>العميل الجديد</h2>
          <div className="crm-rule-safety"><span>✓ تبدأ جلسة أوتوميشن واحدة.</span><span>✓ يتم حفظ كل إجابة بالخطوة.</span><span>✓ إنشاء الطلب بعد اكتمال الفلو.</span><span>✓ التوزيع من القواعد المركزية.</span></div>
        </section>

        <section className="crm-panel settings-card full crm-entry-routing-boundary">
          <h2>حدود التشغيل</h2>
          <p>لا توجد هنا رسالة أو اختيارات قابلة للتعديل حتى لا تصبح مصدرًا ثانيًا للإعدادات. استخدم تبويب «إعدادات الأوتوميشن» للرسائل والفلو، وتبويب «توزيع العملاء» لقواعد الموظفين والدور.</p>
        </section>
      </div>
    </div>
  );
}
