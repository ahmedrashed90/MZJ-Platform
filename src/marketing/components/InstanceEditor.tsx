import { useMemo, useState } from "react";
import { Car, CaretDown, CaretUp, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import type { CreativeInstanceDraft, InstanceSectionDraft, MarketingMeta, StockVehicle } from "../types";

function toggle(items: string[], value: string) { return items.includes(value) ? items.filter((item)=>item!==value) : [...items,value]; }
function localId() { return crypto.randomUUID(); }

export function InstanceEditor({ instance, index, meta, vehicles, onChange, onRemove, showPlatforms = false }: {
  instance: CreativeInstanceDraft;
  index: number;
  meta: MarketingMeta;
  vehicles: StockVehicle[];
  onChange: (value: CreativeInstanceDraft) => void;
  onRemove: () => void;
  showPlatforms?: boolean;
}) {
  const [open,setOpen]=useState(true);
  const [carsOpen,setCarsOpen]=useState(false);
  const [platformsOpen,setPlatformsOpen]=useState(false);
  const creative=meta.creatives.find((item)=>item.id===instance.creativeId);
  const contentDepartment=meta.departments.find((item)=>item.is_content);
  const contentUserOptions=contentDepartment?.users || [];
  const activeDepartments=meta.departments.filter((item)=>item.is_active&&!item.is_content);
  const selectedContentIds=instance.contentUsers.map((item)=>item.userId);

  const primaryDepartment = creative ? meta.departments.find((item)=>item.id===creative.primary_department_id) : undefined;
  const sections = useMemo(() => {
    if (!creative) return instance.sections;
    if (instance.sections.some((section)=>section.kind==="primary")) return instance.sections;
    return [{ localId:localId(),departmentId:creative.primary_department_id,kind:"primary" as const,receivedDate:instance.primaryReceivedDate,notes:instance.primaryNotes,users:[] },...instance.sections];
  },[creative,instance.sections,instance.primaryReceivedDate,instance.primaryNotes]);

  const updateSection=(sectionIndex:number,next:InstanceSectionDraft)=>onChange({...instance,sections:sections.map((section,i)=>i===sectionIndex?next:section)});
  const addOptional=()=>{const used=new Set(sections.map((section)=>section.departmentId));const department=activeDepartments.find((item)=>!used.has(item.id));if(!department)return;onChange({...instance,sections:[...sections,{localId:localId(),departmentId:department.id,kind:"optional",receivedDate:"",notes:"",users:[]}]});};

  return <article className={`marketing-instance-editor ${open?"open":""}`}>
    <header><button type="button" className="marketing-instance-toggle" onClick={()=>setOpen((value)=>!value)}><div><strong>N{String(index+1).padStart(2,"0")} - {creative?.name || "اختر الكرييتيف"}</strong><small>{creative?.short_code || "—"} · القسم الأساسي: {primaryDepartment?.name || "—"}</small></div>{open?<CaretUp size={19}/>:<CaretDown size={19}/>}</button><button type="button" className="danger-icon" onClick={onRemove} title="حذف الكرييتيف"><Trash size={18}/></button></header>
    {open?<div className="marketing-instance-body">
      <section className="marketing-instance-column content"><h4><UsersThree size={18}/>قسم المحتوى</h4><label><span>تاريخ استلام قسم المحتوى</span><input type="date" value={instance.contentReceivedDate} onChange={(event)=>onChange({...instance,contentReceivedDate:event.target.value})}/></label><label><span>ملاحظات قسم المحتوى</span><textarea value={instance.contentNotes} onChange={(event)=>onChange({...instance,contentNotes:event.target.value})}/></label><div className="marketing-choice-list">{contentUserOptions.map((user)=><label key={user.user_id} className={selectedContentIds.includes(user.user_id)?"selected":""}><input type="checkbox" checked={selectedContentIds.includes(user.user_id)} onChange={()=>{const selected=selectedContentIds.includes(user.user_id);const contentUsers=selected?instance.contentUsers.filter((item)=>item.userId!==user.user_id):[...instance.contentUsers,{userId:user.user_id,dueDate:instance.contentReceivedDate,notes:""}];const nextSections=sections.map((section)=>({...section,users:section.users.map((sectionUser)=>({...sectionUser,writers:sectionUser.writers.filter((writer)=>writer.userId!==user.user_id)}))}));onChange({...instance,contentUsers,sections:nextSections});}}/>{user.full_name}</label>)}</div>{!contentUserOptions.length?<p className="marketing-hint">اربط يوزرات قسم المحتوى من إعدادات التسويق أولًا.</p>:null}</section>

      <section className="marketing-instance-column sections"><h4>الأقسام التنفيذية</h4>{sections.map((section,sectionIndex)=>{
        const department=meta.departments.find((item)=>item.id===section.departmentId);const departmentUsers=department?.users||[];
        return <article className="marketing-section-editor" key={section.localId}><header><strong>{section.kind==="primary"?"القسم الأساسي":"قسم اختياري"} — {department?.name||"—"}</strong>{section.kind==="optional"?<button type="button" onClick={()=>onChange({...instance,sections:sections.filter((_,i)=>i!==sectionIndex)})}><Trash size={16}/></button>:null}</header>{section.kind==="optional"?<label><span>القسم</span><select value={section.departmentId} onChange={(event)=>updateSection(sectionIndex,{...section,departmentId:event.target.value,users:[]})}>{activeDepartments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}<div className="marketing-form-row"><label><span>تاريخ استلام القسم</span><input type="date" value={section.receivedDate} onChange={(event)=>updateSection(sectionIndex,{...section,receivedDate:event.target.value})}/></label><label><span>ملاحظات القسم</span><textarea value={section.notes} onChange={(event)=>updateSection(sectionIndex,{...section,notes:event.target.value})}/></label></div><div className="marketing-choice-list">{departmentUsers.map((user)=>{const selected=section.users.some((item)=>item.userId===user.user_id);return <div className={`marketing-user-pair ${selected?"selected":""}`} key={user.user_id}><label><input type="checkbox" checked={selected} onChange={()=>{const users=selected?section.users.filter((item)=>item.userId!==user.user_id):[...section.users,{userId:user.user_id,dueDate:section.receivedDate,writers:[]}];updateSection(sectionIndex,{...section,users});}}/>{user.full_name}</label>{selected?<div className="marketing-writer-links"><span>ربط يوزرات المحتوى + تاريخ تسليم من كل يوزر</span>{contentUserOptions.filter((writer)=>selectedContentIds.includes(writer.user_id)).map((writer)=>{const sectionUser=section.users.find((item)=>item.userId===user.user_id);const link=sectionUser?.writers.find((item)=>item.userId===writer.user_id);return <div key={writer.user_id}><label><input type="checkbox" checked={Boolean(link)} onChange={()=>{const users=section.users.map((item)=>item.userId===user.user_id?{...item,writers:link?item.writers.filter((row)=>row.userId!==writer.user_id):[...item.writers,{userId:writer.user_id,dueDate:item.dueDate||section.receivedDate}]}:item);updateSection(sectionIndex,{...section,users});}}/>{writer.full_name}</label>{link?<input type="date" value={link.dueDate} onChange={(event)=>{const users=section.users.map((item)=>item.userId===user.user_id?{...item,writers:item.writers.map((row)=>row.userId===writer.user_id?{...row,dueDate:event.target.value}:row)}:item);updateSection(sectionIndex,{...section,users});}}/>:null}</div>})}</div>:null}</div>})}</div>{!departmentUsers.length?<p className="marketing-hint">لا يوجد يوزرات مرتبطون بهذا القسم في إعدادات التسويق.</p>:null}</article>})}<button type="button" className="marketing-add-inline" onClick={addOptional}><Plus size={16}/>إضافة قسم اختياري</button></section>

      <section className="marketing-instance-wide"><button type="button" className="marketing-accordion-button" onClick={()=>setCarsOpen((value)=>!value)}><Car size={18}/><span>اختيار سيارة أو أكثر من الاستوك</span><b>{instance.vehicleIds.length}</b>{carsOpen?<CaretUp/>:<CaretDown/>}</button>{carsOpen?<div className="marketing-vehicle-picker">{vehicles.map((vehicle)=><label key={vehicle.id} className={instance.vehicleIds.includes(vehicle.id)?"selected":""}><input type="checkbox" checked={instance.vehicleIds.includes(vehicle.id)} onChange={()=>onChange({...instance,vehicleIds:toggle(instance.vehicleIds,vehicle.id)})}/><strong>{vehicle.vin}</strong><span>{vehicle.car_name} — {vehicle.statement}</span><small>{vehicle.exterior_color} / {vehicle.interior_color} — {vehicle.location_name}</small></label>)}</div>:null}</section>

      {showPlatforms?<section className="marketing-instance-wide"><button type="button" className="marketing-accordion-button" onClick={()=>setPlatformsOpen((value)=>!value)}><span>المنصات وأنواع النشر</span><b>{instance.platformSelections.length}</b>{platformsOpen?<CaretUp/>:<CaretDown/>}</button>{platformsOpen?<div className="marketing-platform-picker">{meta.platforms.filter((platform)=>platform.is_active).map((platform)=>{const selection=instance.platformSelections.find((item)=>item.platformId===platform.id);return <article key={platform.id} className={selection?"selected":""}><label><input type="checkbox" checked={Boolean(selection)} onChange={()=>onChange({...instance,platformSelections:selection?instance.platformSelections.filter((item)=>item.platformId!==platform.id):[...instance.platformSelections,{platformId:platform.id,publishTypeIds:[]}]})}/>{platform.name}</label>{selection?<div>{platform.publishTypes.filter((type)=>type.is_active).map((type)=><label key={type.id}><input type="checkbox" checked={selection.publishTypeIds.includes(type.id)} onChange={()=>onChange({...instance,platformSelections:instance.platformSelections.map((item)=>item.platformId===platform.id?{...item,publishTypeIds:toggle(item.publishTypeIds,type.id)}:item)})}/>{type.name}<small>{type.dimensions}</small></label>)}</div>:null}</article>})}</div>:null}</section>:null}
    </div>:null}
  </article>;
}
