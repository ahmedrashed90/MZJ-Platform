import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, GitBranch, Robot, Shuffle, UsersThree } from "@phosphor-icons/react";
import { crmFetch } from "../api";

const departmentLabels: Record<string, string> = { cash_sales: "مبيعات الكاش", finance_sales: "مبيعات التمويل", customer_service: "خدمة العملاء", call_center: "الكول سنتر" };

export function CrmEntryRoutingSettings() {
  const [data, setData] = useState<any>({ rules: [], users: { total: 0, eligible: 0 } });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true);
    try { setData(await crmFetch<any>("/api/crm/entry-routing")); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل قواعد التوزيع"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <div className="crm-entry-routing-settings">
    <section className="crm-entry-routing-flow">
      <article><Robot size={28} weight="duotone" /><span><b>1</b><strong>الأوتوميشن يحدد الخدمة</strong><small>الرسائل والأسئلة والإجابات تُدار من تبويب إعدادات الأوتوميشن.</small></span></article>
      <article><GitBranch size={28} weight="duotone" /><span><b>2</b><strong>طلب توزيع مركزي</strong><small>الأوتوميشن يطلب التوزيع مرة واحدة ولا يختار الموظف بنفسه.</small></span></article>
      <article><CheckCircle size={28} weight="duotone" /><span><b>3</b><strong>محرك التوزيع ينفذ</strong><small>القسم والفرع والدور والموظفون المؤهلون مصدرهم القواعد الحالية فقط.</small></span></article>
    </section>
    {notice ? <div className="crm-inline-notice">{notice}</div> : null}
    <section className="crm-panel settings-card full crm-entry-routing-boundary">
      <header className="crm-settings-section-head"><div><h2>حدود المسؤولية</h2><p>لا توجد هنا نسخة أخرى من رسائل الترحيب أو اختيارات الخدمات.</p></div><button className="crm-secondary-button" type="button" onClick={() => void load()}><ArrowClockwise size={17} />{loading ? "جاري التحميل" : "تحديث"}</button></header>
      <div className="crm-entry-routing-responsibilities">
        <article><Robot size={23} /><strong>إعدادات الأوتوميشن</strong><span>تشغيل الفلو، الرسائل، الردود المقبولة، الأسئلة، التحقق، والإجراء النهائي.</span></article>
        <article><Shuffle size={23} /><strong>دخول وتوزيع العملاء</strong><span>ترتيب الدور، الفروع، الأقسام، الموظفون المؤهلون، وتوزيع الكول سنتر.</span></article>
      </div>
    </section>
    <section className="crm-panel settings-card full">
      <header className="crm-settings-section-head"><div><h2>القواعد المتاحة حاليًا</h2><p>{data.users?.eligible || 0} مستخدم مؤهل لاستقبال العملاء من أصل {data.users?.total || 0}.</p></div><UsersThree size={24} /></header>
      <div className="crm-entry-routing-rule-list">
        {(data.rules || []).map((rule: any) => <article key={rule.id}><span className={rule.is_active ? "active" : "inactive"}>{rule.is_active ? "نشطة" : "متوقفة"}</span><div><strong>{rule.name}</strong><small>{departmentLabels[rule.department_code] || rule.department_code}{rule.branch_code ? ` · ${rule.branch_code}` : " · كل الفروع"}</small></div><b>{rule.active_member_count || 0}<small>مستقبل نشط</small></b></article>)}
        {!data.rules?.length ? <div className="crm-automation-empty">لا توجد قواعد توزيع محفوظة بعد. أضفها من تبويب «توزيع العملاء».</div> : null}
      </div>
    </section>
  </div>;
}
