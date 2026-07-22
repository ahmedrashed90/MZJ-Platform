import { ArrowRight, GitBranch, ShieldCheck, UsersThree } from "@phosphor-icons/react";

export function CrmEntryRoutingSettings() {
  return (
    <div className="crm-entry-routing-settings">
      <section className="crm-entry-routing-flow">
        <article>
          <UsersThree size={28} weight="duotone" />
          <span><b>1</b><strong>دخول العميل</strong><small>حفظ الرسالة والمحادثة والهوية من جميع المنصات.</small></span>
        </article>
        <article>
          <ArrowRight size={28} weight="duotone" />
          <span><b>2</b><strong>الأوتوميشن</strong><small>الرسائل والاختيارات والأسئلة أصبحت في تبويب إعدادات الأوتوميشن فقط.</small></span>
        </article>
        <article>
          <GitBranch size={28} weight="duotone" />
          <span><b>3</b><strong>محرك التوزيع المركزي</strong><small>يطبق قواعد الدور والفروع والموظفين المحفوظة بدون منطق توزيع موازٍ.</small></span>
        </article>
      </section>

      <section className="crm-panel settings-card full crm-entry-routing-boundary">
        <header className="crm-settings-section-head">
          <div>
            <h2>الفصل بين دخول العميل والأوتوميشن والتوزيع</h2>
            <p>هذه الصفحة توضح حدود المسؤوليات فقط حتى لا يعمل فلو قديم بالتوازي مع محرك الأوتوميشن الجديد.</p>
          </div>
          <ShieldCheck size={34} weight="duotone" />
        </header>
        <div className="crm-rule-safety">
          <span>✓ إعدادات الأوتوميشن هي المصدر الوحيد للرسائل والاختيارات والأسئلة ورسائل النهاية.</span>
          <span>✓ تبويب توزيع العملاء يظل المصدر الوحيد لقواعد الموظفين والدور والفروع.</span>
          <span>✓ الـWorkers يستقبلون ويرسلون فقط ولا يحددون الخدمة أو المندوب.</span>
          <span>✓ لا يوجد حفظ لإعدادات فلو قديمة من هذه الصفحة.</span>
        </div>
      </section>
    </div>
  );
}
