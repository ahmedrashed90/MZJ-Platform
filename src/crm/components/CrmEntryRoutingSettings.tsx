import { useEffect, useState } from "react";
import { ArrowClockwise, GitBranch, Robot, Shuffle, UserCirclePlus } from "@phosphor-icons/react";
import { crmFetch } from "../api";

type Props = {
  onOpenAutomation: () => void;
  onOpenDistribution: () => void;
};

export function CrmEntryRoutingSettings({ onOpenAutomation, onOpenDistribution }: Props) {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/automation-settings");
      setSettings(result.settings);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل منطق دخول العملاء");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const activeServices = (settings?.serviceOptions || []).filter((row: any) => row.active).length;
  const activeWorkers = (settings?.platformWorkers || []).filter((row: any) => row.enabled).length;

  return (
    <div className="crm-entry-routing-settings">
      <section className="crm-entry-routing-flow">
        <article><UserCirclePlus size={28} weight="duotone" /><span><b>1</b><strong>حفظ الرسالة والعميل</strong><small>يتم حفظ الرسالة الواردة أولًا، ولا يؤدي تعطل الأوتوميشن إلى فقدانها.</small></span></article>
        <article><Robot size={28} weight="duotone" /><span><b>2</b><strong>تشغيل الأوتوميشن</strong><small>رسائل البداية، اختيار الخدمة، الأسئلة وحفظ الإجابات من مصدر مركزي واحد.</small></span></article>
        <article><GitBranch size={28} weight="duotone" /><span><b>3</b><strong>تحديد الخدمة</strong><small>يتم إنشاء طلب الخدمة مرة واحدة ثم إرسال طلب مستقل لمحرك التوزيع.</small></span></article>
        <article><Shuffle size={28} weight="duotone" /><span><b>4</b><strong>توزيع الموظف</strong><small>يطبق قواعد القسم والفرع والدور دون التحكم في رسائل أو خطوات الأوتوميشن.</small></span></article>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <section className="crm-panel crm-entry-routing-overview">
        <header><div><h2>منطق دخول وتوزيع العملاء</h2><p>هذه الصفحة توضح حدود كل محرك فقط. تعديل رسائل وفلو العميل يتم من إعدادات الأوتوميشن، وتعديل الموظفين وترتيب الدور يتم من توزيع العملاء.</p></div><button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={17} />{loading ? "جاري التحميل" : "تحديث الحالة"}</button></header>
        <div className="crm-entry-routing-stats">
          <span><small>حالة الأوتوميشن</small><strong>{settings?.enabled ? "نشط" : "غير نشط"}</strong></span>
          <span><small>الخدمات النشطة</small><strong>{activeServices}</strong></span>
          <span><small>الـWorkers النشطة</small><strong>{activeWorkers}</strong></span>
          <span><small>سياسة التشغيل</small><strong>{settings?.triggerMode === "once_24h" ? "مرة كل 24 ساعة" : settings?.triggerMode === "custom" ? "مدة مخصصة" : "مع كل رسالة"}</strong></span>
        </div>
      </section>

      <div className="crm-settings-grid crm-entry-routing-grid">
        <section className="crm-panel settings-card">
          <header><div><h2>إعدادات الأوتوميشن</h2><p>المصدر الوحيد لرسالة اختيار الخدمة، الخدمات والردود المقبولة، الفلو والأسئلة.</p></div></header>
          <div className="crm-rule-safety"><span>✓ لا توجد رسالة اختيار خدمة مكررة هنا.</span><span>✓ لا توجد قيم Hardcoded تعمل بالتوازي.</span><span>✓ إجابة العميل داخل الفلو لا تبدأ Trigger جديدًا.</span><span>✓ كل Worker يقرأ نسخة الإعدادات المركزية.</span></div>
          <button className="crm-primary-button" onClick={onOpenAutomation}><Robot size={18} />فتح إعدادات الأوتوميشن</button>
        </section>

        <section className="crm-panel settings-card">
          <header><div><h2>قواعد توزيع الموظفين</h2><p>مسؤولة فقط عن تحديد الموظف بعد اختيار الخدمة وإنشاء طلب العميل.</p></div></header>
          <div className="crm-rule-safety"><span>✓ لا ترسل رسالة للعميل.</span><span>✓ لا تبدأ أو تلغي فلو.</span><span>✓ لا تعيد قائمة الخدمات.</span><span>✓ فشل التوزيع لا يوقف الأوتوميشن.</span></div>
          <button className="crm-secondary-button" onClick={onOpenDistribution}><Shuffle size={18} />فتح توزيع العملاء</button>
        </section>

        <section className="crm-panel settings-card full crm-entry-routing-boundary">
          <h2>نقطة الربط الوحيدة</h2>
          <p>عند اختيار الخدمة، ينشئ النظام طلب الخدمة مرة واحدة ويطلب التوزيع. بعد ذلك يكمل الأوتوميشن الأسئلة ورسالة النهاية بصورة مستقلة. إذا لم يوجد موظف متاح، يبقى الطلب غير موزع مع استمرار الفلو دون إرسال رسائل مكررة أو إعادة البداية.</p>
        </section>
      </div>
    </div>
  );
}
