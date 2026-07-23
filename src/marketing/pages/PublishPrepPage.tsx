import { useEffect, useState } from "react";
import { CalendarBlank, PaperPlaneTilt } from "@phosphor-icons/react";
import { formatMarketingDate, marketingFetch } from "../api";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";
import { MarketingStatusBadge } from "../components/MarketingStatusBadge";
import { MarketingEmpty } from "../components/MarketingEmpty";

export function PublishPrepPage() {
  const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  async function load() { setLoading(true); setError(""); try { const result = await marketingFetch<{ok:boolean;items:any[]}>("resource=publish-prep"); setItems(result.items); } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل تجهيز النشر"); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  if (loading && !items.length) return <MarketingLoading label="جاري تجهيز عناصر النشر..." />;
  return <div className="marketing-page"><MarketingPageHeader title="تجهيز النشر" description="المهام التنفيذية المكتملة وملفاتها النهائية ونسخة Task Template المعتمدة." />{error ? <MarketingError message={error} onRetry={() => void load()} /> : null}<section className="marketing-panel">{items.length ? <div className="marketing-publish-grid">{items.map((item) => <article key={item.id} className="marketing-publish-card"><header><div><small>{item.campaign_code}</small><h3>{item.campaign_name}</h3></div><MarketingStatusBadge status={item.status} /></header><div className="marketing-publish-media"><PaperPlaneTilt size={30} weight="duotone" /><span>{item.final_file_name || "الملف النهائي غير متاح"}</span></div><dl><div><dt>الكرييتيف</dt><dd>{item.instance_code || item.creative_type}</dd></div><div><dt>الكابشن</dt><dd>{item.caption || "—"}</dd></div><div><dt>الهاشتاج</dt><dd>{item.hashtags || "—"}</dd></div></dl><footer>{Array.isArray(item.targets) && item.targets.length ? item.targets.map((target:any) => <span key={target.id}><CalendarBlank size={14} />{target.platform} · {formatMarketingDate(target.publishAt)} · <MarketingStatusBadge status={target.status} /></span>) : <small>لم تتم إضافة Targets بعد</small>}</footer></article>)}</div> : <MarketingEmpty title="لا توجد عناصر جاهزة للنشر" description="تظهر العناصر تلقائيًا بعد اكتمال مهمة التنفيذ ووجود الملف النهائي." />}</section></div>;
}
