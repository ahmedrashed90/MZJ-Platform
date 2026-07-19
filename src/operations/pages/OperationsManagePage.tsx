import { useMemo, useRef, useState } from "react";
import { FileArrowDown, FileArrowUp, FloppyDisk, Plus, WarningCircle } from "@phosphor-icons/react";
import * as XLSX from "xlsx";
import { useAuth } from "../../auth/AuthContext";
import { operationsFetch } from "../api";
import type { ImportPreviewRow, OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

const emptyForm = { vin:"",carName:"",statement:"",agentName:"",interiorColor:"",exteriorColor:"",modelYear:"",plateNo:"",batchNo:"",locationId:"",statusCode:"available_for_sale",notes:"",statusNote:"",shortageLocationNote:"" };

export function OperationsManagePage() {
  const { user } = useAuth();
  const { meta } = useOperationsMeta();
  const [form,setForm]=useState(emptyForm);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [mode,setMode]=useState<"replace"|"append"|"update">("append");
  const [fileName,setFileName]=useState("");
  const [importRows,setImportRows]=useState<Record<string,unknown>[]>([]);
  const [preview,setPreview]=useState<ImportPreviewRow[]>([]);
  const [previewSummary,setPreviewSummary]=useState({willInsert:0,willUpdate:0,willSkip:0,failedRows:0});
  const [replaceConfirmed,setReplaceConfirmed]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const isAdmin=user?.roleCodes.some((code)=>["admin","system_admin"].includes(code));
  const canCreate=isAdmin||user?.permissionCodes?.includes("operations.vehicle.create");
  const canImport=isAdmin||user?.permissionCodes?.includes("operations.import");
  const canReplace=isAdmin||user?.permissionCodes?.includes("operations.import.replace");
  const selectedStatus=useMemo(()=>meta?.statuses.find((row)=>row.code===form.statusCode),[meta,form.statusCode]);

  function setField(key:keyof typeof emptyForm,value:string){setForm((current)=>({...current,[key]:value}));}
  async function save(){
    setBusy(true);setError("");setMessage("");
    try{const payload=await operationsFetch<{ok:boolean;message:string}>("/api/operations",{method:"POST",body:JSON.stringify({action:"create_vehicle",...form})});setMessage(payload.message);setForm(emptyForm);}
    catch(reason){setError(reason instanceof Error?reason.message:"تعذر إضافة السيارة");}finally{setBusy(false);}
  }
  function exportTemplate(){
    const headers=["الهيكل","السيارة","البيان","الوكيل","اللون الداخلي","اللون الخارجي","الموديل","اللوحة","اسم الدفعة بالتاريخ","المكان","الحالة","ملاحظات في السيارة"];
    const sheet=XLSX.utils.aoa_to_sheet([headers]); sheet["!cols"]=headers.map((header)=>({wch:Math.max(15,header.length+4)}));
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"مخزون السيارات");XLSX.writeFile(book,"MZJ-Operations-Import-Template.xlsx",{bookType:"xlsx"});
  }
  async function readFile(file:File){
    setFileName(file.name);setError("");setPreview([]);
    try{const data=await file.arrayBuffer();const book=XLSX.read(data,{type:"array",raw:false});const sheet=book.Sheets[book.SheetNames[0]];const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:"",raw:false});setImportRows(rows);if(!rows.length)throw new Error("الملف لا يحتوي على بيانات");}
    catch(reason){setImportRows([]);setError(reason instanceof Error?reason.message:"تعذر قراءة ملف Excel");}
  }
  async function previewImport(){
    if(!importRows.length)return;setBusy(true);setError("");setReplaceConfirmed(false);
    try{const payload=await operationsFetch<{ok:boolean;data:{rows:ImportPreviewRow[];willInsert:number;willUpdate:number;willSkip:number;failedRows:number}}>("/api/operations",{method:"POST",body:JSON.stringify({action:"import_vehicles",mode,fileName,rows:importRows,preview:true})});setPreview(payload.data.rows||[]);setPreviewSummary({willInsert:payload.data.willInsert||0,willUpdate:payload.data.willUpdate||0,willSkip:payload.data.willSkip||0,failedRows:payload.data.failedRows||0});}
    catch(reason){setError(reason instanceof Error?reason.message:"تعذر مراجعة ملف الاستيراد");}finally{setBusy(false);}
  }
  async function executeImport(){
    if(!importRows.length||preview.some((row)=>row.errors.length))return;setBusy(true);setError("");
    try{const payload=await operationsFetch<{ok:boolean;message:string;data:any}>("/api/operations",{method:"POST",body:JSON.stringify({action:"import_vehicles",mode,fileName,rows:importRows,confirmReplace:mode!=="replace"||replaceConfirmed})});setMessage(`${payload.message}: مضاف ${payload.data.insertedRows}، محدث ${payload.data.updatedRows}، متجاوز ${payload.data.skippedRows}، فاشل ${payload.data.failedRows}`);setPreview([]);setImportRows([]);setFileName("");setReplaceConfirmed(false);}
    catch(reason){setError(reason instanceof Error?reason.message:"تعذر تنفيذ الاستيراد");}finally{setBusy(false);}
  }

  return <div className="module-page operations-page"><header className="module-page-head"><div><h1>إدارة السيارات</h1><p>إضافة سيارة أو استيراد Excel بالأوضاع الثلاثة دون تعديل التاريخ التشغيلي.</p></div><button type="button" onClick={exportTemplate}><FileArrowDown size={18}/>تصدير قالب Excel فاضي</button></header>
    {error?<div className="connection-banner"><WarningCircle size={20}/><span>{error}</span></div>:null}{message?<div className="success-banner operations-success-banner">{message}</div>:null}
    <div className="operations-manage-grid">
      <section className="panel operations-form-card"><header><div><h2>إضافة سيارة</h2><p>يتم حفظ VIN كنص مع الحفاظ على الأصفار.</p></div><Plus size={22}/></header>
        {!canCreate?<div className="operations-permission-note">ليس لديك صلاحية إضافة السيارات.</div>:<div className="operations-form-grid">
          <label><span>الهيكل VIN *</span><input value={form.vin} onChange={(e)=>setField("vin",e.target.value)} /></label><label><span>السيارة</span><input value={form.carName} onChange={(e)=>setField("carName",e.target.value)}/></label><label><span>البيان</span><input value={form.statement} onChange={(e)=>setField("statement",e.target.value)}/></label><label><span>الوكيل</span><input value={form.agentName} onChange={(e)=>setField("agentName",e.target.value)}/></label><label><span>اللون الداخلي</span><input value={form.interiorColor} onChange={(e)=>setField("interiorColor",e.target.value)}/></label><label><span>اللون الخارجي</span><input value={form.exteriorColor} onChange={(e)=>setField("exteriorColor",e.target.value)}/></label><label><span>الموديل</span><input value={form.modelYear} onChange={(e)=>setField("modelYear",e.target.value)}/></label><label><span>اللوحة</span><input value={form.plateNo} onChange={(e)=>setField("plateNo",e.target.value)}/></label><label><span>اسم الدفعة بالتاريخ</span><input value={form.batchNo} onChange={(e)=>setField("batchNo",e.target.value)}/></label><label><span>المكان *</span><select value={form.locationId} onChange={(e)=>setField("locationId",e.target.value)}><option value="">اختر المكان</option>{meta?.locations.map((row)=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>الحالة *</span><select value={form.statusCode} onChange={(e)=>setField("statusCode",e.target.value)}>{meta?.statuses.map((row)=><option key={row.code} value={row.code}>{row.name}</option>)}</select></label><label className="span-2"><span>ملاحظات في السيارة</span><textarea rows={3} value={form.notes} onChange={(e)=>setField("notes",e.target.value)}/></label>{selectedStatus?.requires_status_note?<label className="span-2"><span>ملاحظات الحالة *</span><textarea rows={3} value={form.statusNote} onChange={(e)=>setField("statusNote",e.target.value)}/></label>:null}<label className="span-2"><span>حجز - نواقص - تحديد مكان</span><textarea rows={3} value={form.shortageLocationNote} onChange={(e)=>setField("shortageLocationNote",e.target.value)}/></label><button type="button" className="operations-primary-button span-2" disabled={busy||!form.vin.trim()||!form.locationId||(selectedStatus?.requires_status_note&&!form.statusNote.trim())} onClick={()=>void save()}><FloppyDisk size={18}/>{busy?"جاري الحفظ...":"حفظ السيارة"}</button>
        </div>}
      </section>
      <section className="panel operations-import-card"><header><div><h2>استيراد من Excel</h2><p>الموافقة والحركة والتراكينج والأرشيف لا يتم تعديلها من الشيت.</p></div><FileArrowUp size={22}/></header>
        {!canImport?<div className="operations-permission-note">ليس لديك صلاحية استيراد المخزون.</div>:<>
          <div className="operations-import-modes"><label className={mode==="replace"?"active":""}><input type="radio" checked={mode==="replace"} disabled={!canReplace} onChange={()=>{setMode("replace");setPreview([]);setReplaceConfirmed(false);}}/><strong>استبدال كامل</strong><span>{canReplace?"إضافة/تحديث سيارات الملف وأرشفة كل سيارة غير موجودة مع الحفاظ على تاريخها.":"يتطلب صلاحية الاستبدال الكامل."}</span></label><label className={mode==="append"?"active":""}><input type="radio" checked={mode==="append"} onChange={()=>{setMode("append");setPreview([]);setReplaceConfirmed(false);}}/><strong>إضافة فوق الحالي</strong><span>إضافة VIN جديد وتجاوز الموجود.</span></label><label className={mode==="update"?"active":""}><input type="radio" checked={mode==="update"} onChange={()=>{setMode("update");setPreview([]);setReplaceConfirmed(false);}}/><strong>تحديث من الشيت</strong><span>تحديث الحقول الوصفية للسيارات الموجودة فقط.</span></label></div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e)=>{const file=e.target.files?.[0];if(file)void readFile(file);}}/><button type="button" className="operations-file-button" onClick={()=>fileRef.current?.click()}><FileArrowUp size={19}/>{fileName||"اختيار ملف Excel"}</button>
          {importRows.length?<div className="operations-import-actions"><span>{importRows.length} صف مقروء</span><button type="button" onClick={()=>void previewImport()} disabled={busy}>معاينة والتحقق</button></div>:null}
          {preview.length?<><div className="operations-import-summary"><span>إضافة: {previewSummary.willInsert}</span><span>تحديث: {previewSummary.willUpdate}</span><span>تجاوز: {previewSummary.willSkip}</span><span>خاطئ: {previewSummary.failedRows}</span></div><div className="operations-preview-table"><table><thead><tr><th>الصف</th><th>VIN</th><th>السيارة</th><th>الأثر</th><th>النتيجة</th></tr></thead><tbody>{preview.map((item)=><tr key={item.rowNo}><td>{item.rowNo}</td><td>{String(item.row.vin||"")}</td><td>{String(item.row.carName||"")}</td><td>{item.outcome==="inserted"?"إضافة":item.outcome==="updated"?"تحديث":item.outcome==="skipped"?"تجاوز":"فشل"}</td><td>{item.errors.length?<span className="error-text">{item.errors.join("، ")}</span>:<span className="success-text">جاهز</span>}</td></tr>)}</tbody></table></div>{mode==="replace"?<label className="operations-replace-confirm"><input type="checkbox" checked={replaceConfirmed} onChange={(event)=>setReplaceConfirmed(event.target.checked)}/><span><strong>أؤكد الاستبدال الكامل</strong><small>سيتم أرشفة السيارات غير الموجودة في الملف مع الاحتفاظ بكل حركاتها وتاريخها.</small></span></label>:null}<button type="button" className="operations-primary-button" disabled={busy||preview.some((row)=>row.errors.length)||(mode==="replace"&&!replaceConfirmed)} onClick={()=>void executeImport()}>{busy?"جاري الاستيراد...":"تنفيذ الاستيراد"}</button></>:null}
        </>}
      </section>
    </div>
  </div>;
}
