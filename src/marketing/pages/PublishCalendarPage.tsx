import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";
import { MarketingStatusBadge } from "../components/MarketingStatusBadge";

function monthKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
export function PublishCalendarPage() {
  const [month, setMonth] = useState(monthKey(new Date())); const [data, setData] = useState<{schedule:any[];prep:any[]}|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  async function load(){setLoading(true);setError("");try{setData(await marketingFetch<any>(`resource=calendar&month=${month}`));}catch(failure){setError(failure instanceof Error?failure.message:"تعذر تحميل التقويم");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[month]);
  const days=useMemo(()=>{const [year,m]=month.split("-").map(Number);const first=new Date(year,m-1,1);const count=new Date(year,m,0).getDate();const prefix=(first.getDay()+1)%7;return [...Array(prefix).fill(null),...Array.from({length:count},(_,i)=>i+1)];},[month]);
  function shift(delta:number){const [year,m]=month.split("-").map(Number);setMonth(monthKey(new Date(year,m-1+delta,1)));}
  if(loading&&!data)return <MarketingLoading label="جاري تحميل تقويم النشر..."/>;
  return <div className="marketing-page"><MarketingPageHeader title="تقويم النشر" description="الجدول الأصلي وPublish Prep ونتائج النشر بدون تكرار." actions={<div className="marketing-calendar-nav"><button onClick={()=>shift(-1)}><CaretRight/></button><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/><button onClick={()=>shift(1)}><CaretLeft/></button></div>}/>{error?<MarketingError message={error} onRetry={()=>void load()}/>:null}<section className="marketing-calendar"><div className="marketing-calendar-week">{["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map(day=><b key={day}>{day}</b>)}</div><div className="marketing-calendar-grid">{days.map((day,index)=>{if(!day)return <div className="empty" key={`e-${index}`}/>;const date=`${month}-${String(day).padStart(2,"0")}`;const prep=(data?.prep||[]).filter(item=>String(item.publish_at).slice(0,10)===date);const overridden=new Set((data?.prep||[]).map(item=>item.schedule_target_id).filter(Boolean));const original=(data?.schedule||[]).filter(item=>String(item.publish_at).slice(0,10)===date&&!overridden.has(item.schedule_target_id));return <article key={date} className={date===new Date().toISOString().slice(0,10)?"today":""}><header>{day}</header><div>{prep.map(item=><span key={`p-${item.id}`} className="prep"><strong>{item.campaign_name}</strong><small>{item.platform_name} · {item.post_type_name}</small><MarketingStatusBadge status={item.status}/></span>)}{original.map(item=><span key={`s-${item.schedule_target_id}`}><strong>{item.campaign_name}</strong><small>{item.platform_name} · {item.post_type_name}</small></span>)}</div></article>})}</div></section></div>;
}
