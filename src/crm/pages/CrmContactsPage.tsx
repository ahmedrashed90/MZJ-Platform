import { useEffect, useRef, useState } from "react";
import {
  AddressBook,
  ArrowClockwise,
  ArrowRight,
  Buildings,
  Car,
  CaretDown,
  CaretUp,
  ChatCircleDots,
  CheckCircle,
  ClockCounterClockwise,
  CurrencyCircleDollar,
  IdentificationCard,
  MagnifyingGlass,
  NotePencil,
  Phone,
  Receipt,
  Storefront,
  Trash,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, departmentLabel, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";

type ContactRow = {
  id: string;
  display_name?: string | null;
  primary_phone?: string | null;
  primary_phone_normalized?: string | null;
  customer_name?: string | null;
  status_label?: string | null;
  department_code?: string | null;
  branch_code?: string | null;
  source_code?: string | null;
  source_name?: string | null;
  assigned_name?: string | null;
  leads_count?: number;
  requests_count?: number;
  open_requests_count?: number;
  conversations_count?: number;
  sales_orders_count?: number;
  sold_vehicles_count?: number;
  total_sales_amount?: number;
  last_sale_at?: string | null;
  last_activity_at?: string | null;
};

type SalesVehicle = {
  id: string;
  itemNo?: string | null;
  vin?: string | null;
  itemType?: string | null;
  itemCategory?: string | null;
  itemModel?: string | null;
  interiorColor?: string | null;
  exteriorColor?: string | null;
  dealer?: string | null;
  qty?: number;
  unitPrice?: number;
  itemValue?: number;
  totalInclVat?: number;
  operationsStatusCode?: string | null;
  isCancelled?: boolean;
};

type SalesOrder = {
  id: string;
  sales_order_no: string;
  erp_status?: string | null;
  erp_event?: string | null;
  erp_sales_person?: string | null;
  order_date?: string | null;
  delivery_date?: string | null;
  platform_user_name?: string | null;
  platform_department_name?: string | null;
  platform_department_code?: string | null;
  platform_branch_name?: string | null;
  platform_branch_code?: string | null;
  erp_branch?: string | null;
  subtotal_before_tax?: number;
  tax_value?: number;
  total_incl_vat?: number;
  registration_fee?: number;
  is_cancelled?: boolean;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  vehicle_qty?: number;
  vehicles?: SalesVehicle[];
  received_at?: string | null;
};

type ContactProfile = {
  contact: any;
  identities: any[];
  leads: any[];
  requests: any[];
  conversations: any[];
  messages: any[];
  events: any[];
  ownership: any[];
  notes: any[];
  salesOrders: SalesOrder[];
  salesSummary: {
    ordersCount: number;
    allOrdersCount: number;
    cancelledOrdersCount: number;
    soldVehiclesCount: number;
    subtotalBeforeTax: number;
    taxValue: number;
    registrationFee: number;
    totalSalesAmount: number;
    lastSaleAt?: string | null;
  };
  canPurge: boolean;
};

const pageSize = 50;
const money = new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("ar-SA");

function text(value: unknown) {
  return String(value ?? "").trim() || "—";
}

function latestLead(profile: ContactProfile | null) {
  return profile?.leads?.find((lead) => !lead.is_deleted) || profile?.leads?.[0] || null;
}

function SummaryCard({ icon: Icon, label, value, sub }: { icon: typeof AddressBook; label: string; value: string; sub?: string }) {
  return <article className="crm-contact-summary-card"><span><Icon size={21} weight="duotone" /></span><div><small>{label}</small><strong>{value}</strong>{sub ? <p>{sub}</p> : null}</div></article>;
}

export function CrmContactsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const contactId = searchParams.get("contact") || "";
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [appliedQ, setAppliedQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get("page") || 1)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmPhone, setConfirmPhone] = useState("");
  const [purgeError, setPurgeError] = useState("");
  const [purging, setPurging] = useState(false);
  const openedFromList = useRef(false);
  const listScroll = useRef(0);

  useEscapeToClose(Boolean(contactId && !purgeOpen), () => closeProfile());
  useEscapeToClose(purgeOpen, () => setPurgeOpen(false));

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const result = await crmFetch<{ rows: ContactRow[]; total: number; summary: any }>(`/api/crm/contacts${queryString({ q: appliedQ, limit: pageSize, offset: (page - 1) * pageSize })}`);
      setRows(result.rows || []);
      setTotal(Number(result.total || 0));
      setSummary(result.summary || {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل جهات الاتصال");
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile(id: string) {
    setProfileLoading(true);
    setError("");
    try {
      const result = await crmFetch<ContactProfile>(`/api/crm/contacts${queryString({ id })}`);
      setProfile(result);
      setExpandedOrderId(result.salesOrders?.[0]?.id || null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل ملف جهة الاتصال");
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => { void loadList(); }, [appliedQ, page]);
  useEffect(() => {
    if (contactId) void loadProfile(contactId);
    else {
      setProfile(null);
      window.requestAnimationFrame(() => window.scrollTo({ top: listScroll.current, behavior: "auto" }));
    }
  }, [contactId]);

  function applySearch() {
    const next = new URLSearchParams(searchParams);
    const value = q.trim();
    if (value) next.set("q", value); else next.delete("q");
    next.set("page", "1");
    next.delete("contact");
    setSearchParams(next, { replace: true });
    setAppliedQ(value);
    setPage(1);
  }

  function changePage(nextPage: number) {
    const safe = Math.max(1, Math.min(Math.max(1, Math.ceil(total / pageSize)), nextPage));
    const next = new URLSearchParams(searchParams);
    next.set("page", String(safe));
    next.delete("contact");
    setSearchParams(next, { replace: true });
    setPage(safe);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openProfile(id: string) {
    listScroll.current = window.scrollY;
    openedFromList.current = true;
    const next = new URLSearchParams(searchParams);
    next.set("contact", id);
    setSearchParams(next, { replace: false });
  }

  function closeProfile() {
    if (!contactId) return;
    if (openedFromList.current) {
      openedFromList.current = false;
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("contact");
    setSearchParams(next, { replace: true });
  }

  async function purgeContact() {
    if (!profile) return;
    const confirmation = confirmPhone.trim();
    setPurging(true);
    setError("");
    setPurgeError("");
    try {
      await crmFetch(`/api/crm/contacts${queryString({ id: profile.contact.id })}`, {
        method: "DELETE",
        headers: { "x-mzj-contact-purge-confirmation": confirmation },
        body: JSON.stringify({ id: profile.contact.id, confirmPhone: confirmation }),
      });
      setPurgeOpen(false);
      setConfirmPhone("");
      setPurgeError("");
      setProfile(null);
      openedFromList.current = false;
      const next = new URLSearchParams(searchParams);
      next.delete("contact");
      setSearchParams(next, { replace: true });
      await loadList();
    } catch (failure) {
      setPurgeError(failure instanceof Error ? failure.message : "تعذر حذف الملف");
    } finally {
      setPurging(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const lead = latestLead(profile);
  const contactName = profile ? text(profile.contact.display_name || lead?.customer_name) : "";

  return <div className="crm-page crm-contacts-page-v2">
    {error ? <div className="crm-error-banner">{error}</div> : null}

    <section className="crm-contact-overview-grid">
      <SummaryCard icon={AddressBook} label="إجمالي جهات الاتصال" value={number.format(Number(summary.total_contacts || total || 0))} />
      <SummaryCard icon={ClockCounterClockwise} label="لديها طلبات مفتوحة" value={number.format(Number(summary.open_contacts || 0))} />
      <SummaryCard icon={CheckCircle} label="لديها طلبات منتهية" value={number.format(Number(summary.completed_contacts || 0))} />
      <SummaryCard icon={ChatCircleDots} label="لديها محادثات" value={number.format(Number(summary.contacts_with_conversations || 0))} />
    </section>

    <section className="crm-contact-list-shell">
      <form className="crm-contact-search-v2" onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
        <label><MagnifyingGlass size={20} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث بالاسم أو رقم الجوال أو الحالة أو رقم طلب البيع أو الملاحظات" /></label>
        <button type="submit" className="crm-primary-button">بحث</button>
        <button type="button" className="crm-secondary-button" onClick={() => void loadList()} disabled={loading}><ArrowClockwise size={18} />تحديث</button>
        <span>النتائج: {number.format(total)}</span>
      </form>

      <div className="crm-table-wrap crm-contacts-table-wrap">
        <table className="crm-table crm-contacts-table">
          <thead><tr><th>العميل</th><th>رقم الجوال</th><th>الحالة الحالية</th><th>القسم / الفرع</th><th>المسؤول</th><th>طلبات البيع</th><th>السيارات المباعة</th><th>إجمالي المبيعات</th><th>آخر نشاط</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id} tabIndex={0} onClick={() => openProfile(row.id)} onKeyDown={(event) => { if (event.key === "Enter") openProfile(row.id); }}>
              <td><div className="crm-contact-table-name"><span><UserCircle size={25} weight="duotone" /></span><div><strong>{text(row.display_name || row.customer_name)}</strong><small>{sourceLabel(row.source_code, row.source_name)}</small></div></div></td>
              <td dir="ltr">{text(row.primary_phone || row.primary_phone_normalized)}</td>
              <td><span className="crm-contact-status-pill">{text(row.status_label)}</span></td>
              <td><strong>{departmentLabel(row.department_code)}</strong><small>{text(row.branch_code)}</small></td>
              <td>{text(row.assigned_name)}</td>
              <td><b className="crm-contact-sales-number">{number.format(Number(row.sales_orders_count || 0))}</b></td>
              <td><b className="crm-contact-sales-number">{number.format(Number(row.sold_vehicles_count || 0))}</b></td>
              <td><strong className="crm-contact-money">{money.format(Number(row.total_sales_amount || 0))}</strong></td>
              <td>{formatDate(row.last_activity_at || row.last_sale_at)}</td>
            </tr>)}
            {!loading && !rows.length ? <tr><td colSpan={9} className="crm-empty-cell">لا توجد جهات اتصال مطابقة</td></tr> : null}
            {loading ? <tr><td colSpan={9} className="crm-empty-cell">جاري تحميل جهات الاتصال...</td></tr> : null}
          </tbody>
        </table>
      </div>

      <footer className="crm-contact-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}>السابق</button><span>صفحة {number.format(page)} من {number.format(totalPages)}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => changePage(page + 1)}>التالي</button></footer>
    </section>

    {contactId ? <div className="crm-contact-profile-backdrop">
      <article className="crm-contact-profile-v2">
        <header className="crm-contact-profile-hero">
          <div className="crm-contact-profile-actions"><button type="button" className="crm-contact-back-button" onClick={closeProfile}><ArrowRight size={19} />الرجوع إلى العملاء</button>{profile?.canPurge ? <button type="button" className="crm-danger-button ghost" onClick={() => { setConfirmPhone(""); setPurgeError(""); setPurgeOpen(true); }}><Trash size={17} />حذف الملف بالكامل</button> : null}</div>
          {profileLoading && !profile ? <div className="crm-contact-profile-loading">جاري تحميل ملف العميل...</div> : null}
          {profile ? <div className="crm-contact-profile-identity">
            <span className="crm-contact-avatar"><IdentificationCard size={34} weight="duotone" /></span>
            <div><small>ملف جهة الاتصال</small><h2>{contactName}</h2><p><Phone size={15} /> <bdi>{text(profile.contact.primary_phone || profile.contact.primary_phone_normalized)}</bdi></p></div>
            <div className="crm-contact-hero-badges"><span>{text(lead?.status_label)}</span><span>{departmentLabel(lead?.department_code)}</span><span>{text(lead?.branch_name || lead?.branch_code)}</span></div>
          </div> : null}
        </header>

        {profile ? <div className="crm-contact-profile-body">
          <section className="crm-contact-sales-summary">
            <SummaryCard icon={Receipt} label="طلبات البيع" value={number.format(profile.salesSummary.ordersCount)} sub={`${number.format(profile.salesSummary.cancelledOrdersCount)} ملغي`} />
            <SummaryCard icon={Car} label="إجمالي السيارات المباعة" value={number.format(profile.salesSummary.soldVehiclesCount)} />
            <SummaryCard icon={CurrencyCircleDollar} label="إجمالي المبيعات" value={money.format(profile.salesSummary.totalSalesAmount)} sub="بدون الطلبات الملغاة" />
            <SummaryCard icon={ClockCounterClockwise} label="آخر عملية بيع" value={formatDate(profile.salesSummary.lastSaleAt)} />
          </section>

          <section className="crm-contact-info-panel">
            <div className="crm-contact-section-title"><div><h3>البيانات الحالية</h3><p>آخر بيانات فعالة مرتبطة بملف العميل.</p></div><IdentificationCard size={23} /></div>
            <div className="crm-contact-info-grid">
              <article><small>الاسم</small><strong>{contactName}</strong></article><article><small>رقم الجوال</small><strong dir="ltr">{text(profile.contact.primary_phone || profile.contact.primary_phone_normalized)}</strong></article>
              <article><small>الحالة</small><strong>{text(lead?.status_label)}</strong></article><article><small>المصدر</small><strong>{sourceLabel(lead?.source_code, lead?.source_name)}</strong></article>
              <article><small>المسؤول الحالي</small><strong>{text(lead?.assigned_name)}</strong></article><article><small>القسم</small><strong>{departmentLabel(lead?.department_code)}</strong></article>
              <article><small>الفرع</small><strong>{text(lead?.branch_name || lead?.branch_code)}</strong></article><article><small>تاريخ دخول النظام</small><strong>{formatDate(profile.contact.created_at)}</strong></article>
            </div>
          </section>

          <section className="crm-contact-sales-orders-panel">
            <div className="crm-contact-section-title"><div><h3>طلبات البيع</h3><p>كل طلب بيع مستقل بمندوبه وفرعه وسياراته وقيمته، مع بقاء العميل سجلًا واحدًا.</p></div><span>{number.format(profile.salesOrders.length)} طلب</span></div>
            <div className="crm-contact-sales-orders-list">
              {profile.salesOrders.map((order) => {
                const open = expandedOrderId === order.id;
                return <article key={order.id} className={`crm-sales-order-card ${order.is_cancelled ? "cancelled" : ""}`}>
                  <button type="button" className="crm-sales-order-head" onClick={() => setExpandedOrderId(open ? null : order.id)}>
                    <div className="crm-sales-order-number"><span><Receipt size={22} weight="duotone" /></span><div><small>طلب البيع</small><strong dir="ltr">{order.sales_order_no}</strong></div></div>
                    <div><small>التاريخ</small><strong>{formatDate(order.order_date || order.received_at)}</strong></div>
                    <div><small>المندوب</small><strong>{text(order.platform_user_name || order.erp_sales_person)}</strong></div>
                    <div><small>الفرع</small><strong>{text(order.platform_branch_name || order.platform_branch_code || order.erp_branch)}</strong></div>
                    <div><small>السيارات</small><strong>{number.format(Number(order.vehicle_qty || 1))}</strong></div>
                    <div><small>إجمالي الطلب</small><strong className="crm-contact-money">{money.format(Number(order.total_incl_vat || 0))}</strong></div>
                    <span className={`crm-sales-order-state ${order.is_cancelled ? "cancelled" : "active"}`}>{order.is_cancelled ? "ملغي" : text(order.erp_status || "نشط")}</span>
                    {open ? <CaretUp size={19} /> : <CaretDown size={19} />}
                  </button>
                  {open ? <div className="crm-sales-order-details">
                    <div className="crm-sales-order-financials">
                      <article><small>قبل الضريبة</small><strong>{money.format(Number(order.subtotal_before_tax || 0))}</strong></article>
                      <article><small>الضريبة</small><strong>{money.format(Number(order.tax_value || 0))}</strong></article>
                      <article><small>رسوم التسجيل</small><strong>{money.format(Number(order.registration_fee || 0))}</strong></article>
                      <article><small>الإجمالي شامل الضريبة</small><strong>{money.format(Number(order.total_incl_vat || 0))}</strong></article>
                    </div>
                    <div className="crm-sales-order-meta"><span><UsersThree size={16} />{text(order.platform_department_name || order.platform_department_code)}</span><span><Storefront size={16} />{text(order.platform_branch_name || order.platform_branch_code || order.erp_branch)}</span><span><Buildings size={16} />التسليم: {formatDate(order.delivery_date)}</span></div>
                    {order.is_cancelled ? <div className="crm-sales-order-cancel-note"><strong>تم إلغاء الطلب</strong><span>{text(order.cancellation_reason)}</span><small>{formatDate(order.cancelled_at)}</small></div> : null}
                    <div className="crm-table-wrap crm-sales-vehicles-table"><table className="crm-table"><thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>الموديل</th><th>الألوان</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>حالة العمليات</th></tr></thead><tbody>
                      {(order.vehicles || []).map((vehicle) => <tr key={vehicle.id}><td dir="ltr"><strong>{text(vehicle.vin)}</strong></td><td>{text(vehicle.itemType || vehicle.itemCategory || vehicle.itemNo)}</td><td>{text(vehicle.itemModel)}</td><td>{[vehicle.exteriorColor, vehicle.interiorColor].filter(Boolean).join(" / ") || "—"}</td><td>{number.format(Number(vehicle.qty || 1))}</td><td>{money.format(Number(vehicle.unitPrice || 0))}</td><td>{money.format(Number(vehicle.totalInclVat || vehicle.itemValue || 0))}</td><td>{text(vehicle.operationsStatusCode)}</td></tr>)}
                      {!order.vehicles?.length ? <tr><td colSpan={8} className="crm-empty-cell">لا توجد تفاصيل سيارات محفوظة لهذا الطلب</td></tr> : null}
                    </tbody></table></div>
                  </div> : null}
                </article>;
              })}
              {!profile.salesOrders.length ? <div className="crm-contact-empty-section">لا توجد طلبات بيع مرتبطة بهذا العميل حتى الآن.</div> : null}
            </div>
          </section>

          <div className="crm-contact-secondary-grid">
            <section className="crm-contact-info-panel"><div className="crm-contact-section-title"><div><h3>الملاحظات</h3><p>الملاحظات المحفوظة في كل ملفات العميل.</p></div><NotePencil size={22} /></div><div className="crm-contact-timeline">{profile.notes.map((note, index) => <article key={`${note.leadId}-${index}`}><strong>{text(note.customerName)}</strong><p>{text(note.text)}</p><small>{formatDate(note.updatedAt)}</small></article>)}{!profile.notes.length ? <div className="crm-contact-empty-section">لا توجد ملاحظات.</div> : null}</div></section>
            <section className="crm-contact-info-panel"><div className="crm-contact-section-title"><div><h3>طلبات الخدمة</h3><p>الطلبات المفتوحة والمنتهية.</p></div><ClockCounterClockwise size={22} /></div><div className="crm-contact-timeline">{profile.requests.slice(0, 20).map((request) => <article key={request.id}><strong>{text(request.status_label)}</strong><p>{departmentLabel(request.department_code)} · {text(request.assigned_name)}</p><small>{formatDate(request.opened_at)}</small></article>)}{!profile.requests.length ? <div className="crm-contact-empty-section">لا توجد طلبات خدمة.</div> : null}</div></section>
            <section className="crm-contact-info-panel"><div className="crm-contact-section-title"><div><h3>المحادثات</h3><p>آخر المحادثات المسجلة.</p></div><ChatCircleDots size={22} /></div><div className="crm-contact-timeline">{profile.conversations.slice(0, 20).map((conversation) => <article key={conversation.id}><strong>{text(conversation.channel_code || conversation.platform_code)}</strong><p>{text(conversation.preview_text)}</p><small>{formatDate(conversation.last_message_at || conversation.updated_at)}</small></article>)}{!profile.conversations.length ? <div className="crm-contact-empty-section">لا توجد محادثات.</div> : null}</div></section>
            <section className="crm-contact-info-panel"><div className="crm-contact-section-title"><div><h3>سجل الحركات</h3><p>أحدث تغييرات الحالة والملكية.</p></div><ClockCounterClockwise size={22} /></div><div className="crm-contact-timeline">{profile.events.slice(0, 30).map((event) => <article key={event.id}><strong>{text(event.event_type)}</strong><p>{text(event.note || `${event.old_status || "—"} ← ${event.new_status || "—"}`)}</p><small>{text(event.actor_name)} · {formatDate(event.created_at)}</small></article>)}{!profile.events.length ? <div className="crm-contact-empty-section">لا توجد حركات.</div> : null}</div></section>
          </div>
        </div> : null}
      </article>
    </div> : null}

    {purgeOpen && profile ? <div className="crm-modal-backdrop crm-contact-purge-backdrop" onMouseDown={() => { setPurgeOpen(false); setPurgeError(""); }}><div className="crm-modal-card crm-contact-purge-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>حذف ملف العميل بالكامل</h2><p>سيتم حذف جهة الاتصال والعميل وطلبات الخدمة والمحادثات والرسائل نهائيًا.</p></div><button className="crm-icon-button" type="button" onClick={() => { setPurgeOpen(false); setPurgeError(""); }}><X size={18} /></button></header><div className="crm-contact-purge-warning"><Trash size={28} /><div><strong>هذا الإجراء غير قابل للتراجع</strong><span>{profile.contact.primary_phone || profile.contact.primary_phone_normalized ? `اكتب رقم الجوال المسجل للتأكيد: ${profile.contact.primary_phone || profile.contact.primary_phone_normalized}` : "لا يوجد رقم جوال مسجل. اكتب كلمة التأكيد الأساسية 2106"}</span></div></div>{purgeError ? <div className="crm-alert error">{purgeError}</div> : null}<label className="crm-form-label"><span>التأكيد</span><input value={confirmPhone} onChange={(event) => { setConfirmPhone(event.target.value); if (purgeError) setPurgeError(""); }} /></label><div className="crm-modal-actions"><button type="button" className="crm-secondary-button" onClick={() => { setPurgeOpen(false); setPurgeError(""); }}>إلغاء</button><button type="button" className="crm-danger-button" disabled={purging || !confirmPhone.trim()} onClick={() => void purgeContact()}><Trash size={17} />{purging ? "جاري الحذف..." : "حذف الملف بالكامل"}</button></div></div></div> : null}
  </div>;
}
