import type { LeadForm, LeadRow } from '../../../shared/lead-forms';
export type FormListResponse = { ok:true;forms:LeadForm[] };
export type LeadListResponse = {ok:true;leads:LeadRow[]};
export type FormStats = {ok:true;byForm:{id:string;title:string;slug:string;status:string;visits:number;submissions:number}[];bySource:{source:string;submissions:number}[];byCampaign:{campaign:string;source:string;submissions:number}[];daily:{date:string;visits:number;submissions:number}[];byStep:{form_id:string;step_id:string;total:number}[]};
export async function formsApi<T>(action:string, payload:Record<string,unknown>={}, method:'GET'|'POST'='GET'):Promise<T>{
  const query=method==='GET'?'?'+new URLSearchParams({view:action,...Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v??'')]))}).toString():'';
  const response=await fetch(`/api/marketing/lead-forms${query}`,{method,credentials:'include',cache:'no-store',headers:method==='POST'?{'Content-Type':'application/json'}:undefined,body:method==='POST'?JSON.stringify({action,...payload}):undefined});
  const result=await response.json().catch(()=>({}));
  if (!response.ok || result.ok===false) throw new Error(String(result.error || result.message || 'تعذر الاتصال بسيستم الفورمات'));
  return result as T;
}
export function formLink(slug:string) { return `${window.location.origin}/forms/${encodeURIComponent(slug)}`; }
export function slugify(value:string) { return value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80); }
