import { Archive,CheckCircle,Eye,PencilSimple,WarningCircle,XCircle } from "@phosphor-icons/react";
import type { VehicleRow } from "../types";

const show=(value:unknown)=>value===null||value===undefined||value===""?"—":String(value);
function trackingLabel(row:VehicleRow) {
  if (row.tracking_sync_state==="unavailable"||row.tracking_state==="unavailable") return {text:"تعذر التحديث",kind:"danger"};
  if (row.tracking_state==="no_request") return {text:"لا يوجد طلب",kind:"muted"};
  if (row.tracking_state==="deleted") return {text:"لا يوجد طلب نشط",kind:"muted"};
  if (row.tracking_state==="cancelled") return {text:"ملغي",kind:"warning"};
  if (row.tracking_state==="rejected") return {text:"مرفوض",kind:"danger"};
  if (row.tracking_state==="completed") return {text:`مكتمل — ${row.tracking_progress||100}%`,kind:"success"};
  return {text:`${row.tracking_state==="not_started"?"لم يبدأ":"قيد التنفيذ"} — ${row.tracking_progress||0}%`,kind:"progress"};
}

export function VehicleTable({rows,onView,onEdit,onTracking,onArchive,selected,onSelect,showSelection=false,manage=false}:{rows:VehicleRow[];onView:(id:string)=>void;onEdit?:(row:VehicleRow)=>void;onTracking?:(row:VehicleRow)=>void;onArchive?:(row:VehicleRow)=>void;selected?:Set<string>;onSelect?:(row:VehicleRow)=>void;showSelection?:boolean;manage?:boolean}) {
  return <div className="operations-table-wrap"><table className="operations-table inventory-table"><thead><tr>
    {showSelection?<th>اختيار</th>:null}<th>الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>اللون الداخلي</th><th>اللون الخارجي</th><th>الموديل</th><th>اللوحة</th><th>اسم الدفعة بالتاريخ</th><th>المكان</th><th>ملاحظات في السيارة</th><th>حجز - نواقص - تحديد مكان</th><th>الحالة</th><th>Tracking</th><th>الموافقات</th><th>التشيك</th><th>طلبات النقل</th><th>الأرشيف</th>{manage?<th>الإجراءات</th>:null}
  </tr></thead><tbody>{rows.length?rows.map(row=>{
    const tracking=trackingLabel(row); const approvals=row.financial_approved&&row.administrative_approved; const checks=Object.values(row.check_items||{}); const checked=checks.filter(Boolean).length;
    return <tr key={row.id} className={row.has_notes?"has-notes":""}>
      {showSelection?<td><input type="checkbox" checked={Boolean(selected?.has(row.id))} onChange={()=>onSelect?.(row)}/></td>:null}
      <td><button type="button" className="table-link mono" onClick={()=>onView(row.id)}>{row.vin}</button></td><td>{show(row.car_name)}</td><td>{show(row.statement)}</td><td>{show(row.agent_name)}</td><td>{show(row.interior_color)}</td><td>{show(row.exterior_color)}</td><td>{show(row.model_year)}</td><td>{show(row.plate_no)}</td><td>{show(row.batch_no)}</td><td>{show(row.location_name)}</td><td>{show(row.notes)}</td><td>{show(row.booking_shortage_location_notes)}</td><td><span className={`operations-badge ${row.status_code==="has_notes"?"warning":""}`}>{show(row.status_name)}</span>{row.status_note?<small className="cell-note">{row.status_note}</small>:null}</td>
      <td><button type="button" className={`operations-badge ${tracking.kind}`} onClick={()=>onTracking?.(row)} disabled={!onTracking}>{tracking.text}</button>{row.tracking_state==="in_progress"?<span className="mini-progress"><i style={{width:`${Math.min(100,row.tracking_progress||0)}%`}}/></span>:null}</td>
      <td><span className={`operations-badge ${approvals?"success":"warning"}`}>{approvals?<><CheckCircle size={14}/>مكتملة</>:<><WarningCircle size={14}/>ناقصة</>}</span></td><td><span className="operations-badge muted">{checked}/{checks.length||0}</span></td><td><span className="operations-badge muted">{row.requests_count||0}</span></td>
      <td>{row.archived_at?<span className="operations-badge success">مؤرشفة</span>:onArchive?<button type="button" className="table-icon" onClick={()=>onArchive(row)} title="أرشفة"><Archive size={17}/></button>:<span className="operations-badge muted">نشطة</span>}</td>
      {manage?<td className="table-actions"><button type="button" onClick={()=>onView(row.id)} title="عرض"><Eye size={17}/></button>{onEdit?<button type="button" onClick={()=>onEdit(row)} title="تعديل"><PencilSimple size={17}/></button>:null}</td>:null}
    </tr>;
  }):<tr><td colSpan={(showSelection?1:0)+19+(manage?1:0)} className="operations-empty"><XCircle size={22}/>لا توجد سيارات مطابقة</td></tr>}</tbody></table></div>;
}
