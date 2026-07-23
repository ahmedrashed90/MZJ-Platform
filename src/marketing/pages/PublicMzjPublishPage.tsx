import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "@phosphor-icons/react";
import "../styles/marketing.css";

const content={
  privacy:{title:"Privacy Policy",arabic:"سياسة الخصوصية",body:"توضح هذه الصفحة كيفية معالجة بيانات الحساب والمحتوى عند استخدام MZJ Publish. يتم استخدام البيانات فقط لتشغيل خصائص الربط والنشر المصرح بها، ولا تتم مشاركة رموز الوصول مع المستخدمين أو تخزينها في المتصفح."},
  terms:{title:"Terms of Service",arabic:"شروط الخدمة",body:"باستخدام MZJ Publish يوافق المستخدم على استخدام المنصة ضمن صلاحيات العمل الممنوحة له، وعدم رفع محتوى مخالف أو محاولة الوصول إلى حسابات أو بيانات غير مصرح بها."},
  deletion:{title:"Data Deletion",arabic:"حذف البيانات",body:"يمكن طلب فصل الحساب أو حذف بيانات الربط من خلال مدير النظام. عند تنفيذ الطلب يتم إبطال الاتصال وحذف أو تعطيل رموز الوصول وبيانات الربط وفق متطلبات المنصة الخارجية."},
};
export function PublicMzjPublishPage({page="home"}:{page?:"home"|"privacy"|"terms"|"deletion"}){const item=page==="home"?null:content[page];useEffect(()=>{document.title="MZJ Publish";return()=>{document.title="MZJ Platform"}},[]);return <main className="mzj-publish-public"><section><img src="/mzj-publish/mzj-publish-icon.png" alt="MZJ Publish"/><span>MZJ Workspace</span><h1>{item?.title||"MZJ Publish"}</h1><h2>{item?.arabic||"مركز إدارة وجدولة النشر"}</h2><p>{item?.body||"منصة داخلية لإدارة المحتوى وتجهيز النشر وربط الحسابات بطريقة آمنة من خلال منصة MZJ الموحدة."}</p>{page==="home"?<Link className="marketing-button" to="/login">Sign in</Link>:<Link className="marketing-button secondary" to="/mzj-publish">العودة إلى MZJ Publish</Link>}<nav><Link to="/mzj-publish/privacy-policy">Privacy Policy</Link><Link to="/mzj-publish/terms-of-service">Terms of Service</Link><Link to="/mzj-publish/data-deletion">Data Deletion</Link></nav><footer><ShieldCheck size={18}/>OAuth tokens are handled server-side.</footer></section></main>}
