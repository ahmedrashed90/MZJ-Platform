import { useEffect, useMemo, useState } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { MarketingPage, MarketingAlert } from "../components/MarketingPage";
import { marketingFetch } from "../api";
import type { MarketingMeta } from "../types";

type PlatformPostDraft = { name: string; width: string; height: string };

export function DepartmentsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [department, setDepartment] = useState({ id: "", name: "", userIds: [] as string[], isContent: false });
  const [assignmentAction, setAssignmentAction] = useState({ id: "", departmentId: "", name: "", percentage: "", adminOnly: false, sortOrder: "0" });
  const [creative, setCreative] = useState({ id: "", name: "", shortCode: "", primaryDepartmentId: "" });
  const [campaignType, setCampaignType] = useState({ id: "", name: "", shortCode: "", codePrefix: "" });
  const [platform, setPlatform] = useState({ id: "", name: "", code: "", postTypes: [{ name: "", width: "", height: "" }] as PlatformPostDraft[] });

  async function load() {
    setError("");
    try { setMeta(await marketingFetch<MarketingMeta>("/api/marketing?resource=meta")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات الأقسام"); }
  }
  useEffect(() => { void load(); }, []);

  const postTypesByPlatform = useMemo(() => {
    const map = new Map<string, PlatformPostDraft[]>();
    for (const item of meta?.postTypes || []) {
      const rows = map.get(item.platform_id) || [];
      rows.push({ name: item.name, width: String(item.width || ""), height: String(item.height || "") });
      map.set(item.platform_id, rows);
    }
    return map;
  }, [meta]);

  async function save(action: string, body: Record<string, unknown>, reset: () => void) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action, ...body }) });
      setMessage(result.message); reset(); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر الحفظ"); }
    finally { setBusy(false); }
  }

  async function remove(entity: string, id: string) {
    if (!window.confirm("تأكيد الحذف؟")) return;
    await save("delete_setting", { entity, id }, () => undefined);
  }

  const content = <>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    <div className="marketing-settings-grid">
      <section className="marketing-card">
        <h2>إضافة قسم جديد</h2>
        <label>اسم القسم<input value={department.name} onChange={(e) => setDepartment({ ...department, name: e.target.value })} /></label>
        <label className="marketing-check"><input type="checkbox" checked={department.isContent} onChange={(e) => setDepartment({ ...department, isContent: e.target.checked })} />إضافة قسم محتوى</label>
        <label>اليوزرات داخل القسم<select multiple value={department.userIds} onChange={(e) => setDepartment({ ...department, userIds: Array.from(e.target.selectedOptions).map((option) => option.value) })}>{meta?.users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.fullName}</option>)}</select></label>
        <button className="marketing-primary" disabled={busy} onClick={() => void save("save_department", department, () => setDepartment({ id: "", name: "", userIds: [], isContent: false }))}>{department.id ? "تعديل القسم" : "إضافة القسم"}</button>
      </section>
      <section className="marketing-card marketing-list-card">
        <h2>قائمة الأقسام</h2>
        {(meta?.departments || []).map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.users.map((user) => user.fullName || user.full_name).join("، ") || "لا يوجد يوزرات"}</small></div><div className="marketing-inline-actions"><button onClick={() => setDepartment({ id: item.id, name: item.name, userIds: item.users.map((user) => user.id), isContent: item.is_content })}><PencilSimple /></button><button className="danger" onClick={() => void remove("department", item.id)}><Trash /></button></div></article>)}
      </section>

      <section className="marketing-card">
        <h2>إجراءات التكليف</h2>
        <label>القسم<select value={assignmentAction.departmentId} onChange={(e) => setAssignmentAction({ ...assignmentAction, departmentId: e.target.value })}><option value="">اختر القسم</option>{meta?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>اسم الإجراء<input value={assignmentAction.name} onChange={(e) => setAssignmentAction({ ...assignmentAction, name: e.target.value })} /></label>
        <div className="marketing-form-row"><label>النسبة<input type="number" min="0" max="100" value={assignmentAction.percentage} onChange={(e) => setAssignmentAction({ ...assignmentAction, percentage: e.target.value })} /></label><label>الترتيب<input type="number" value={assignmentAction.sortOrder} onChange={(e) => setAssignmentAction({ ...assignmentAction, sortOrder: e.target.value })} /></label></div>
        <label className="marketing-check"><input type="checkbox" checked={assignmentAction.adminOnly} onChange={(e) => setAssignmentAction({ ...assignmentAction, adminOnly: e.target.checked })} />أدمن فقط</label>
        <button className="marketing-primary" disabled={busy} onClick={() => void save("save_assignment_action", assignmentAction, () => setAssignmentAction({ id: "", departmentId: "", name: "", percentage: "", adminOnly: false, sortOrder: "0" }))}>{assignmentAction.id ? "تعديل الإجراء" : "إضافة الإجراء"}</button>
      </section>
      <section className="marketing-card marketing-list-card">
        <h2>إجراءات التكليف الحالية</h2>
        {(meta?.actions || []).map((item) => <article key={item.id}><div><strong>{item.name} — {item.percentage}%</strong><small>{item.department_name}{item.admin_only ? " · أدمن فقط" : ""}</small></div><div className="marketing-inline-actions"><button onClick={() => setAssignmentAction({ id: item.id, departmentId: item.department_id, name: item.name, percentage: String(item.percentage), adminOnly: item.admin_only, sortOrder: String(item.sort_order) })}><PencilSimple /></button><button className="danger" onClick={() => void remove("action", item.id)}><Trash /></button></div></article>)}
      </section>

      <section className="marketing-card">
        <h2>إضافة كرييتيف</h2>
        <label>القسم المرتبط بالكرييتيف<select value={creative.primaryDepartmentId} onChange={(e) => setCreative({ ...creative, primaryDepartmentId: e.target.value })}><option value="">اختر القسم الأساسي</option>{meta?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>اسم الكرييتيف<input value={creative.name} onChange={(e) => setCreative({ ...creative, name: e.target.value })} /></label>
        <label>الكود المختصر<input dir="ltr" value={creative.shortCode} onChange={(e) => setCreative({ ...creative, shortCode: e.target.value })} /></label>
        <button className="marketing-primary" disabled={busy} onClick={() => void save("save_creative_type", creative, () => setCreative({ id: "", name: "", shortCode: "", primaryDepartmentId: "" }))}>{creative.id ? "تعديل الكرييتيف" : "إضافة الكرييتيف"}</button>
      </section>
      <section className="marketing-card marketing-list-card">
        <h2>قائمة الكرييتيفات</h2>
        {(meta?.creativeTypes || []).map((item) => <article key={item.id}><div><strong>{item.name} — {item.short_code}</strong><small>{item.primary_department_name}</small></div><div className="marketing-inline-actions"><button onClick={() => setCreative({ id: item.id, name: item.name, shortCode: item.short_code, primaryDepartmentId: item.primary_department_id })}><PencilSimple /></button><button className="danger" onClick={() => void remove("creative_type", item.id)}><Trash /></button></div></article>)}
      </section>

      <section className="marketing-card">
        <h2>إضافة نوع حملة وكود</h2>
        <label>نوع الحملة<input value={campaignType.name} onChange={(e) => setCampaignType({ ...campaignType, name: e.target.value })} /></label>
        <label>الكود المختصر للنوع<input dir="ltr" value={campaignType.shortCode} onChange={(e) => setCampaignType({ ...campaignType, shortCode: e.target.value })} /></label>
        <label>بادئة الكود<input dir="ltr" value={campaignType.codePrefix} onChange={(e) => setCampaignType({ ...campaignType, codePrefix: e.target.value })} /></label>
        <button className="marketing-primary" disabled={busy} onClick={() => void save("save_campaign_type", campaignType, () => setCampaignType({ id: "", name: "", shortCode: "", codePrefix: "" }))}>{campaignType.id ? "تعديل نوع الحملة" : "إضافة نوع الحملة"}</button>
      </section>
      <section className="marketing-card marketing-list-card">
        <h2>أنواع الحملات وأكوادها</h2>
        {(meta?.campaignTypes || []).map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.code_prefix} · {item.short_code}</small></div><div className="marketing-inline-actions"><button onClick={() => setCampaignType({ id: item.id, name: item.name, shortCode: item.short_code, codePrefix: item.code_prefix })}><PencilSimple /></button><button className="danger" onClick={() => void remove("campaign_type", item.id)}><Trash /></button></div></article>)}
      </section>

      <section className="marketing-card">
        <h2>إضافة منصة</h2>
        <label>اسم المنصة<input value={platform.name} onChange={(e) => setPlatform({ ...platform, name: e.target.value })} /></label>
        <label>الكود<input dir="ltr" value={platform.code} onChange={(e) => setPlatform({ ...platform, code: e.target.value })} /></label>
        <div className="marketing-repeat-list">{platform.postTypes.map((item, index) => <div className="marketing-form-row three" key={index}><label>نوع النشر<input value={item.name} onChange={(e) => setPlatform({ ...platform, postTypes: platform.postTypes.map((row, rowIndex) => rowIndex === index ? { ...row, name: e.target.value } : row) })} /></label><label>العرض<input type="number" value={item.width} onChange={(e) => setPlatform({ ...platform, postTypes: platform.postTypes.map((row, rowIndex) => rowIndex === index ? { ...row, width: e.target.value } : row) })} /></label><label>الارتفاع<input type="number" value={item.height} onChange={(e) => setPlatform({ ...platform, postTypes: platform.postTypes.map((row, rowIndex) => rowIndex === index ? { ...row, height: e.target.value } : row) })} /></label></div>)}</div>
        <button className="marketing-secondary" onClick={() => setPlatform({ ...platform, postTypes: [...platform.postTypes, { name: "", width: "", height: "" }] })}><Plus />إضافة نوع نشر</button>
        <button className="marketing-primary" disabled={busy} onClick={() => void save("save_platform", platform, () => setPlatform({ id: "", name: "", code: "", postTypes: [{ name: "", width: "", height: "" }] }))}>{platform.id ? "تعديل المنصة" : "إضافة المنصة"}</button>
      </section>
      <section className="marketing-card marketing-list-card">
        <h2>المنصات</h2>
        {(meta?.platforms || []).map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{(postTypesByPlatform.get(item.id) || []).map((post) => `${post.name} ${post.width && post.height ? `(${post.width}×${post.height})` : ""}`).join("، ") || "لا يوجد أنواع نشر"}</small></div><div className="marketing-inline-actions"><button onClick={() => setPlatform({ id: item.id, name: item.name, code: item.code, postTypes: postTypesByPlatform.get(item.id) || [{ name: "", width: "", height: "" }] })}><PencilSimple /></button><button className="danger" onClick={() => void remove("platform", item.id)}><Trash /></button></div></article>)}
      </section>
    </div>
  </>;

  if (embedded) return content;
  return <MarketingPage title="الأقسام" description="إدارة الأقسام واليوزرات وإجراءات التكليف والكرييتيفات وأنواع الحملات والمنصات.">{content}</MarketingPage>;
}
