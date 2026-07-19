import { useRef,useState } from "react";
import { DownloadSimple,FileArrowUp,FileXls,UploadSimple,WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import { exportXlsx,parseXlsx } from "../excel";
import type { ImportPreviewRow,OperationsMeta,Pagination,VehicleRow } from "../types";

const inputColumns=[
  {key:"vin",header:"VIN"},{key:"carName",header:"السيارة"},{key:"statement",header:"البيان"},{key:"agentName",header:"الوكيل"},
  {key:"interiorColor",header:"اللون الداخلي"},{key:"exteriorColor",header:"اللون الخارجي"},{key:"modelYear",header:"الموديل"},
  {key:"plateNo",header:"اللوحة"},{key:"batchNo",header:"اسم الدفعة بالتاريخ"},{key:"location",header:"المكان"},
  {key:"status",header:"الحالة"},{key:"statusNote",header:"ملاحظات الحالة"},{key:"notes",header:"ملاحظات في السيارة"},
  {key:"placeNotes",header:"ملاحظات المكان"},{key:"bookingShortageLocationNotes",header:"حجز - نواقص - تحديد مكان"},{key:"sourceType",header:"المصدر"},
] as const;
const exportColumns=[
  {key:"vin",header:"VIN"},{key:"car_name",header:"السيارة"},{key:"statement",header:"البيان"},{key:"agent_name",header:"الوكيل"},
  {key:"interior_color",header:"اللون الداخلي"},{key:"exterior_color",header:"اللون الخارجي"},{key:"model_year",header:"الموديل"},
  {key:"plate_no",header:"اللوحة"},{key:"batch_no",header:"اسم الدفعة بالتاريخ"},{key:"location_name",header:"المكان"},
  {key:"status_name",header:"الحالة"},{key:"status_note",header:"ملاحظات الحالة"},{key:"notes",header:"ملاحظات في السيارة"},
  {key:"place_notes",header:"ملاحظات المكان"},{key:"booking_shortage_location_notes",header:"حجز - نواقص - تحديد مكان"},{key:"source_type",header:"المصدر"},
] as const;
const headerAliases:Record<string,string>={
  "vin":"vin","الهيكل":"vin","رقم الهيكل":"vin","السيارة":"carName","البيان":"statement","الوكيل":"agentName",
  "اللون الداخلي":"interiorColor","اللون الخارجي":"exteriorColor","الموديل":"modelYear","اللوحة":"plateNo",
  "اسم الدفعة بالتاريخ":"batchNo","الدفعة":"batchNo","المكان":"location","الحالة":"status","ملاحظات الحالة":"statusNote",
  "ملاحظات في السيارة":"notes","ملاحظات السيارة":"notes","ملاحظات المكان":"placeNotes",
  "حجز - نواقص - تحديد مكان":"bookingShortageLocationNotes","المصدر":"sourceType",
};
type RawRow=Record<string,string|number> & {rowNumber:number};
type PreviewResponse={preview:ImportPreviewRow[];summary:{read:number;valid:number;invalid:number}};
type CommitResponse={message:string;result:{read:number;inserted:number;updated:number;failed:number;skipped:number;failedRows:ImportPreviewRow[]}};

function normalizedHeader(value:string){return value.trim().toLowerCase();}
function rowsFromSheet(sheet:string[][]):RawRow[]{
  if(sheet.length<2) return [];
  const headers=sheet[0].map(value=>headerAliases[normalizedHeader(value)]||headerAliases[value.trim()]||value.trim());
  return sheet.slice(1).map((cells,index)=>{
    const row:RawRow={rowNumber:index+2};
    headers.forEach((header,column)=>{if(header) row[header]=cells[column]??"";});
    return row;
  }).filter(row=>Object.entries(row).some(([key,value])=>key!=="rowNumber"&&String(value).trim()));
}
async function readAllVehicles(){
  const rows:VehicleRow[]=[];let page=1;let pages=1;
  do{
    const payload=await operationsFetch<{vehicles:VehicleRow[];pagination:Pagination}>("vehicles",{query:{archived:"all",page,pageSize:200}});
    rows.push(...(payload.vehicles||[]));pages=payload.pagination?.pages||1;page+=1;
  }while(page<=pages);
  return rows;
}

export function ImportExportPage({meta,notify}:{meta:OperationsMeta;notify:(message:string,error?:boolean)=>void}){
  const inputRef=useRef<HTMLInputElement|null>(null);const [rows,setRows]=useState<RawRow[]>([]);const [preview,setPreview]=useState<ImportPreviewRow[]>([]);
  const [summary,setSummary]=useState<PreviewResponse["summary"]|null>(null);const [result,setResult]=useState<CommitResponse["result"]|null>(null);const [busy,setBusy]=useState(false);
  const can=(permission:string)=>meta.permissionCodes.includes("*")||meta.permissionCodes.includes(permission);
  function downloadTemplate(){exportXlsx([],inputColumns as any,"MZJ-Operations-Vehicles-Template.xlsx","قالب السيارات");}
  async function exportData(){setBusy(true);try{const data=await readAllVehicles();exportXlsx(data as any,exportColumns as any,"MZJ-Operations-Vehicles.xlsx","بيانات السيارات");notify(`تم تجهيز ${data.length} سيارة للتصدير حسب صلاحياتك`);}catch(error){notify(error instanceof Error?error.message:"تعذر تصدير البيانات",true)}finally{setBusy(false)}}
  async function chooseFile(file:File){setBusy(true);setPreview([]);setSummary(null);setResult(null);try{const parsed=rowsFromSheet(await parseXlsx(file));if(!parsed.length)throw new Error("لا توجد صفوف بيانات داخل الشيت");setRows(parsed);const payload=await operationsFetch<PreviewResponse>("import",{method:"POST",body:JSON.stringify({action:"preview",rows:parsed})});setPreview(payload.preview||[]);setSummary(payload.summary);notify("تمت معاينة الملف دون حفظ أي بيانات");}catch(error){setRows([]);notify(error instanceof Error?error.message:"تعذر قراءة ملف Excel",true)}finally{setBusy(false);if(inputRef.current)inputRef.current.value=""}}
  async function commit(){if(!rows.length)return;setBusy(true);try{const payload=await operationsFetch<CommitResponse>("import",{method:"POST",body:JSON.stringify({action:"commit",rows})});setResult(payload.result);notify(payload.message);const refreshed=await operationsFetch<PreviewResponse>("import",{method:"POST",body:JSON.stringify({action:"preview",rows})});setPreview(refreshed.preview||[]);setSummary(refreshed.summary);}catch(error){notify(error instanceof Error?error.message:"فشل الاستيراد",true)}finally{setBusy(false)}}
  return <div className="operations-page">
    <header className="operations-page-toolbar"><div><h2>الاستيراد والتصدير</h2><p>ثلاث عمليات منفصلة، ومعاينة كاملة قبل الحفظ، وVIN محفوظ كنص للحفاظ على الأصفار.</p></div></header>
    <section className="operations-action-cards">
      <button type="button" onClick={downloadTemplate}><FileXls size={28}/><span><b>تصدير قالب فاضي</b><small>أعمدة الإدخال فقط بدون موافقات أو حركات أو Tracking.</small></span><DownloadSimple size={18}/></button>
      <button type="button" disabled={busy||!can("operations.vehicles.export")} onClick={()=>void exportData()}><FileXls size={28}/><span><b>تصدير البيانات</b><small>يصدر البيانات المتاحة للمستخدم من السيرفر على دفعات.</small></span><DownloadSimple size={18}/></button>
      <button type="button" disabled={busy||!can("operations.vehicles.import")} onClick={()=>inputRef.current?.click()}><FileArrowUp size={28}/><span><b>استيراد من شيت</b><small>قراءة ومعاينة الصفوف الصحيحة والخاطئة قبل الحفظ.</small></span><UploadSimple size={18}/></button>
      <input ref={inputRef} type="file" accept=".xlsx" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void chooseFile(file)}}/>
    </section>
    <div className="operations-info"><WarningCircle size={18}/>لا تضع VIN بصيغة رقمية علمية داخل Excel. القالب المولد يكتب النصوص كـText ويحافظ على الأصفار في البداية.</div>
    {summary?<section className="operations-summary-cards"><article><span>المقروء</span><b>{summary.read}</b></article><article><span>الصحيح</span><b>{summary.valid}</b></article><article><span>الخاطئ</span><b>{summary.invalid}</b></article>{result?<><article><span>المضاف</span><b>{result.inserted}</b></article><article><span>المحدث</span><b>{result.updated}</b></article></>:null}</section>:null}
    {preview.length?<><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>الصف</th><th>VIN</th><th>النتيجة</th><th>الإجراء</th><th>سبب الخطأ</th></tr></thead><tbody>{preview.map(item=><tr key={`${item.rowNumber}-${item.vin}`} className={item.valid?"":"invalid"}><td>{item.rowNumber}</td><td className="mono">{item.vin||"—"}</td><td><span className={`operations-badge ${item.valid?"success":"danger"}`}>{item.valid?"صحيح":"خطأ"}</span></td><td>{item.action==="insert"?"إضافة":item.action==="update"?"تحديث":"—"}</td><td>{item.errors.join(" — ")||"—"}</td></tr>)}</tbody></table></div><div className="operations-form-actions"><button type="button" className="primary" disabled={busy||!summary?.valid} onClick={()=>void commit()}>{busy?"جاري التنفيذ...":"حفظ الصفوف الصحيحة داخل Transaction"}</button></div></>:null}
  </div>;
}
