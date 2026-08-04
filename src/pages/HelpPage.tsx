import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpenText,
  ChartBar,
  CheckCircle,
  Database,
  Gear,
  Lifebuoy,
  MagnifyingGlass,
  MapPin,
  Megaphone,
  Pulse,
  Question,
  ShieldCheck,
  SuitcaseSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, canOpenSettings, hasPermission } from "../systemAccess";

type HelpSection = {
  id: string;
  title: string;
  description: string;
  icon: typeof Question;
  link?: string;
  steps: string[];
  keywords: string;
  visible: boolean;
};

export function HelpPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const sections = useMemo<HelpSection[]>(() => [
    {
      id: "start", title: "البدء واستخدام المنصة", description: "التنقل بين الأنظمة ومعرفة الصفحات المتاحة حسب صلاحيتك.", icon: BookOpenText, link: "/",
      steps: ["استخدم القائمة الجانبية للانتقال بين الأنظمة.", "الصفحات الظاهرة لك تعتمد على الدور والصلاحيات المسندة لحسابك.", "استخدم الداش بورد للوصول السريع إلى مؤشرات الأنظمة المتاحة."], keywords: "البدء الدخول القائمة الداش بورد", visible: true,
    },
    {
      id: "crm", title: "نظام CRM", description: "إدارة العملاء والمحادثات والتقارير والمتابعة البيعية.", icon: UsersThree, link: "/crm",
      steps: ["افتح الداش بورد لمتابعة العملاء حسب الحالة والقسم.", "استخدم قاعدة البيانات للبحث والتصفية وتحديث بيانات العميل.", "المحادثات والتقارير تظهر وفق نطاق الفروع والأقسام المسموح لك بها."], keywords: "CRM العملاء المحادثات المبيعات التقارير", visible: canAccessCrm(user),
    },
    {
      id: "marketing", title: "نظام التسويق", description: "الحملات والأجندات والتاسكات وتجهيز النشر والمتابعة.", icon: Megaphone, link: "/marketing",
      steps: ["أنشئ حملة أو أجندة وحدد الكرييتيفات والأقسام واليوزرات.", "تابع Task Template والتاسكات التنفيذية من الداش بورد.", "بعد اكتمال المطلوب انتقل إلى تجهيز النشر والتقويم."], keywords: "التسويق حملة أجندة Task Template نشر", visible: canAccessMarketing(user),
    },
    {
      id: "operations", title: "نظام العمليات", description: "مخزون السيارات والحركات وطلبات النقل والموافقات.", icon: SuitcaseSimple, link: "/operations",
      steps: ["استخدم مخزون السيارات للبحث برقم الهيكل وعرض التشييك والموافقات.", "إدارة السيارات مخصصة للإضافة والاستيراد والتعديل.", "طلبات النقل والحركات تسجل تاريخ السيارة كاملًا."], keywords: "العمليات السيارات المخزون التشييك النقل الموافقات", visible: canAccessOperations(user),
    },
    {
      id: "tracking", title: "نظام التراكينج", description: "متابعة طلبات السيارات والمراحل والرسائل والأرشيف.", icon: MapPin, link: "/tracking",
      steps: ["ابحث برقم الطلب أو بيانات العميل.", "افتح الطلب لمتابعة المراحل والسيارات المرتبطة.", "الأرشفة والحذف والاسترجاع تظهر حسب الصلاحيات."], keywords: "التراكينج الطلبات المراحل السيارات SMS", visible: canAccessTracking(user),
    },
    {
      id: "reports", title: "التقارير وقاعدة البيانات", description: "عرض موحد لتقارير وبيانات الأنظمة المتاحة.", icon: ChartBar, link: hasPermission(user, "platform.reports.view") ? "/reports" : "/database",
      steps: ["صفحة التقارير تجمع مؤشرات الأنظمة حسب صلاحيتك.", "صفحة قاعدة البيانات تسمح بالبحث والتصفية والتصدير.", "يمكن فتح الصفحة الأصلية للنظام للوصول للتفاصيل الكاملة."], keywords: "التقارير قاعدة البيانات البحث التصدير", visible: hasPermission(user, "platform.reports.view") || hasPermission(user, "platform.database.view"),
    },
    {
      id: "settings", title: "الإعدادات والصلاحيات", description: "إدارة المستخدمين والأدوار وإعدادات الأنظمة والتكاملات.", icon: Gear, link: "/settings",
      steps: ["حدد المستخدم قبل تعديل بياناته أو صلاحياته.", "لا تغيّر الصلاحيات إلا بعد كتابة سبب التعديل.", "إعدادات كل نظام مستقلة ولا تؤثر على الأنظمة الأخرى إلا عند الحفظ المقصود."], keywords: "الإعدادات المستخدمون الصلاحيات الأدوار الأقسام", visible: canOpenSettings(user),
    },
    {
      id: "activity", title: "سجل النشاط والأمان", description: "مراجعة من نفذ الإجراء ومتى وعلى أي نظام.", icon: Pulse, link: "/activity",
      steps: ["استخدم البحث والفلاتر للوصول إلى نشاط محدد.", "اضغط «عرض» لمشاهدة البيانات قبل الإجراء وبعده.", "العمليات المرفوضة تظهر بنتيجة واضحة وسبب الرفض عند توفره."], keywords: "سجل النشاط الأمان المستخدم الإجراء", visible: hasPermission(user, "platform.activity.view"),
    },
  ], [user]);

  const visible = sections.filter((section) => section.visible && `${section.title} ${section.description} ${section.keywords} ${section.steps.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));

  const faqs = [
    ["لماذا لا تظهر لي صفحة أو زر؟", "الصفحات والأزرار مرتبطة بصلاحيات حسابك ونطاق النظام والفرع والقسم. راجع مدير النظام عند الحاجة."],
    ["لماذا لا تظهر بيانات نظام معيّن؟", "تأكد أن النظام مفعّل لحسابك وأن لديك صلاحية العرض ونطاق البيانات المناسب."],
    ["ماذا أفعل عند فشل الحفظ؟", "راجع الحقول المطلوبة ورسالة الخطأ، ثم حدّث الصفحة وحاول مرة أخرى. لا تكرر الإجراء إذا ظهر أنه تم بالفعل."],
    ["كيف أراجع إجراء تم تنفيذه؟", "افتح سجل النشاط وابحث باسم المستخدم أو النظام أو الإجراء أو رقم السجل."],
  ];

  return (
    <div className="module-page help-page">
      <section className="help-hero">
        <div><span>مركز مساعدة المنصة</span><h2>كيف نقدر نساعدك؟</h2><p>ابحث باسم الصفحة أو الوظيفة للوصول إلى خطوات الاستخدام بسرعة.</p></div>
        <label><MagnifyingGlass size={22} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المساعدة: مستخدم، حملة، سيارة، تقرير..." /></label>
      </section>

      <section className="help-section-grid">
        {visible.map((section) => {
          const Icon = section.icon;
          return (
            <article key={section.id} className="help-section-card">
              <header><span><Icon size={24} weight="duotone" /></span><div><h2>{section.title}</h2><p>{section.description}</p></div></header>
              <ol>{section.steps.map((step) => <li key={step}><CheckCircle size={17} weight="fill" /><span>{step}</span></li>)}</ol>
              {section.link ? <Link to={section.link}>فتح الصفحة</Link> : null}
            </article>
          );
        })}
        {!visible.length ? <div className="help-no-results"><Question size={36} /><strong>لم نجد نتيجة مطابقة</strong><span>جرّب كلمة أقصر أو اسم النظام المطلوب.</span></div> : null}
      </section>

      <section className="help-faq panel">
        <header><ShieldCheck size={24} /><div><h2>أسئلة شائعة</h2><p>إجابات سريعة لأكثر المواقف المتكررة داخل المنصة.</p></div></header>
        <div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="help-footer-card"><Database size={24} /><div><strong>البيانات المعروضة داخل المنصة بيانات فعلية</strong><span>عند وجود اختلاف في البيانات استخدم صفحة قاعدة البيانات أو سجل النشاط للمراجعة قبل إعادة تنفيذ الإجراء.</span></div></section>
    </div>
  );
}
