import { useEffect, useState } from "react";
import { Archive, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import { VehicleDetailDrawer } from "../components/VehicleDetailDrawer";
import { VehicleTable } from "../components/VehicleTable";
import type { OperationsVehicle } from "../types";

export function OperationsArchivePage(){
  const [search,setSearch]=useState("");const [vehicles,setVehicles]=useState<OperationsVehicle[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [selected,setSelected]=useState<OperationsVehicle|null>(null);
  async function load(){setLoading(true);setError("");try{const payload=await operationsFetch<{ok:boolean;vehicles:OperationsVehicle[]}>(`/api/operations${operationsQuery({resource:"vehicles",archived:true,search,limit:500})}`);setVehicles(payload.vehicles||[]);}catch(reason){setError(reason instanceof Error?reason.message:"تعذر تحميل الأرشيف");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  return <div className="module-page operations-page"><header className="module-page-head"><div><h1>الأرشيف</h1><p>السيارات المؤرشفة تظل بكل بياناتها وحركاتها وموافقاتها وطلبات التراكينج.</p></div><Archive size={28}/></header>{error?<div className="connection-banner"><WarningCircle size={20}/><span>{error}</span></div>:null}<section className="panel operations-filter-panel archive"><label className="operations-search-field"><span>بحث في VIN أو السيارة</span><div><MagnifyingGlass size={18}/><input value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void load();}}/></div></label><button type="button" className="operations-primary-button" onClick={()=>void load()}>بحث</button></section><section className="panel operations-table-card"><div className="operations-table-heading"><div><h2>السيارات المؤرشفة</h2><span>{vehicles.length}</span></div></div><VehicleTable vehicles={vehicles} loading={loading} onOpen={setSelected} showActions={false}/></section>{selected?<VehicleDetailDrawer vehicle={selected} canDelete={false} canArchive={false} onClose={()=>setSelected(null)} onChanged={()=>void load()}/>:null}</div>;
}
