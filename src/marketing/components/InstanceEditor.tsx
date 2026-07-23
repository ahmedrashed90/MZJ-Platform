import { useMemo, useState } from "react";
import { Car, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { DraftAssignment, DraftDepartment, DraftInstance, MarketingMeta, VehicleRow } from "../types";
import { Empty } from "./Ui";

type Props = { instance: DraftInstance; meta: MarketingMeta; onChange: (next: DraftInstance) => void; allowAgendaDate?: boolean; showPosts?: boolean; onRemove?: () => void };

function toggleValue(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

export function InstanceEditor({ instance, meta, onChange, allowAgendaDate, showPosts, onRemove }: Props) {
  const [optionalDepartmentId, setOptionalDepartmentId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleRows, setVehicleRows] = useState<VehicleRow[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const creative = meta.creatives.find((item) => item.id === instance.creativeId);
  const contentDepartment = meta.departments.find((item) => item.is_content);
  const selectedWriterIds = instance.writers.map((item) => item.userId);
  const usedDepartments = new Set(instance.departments.map((item) => item.departmentId));
  const selectedVehicles = useMemo(() => {
    const byId = new Map(vehicleRows.map((item) => [item.id, item]));
    return instance.vehicleIds.map((id) => byId.get(id)).filter((item): item is VehicleRow => Boolean(item));
  }, [instance.vehicleIds, vehicleRows]);

  function updateDepartment(index: number, next: DraftDepartment) { onChange({ ...instance, departments: instance.departments.map((item, itemIndex) => itemIndex === index ? next : item) }); }
  function removeDepartment(index: number) { onChange({ ...instance, departments: instance.departments.filter((_, itemIndex) => itemIndex !== index) }); }
  function toggleWriter(userId: string) {
    const exists = instance.writers.some((item) => item.userId === userId);
    const writers = exists ? instance.writers.filter((item) => item.userId !== userId) : [...instance.writers, { userId, dueDate: "", notes: "" }];
    const departments = instance.departments.map((department) => ({ ...department, assignments: department.assignments.filter((assignment) => writers.some((writer) => writer.userId === assignment.contentWriterId)) }));
    onChange({ ...instance, writers, departments });
  }
  function updateWriter(userId: string, patch: Partial<{ dueDate: string; notes: string }>) { onChange({ ...instance, writers: instance.writers.map((item) => item.userId === userId ? { ...item, ...patch } : item) }); }
  function addOptionalDepartment() {
    if (!optionalDepartmentId || usedDepartments.has(optionalDepartmentId)) return;
    onChange({ ...instance, departments: [...instance.departments, { departmentId: optionalDepartmentId, isPrimary: false, dueDate: "", notes: "", assignments: [] }] });
    setOptionalDepartmentId("");
  }
  function togglePair(department: DraftDepartment, executiveUserId: string, writerId: string) {
    const exists = department.assignments.some((item) => item.executiveUserId === executiveUserId && item.contentWriterId === writerId);
    const assignments = exists ? department.assignments.filter((item) => !(item.executiveUserId === executiveUserId && item.contentWriterId === writerId)) : [...department.assignments, { executiveUserId, contentWriterId: writerId, dueDate: department.dueDate }];
    return { ...department, assignments };
  }
  function updateAssignment(department: DraftDepartment, executiveUserId: string, writerId: string, patch: Partial<DraftAssignment>) {
    return { ...department, assignments: department.assignments.map((item) => item.executiveUserId === executiveUserId && item.contentWriterId === writerId ? { ...item, ...patch } : item) };
  }
  async function searchVehicles() {
    setVehicleLoading(true);
    try {
      const payload = await marketingFetch<{ ok: true; rows: VehicleRow[] }>(`/api/marketing?resource=stock&search=${encodeURIComponent(vehicleSearch)}`);
      setVehicleRows((current) => {
        const map = new Map([...current, ...payload.rows].map((item) => [item.id, item]));
        return [...map.values()];
      });
    } finally { setVehicleLoading(false); }
  }

  return <article className={`marketing-instance-editor ${instance.writers.length && instance.departments.every((dep) => dep.assignments.length) ? "complete" : "incomplete"}`}>
    <header><div><b>{creative?.name || "اختر الكرييتيف"}</b><span>{creative?.short_code || "—"}</span></div>{onRemove ? <button type="button" onClick={onRemove}><Trash size={17} />حذف الكرييتيف</button> : null}</header>
    {allowAgendaDate ? <label className="marketing-field"><span>تاريخ اليوم</span><input type="date" value={instance.agendaDate} onChange={(event) => onChange({ ...instance, agendaDate: event.target.value })} /></label> : null}
    <div className="marketing-instance-columns">
      <section className="marketing-instance-block"><h3>قسم المحتوى</h3><div className="marketing-inline-fields"><label><span>تاريخ استلام قسم المحتوى</span><input type="date" value={instance.contentReceivedDate} onChange={(event) => onChange({ ...instance, contentReceivedDate: event.target.value })} /></label><label><span>ملاحظات قسم المحتوى</span><textarea rows={2} value={instance.contentNotes} onChange={(event) => onChange({ ...instance, contentNotes: event.target.value })} /></label></div>
        <div className="marketing-choice-list">{contentDepartment?.users.map((person) => { const selected = selectedWriterIds.includes(person.id); const writer = instance.writers.find((item) => item.userId === person.id); return <div key={person.id} className={selected ? "selected" : ""}><label><input type="checkbox" checked={selected} onChange={() => toggleWriter(person.id)} /><span>{person.full_name}</span></label>{selected ? <div className="marketing-writer-extra"><input type="date" value={writer?.dueDate || ""} onChange={(event) => updateWriter(person.id, { dueDate: event.target.value })} /><input placeholder="ملاحظات الكاتب" value={writer?.notes || ""} onChange={(event) => updateWriter(person.id, { notes: event.target.value })} /></div> : null}</div>; })}</div>
        {!contentDepartment?.users.length ? <Empty text="لا يوجد يوزرات مرتبطة بقسم المحتوى من إعدادات التسويق." /> : null}
      </section>
      <section className="marketing-instance-block"><h3>القسم الأساسي — {creative?.primary_department_name || "—"}</h3>{instance.departments.filter((item) => item.isPrimary).map((department, index) => <DepartmentEditor key={department.departmentId} department={department} meta={meta} writerIds={selectedWriterIds} update={(next) => updateDepartment(instance.departments.indexOf(department), next)} togglePair={togglePair} updateAssignment={updateAssignment} />)}</section>
    </div>
    <section className="marketing-instance-block"><div className="marketing-block-title"><h3>الأقسام الاختيارية</h3><div><select value={optionalDepartmentId} onChange={(event) => setOptionalDepartmentId(event.target.value)}><option value="">اختر قسمًا</option>{meta.departments.filter((item) => !item.is_content && item.id !== creative?.primary_department_id && !usedDepartments.has(item.id) && item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={addOptionalDepartment}><Plus size={16} />إضافة قسم</button></div></div>
      {instance.departments.filter((item) => !item.isPrimary).map((department) => <div className="marketing-optional-department" key={department.departmentId}><DepartmentEditor department={department} meta={meta} writerIds={selectedWriterIds} update={(next) => updateDepartment(instance.departments.indexOf(department), next)} togglePair={togglePair} updateAssignment={updateAssignment} /><button className="marketing-text-danger" type="button" onClick={() => removeDepartment(instance.departments.indexOf(department))}>حذف القسم</button></div>)}
      {!instance.departments.some((item) => !item.isPrimary) ? <Empty text="لا توجد أقسام اختيارية." /> : null}
    </section>
    {showPosts ? <details className="marketing-accordion" open><summary>المنصات وأنواع النشر <span>{instance.posts.length} اختيار</span></summary><div className="marketing-platform-picker">{meta.platforms.filter((item) => item.is_active).map((platform) => <article key={platform.id}><strong>{platform.name}</strong>{platform.post_types.filter((item) => item.is_active).map((postType) => { const selected = instance.posts.some((post) => post.platformId === platform.id && post.postTypeId === postType.id); return <label key={postType.id}><input type="checkbox" checked={selected} onChange={() => onChange({ ...instance, posts: selected ? instance.posts.filter((post) => !(post.platformId === platform.id && post.postTypeId === postType.id)) : [...instance.posts, { platformId: platform.id, postTypeId: postType.id }] })} /><span>{postType.name}</span><small>{postType.width && postType.height ? `${postType.width}×${postType.height}` : ""}</small></label>; })}</article>)}</div></details> : null}
    <details className="marketing-accordion"><summary><Car size={18} />اختيار سيارة أو أكثر من الاستوك <span>{instance.vehicleIds.length} سيارة</span></summary><div className="marketing-vehicle-picker"><div className="marketing-search-row"><input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} placeholder="ابحث برقم الهيكل أو السيارة" /><button type="button" onClick={() => void searchVehicles()} disabled={vehicleLoading}>{vehicleLoading ? "جاري البحث..." : "بحث"}</button></div><div className="marketing-chip-list">{selectedVehicles.map((vehicle) => <span key={vehicle.id}>{vehicle.vin} · {vehicle.car_name || vehicle.statement || "سيارة"}<button type="button" onClick={() => onChange({ ...instance, vehicleIds: instance.vehicleIds.filter((id) => id !== vehicle.id) })}>×</button></span>)}</div><div className="marketing-vehicle-results">{vehicleRows.map((vehicle) => <label key={vehicle.id} className={instance.vehicleIds.includes(vehicle.id) ? "selected" : ""}><input type="checkbox" checked={instance.vehicleIds.includes(vehicle.id)} onChange={() => onChange({ ...instance, vehicleIds: toggleValue(instance.vehicleIds, vehicle.id) })} /><div><b>{vehicle.vin}</b><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"}</span><small>{vehicle.exterior_color || "—"} / {vehicle.interior_color || "—"} · {vehicle.model_year || "—"} · {vehicle.location_name || "—"}</small></div></label>)}</div></div></details>
  </article>;
}

function DepartmentEditor({ department, meta, writerIds, update, togglePair, updateAssignment }: { department: DraftDepartment; meta: MarketingMeta; writerIds: string[]; update: (next: DraftDepartment) => void; togglePair: (department: DraftDepartment, executiveUserId: string, writerId: string) => DraftDepartment; updateAssignment: (department: DraftDepartment, executiveUserId: string, writerId: string, patch: Partial<DraftAssignment>) => DraftDepartment }) {
  const definition = meta.departments.find((item) => item.id === department.departmentId);
  return <div className="marketing-department-editor"><div className="marketing-department-title"><UsersThree size={19} /><strong>{definition?.name || "قسم"}</strong></div><div className="marketing-inline-fields"><label><span>تاريخ استلام القسم</span><input type="date" value={department.dueDate} onChange={(event) => update({ ...department, dueDate: event.target.value, assignments: department.assignments.map((item) => ({ ...item, dueDate: item.dueDate || event.target.value })) })} /></label><label><span>ملاحظات القسم</span><textarea rows={2} value={department.notes} onChange={(event) => update({ ...department, notes: event.target.value })} /></label></div>
    <div className="marketing-executive-list">{definition?.users.map((person) => { const pairs = department.assignments.filter((item) => item.executiveUserId === person.id); const selected = pairs.length > 0; return <article key={person.id} className={selected ? "selected" : ""}><div className="marketing-executive-name"><strong>{person.full_name}</strong><span>{selected ? `${pairs.length} علاقة` : "لم يتم الربط"}</span></div>{writerIds.length ? <div className="marketing-pair-grid">{writerIds.map((writerId) => { const writer = meta.users.find((item) => item.id === writerId); const pair = pairs.find((item) => item.contentWriterId === writerId); return <label key={writerId}><input type="checkbox" checked={Boolean(pair)} onChange={() => update(togglePair(department, person.id, writerId))} /><span>{writer?.full_name || "كاتب محتوى"}</span>{pair ? <input type="date" value={pair.dueDate} onChange={(event) => update(updateAssignment(department, person.id, writerId, { dueDate: event.target.value }))} /> : null}</label>; })}</div> : <small>اختر كاتب محتوى أولًا.</small>}</article>; })}</div>
    {!definition?.users.length ? <Empty text="لا يوجد يوزرات مرتبطون بهذا القسم في إعدادات التسويق." /> : null}
  </div>;
}
