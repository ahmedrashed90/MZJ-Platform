import { useEffect, useMemo, useState } from "react";
import { ArrowsLeftRight, CheckSquare, SpinnerGap, Trash } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import type { OperationsMeta, VehicleDetail, VehicleRow } from "../types";
import { VehicleSearch } from "../components/VehicleSearch";

type CheckState=Record<string,{isPresent:boolean;note:string}>;
export function MovementPage(){
  const[meta,setMeta]=useState<OperationsMeta>({locations:[],statuses:[],checklist:[]});const[selected,setSelected]=useState<VehicleRow[]>([]);const[destination,setDestination]=useState("");const[status,setStatus]=useState("");const[statusNote,setStatusNote]=useState("");const[missing,setMissing]=useState("");const[checks,setChecks]=useState<Record<string,CheckState>>({});const[saving,setSaving]=useState(false);const[error,setError]=useState("");const[message,setMessage]=useState("");
  useEffect(()=>{operationsFetch<OperationsMeta&{ok:boolean}>("/api/operations?resource=meta").then((payload)=>{setMeta(payload);setStatus(payload.statuses[0]?.code||"");}).catch((e)=>setError((e as Error).message));},[]);
  const chosenStatus=useMemo(()=>meta.statuses.find((item)=>item.code===status),[meta.statuses,status]);
  const add=(vehicle:VehicleRow)=>{
    setSelected((current)=>current.some((item)=>item.id===vehicle.id)?current:[...current,vehicle]);
    if(vehicle.location_code!=="agency")return;
    operationsFetch<{detail:VehicleDetail}>(`/api/operations?resource=vehicle&id=${encodeURIComponent(vehicle.id)}`)
      .then(({detail})=>setChecks((current)=>{
        if(current[vehicle.id])return current;
        return {...current,[vehicle.id]:Object.fromEntries(meta.checklist.map((item)=>{
          const saved=detail.checklist.find((entry)=>entry.code===item.code);
          return [item.code,{isPresent:Boolean(saved?.is_present),note:saved?.note||""}];
        }))};
      }))
      .catch((e)=>setError((e as Error).message));
  };
  const remove=(id:string)=>{setSelected((current)=>current.filter((item)=>item.id!==id));setChecks((current)=>{const next={...current};delete next[id];return next;});};
  const toggle=(vehicleId:string,itemCode:string,checked:boolean)=>setChecks((current)=>({...current,[vehicleId]:{...(current[vehicleId]||{}),[itemCode]:{...(current[vehicleId]?.[itemCode]||{note:""}),isPresent:checked}}}));
  const execute=async()=>{setSaving(true);setError("");setMessage("");try{await operationsFetch("/api/operations",{method:"POST",body:JSON.stringify({action:"create_movement",vehicleIds:selected.map((v)=>v.id),destinationLocationId:destination,newStatusCode:status,statusNote,missingReservationLocation:missing,checklistByVehicle:checks})});setMessage(`تم تنفيذ الحركة بنجاح لعدد ${selected.length.toLocaleString("ar-SA")} سيارة`);setSelected([]);setChecks({});setDestination("");setStatusNote("");setMissing("");}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
  return <section className="panel operations-page movement-page"><header className="operations-page-title"><div><span>حركة موحدة</span><h2>الحركة</h2><p>نفس الفلو لسيارة واحدة أو عدة سيارات، مع Transaction كاملة وسجل مستقل لكل سيارة.</p></div></header>
    {error?<div className="operations-error">{error}</div>:null}{message?<div className="operations-success">{message}</div>:null}
    <div className="operations-movement-builder"><section><h3>1. اختيار السيارات</h3><VehicleSearch onSelect={add} excludedIds={selected.map((item)=>item.id)}/>{selected.length?<div className="operations-selected-vehicles">{selected.map((vehicle)=><article key={vehicle.id}><header><div><b>{vehicle.vin}</b><span>{vehicle.car_name||"—"} · {vehicle.statement||"—"}</span><small>{vehicle.model_year||"—"} · {vehicle.location_name||"—"} · {vehicle.status_name||"—"}</small></div><button type="button" onClick={()=>remove(vehicle.id)}><Trash size={17}/></button></header>{vehicle.location_code==="agency"?<div className="operations-movement-checklist"><div className="checklist-title"><CheckSquare size={18}/><b>التشيك الخاص بهذه السيارة</b><span>ظهر لأن المكان الحالي هو الوكالة</span></div><div>{meta.checklist.map((item)=><label key={item.code}><input type="checkbox" checked={Boolean(checks[vehicle.id]?.[item.code]?.isPresent)} onChange={(e)=>toggle(vehicle.id,item.code,e.target.checked)}/><span>{item.name}</span></label>)}</div></div>:null}</article>)}</div>:<div className="operations-empty-inline">لم يتم اختيار سيارات بعد.</div>}</section>
      <section><h3>2. بيانات الحركة</h3><div className="operations-form-grid"><label><span>المكان الجديد *</span><select value={destination} onChange={(e)=>setDestination(e.target.value)}><option value="">اختر المكان</option>{meta.locations.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>الحالة الجديدة *</span><select value={status} onChange={(e)=>setStatus(e.target.value)}>{meta.statuses.map((item)=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>{chosenStatus?.requires_status_note?<label className="full required-note"><span>ملاحظات الحالة *</span><textarea value={statusNote} onChange={(e)=>setStatusNote(e.target.value)} placeholder="سبب وجود الملاحظات"/></label>:null}<label className="full"><span>حجز - نواقص - تحديد مكان</span><textarea value={missing} onChange={(e)=>setMissing(e.target.value)}/></label></div><div className="operations-note-removed">تم إلغاء حقل «ملاحظة الحركة» من الإدخال الجديد، مع الحفاظ على الملاحظات التاريخية للحركات القديمة.</div><button type="button" className="operations-primary-button execute-movement" onClick={()=>void execute()} disabled={saving||!selected.length||!destination||!status||(Boolean(chosenStatus?.requires_status_note)&&!statusNote.trim())}>{saving?<SpinnerGap className="spin" size={18}/>:<ArrowsLeftRight size={18}/>} {saving?"جاري تنفيذ الحركة...":`تنفيذ الحركة (${selected.length.toLocaleString("ar-SA")})`}</button></section>
    </div>
  </section>;
}
