import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  ChatCircleDots,
  CheckCircle,
  ClockCountdown,
  MagnifyingGlass,
  Phone,
  Sparkle,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";
import { sourceLabel } from "../sourceCatalog";

type InboxRow = Record<string, any>;

const serviceButtons = [
  { key: "cash", label: "مبيعات الكاش" },
  { key: "finance", label: "مبيعات التمويل" },
  { key: "service", label: "خدمة العملاء" },
];

export function CrmInboxPage() {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [channel, setChannel] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [classifyingId, setClassifyingId] = useState("");
  const [canClassify, setCanClassify] = useState(false);

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (state) q.set("state", state);
      if (channel) q.set("channel", channel);
      const result = await crmFetch<{ ok: boolean; rows: InboxRow[]; summary: Record<string, number>; canClassify: boolean }>(`/api/crm/inbox?${q}`);
      setRows(result.rows || []);
      setSummary(result.summary || {});
      setCanClassify(Boolean(result.canClassify));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل الرسائل غير المصنفة");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function classify(id: string, serviceKey: string) {
    setClassifyingId(id);
    setNotice("");
    try {
      await crmFetch("/api/crm/inbox", { method: "POST", body: JSON.stringify({ conversationId: id, serviceKey }) });
      setRows((current) => current.filter((row) => row.id !== id));
      setSummary((current) => ({ ...current, total: Math.max(0, Number(current.total || 0) - 1) }));
      setNotice("تم تصنيف الرسالة وإنشاء طلب الخدمة وتطبيق التوزيع.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل تصنيف الرسالة");
    } finally {
      setClassifyingId("");
    }
  }

  return (
    <div className="crm-page crm-unclassified-page">
      <header className="crm-page-head crm-unclassified-head">
        <div>
          <span className="crm-page-kicker"><Sparkle size={18} weight="duotone" /> نقطة المراجعة قبل إنشاء العميل</span>
          <h1>رسائل غير مصنفة</h1>
          <p>تظهر هنا الرسائل التي لم يُحدد صاحبها بعد هل يحتاج مبيعات كاش أو تمويل أو خدمة عملاء. بعد التصنيف تُنشأ دورة الخدمة وتختفي الرسالة من هذه الصفحة.</p>
        </div>
        <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />{loading ? "جاري التحديث" : "تحديث"}</button>
      </header>

      <section className="crm-unclassified-summary">
        <article><span className="icon"><ChatCircleDots size={23} /></span><div><small>إجمالي غير المصنف</small><strong>{Number(summary.total || 0).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon new"><Sparkle size={23} /></span><div><small>رسائل جديدة</small><strong>{Number(summary.new_count || 0).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon waiting"><ClockCountdown size={23} /></span><div><small>بانتظار اختيار الخدمة</small><strong>{Number(summary.awaiting_count || 0).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon unread"><WhatsappLogo size={23} /></span><div><small>غير مقروءة</small><strong>{Number(summary.unread_count || 0).toLocaleString("ar-SA")}</strong></div></article>
      </section>

      <section className="crm-panel crm-unclassified-filter">
        <label className="crm-search-box wide"><MagnifyingGlass size={19} /><input placeholder="بحث بالاسم أو الرقم أو محتوى آخر رسالة" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
        <select value={state} onChange={(event) => setState(event.target.value)}><option value="">كل الحالات</option><option value="new">رسالة جديدة</option><option value="awaiting_service">بانتظار اختيار الخدمة</option></select>
        <select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">كل القنوات</option><option value="whatsapp">واتساب</option><option value="facebook">فيسبوك</option><option value="instagram">إنستجرام</option><option value="tiktok">تيك توك</option></select>
        <button className="crm-primary-button" type="button" onClick={() => void load()}>تطبيق</button>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-unclassified-list">
        {rows.map((row) => {
          const name = row.lead_customer_name || row.contact_display_name || row.customer_name || "عميل";
          const phone = row.primary_phone || row.primary_phone_normalized || row.participant_id || "بدون رقم";
          const awaiting = row.classification_state === "awaiting_service";
          return (
            <article className={`crm-unclassified-card ${Number(row.unread_count || 0) ? "unread" : ""}`} key={row.id}>
              <div className="crm-unclassified-card-main">
                <header>
                  <span className="crm-unclassified-avatar"><ChatCircleDots size={26} weight="duotone" /></span>
                  <div><strong>{name}</strong><small><Phone size={13} /> {phone} <b>•</b> {sourceLabel(row.channel_code)}</small></div>
                  <span className={`crm-unclassified-state ${awaiting ? "waiting" : "new"}`}>{awaiting ? "بانتظار اختيار الخدمة" : "رسالة جديدة"}</span>
                </header>
                <div className="crm-unclassified-preview"><ChatCircleDots size={18} /><p>{row.preview_text || "وصل مرفق جديد بدون نص"}</p></div>
                <footer><span>آخر رسالة: {formatDate(row.last_customer_message_at || row.last_message_at)}</span>{Number(row.unread_count || 0) ? <b>{Number(row.unread_count)} غير مقروءة</b> : <span>تمت القراءة</span>}</footer>
              </div>
              <aside className="crm-unclassified-actions">
                <div><CheckCircle size={21} weight="duotone" /><strong>تصنيف الرسالة</strong><small>اختر الخدمة الصحيحة ليتم إنشاء العميل والطلب والتوزيع.</small></div>
                {canClassify ? <div className="crm-unclassified-buttons">{serviceButtons.map((service) => <button type="button" key={service.key} disabled={classifyingId === row.id} onClick={() => void classify(row.id, service.key)}>{classifyingId === row.id ? "جاري التنفيذ..." : service.label}</button>)}</div> : <span className="crm-unclassified-manager-note">التصنيف متاح للإدارة فقط</span>}
              </aside>
            </article>
          );
        })}
        {!loading && !rows.length ? <div className="crm-empty-state panel crm-unclassified-empty"><CheckCircle size={46} weight="duotone" /><strong>لا توجد رسائل تحتاج تصنيف</strong><span>كل الرسائل الحالية تم توجيهها إلى الخدمة الصحيحة.</span></div> : null}
        {loading ? <div className="crm-empty-state panel">جاري تحميل الرسائل غير المصنفة...</div> : null}
      </div>
    </div>
  );
}
