export class OperationsApiError extends Error {
  code?: string;
  requestId?: string;
  fieldErrors?: Record<string,string>;
  constructor(message:string,payload?:any){ super(message); this.code=payload?.code; this.requestId=payload?.requestId; this.fieldErrors=payload?.fieldErrors; }
}

export function operationsQuery(values:Record<string,unknown>){
  const params=new URLSearchParams();
  Object.entries(values).forEach(([key,value])=>{if(value===undefined||value===null||value==='')return;params.set(key,String(value));});
  const text=params.toString(); return text?`?${text}`:'';
}

export async function operationsFetch<T>(url:string,options?:RequestInit):Promise<T>{
  const response=await fetch(url,{credentials:'include',cache:'no-store',...options,headers:{...(options?.body?{'content-type':'application/json'}:{}),...(options?.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.ok===false){
    const base=payload?.message||payload?.error||'تعذر تنفيذ العملية';
    const text=payload?.requestId?`${base} — رقم المرجع: ${payload.requestId}`:base;
    throw new OperationsApiError(text,payload);
  }
  return payload as T;
}

export function formatDate(value?:string|null){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});}
export function statusLabel(code?:string|null){return ({available_for_sale:'متاح للبيع',reserved:'حجز',has_notes:'بها ملاحظات',under_delivery:'مباع تحت التسليم',delivered:'مباع تم التسليم'} as Record<string,string>)[String(code||'')]||String(code||'—');}
export function stageLabel(code?:string|null){return ({request_received:'تم استلام الطلب',vehicle_sent:'تم إرسال السيارة',vehicle_received:'تم استلام السيارة',completed:'تم الانتهاء',cancelled:'ملغي'} as Record<string,string>)[String(code||'')]||String(code||'—');}
