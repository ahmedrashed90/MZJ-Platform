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
import { MessagingWindowBadge } from "../components/MessagingWindowBadge";

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
  const [sortMode, setSortMode] = useState<"expiry" | "latest">("expiry");
  const [openConversationId, setOpenConversationId] = useState("");
  const [conversationMessages, setConversationMessages] = useState<any[]>([]);
  const [draftReply, setDraftReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

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


  async function openConversation(id: string) {
    if (openConversationId === id) { setOpenConversationId(""); return; }
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; messages: any[] }>(`/api/crm/conversations?conversationId=${encodeURIComponent(id)}&limit=100`);
      setConversationMessages(result.messages || []);
      setOpenConversationId(id);
      setDraftReply("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر فتح المحادثة");
    }
  }

  async function sendReply(id: string) {
    const message = draftReply.trim();
    if (!message || sendingReply) return;
    setSendingReply(true);
    setNotice("");
    try {
      await crmFetch("/api/crm/conversations", { method: "POST", body: JSON.stringify({ conversationId: id, text: message }) });
      setDraftReply("");
      const result = await crmFetch<{ ok: boolean; messages: any[] }>(`/api/crm/conversations?conversationId=${encodeURIComponent(id)}&limit=100`);
      setConversationMessages(result.messages || []);
      setNotice("تم إرسال الرد للعميل.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر إرسال الرد");
    } finally {
      setSendingReply(false);
    }
  }

  // Nearest window expiry first (still-open windows), already-closed ones last.
  const sortedRows = sortMode === "latest" ? rows : [...rows].sort((a, b) => {
    const rank = (row: InboxRow) => {
      const expires = row.messaging_window?.expiresAt ? new Date(row.messaging_window.expiresAt).getTime() : NaN;
      if (!Number.isFinite(expires)) return Number.MAX_SAFE_INTEGER;
      return expires > Date.now() ? expires : Number.MAX_SAFE_INTEGER - 1;
    };
    return rank(a) - rank(b);
  });

  return (
    <div className="crm-page crm-unclassified-page">
      <div className="page-top-actions"><button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />{loading ? "جاري التحديث" : "تحديث"}</button></div>

      <section className="crm-unclassified-summary">
        <article><span className="icon"><ChatCircleDots size={23} /></span><div><small>إجمالي غير المصنف</small><strong>{Number(summary.total || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><span className="icon new"><Sparkle size={23} /></span><div><small>رسائل جديدة</small><strong>{Number(summary.new_count || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><span className="icon waiting"><ClockCountdown size={23} /></span><div><small>بانتظار اختيار الخدمة</small><strong>{Number(summary.awaiting_count || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
        <article><span className="icon unread"><WhatsappLogo size={23} /></span><div><small>غير مقروءة</small><strong>{Number(summary.unread_count || 0).toLocaleString("ar-SA-u-nu-latn")}</strong></div></article>
      </section>

      <section className="crm-panel crm-unclassified-filter">
        <label className="crm-search-box wide"><MagnifyingGlass size={19} /><input placeholder="بحث بالاسم أو الرقم أو محتوى آخر رسالة" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
        <select value={state} onChange={(event) => setState(event.target.value)}><option value="">كل الحالات</option><option value="new">رسالة جديدة</option><option value="awaiting_service">بانتظار اختيار الخدمة</option></select>
        <select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">كل القنوات</option><option value="whatsapp">واتساب</option><option value="facebook">فيسبوك</option><option value="instagram">إنستجرام</option><option value="tiktok">تيك توك</option></select>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as "expiry" | "latest")} aria-label="ترتيب القائمة"><option value="expiry">الأقرب انتهاءً للنافذة أولًا</option><option value="latest">الأحدث أولًا</option></select>
        <button className="crm-primary-button" type="button" onClick={() => void load()}>تطبيق</button>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-unclassified-list">
        {sortedRows.map((row) => {
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
                <footer><span>آخر رسالة: {formatDate(row.last_customer_message_at || row.last_message_at)}</span>{row.messaging_window ? <MessagingWindowBadge compact expiresAt={row.messaging_window.expiresAt} windowHours={row.messaging_window.windowHours} /> : null}{Number(row.unread_count || 0) ? <b>{Number(row.unread_count)} غير مقروءة</b> : <span>تمت القراءة</span>}</footer>
              </div>
              <aside className="crm-unclassified-actions">
                <div><CheckCircle size={21} weight="duotone" /><strong>تصنيف الرسالة</strong><small>اختر الخدمة الصحيحة ليتم إنشاء العميل والطلب والتوزيع.</small></div>
                {canClassify ? <div className="crm-unclassified-buttons">{serviceButtons.map((service) => <button type="button" key={service.key} disabled={classifyingId === row.id} onClick={() => void classify(row.id, service.key)}>{classifyingId === row.id ? "جاري التنفيذ..." : service.label}</button>)}</div> : <span className="crm-unclassified-manager-note">التصنيف متاح للإدارة فقط</span>}
                <span className="crm-unclassified-manager-note">المندوب المسؤول: {row.assigned_name || "غير موزع"}</span>
                <button className="crm-secondary-button" type="button" onClick={() => void openConversation(row.id)}>
                  <ChatCircleDots size={17} /> {openConversationId === row.id ? "إغلاق المحادثة" : "فتح المحادثة والرد"}
                </button>
              </aside>
              {openConversationId === row.id ? (
                <div className="crm-unclassified-chat" style={{ gridColumn: "1 / -1", padding: "16px", background: "var(--crm-surface, #f8f5f1)" }}>
                  <div style={{ display: "grid", gap: 8, maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
                    {conversationMessages.map((message) => (
                      <div key={message.id} style={{ padding: "8px 12px", borderRadius: 10, background: "#fff", textAlign: "right" }}>
                        <strong>{message.direction === "in" ? "العميل" : "المعرض"}</strong>
                        <p style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{message.body || "مرفق أو رسالة بدون نص"}</p>
                      </div>
                    ))}
                  </div>
                  <label className="ia-field" style={{ display: "grid", gap: 8 }}>
                    <span>الرد على العميل</span>
                    <textarea className="ia-textarea" rows={3} value={draftReply} onChange={(e) => setDraftReply(e.target.value)} placeholder="اكتب ردك هنا..." />
                  </label>
                  <button className="crm-primary-button" type="button" disabled={sendingReply || !draftReply.trim()} onClick={() => void sendReply(row.id)}>
                    {sendingReply ? "جاري الإرسال..." : "إرسال الرد"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
        {!loading && !rows.length ? <div className="crm-empty-state panel crm-unclassified-empty"><CheckCircle size={46} weight="duotone" /><strong>لا توجد رسائل تحتاج تصنيف</strong><span>كل الرسائل الحالية تم توجيهها إلى الخدمة الصحيحة.</span></div> : null}
        {loading ? <div className="crm-empty-state panel">جاري تحميل الرسائل غير المصنفة...</div> : null}
      </div>
    </div>
  );
}
