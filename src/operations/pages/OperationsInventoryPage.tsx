import { useEffect, useState } from "react";
import { ArrowClockwise, DownloadSimple, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { downloadCsv, operationsFetch, operationsQuery } from "../api";
import { VehicleDetailDrawer } from "../components/VehicleDetailDrawer";
import { VehicleTable } from "../components/VehicleTable";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

export function OperationsInventoryPage() {
  const { user } = useAuth();
  const { meta, error: metaError } = useOperationsMeta();
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<OperationsVehicle | null>(null);
  const canEdit = user?.roleCodes.some((code)=>["admin","system_admin"].includes(code)) || user?.permissionCodes?.includes("operations.vehicle.edit") || false;
  const canDelete = user?.roleCodes.some((code)=>["admin","system_admin"].includes(code)) || user?.permissionCodes?.includes("operations.vehicle.delete") || false;
  const canArchive = user?.roleCodes.some((code)=>["admin","system_admin"].includes(code)) || user?.permissionCodes?.includes("operations.vehicle.archive") || false;
  const canExport = user?.roleCodes.some((code)=>["admin","system_admin"].includes(code)) || user?.permissionCodes?.includes("operations.export") || false;

  async function load(nextPage = page) {
    setLoading(true); setError("");
    try {
      const payload = await operationsFetch<{ok:boolean;vehicles:OperationsVehicle[];total:number}>(`/api/operations${operationsQuery({resource:"vehicles",page:nextPage,limit:50,search,locationId,status,model,agent})}`);
      setVehicles(payload.vehicles || []); setTotal(payload.total || 0); setPage(nextPage);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل مخزون السيارات"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(1); }, []);

  async function exportRows() {
    try {
      const payload = await operationsFetch<{ok:boolean;vehicles:OperationsVehicle[]}>(`/api/operations${operationsQuery({resource:"vehicles",export:true,search,locationId,status,model,agent})}`);
      downloadCsv("MZJ-Operations-Inventory.csv", payload.vehicles.map((row)=>({
        "الهيكل VIN": row.vin,"السيارة":row.car_name,"البيان":row.statement,"الوكيل":row.agent_name,"اللون الداخلي":row.interior_color,
        "اللون الخارجي":row.exterior_color,"الموديل":row.model_year,"اللوحة":row.plate_no,"اسم الدفعة بالتاريخ":row.batch_no,"المكان":row.location_name,
        "ملاحظات في السيارة":row.notes,"حجز - نواقص - تحديد مكان":row.shortage_location_note,"الحالة":row.status_name,"Tracking":row.tracking_order_no||"لا يوجد طلب",
      })));
    } catch (reason) { setError(reason instanceof Error?reason.message:"تعذر تصدير البيانات"); }
  }

  return <div className="module-page operations-page">
    <header className="module-page-head"><div><h1>مخزون السيارات</h1><p>المخزون التشغيلي الكامل مع الحركة والتراكينج والموافقات وطلبات النقل.</p></div><div className="operations-head-actions">{canExport?<button type="button" onClick={()=>void exportRows()}><DownloadSimple size={18}/>تصدير النتائج</button>:null}<button type="button" onClick={()=>void load()} disabled={loading}><ArrowClockwise size={18} className={loading?"spin":""}/>تحديث</button></div></header>
    {error||metaError?<div className="connection-banner"><WarningCircle size={20}/><span>{error||metaError}</span></div>:null}
    <section className="panel operations-filter-panel">
      <label className="operations-search-field"><span>بحث جزئي في VIN أو السيارة</span><div><MagnifyingGlass size={18}/><input value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void load(1);}} placeholder="اكتب جزءًا من رقم الهيكل"/></div></label>
      <label><span>المكان</span><select value={locationId} onChange={(e)=>setLocationId(e.target.value)}><option value="">كل الأماكن</option>{meta?.locations.map((row)=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label><span>الحالة</span><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">كل الحالات</option>{meta?.statuses.map((row)=><option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
      <label><span>الموديل</span><input value={model} onChange={(e)=>setModel(e.target.value)} placeholder="الموديل"/></label>
      <label><span>الوكيل</span><input value={agent} onChange={(e)=>setAgent(e.target.value)} placeholder="الوكيل"/></label>
      <button type="button" className="operations-primary-button" onClick={()=>void load(1)}><MagnifyingGlass size={17}/>تطبيق</button>
    </section>
    <section className="panel operations-table-card"><div className="operations-table-heading"><div><h2>السيارات الظاهرة</h2><span>{total} سيارة</span></div><small>اضغط على رقم الهيكل لفتح الملف الكامل.</small></div><VehicleTable vehicles={vehicles} loading={loading} onOpen={setSelected} onDelete={canDelete?setSelected:undefined}/><div className="operations-pagination"><button type="button" disabled={page<=1||loading} onClick={()=>void load(page-1)}>السابق</button><span>صفحة {page} من {Math.max(1,Math.ceil(total/50))}</span><button type="button" disabled={page*50>=total||loading} onClick={()=>void load(page+1)}>التالي</button></div></section>
    {selected?<VehicleDetailDrawer vehicle={selected} canEdit={canEdit} canDelete={canDelete} canArchive={canArchive} onClose={()=>setSelected(null)} onChanged={()=>void load()}/>:null}
  </div>;
}
