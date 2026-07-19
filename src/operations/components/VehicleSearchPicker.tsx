import { useEffect,useMemo,useState } from "react";
import { MagnifyingGlass,Plus,X } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import type { VehicleRow } from "../types";

export function VehicleSearchPicker({selected,onAdd,onRemove,multiple=true,placeholder="ابحث بجزء من VIN أو اسم السيارة"}:{selected:VehicleRow[];onAdd:(vehicle:VehicleRow)=>void;onRemove:(id:string)=>void;multiple?:boolean;placeholder?:string}) {
  const [query,setQuery]=useState(""); const [results,setResults]=useState<VehicleRow[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  const selectedIds=useMemo(()=>new Set(selected.map(item=>item.id)),[selected]);
  useEffect(()=>{
    const normalized=query.trim();
    if (normalized.length<2) { setResults([]);setError("");return; }
    const controller=new AbortController(); const timer=window.setTimeout(async()=>{
      setLoading(true);setError("");
      try { const payload=await operationsFetch<{vehicles:VehicleRow[]}>("vehicles",{query:{search:normalized,suggest:1,archived:"hide",pageSize:20},signal:controller.signal}); setResults(payload.vehicles||[]); }
      catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:"تعذر البحث");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },300);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[query]);
  return <div className="operations-vehicle-picker">
    <label className="operations-search-box"><MagnifyingGlass size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={placeholder}/>{loading?<span>...</span>:query?<button type="button" onClick={()=>setQuery("")} aria-label="مسح"><X size={15}/></button>:null}</label>
    {error?<p className="operations-inline-error">{error}</p>:null}
    {results.length?<div className="operations-suggestions">{results.map(vehicle=><button type="button" key={vehicle.id} disabled={selectedIds.has(vehicle.id)} onClick={()=>{onAdd(vehicle);if(!multiple)setQuery("");}}><span><strong>{vehicle.vin}</strong><small>{vehicle.car_name||"—"} • {vehicle.statement||"—"} • {vehicle.model_year||"—"}</small></span><span>{vehicle.location_name||"—"}<small>{vehicle.status_name||"—"}</small></span><Plus size={17}/></button>)}</div>:null}
    {selected.length?<div className="operations-selected-vehicles">{selected.map(vehicle=><article key={vehicle.id}><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name||"—"} • {vehicle.statement||"—"}</span><small>{vehicle.location_name||"—"} • {vehicle.status_name||"—"}</small></div><button type="button" onClick={()=>onRemove(vehicle.id)} aria-label="إزالة"><X size={17}/></button></article>)}</div>:null}
  </div>;
}
