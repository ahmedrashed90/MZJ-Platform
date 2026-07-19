export async function operationsFetch<T>(action:string, options?:{method?:string;body?:unknown;query?:Record<string,unknown>}):Promise<T>{
  const params=new URLSearchParams({action});
  Object.entries(options?.query||{}).forEach(([key,value])=>{if(value!==undefined&&value!==null&&String(value)!=="")params.set(key,String(value));});
  const response=await fetch(`/api/operations?${params.toString()}`,{method:options?.method||"GET",credentials:"include",headers:options?.body?{"content-type":"application/json"}:undefined,body:options?.body?JSON.stringify(options.body):undefined,cache:"no-store"});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.ok===false){const error=new Error(payload?.error||"تعذر تنفيذ العملية") as Error&{code?:string;requestId?:string;fieldErrors?:Record<string,string>};error.code=payload?.code;error.requestId=payload?.requestId;error.fieldErrors=payload?.fieldErrors;throw error;}
  return payload as T;
}
export function formatOperationsError(error:unknown){
  if(error instanceof Error){const typed=error as Error&{requestId?:string};return typed.requestId?`${error.message} — رقم المرجع: ${typed.requestId}`:error.message;}
  return "تعذر تنفيذ العملية";
}
export function exportExcelFile(fileName:string, headers:string[], rows:Array<Array<unknown>>){
  const escape=(value:unknown)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const html=`<html dir="rtl"><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${escape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  const blob=new Blob(["\ufeff",html],{type:"application/vnd.ms-excel;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`${fileName}.xls`;link.click();URL.revokeObjectURL(url);
}
