import { useCallback,useEffect,useState } from "react";
import { CheckCircle,WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "./api";
import type { OperationsMeta,OperationsView } from "./types";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { MovementLogPage } from "./pages/MovementLogPage";
import { MovementPage } from "./pages/MovementPage";
import { ReportPage } from "./pages/ReportPage";
import { RequestsPage } from "./pages/RequestsPage";
import { VehicleListPage } from "./pages/VehicleListPage";

type Notice={message:string;error:boolean}|null;
export function OperationsPage({view}:{view:OperationsView}){
 const [meta,setMeta]=useState<OperationsMeta|null>(null);const [loading,setLoading]=useState(true);const [fatal,setFatal]=useState("");const [notice,setNotice]=useState<Notice>(null);
 const notify=useCallback((message:string,error=false)=>{setNotice({message,error});window.setTimeout(()=>setNotice(null),4500)},[]);
 useEffect(()=>{let active=true;setLoading(true);operationsFetch<OperationsMeta>("meta").then(payload=>{if(active){setMeta(payload);setFatal("")}}).catch(error=>{if(active)setFatal(error instanceof Error?error.message:"تعذر تحميل إعدادات العمليات")}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 if(loading)return <div className="operations-loading">جاري تهيئة نظام العمليات...</div>;
 if(fatal||!meta)return <div className="operations-error"><WarningCircle size={24}/><span>{fatal||"تعذر تهيئة نظام العمليات"}</span></div>;
 let page:React.ReactNode;
 if(view==="inventory"||view==="manage"||view==="archive")page=<VehicleListPage mode={view} meta={meta} notify={notify}/>;
 else if(view==="import-export")page=<ImportExportPage meta={meta} notify={notify}/>;
 else if(view==="movements"||view==="bulk-movement")page=<MovementPage bulk={view==="bulk-movement"} meta={meta} notify={notify}/>;
 else if(view==="requests")page=<RequestsPage meta={meta} notify={notify}/>;
 else if(view==="approvals")page=<ApprovalsPage meta={meta} notify={notify}/>;
 else if(view==="all-vehicles")page=<ReportPage meta={meta} notify={notify}/>;
 else page=<MovementLogPage meta={meta} notify={notify}/>;
 return <>{notice?<div className={`operations-toast ${notice.error?"error":""}`}>{notice.error?<WarningCircle size={18}/>:<CheckCircle size={18}/>}<span>{notice.message}</span></div>:null}{page}</>;
}
