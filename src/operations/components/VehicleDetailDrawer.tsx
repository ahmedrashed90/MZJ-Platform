import { useEffect, useState } from "react";
import { Archive, Car, CheckCircle, Clock, FloppyDisk, MapPin, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { formatDate, operationsFetch } from "../api";
import type { OperationsVehicle, VehicleDetail } from "../types";

const editKeys = ["carName","statement","agentName","interiorColor","exteriorColor","modelYear","plateNo","batchNo","notes"] as const;
type EditForm = Record<(typeof editKeys)[number], string>;
function formFromVehicle(vehicle: OperationsVehicle): EditForm { return { carName:vehicle.car_name||"",statement:vehicle.statement||"",agentName:vehicle.agent_name||"",interiorColor:vehicle.interior_color||"",exteriorColor:vehicle.exterior_color||"",modelYear:vehicle.model_year||"",plateNo:vehicle.plate_no||"",batchNo:vehicle.batch_no||"",notes:vehicle.notes||"" }; }

export function VehicleDetailDrawer({ vehicle, canEdit = false, canDelete, canArchive, onClose, onChanged }: { vehicle: OperationsVehicle; canEdit?: boolean; canDelete: boolean; canArchive: boolean; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"delete"|"archive"|null>(null);
  const [reason, setReason] = useState("");
  const [editing,setEditing]=useState(false);
  const [form,setForm]=useState<EditForm>(()=>formFromVehicle(vehicle));
  const [busy, setBusy] = useState(false);
  useEscapeToClose(!action && !editing, onClose);
  useEscapeToClose(Boolean(action), ()=>setAction(null));
  useEscapeToClose(editing, ()=>setEditing(false));
  useEffect(() => {
    setForm(formFromVehicle(vehicle));
    operationsFetch<{ok:boolean}&VehicleDetail>(`/api/operations?resource=vehicle&id=${encodeURIComponent(vehicle.id)}`).then((payload)=>setDetail(payload)).catch((reason)=>setError(reason instanceof Error?reason.message:"تعذر تحميل تفاصيل السيارة"));
  }, [vehicle.id]);

  async function submitAction() {
    if (!action || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: action === "delete" ? "delete_vehicle" : "archive_vehicle", id: vehicle.id, reason }) });
      onChanged(); onClose();
    } catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }

  async function saveEdit(){
    setBusy(true);setError("");
    try{
      await operationsFetch("/api/operations",{method:"POST",body:JSON.stringify({action:"update_vehicle",id:vehicle.id,...form})});
      setEditing(false);onChanged();
      const payload=await operationsFetch<{ok:boolean}&VehicleDetail>(`/api/operations?resource=vehicle&id=${encodeURIComponent(vehicle.id)}`);setDetail(payload);
    }catch(reasonError){setError(reasonError instanceof Error?reasonError.message:"تعذر حفظ بيانات السيارة");}finally{setBusy(false);}
  }

  const shown=detail?.vehicle||vehicle;
  return <div className="crm-drawer-backdrop operations-detail-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target)onClose();}}>
    <aside className="operations-detail-drawer">
      <header><div><span>تفاصيل السيارة</span><h2>{shown.vin}</h2><p>{shown.car_name || "—"}</p></div><button type="button" onClick={onClose}><X size={22}/></button></header>
      {error?<div className="connection-banner">{error}</div>:null}
      <div className="operations-detail-actions">
        {canEdit&&!shown.archived_at?<button type="button" onClick={()=>{setForm(formFromVehicle(shown));setEditing(true);}}><PencilSimple size={17}/>تعديل البيانات</button>:null}
        {canArchive && !shown.archived_at?<button type="button" onClick={()=>{setAction("archive");setReason("");}}><Archive size={17}/>أرشفة السيارة</button>:null}
        {canDelete?<button type="button" className="danger" onClick={()=>{setAction("delete");setReason("");}}><Trash size={17}/>مسح السيارة</button>:null}
      </div>
      <div className="operations-detail-body">
        <section className="operations-detail-grid">
          <div><Car size={18}/><span><small>السيارة</small><strong>{shown.car_name||"—"}</strong></span></div>
          <div><MapPin size={18}/><span><small>المكان</small><strong>{shown.location_name||"—"}</strong></span></div>
          <div><CheckCircle size={18}/><span><small>الحالة</small><strong>{shown.status_name||shown.status_code}</strong></span></div>
          <div><Clock size={18}/><span><small>آخر تحديث</small><strong>{formatDate(shown.updated_at)}</strong></span></div>
        </section>
        <section className="operations-detail-section"><h3>بيانات السيارة</h3><dl>
          <div><dt>البيان</dt><dd>{shown.statement||"—"}</dd></div><div><dt>الوكيل</dt><dd>{shown.agent_name||"—"}</dd></div><div><dt>الموديل</dt><dd>{shown.model_year||"—"}</dd></div><div><dt>اللوحة</dt><dd>{shown.plate_no||"—"}</dd></div><div><dt>اللون الخارجي</dt><dd>{shown.exterior_color||"—"}</dd></div><div><dt>اللون الداخلي</dt><dd>{shown.interior_color||"—"}</dd></div><div><dt>اسم الدفعة</dt><dd>{shown.batch_no||"—"}</dd></div><div><dt>الملاحظات</dt><dd>{shown.notes||"—"}</dd></div><div><dt>ملاحظات الحالة</dt><dd>{shown.status_note||"—"}</dd></div><div><dt>حجز - نواقص - تحديد مكان</dt><dd>{shown.shortage_location_note||"—"}</dd></div>
        </dl></section>
        <section className="operations-detail-section"><h3>التشيك</h3><div className="operations-check-summary">{detail?.checks.length?detail.checks.map((item:any)=><span key={item.item_code} className={item.status==="ok"?"ok":""}>{item.item_name}: {item.status}</span>):<p>لا توجد بيانات تشيك.</p>}</div></section>
        <section className="operations-detail-section"><h3>الموافقات</h3><div className="operations-timeline">{detail?.approvals.length?detail.approvals.map((row:any)=><div key={row.id}><b>دورة {row.cycle_no}</b><span>مالي: {row.financial_approved?"تم":"لم يتم"} • إداري: {row.administrative_approved?"تم":"لم يتم"}</span><small>{formatDate(row.started_at)}</small></div>):<p>لا توجد دورات موافقات.</p>}</div></section>
        <section className="operations-detail-section"><h3>طلبات النقل</h3><div className="operations-timeline">{detail?.transfers.length?detail.transfers.map((row:any)=><div key={row.id}><b>{row.request_no}</b><span>{row.source_location||"—"} ← {row.destination_location||"—"} • {row.status}</span><small>{formatDate(row.requested_at)}</small></div>):<p>لا توجد طلبات نقل.</p>}</div></section>
        <section className="operations-detail-section"><h3>سجل الحركات</h3><div className="operations-timeline">{detail?.movements.length?detail.movements.map((row:any)=><div key={row.id}><b>{row.from_location_name||"—"} ← {row.to_location_name||"—"}</b><span>{row.old_status||"—"} ← {row.new_status||"—"}</span><small>{row.performed_by_name||"—"} • {formatDate(row.created_at)}</small></div>):<p>لا توجد حركات.</p>}</div></section>
        <section className="operations-detail-section"><h3>طلبات التراكينج</h3><div className="operations-timeline">{detail?.tracking.length?detail.tracking.map((row:any)=><div key={row.id}><b>{row.sales_order_no}</b><span>{row.status}</span><small>{formatDate(row.updated_at)}</small></div>):<p>لا يوجد طلب تراكينج مرتبط.</p>}</div></section>
      </div>
    </aside>
    {editing?<div className="modal-backdrop operations-confirm-backdrop"><div className="operations-confirm-modal operations-edit-modal"><h3>تعديل بيانات السيارة</h3><p>المكان والحالة يتم تغييرهما من تبويب الحركة فقط.</p><div className="operations-form-grid">{([['carName','السيارة'],['statement','البيان'],['agentName','الوكيل'],['interiorColor','اللون الداخلي'],['exteriorColor','اللون الخارجي'],['modelYear','الموديل'],['plateNo','اللوحة'],['batchNo','اسم الدفعة']] as Array<[keyof EditForm,string]>).map(([key,label])=><label key={key}><span>{label}</span><input value={form[key]} onChange={(event)=>setForm((current)=>({...current,[key]:event.target.value}))}/></label>)}<label className="span-2"><span>ملاحظات السيارة</span><textarea rows={4} value={form.notes} onChange={(event)=>setForm((current)=>({...current,notes:event.target.value}))}/></label></div><div><button type="button" onClick={()=>setEditing(false)}>إلغاء</button><button type="button" className="primary" disabled={busy} onClick={()=>void saveEdit()}><FloppyDisk size={17}/>{busy?"جاري الحفظ...":"حفظ التعديل"}</button></div></div></div>:null}
    {action?<div className="modal-backdrop operations-confirm-backdrop"><div className="operations-confirm-modal"><h3>{action==="delete"?"تأكيد مسح السيارة":"تأكيد أرشفة السيارة"}</h3><p>{action==="delete"?"هذا حذف فيزيائي نهائي، ولن يُسمح به إذا كان للسيارة أي تاريخ.":"ستظل كل بيانات السيارة وتاريخها محفوظة في الأرشيف."}</p><strong>{shown.vin} — {shown.car_name||"—"}</strong><label><span>سبب الإجراء</span><textarea rows={4} value={reason} onChange={(e)=>setReason(e.target.value)}/></label><div><button type="button" onClick={()=>setAction(null)}>إلغاء</button><button type="button" className={action==="delete"?"danger":"primary"} disabled={!reason.trim()||busy} onClick={()=>void submitAction()}>{busy?"جاري التنفيذ...":action==="delete"?"مسح نهائي":"تأكيد الأرشفة"}</button></div></div></div>:null}
  </div>;
}
