import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import type { VehicleRow } from "../types";

type Props = { onSelect: (vehicle: VehicleRow) => void; excludedIds?: string[]; placeholder?: string; disabled?: boolean };
export function VehicleSearch({ onSelect, excludedIds = [], placeholder = "ابحث بجزء من رقم الهيكل أو اسم السيارة", disabled }: Props) {
  const [value,setValue]=useState(""); const [rows,setRows]=useState<VehicleRow[]>([]); const [loading,setLoading]=useState(false); const [open,setOpen]=useState(false); const abortRef=useRef<AbortController|null>(null);
  useEffect(()=>{
    const search=value.trim(); if(search.length<2){setRows([]);setOpen(false);return;}
    const timer=window.setTimeout(()=>{
      abortRef.current?.abort(); const controller=new AbortController(); abortRef.current=controller; setLoading(true);
      operationsFetch<{rows:VehicleRow[]}>(`/api/operations${operationsQuery({resource:"vehicle_search",search,limit:20})}`,{signal:controller.signal})
        .then((payload)=>{setRows(payload.rows.filter((row)=>!excludedIds.includes(row.id)));setOpen(true);})
        .catch((error)=>{if((error as Error).name!=="AbortError")setRows([]);})
        .finally(()=>setLoading(false));
    },300);
    return ()=>window.clearTimeout(timer);
  },[value,excludedIds.join("|")]);
  useEffect(()=>()=>abortRef.current?.abort(),[]);
  return <div className="operations-vehicle-search">
    <div className="operations-search-input"><MagnifyingGlass size={18}/><input value={value} onChange={(e)=>setValue(e.target.value)} placeholder={placeholder} disabled={disabled}/>{value?<button type="button" onClick={()=>{setValue("");setRows([]);setOpen(false);}} aria-label="مسح"><X size={15}/></button>:null}</div>
    {loading?<small>جاري البحث...</small>:null}
    {open?<div className="operations-search-results">{rows.length?rows.map((row)=><button type="button" key={row.id} onClick={()=>{onSelect(row);setValue("");setOpen(false);setRows([]);}}><strong>{row.vin}</strong><span>{row.car_name||"—"} · {row.statement||"—"}</span><small>{row.model_year||"—"} · {row.location_name||"—"} · {row.status_name||"—"}</small></button>):<div className="operations-empty-inline">لا توجد نتائج مطابقة</div>}</div>:null}
  </div>;
}
