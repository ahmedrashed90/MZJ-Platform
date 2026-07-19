import { useCallback,useEffect,useMemo,useState } from "react";
import { CheckCircle,FloppyDisk,Prohibit,WarningCircle } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { operationsFetch } from "../api";
import type { OperationsMeta,Pagination as PaginationType } from "../types";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

const emptyPagination:PaginationType={page:1,pageSize:30,total:0,pages:1};
type ApprovalFilter="all"|"missing_financial"|"missing_administrative"|"completed";
type ApprovalType="financial"|"administrative";
type ApprovalRow={
  id:string;vin:string;car_name:string|null;statement:string|null;location_name:string|null;status_name:string|null;
  financial_approved:boolean;administrative_approved:boolean;financial_note?:string|null;administrative_note?:string|null;
  financial_approved_at?:string|null;administrative_approved_at?:string|null;financial_approved_by_name?:string|null;administrative_approved_by_name?:string|null;
  financial_revoked_at?:string|null;administrative_revoked_at?:string|null;financial_revoked_by_name?:string|null;administrative_revoked_by_name?:string|null;
  cycle_no?:number;updated_at?:string;version?:number;
};
type ApprovalHistory={id:string;approval_type:ApprovalType;action:string;performer_name:string;performer_role?:string|null;performer_branch?:string|null;note?:string|null;cycle_no?:number;created_at:string};
type ApprovalDetail=ApprovalRow&{history:ApprovalHistory[]};

