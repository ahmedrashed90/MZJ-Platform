import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { MagnifyingGlass, Plus, WarningCircle } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { MarketingCampaignRow } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { formatMarketingDate, statusTone } from "../utils";

export function MarketingCampaignsPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [rows, setRows] = useState<MarketingCampaignRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); setError(""); try { const payload = await marketingFetch<{ok:true;rows:MarketingCampaignRow[]}>(`/api/marketing?resource=campaigns&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`); setRows(payload.rows); } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الحملات"); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [status]);
  return <div className="module-page marketing-page">
    <header className="module-page-head"><div><h1>الحملات</h1><p>كل حملة مرتبطة بنسخ الكرييتيف والتاسكات وجدول النشر.</p></div>{meta.access.canManageCampaigns ? <Link className="marketing-primary-button" to="/marketing/campaigns/new"><Plus size={18}/>حملة جديدة</Link> : null}</header>
    <section className="panel marketing-toolbar"><label><MagnifyingGlass size={18}/><input value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void load();}} placeholder="ابحث بالاسم أو الكود أو الهدف"/></label><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">كل الحالات</option>{meta.campaignStatuses.map((item)=><option key={item}>{item}</option>)}</select><button onClick={()=>void load()}>بحث</button></section>
    {error ? <div className="connection-banner"><WarningCircle size={20}/><span>{error}</span></div>:null}
    <section className="marketing-cards-grid">{rows.map((campaign)=><article className="panel marketing-campaign-card" key={campaign.id}><header><div><span>{campaign.campaign_code}</span><h2>{campaign.name}</h2></div><em className={`marketing-status ${statusTone(campaign.status)}`}>{campaign.status}</em></header><p>{campaign.objective || "بدون هدف مسجل"}</p><div className="marketing-card-metrics"><span><b>{campaign.creatives}</b>كرييتيف</span><span><b>{campaign.done_tasks}/{campaign.tasks}</b>تاسكات</span><span><b>{Number(campaign.budget_total||0).toLocaleString('ar-SA')}</b>الميزانية</span></div><div className="marketing-card-progress"><span><i style={{width:`${campaign.progress}%`}}/></span><b>{campaign.progress}%</b></div><footer><span>{formatMarketingDate(campaign.starts_at)} — {formatMarketingDate(campaign.ends_at)}</span><div>{meta.access.canManageCampaigns && campaign.status==='في انتظار اعتماد الهيكل'?<Link to={`/marketing/campaigns/${campaign.id}/edit`}>تعديل</Link>:null}<Link className="primary" to={`/marketing/campaigns/${campaign.id}`}>التفاصيل</Link></div></footer></article>)}{!loading&&rows.length===0?<div className="marketing-empty panel">لا توجد حملات مطابقة.</div>:null}</section>
  </div>;
}
