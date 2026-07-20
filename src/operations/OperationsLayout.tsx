import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ArrowsLeftRight, Archive, Car, CheckCircle, ClipboardText, ClockCounterClockwise, ListBullets, Wrench } from '@phosphor-icons/react';
import { operationsFetch } from './api';
import type { OperationsMeta } from './types';

const MetaContext=createContext<OperationsMeta|null>(null);
export function useOperationsMeta(){const value=useContext(MetaContext);if(!value)throw new Error('Operations meta is not loaded');return value;}
const tabs=[
  {to:'/operations',label:'مخزون السيارات',icon:Car,end:true},
  {to:'/operations/manage',label:'إدارة السيارات',icon:Wrench},
  {to:'/operations/movement',label:'الحركة',icon:ArrowsLeftRight},
  {to:'/operations/transfers',label:'طلبات النقل',icon:ClipboardText},
  {to:'/operations/approvals',label:'الموافقات',icon:CheckCircle},
  {to:'/operations/all',label:'جميع السيارات',icon:ListBullets},
  {to:'/operations/movements',label:'سجل الحركات',icon:ClockCounterClockwise},
  {to:'/operations/archive',label:'الأرشيف',icon:Archive},
];
export function OperationsLayout(){
  const [meta,setMeta]=useState<OperationsMeta|null>(null);const [error,setError]=useState('');
  useEffect(()=>{operationsFetch<{ok:boolean}&OperationsMeta>('/api/operations?resource=meta').then((payload)=>setMeta(payload)).catch((e)=>setError(e instanceof Error?e.message:'تعذر تحميل إعدادات العمليات'));},[]);
  if(error)return <div className="module-page"><div className="connection-banner"><span>{error}</span></div></div>;
  if(!meta)return <div className="crm-loading-panel">جاري تحميل نظام العمليات...</div>;
  return <MetaContext.Provider value={meta}><div className="operations-module"><header className="module-page-head operations-main-head"><div><h1>نظام العمليات</h1><p>إدارة مخزون السيارات والحركة وطلبات النقل والموافقات من داخل المنصة الموحدة.</p></div></header><nav className="operations-tabs" aria-label="تبويبات العمليات">{tabs.map(({to,label,icon:Icon,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>isActive?'active':''}><Icon size={18} weight="duotone"/><span>{label}</span></NavLink>)}</nav><Outlet/></div></MetaContext.Provider>;
}
