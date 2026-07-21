import { useEffect, useMemo, useState } from "react";
import {
  AddressBook,
  ArrowClockwise,
  ChatCircleDots,
  CheckCircle,
  ClockCounterClockwise,
  IdentificationCard,
  MagnifyingGlass,
  NotePencil,
  Phone,
  Trash,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, departmentLabel, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";

type ContactRow = {
  id: string;
  display_name?: string | null;
  primary_phone?: string | null;
  primary_phone_normalized?: string | null;
  latest_lead_id?: string | null;
  customer_name?: string | null;
  status_label?: string | null;
  department_code?: string | null;
  branch_code?: string | null;
  source_code?: string | null;
  source_name?: string | null;
  assigned_name?: string | null;
  call_center_name?: string | null;
  leads_count?: number;
  requests_count?: number;
  open_requests_count?: number;
  conversations_count?: number;
  last_activity_at?: string | null;
};

type ContactProfile = {
  contact: Record<string, any>;
  identities: Array<Record<string, any>>;
  leads: Array<Record<string, any>>;
  requests: Array<Record<string, any>>;
  conversations: Array<Record<string, any>>;
  messages: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  ownership: Array<Record<string, any>>;
  notes: Array<{ leadId: string; customerName?: string; text: string; updatedAt?: string }>;
  canPurge: boolean;
};

const serviceLabels: Record<string, string> = { cash: "مبيعات الكاش", finance: "مبيعات التمويل", service: "خدمة العملاء" };

function serviceLabel(value?: string | null, departmentCode?: string | null) {
  const key = String(value || "").trim();
  return serviceLabels[key] || departmentLabel(departmentCode || key);
}

function requestStateLabel(value?: string | null) {
  return String(value || "") === "closed" ? "منتهي" : "مفتوح";
}

function messageDirectionLabel(message: Record<string, any>) {
  return String(message.direction || "") === "out" ? "رسالة من الفريق" : "رسالة من العميل";
}

function profileValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function CrmContactsPage() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmPhone, setConfirmPhone] = useState("");
  const [purging, setPurging] = useState(false);

  useEffect(() => { void load(); }, []);
  useEscapeToClose(Boolean(selectedId) && !purgeOpen, closeProfile);
  useEscapeToClose(purgeOpen, () => setPurgeOpen(false));

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; rows: ContactRow[]; total: number; summary: Record<string, number> }>(`/api/crm/contacts${queryString({ q, limit: 200 })}`);
      setRows(result.rows || []);
      setTotal(Number(result.total || 0));
      setSummary(result.summary || {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل جهات الاتصال");
    } finally {
      setLoading(false);
    }
  }

  async function openProfile(id: string) {
    setSelectedId(id);
    setProfile(null);
    setProfileLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<ContactProfile & { ok: boolean }>(`/api/crm/contacts?id=${encodeURIComponent(id)}`);
      setProfile(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل ملف العميل");
      setSelectedId("");
    } finally {
      setProfileLoading(false);
    }
  }

  function closeProfile() {
    setSelectedId("");
    setProfile(null);
    setPurgeOpen(false);
    setConfirmPhone("");
  }

  async function purgeContact() {
    if (!selectedId || !confirmPhone.trim()) return;
    setPurging(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; deleted: Record<string, number> }>("/api/crm/contacts", {
        method: "DELETE",
        body: JSON.stringify({ id: selectedId, confirmPhone }),
      });
      const deleted = result.deleted || {};
      closeProfile();
      setNotice(`تم حذف ملف جهة الاتصال بالكامل: ${Number(deleted.leads || 0)} عميل، ${Number(deleted.requests || 0)} طلب، ${Number(deleted.conversations || 0)} محادثة، ${Number(deleted.messages || 0)} رسالة.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حذف ملف جهة الاتصال");
    } finally {
      setPurging(false);
    }
  }

  const currentLead = useMemo(() => profile?.leads?.find((lead) => !lead.is_deleted) || profile?.leads?.[0] || null, [profile]);
  const latestMessages = useMemo(() => (profile?.messages || []).slice(0, 30), [profile]);
  const customData = useMemo(() => Object.entries(currentLead?.extra_data || {}).filter(([, item]) => item != null && String(item).trim() !== ""), [currentLead]);

  return (
    <div className="crm-page crm-contacts-page">
      <header className="crm-page-head crm-contacts-page-head">
        <div>
          <span className="crm-page-kicker"><AddressBook size={18} weight="duotone" /> السجل الدائم للعملاء</span>
          <h1>جهات الاتصال</h1>
          <p>ملف موحد لكل رقم يجمع بيانات العميل، الطلبات، الملاحظات، التوزيع، المحادثات وسجل التغييرات.</p>
        </div>
        <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />{loading ? "جاري التحديث" : "تحديث"}</button>
      </header>

      <section className="crm-contacts-summary">
        <article><span className="icon"><AddressBook size={22} /></span><div><small>إجمالي جهات الاتصال</small><strong>{Number(summary.total_contacts ?? total).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon open"><ClockCounterClockwise size={22} /></span><div><small>لديها طلب مفتوح</small><strong>{Number(summary.open_contacts || 0).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon done"><CheckCircle size={22} /></span><div><small>لديها طلبات منتهية</small><strong>{Number(summary.completed_contacts || 0).toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon chat"><ChatCircleDots size={22} /></span><div><small>لديها محادثات</small><strong>{Number(summary.contacts_with_conversations || 0).toLocaleString("ar-SA")}</strong></div></article>
      </section>

      <section className="crm-panel crm-contacts-toolbar">
        <label className="crm-search-box wide"><MagnifyingGlass size={19} /><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="بحث بالاسم أو رقم الجوال أو الحالة أو الملاحظات" /></label>
        <button className="crm-primary-button" type="button" onClick={() => void load()}>بحث</button>
        <span className="crm-contacts-result-count">النتائج <b>{total.toLocaleString("ar-SA")}</b></span>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-contacts-grid">
        {rows.map((row) => (
          <button type="button" className="crm-contact-card" key={row.id} onClick={() => void openProfile(row.id)}>
            <header>
              <span className="crm-contact-avatar"><UserCircle size={34} weight="duotone" /></span>
              <div><strong>{row.customer_name || row.display_name || "عميل"}</strong><small><Phone size={13} /> {row.primary_phone || row.primary_phone_normalized || "بدون رقم"}</small></div>
              <span className={`crm-contact-request-state ${Number(row.open_requests_count || 0) ? "open" : "closed"}`}>{Number(row.open_requests_count || 0) ? "طلب مفتوح" : "لا يوجد طلب مفتوح"}</span>
            </header>
            <div className="crm-contact-card-main">
              <span><b>آخر حالة</b>{row.status_label || "غير مصنف"}</span>
              <span><b>القسم</b>{row.department_code ? departmentLabel(row.department_code) : "غير محدد"}</span>
              <span><b>المسؤول</b>{row.assigned_name || "غير موزع"}</span>
              <span><b>المصدر</b>{sourceLabel(row.source_code, row.source_name)}</span>
            </div>
            <footer>
              <span>{Number(row.requests_count || 0)} طلب</span>
              <span>{Number(row.conversations_count || 0)} محادثة</span>
              <time>{formatDate(row.last_activity_at)}</time>
            </footer>
          </button>
        ))}
        {!loading && !rows.length ? <div className="crm-empty-state panel"><AddressBook size={42} weight="duotone" /><strong>لا توجد جهات اتصال مطابقة</strong><span>غيّر البحث ثم أعد المحاولة.</span></div> : null}
        {loading ? <div className="crm-empty-state panel">جاري تحميل جهات الاتصال...</div> : null}
      </div>

      {selectedId ? (
        <div className="crm-modal-backdrop crm-contact-profile-backdrop" onMouseDown={closeProfile}>
          <article className="crm-contact-profile" onMouseDown={(event) => event.stopPropagation()}>
            {profileLoading || !profile ? <div className="crm-loading-panel">جاري تجهيز ملف العميل الكامل...</div> : (
              <>
                <header className="crm-contact-profile-head">
                  <div className="crm-contact-profile-identity">
                    <span className="crm-contact-profile-avatar"><IdentificationCard size={38} weight="duotone" /></span>
                    <div><small>ملف جهة الاتصال</small><h2>{currentLead?.customer_name || profile.contact.display_name || "عميل"}</h2><p><Phone size={15} /> {profile.contact.primary_phone || profile.contact.primary_phone_normalized || "بدون رقم"}</p></div>
                  </div>
                  <div className="crm-contact-profile-status">
                    <span><b>الحالة الحالية</b>{currentLead?.status_label || "غير مصنف"}</span>
                    <span><b>القسم</b>{currentLead ? departmentLabel(currentLead.department_code) : "غير محدد"}</span>
                    <span><b>المسؤول</b>{currentLead?.assigned_name || "غير موزع"}</span>
                  </div>
                  <div className="crm-contact-profile-actions">
                    {profile.canPurge ? <button type="button" className="crm-danger-button" onClick={() => { setConfirmPhone(""); setPurgeOpen(true); }}><Trash size={17} />حذف الملف بالكامل</button> : null}
                    <button type="button" className="crm-icon-button" onClick={closeProfile}><X size={20} /></button>
                  </div>
                </header>

                <div className="crm-contact-profile-body">
                  <section className="crm-contact-profile-section crm-contact-overview">
                    <header><div><h3>البيانات الحالية</h3><p>آخر بيانات محفوظة في CRM مع تفاصيل السيارة والتوزيع.</p></div><span>{currentLead?.status_label || "غير مصنف"}</span></header>
                    <div className="crm-contact-detail-grid">
                      <span><b>الاسم</b>{currentLead?.customer_name || profile.contact.display_name || "—"}</span>
                      <span><b>رقم الجوال</b>{currentLead?.phone || profile.contact.primary_phone || profile.contact.primary_phone_normalized || "—"}</span>
                      <span><b>المصدر</b>{sourceLabel(currentLead?.source_code, currentLead?.source_name)}</span>
                      <span><b>الفرع</b>{currentLead?.branch_name || currentLead?.branch_code || "—"}</span>
                      <span><b>السيارة</b>{currentLead?.car_name || currentLead?.car_type || "—"}</span>
                      <span><b>الفئة</b>{currentLead?.car_category || "—"}</span>
                      <span><b>الموديل</b>{currentLead?.car_model || "—"}</span>
                      <span><b>اللون</b>{currentLead?.color || "—"}</span>
                      <span><b>نوع الدفع</b>{currentLead?.payment_type || "—"}</span>
                      <span><b>نوع التمويل</b>{currentLead?.finance_type || "—"}</span>
                      <span><b>العمر</b>{profileValue(currentLead?.age)}</span>
                      <span><b>الراتب</b>{profileValue(currentLead?.salary)}</span>
                      <span><b>الالتزامات</b>{profileValue(currentLead?.obligation)}</span>
                      <span><b>بنك الراتب</b>{currentLead?.salary_bank || "—"}</span>
                      <span><b>المكان</b>{currentLead?.location || "—"}</span>
                      <span><b>الحد الائتماني</b>{profileValue(currentLead?.credit_limit)}</span>
                      <span><b>التأهيل الائتماني</b>{currentLead?.credit_qualified == null ? "—" : currentLead.credit_qualified ? "مؤهل" : "غير مؤهل"}</span>
                      <span><b>تاريخ المتابعة</b>{formatDate(currentLead?.follow_up_at)}</span>
                      <span><b>الحملة</b>{currentLead?.campaign_name || "—"}</span>
                      <span><b>تاريخ الحملة</b>{formatDate(currentLead?.campaign_date)}</span>
                      <span><b>اكتمال الملف</b>{currentLead?.completion_percent == null ? "—" : `${currentLead.completion_percent}%`}</span>
                      <span><b>ملاحظة الحالة</b>{currentLead?.status_note || "—"}</span>
                      <span><b>الكول سنتر</b>{currentLead?.call_center_name || "—"}</span>
                      <span><b>دخول السيستم</b>{formatDate(currentLead?.registered_at || currentLead?.created_at)}</span>
                      <span><b>آخر تحديث</b>{formatDate(currentLead?.updated_at)}</span>
                    </div>
                    {customData.length ? <div className="crm-contact-custom-data"><h4>الحقول الإضافية المحفوظة</h4><div className="crm-contact-detail-grid">{customData.map(([key, item]) => <span key={key}><b>{key.replace(/_/g, " ")}</b><pre>{profileValue(item)}</pre></span>)}</div></div> : null}
                  </section>

                  <section className="crm-contact-profile-section">
                    <header><div><h3>الملاحظات المسجلة</h3><p>كل الملاحظات المرتبطة بملف العميل.</p></div><NotePencil size={22} /></header>
                    <div className="crm-contact-notes">
                      {profile.notes.map((note, index) => <article key={`${note.leadId}-${index}`}><time>{formatDate(note.updatedAt)}</time><pre>{note.text}</pre></article>)}
                      {!profile.notes.length ? <div className="crm-empty-state">لا توجد ملاحظات مسجلة لهذا العميل.</div> : null}
                    </div>
                  </section>

                  <section className="crm-contact-profile-section">
                    <header><div><h3>طلبات الخدمة</h3><p>كل دورة تعامل للعميل، سواء كانت مفتوحة أو منتهية.</p></div><span>{profile.requests.length}</span></header>
                    <div className="crm-contact-timeline">
                      {profile.requests.map((request) => <article key={request.id} className={request.request_state === "closed" ? "closed" : "open"}>
                        <span className="point" />
                        <div><header><strong>{serviceLabel(request.service_key, request.department_code)}</strong><span>{requestStateLabel(request.request_state)}</span></header><p>الحالة: {request.status_label || "عميل جديد"}</p><small>المسؤول: {request.assigned_name || "غير موزع"} • الفرع: {request.branch_name || request.branch_code || "—"}</small><time>فتح: {formatDate(request.opened_at)}{request.closed_at ? ` • إغلاق: ${formatDate(request.closed_at)}` : ""}</time></div>
                      </article>)}
                      {!profile.requests.length ? <div className="crm-empty-state">لا توجد طلبات خدمة مسجلة.</div> : null}
                    </div>
                  </section>

                  <section className="crm-contact-profile-section">
                    <header><div><h3>سجل الحالات والإجراءات</h3><p>تاريخ التغييرات، التحويلات والتوزيع.</p></div><ClockCounterClockwise size={22} /></header>
                    <div className="crm-contact-events">
                      {profile.events.map((event) => <article key={`event-${event.id}`}><span className="event-icon"><ClockCounterClockwise size={17} /></span><div><strong>{event.event_type === "status_change" ? `تغيير الحالة إلى ${event.new_status || "—"}` : event.note || event.event_type}</strong><p>{event.old_status && event.new_status ? `${event.old_status} ← ${event.new_status}` : event.note || ""}</p><small>{event.actor_name || "النظام"} • {formatDate(event.created_at)}</small></div></article>)}
                      {profile.ownership.map((event) => <article key={`owner-${event.id}`}><span className="event-icon owner"><UserCircle size={17} /></span><div><strong>{event.reason || "تغيير المسؤول"}</strong><p>{event.previous_assigned_name || "غير موزع"} ← {event.new_assigned_name || "غير موزع"}</p><small>{event.actor_name || "النظام"} • {formatDate(event.created_at)}</small></div></article>)}
                      {!profile.events.length && !profile.ownership.length ? <div className="crm-empty-state">لا يوجد سجل تغييرات.</div> : null}
                    </div>
                  </section>

                  <section className="crm-contact-profile-section">
                    <header><div><h3>المحادثات والرسائل الأخيرة</h3><p>ملخص القنوات وآخر 30 رسالة محفوظة.</p></div><ChatCircleDots size={22} /></header>
                    <div className="crm-contact-conversation-chips">{profile.conversations.map((conversation) => <span key={conversation.id}>{sourceLabel(conversation.channel_code)} • {conversation.classification_state === "classified" ? "مصنفة" : "غير مصنفة"} • {formatDate(conversation.last_message_at)}</span>)}</div>
                    <div className="crm-contact-messages">
                      {latestMessages.map((message) => <article key={message.id} className={message.direction === "out" ? "out" : "in"}><header><strong>{messageDirectionLabel(message)}</strong><time>{formatDate(message.created_at)}</time></header><p>{message.body || message.caption || message.file_name || "مرفق"}</p><small>{message.sent_by_name || message.sender_type || sourceLabel(message.provider)}</small></article>)}
                      {!latestMessages.length ? <div className="crm-empty-state">لا توجد رسائل محفوظة.</div> : null}
                    </div>
                  </section>

                  <section className="crm-contact-profile-section compact">
                    <header><div><h3>الهويات والقنوات</h3><p>كل المعرفات التي تم ربطها بنفس جهة الاتصال.</p></div><span>{profile.identities.length}</span></header>
                    <div className="crm-contact-identities">{profile.identities.map((identity) => <article key={identity.id}><b>{sourceLabel(identity.channel_code)}</b><span>{identity.participant_id || identity.external_id}</span><small>{identity.display_name || "—"} • {formatDate(identity.updated_at)}</small></article>)}</div>
                  </section>
                </div>
              </>
            )}
          </article>
        </div>
      ) : null}

      {purgeOpen && profile ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setPurgeOpen(false)}>
          <div className="crm-modal-card crm-contact-purge-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>حذف ملف العميل بالكامل</h2><p>سيتم حذف جهة الاتصال والعميل وطلبات الخدمة والمحادثات والرسائل نهائيًا. استخدمها فقط لمسح أرقام الاختبار.</p></div><button className="crm-icon-button" type="button" onClick={() => setPurgeOpen(false)}><X size={18} /></button></header>
            <div className="crm-contact-purge-warning"><Trash size={28} /><div><strong>هذا الإجراء غير قابل للتراجع</strong><span>اكتب رقم الجوال المسجل للتأكيد: {profile.contact.primary_phone || profile.contact.primary_phone_normalized}</span></div></div>
            <label className="crm-form-label"><span>تأكيد رقم الجوال</span><input value={confirmPhone} onChange={(event) => setConfirmPhone(event.target.value)} placeholder="اكتب رقم الجوال كاملًا" inputMode="tel" /></label>
            <div className="crm-modal-actions"><button type="button" className="crm-secondary-button" onClick={() => setPurgeOpen(false)}>إلغاء</button><button type="button" className="crm-danger-button" disabled={purging || !confirmPhone.trim()} onClick={() => void purgeContact()}><Trash size={17} />{purging ? "جاري الحذف..." : "حذف الملف والطلب والمحادثات"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