function formatDate(value?:string|null){return value?new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—"}
function actionLabel(action:string){return action==="approved"?"تمت الموافقة":action==="revoked"?"تم التراجع":action==="note_updated"?"تم تحديث الملاحظة":action==="initialized"?"تمت تهيئة الموافقة":action==="cleared"?"تم مسح الحالة التشغيلية":action}

function ApprovalCard({type,vehicle,canApprove,canRevert,canNotes,saving,onAction}:{
  type:ApprovalType;vehicle:ApprovalDetail;canApprove:boolean;canRevert:boolean;canNotes:boolean;saving:string;
  onAction:(type:ApprovalType,action:"approve"|"revoke"|"note",note:string)=>Promise<void>;
}){
  const financial=type==="financial";
  const approved=financial?vehicle.financial_approved:vehicle.administrative_approved;
  const initialNote=(financial?vehicle.financial_note:vehicle.administrative_note)||"";
  const [note,setNote]=useState(initialNote);
  useEffect(()=>setNote(initialNote),[initialNote,vehicle.id]);
  const approvedBy=financial?vehicle.financial_approved_by_name:vehicle.administrative_approved_by_name;
  const approvedAt=financial?vehicle.financial_approved_at:vehicle.administrative_approved_at;
  const busy=saving.startsWith(`${type}:`);
  return <article className="operations-approval-card">
    <header><div><h3>{financial?"الموافقة المالية":"الموافقة الإدارية"}</h3><p>{approved?`تمت بواسطة ${approvedBy||"مستخدم مخول"} — ${formatDate(approvedAt)}`:"لم تتم حتى الآن"}</p></div><span className={`operations-badge ${approved?"success":"warning"}`}>{approved?"تم":"لم يتم"}</span></header>
    <div className="operations-approval-actions">
      {canApprove?<button type="button" className="primary" disabled={busy||approved} onClick={()=>void onAction(type,"approve",note)}><CheckCircle size={17}/>{approved?"تمت الموافقة":financial?"موافقة مالية":"موافقة إدارية"}</button>:null}
      {canRevert?<button type="button" className="danger" disabled={busy||!approved||!note.trim()} title={!note.trim()?"اكتب سبب التراجع في الملاحظة أولًا":""} onClick={()=>void onAction(type,"revoke",note)}><Prohibit size={17}/>تراجع</button>:null}
    </div>
    <label className="operations-modal-field"><span>{financial?"ملاحظة مالية":"ملاحظة إدارية"}</span><textarea rows={4} value={note} readOnly={!canNotes&&!(canRevert&&approved)} onChange={event=>setNote(event.target.value)} placeholder={canNotes||canRevert?"اكتب الملاحظة أو سبب التراجع...":"لا توجد صلاحية لتعديل الملاحظة"}/></label>
    {canNotes?<button type="button" className="secondary operations-note-save" disabled={busy||note===initialNote} onClick={()=>void onAction(type,"note",note)}><FloppyDisk size={17}/>حفظ الملاحظة</button>:null}
  </article>
}

function ApprovalModal({vehicleId,meta,onClose,notify}:{vehicleId:string|null;meta:OperationsMeta;onClose:()=>void;notify:(message:string,error?:boolean)=>void}){
  const [vehicle,setVehicle]=useState<ApprovalDetail|null>(null);const [loading,setLoading]=useState(false);const [saving,setSaving]=useState("");
  const can=(permission:string)=>meta.permissionCodes.includes("*")||meta.permissionCodes.includes(permission);
  const load=useCallback(async()=>{if(!vehicleId)return;setLoading(true);try{const payload=await operationsFetch<{vehicle:ApprovalDetail}>("approvals",{query:{id:vehicleId}});setVehicle(payload.vehicle)}catch(error){notify(error instanceof Error?error.message:"تعذر تحميل الموافقات",true)}finally{setLoading(false)}},[vehicleId,notify]);
  useEffect(()=>{void load()},[load]);
  async function action(type:ApprovalType,action:"approve"|"revoke"|"note",note:string){if(!vehicleId)return;setSaving(`${type}:${action}`);try{const payload=await operationsFetch<{message:string}>("approvals",{method:"POST",body:JSON.stringify({vehicleId,approvalType:type,action,note})});notify(payload.message);await load()}catch(error){notify(error instanceof Error?error.message:"تعذر حفظ الموافقة",true)}finally{setSaving("")}}
  const subtitle=vehicle?`${vehicle.vin} — ${vehicle.car_name||"—"} — ${vehicle.location_name||"—"}`:"";
  return <Modal open={Boolean(vehicleId)} title="موافقات السيارة" subtitle={subtitle} onClose={onClose} className="operations-approval-modal">
    {loading||!vehicle?<div className="operations-loading">جاري تحميل الموافقات...</div>:<>
      <div className="operations-approval-summary"><span>الحالة الحالية</span><strong>{vehicle.status_name||"مباع تحت التسليم"}</strong><small>دورة الموافقات رقم {vehicle.cycle_no||1}</small></div>
      <div className="operations-approval-cards">
        <ApprovalCard type="financial" vehicle={vehicle} canApprove={can("operations.approvals.financial")} canRevert={can("operations.approvals.financial")&&can("operations.approvals.revert")} canNotes={can("operations.approvals.notes")} saving={saving} onAction={action}/>
        <ApprovalCard type="administrative" vehicle={vehicle} canApprove={can("operations.approvals.administrative")} canRevert={can("operations.approvals.administrative")&&can("operations.approvals.revert")} canNotes={can("operations.approvals.notes")} saving={saving} onAction={action}/>
      </div>
      <section className="operations-approval-history"><h3>سجل الموافقات والتراجع</h3>{vehicle.history.length?vehicle.history.map(item=><article key={item.id}><div><b>{item.approval_type==="financial"?"مالية":"إدارية"} — {actionLabel(item.action)}</b><span>{item.performer_name} • {formatDate(item.created_at)}</span></div><p>{item.note||"بدون ملاحظة"}</p></article>):<p className="operations-empty">لا يوجد سجل موافقات</p>}</section>
    </>}
  </Modal>
}

export function ApprovalsPage({meta,notify}:{meta:OperationsMeta;notify:(message:string,error?:boolean)=>void}){
  const [searchParams,setSearchParams]=useSearchParams();
  const urlFilter=useMemo(()=>{const value=searchParams.get("filter")||"all";return (["all","missing_financial","missing_administrative","completed"].includes(value)?value:"all") as ApprovalFilter},[searchParams]);
  const [rows,setRows]=useState<ApprovalRow[]>([]);const [pagination,setPagination]=useState(emptyPagination);const [summary,setSummary]=useState({total:0,missingFinancial:0,missingAdministrative:0,completed:0});const [page,setPage]=useState(1);
  const [search,setSearch]=useState("");const [debounced,setDebounced]=useState("");const [filter,setFilter]=useState<ApprovalFilter>(urlFilter);const [loading,setLoading]=useState(true);
  const vehicleId=searchParams.get("vehicle");
  useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(search),300);return()=>window.clearTimeout(timer)},[search]);
  useEffect(()=>setFilter(urlFilter),[urlFilter]);
  const load=useCallback(async()=>{setLoading(true);try{const payload=await operationsFetch<{vehicles:ApprovalRow[];pagination:PaginationType;summary:{total:number;missingFinancial:number;missingAdministrative:number;completed:number}}>("approvals",{query:{search:debounced,filter,page,pageSize:30}});setRows(payload.vehicles||[]);setPagination(payload.pagination||emptyPagination);setSummary(payload.summary||{total:0,missingFinancial:0,missingAdministrative:0,completed:0})}catch(error){notify(error instanceof Error?error.message:"تعذر تحميل سيارات الموافقات",true)}finally{setLoading(false)}},[debounced,filter,page,notify]);
  useEffect(()=>{void load()},[load]);useEffect(()=>setPage(1),[debounced,filter]);
  useEffect(()=>{const onChange=()=>void load();window.addEventListener("operations:data-changed",onChange);return()=>window.removeEventListener("operations:data-changed",onChange)},[load]);
  function updateFilter(next:ApprovalFilter){setFilter(next);const params=new URLSearchParams(searchParams);if(next==="all")params.delete("filter");else params.set("filter",next);params.delete("vehicle");setSearchParams(params,{replace:true})}
  function openVehicle(id:string){const params=new URLSearchParams(searchParams);params.set("vehicle",id);setSearchParams(params,{replace:true})}
  function closeVehicle(){const params=new URLSearchParams(searchParams);params.delete("vehicle");setSearchParams(params,{replace:true})}
  return <div className="operations-page"><header className="operations-page-toolbar"><div><h2>الموافقة المالية والإدارية</h2><p>تظهر هنا فقط السيارات التي حالتها الحالية «مباع تحت التسليم».</p></div></header>
    <section className="operations-approval-kpis"><button type="button" className={filter==="all"?"active":""} onClick={()=>updateFilter("all")}><span>الإجمالي</span><b>{summary.total}</b></button><button type="button" className={filter==="missing_financial"?"active":""} onClick={()=>updateFilter("missing_financial")}><span>ناقص موافقة مالية</span><b>{summary.missingFinancial}</b></button><button type="button" className={filter==="missing_administrative"?"active":""} onClick={()=>updateFilter("missing_administrative")}><span>ناقص موافقة إدارية</span><b>{summary.missingAdministrative}</b></button><button type="button" className={filter==="completed"?"active":""} onClick={()=>updateFilter("completed")}><span>الموافقات المكتملة</span><b>{summary.completed}</b></button></section>
    <section className="operations-filters"><label><span>بحث VIN أو السيارة</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="بحث جزئي..."/></label></section>
    {loading?<div className="operations-loading">جاري التحميل...</div>:<><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>VIN</th><th>السيارة</th><th>البيان</th><th>المكان</th><th>الموافقة المالية</th><th>الموافقة الإدارية</th><th>الإجراء</th></tr></thead><tbody>{rows.length?rows.map(row=><tr key={row.id}><td><button className="table-link mono" onClick={()=>openVehicle(row.id)}>{row.vin}</button></td><td>{row.car_name||"—"}</td><td>{row.statement||"—"}</td><td>{row.location_name||"—"}</td><td><span className={`operations-badge ${row.financial_approved?"success":"warning"}`}>{row.financial_approved?"تم":"لم يتم"}</span></td><td><span className={`operations-badge ${row.administrative_approved?"success":"warning"}`}>{row.administrative_approved?"تم":"لم يتم"}</span></td><td><button type="button" onClick={()=>openVehicle(row.id)}>فتح الموافقات</button></td></tr>):<tr><td colSpan={7} className="operations-empty"><WarningCircle size={18}/>لا توجد سيارات مطابقة داخل «مباع تحت التسليم»</td></tr>}</tbody></table></div><Pagination value={pagination} onChange={setPage}/></>}
    <ApprovalModal vehicleId={vehicleId} meta={meta} onClose={closeVehicle} notify={notify}/>
  </div>
}
