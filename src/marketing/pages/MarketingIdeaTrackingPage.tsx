import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, CalendarBlank, ArrowClockwise } from '@phosphor-icons/react';
import { WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, useWorkQuery } from '../workflow/api';
import type { MarketingIdeaTrackingRow } from '../../../shared/marketing-idea-identity';
import '../marketing-tracking.css';

function stage(count:number,total:number,percent:number,tone:'execution'|'publishing'|'funding') {
  return <div className={`mkt-track-progress mkt-track-${tone}`}>
    <strong><span>{count} {count===1?'فكرة':'أفكار'}</span><b>{percent}%</b></strong>
    <div className="mkt-track-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${count} من ${total}`}>
      <span style={{width:`${percent}%`}}/>
    </div>
  </div>;
}

export function MarketingIdeaTrackingPage() {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[search,setSearch]=useState('');
  const [range,setRange]=useState<{from:string;to:string}>({from:'',to:''});
  const query=useWorkQuery<{ok:true;rows:MarketingIdeaTrackingRow[]}>('marketing_tracking',range);
  // The page has no manual records: refresh the live workflow projection while visible.
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void query.reload();},60000);
    return ()=>window.clearInterval(timer);
  },[query.reload]);
  const rows=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase();
    return (query.data?.rows||[]).filter(row=>!term||`${row.taskNo} ${row.createdAt}`.toLocaleLowerCase().includes(term));
  },[query.data?.rows,search]);
  return <div className="mkw mkt-track-page">
    <WorkHeader title="التراكينج" onRefresh={()=>void query.reload()} loading={query.loading}/>
    <WorkAlert>{query.error}</WorkAlert>
    <section className="mkt-track-toolbar">
      <label className="mkt-track-search"><MagnifyingGlass size={19}/><input aria-label="بحث برقم التاسك" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="بحث برقم التاسك..."/></label>
      <div className="mkt-track-date-range"><CalendarBlank size={18}/><label>تاريخ التكليف من <input type="date" value={from} max={to||undefined} onChange={event=>setFrom(event.target.value)}/></label><label>إلى <input type="date" value={to} min={from||undefined} onChange={event=>setTo(event.target.value)}/></label>
        <button type="button" className="secondary" onClick={()=>setRange({from,to})}>تطبيق</button>
      </div>
      <button type="button" className="secondary mkt-track-refresh" onClick={()=>void query.reload()} aria-label="تحديث"><ArrowClockwise size={20}/></button>
    </section>
    <section className="mkt-track-table-wrap">
      <table className="mkt-track-table"><thead><tr><th>م</th><th>تاريخ التكليف</th><th>رقم التاسك</th><th>التكليف</th><th>التنفيذ</th><th>النشر</th><th>التمويل</th></tr></thead>
        <tbody>{rows.map((row,index)=><tr key={row.taskId}>
          <td>{index+1}</td>
          <td><time dateTime={row.createdAt}>{showDate(row.createdAt)}</time></td>
          <td><a href={`/marketing?task=${encodeURIComponent(row.taskId)}`} className="mkt-track-task" dir="ltr">{row.taskNo}</a></td>
          <td><strong className="mkt-track-assignment">{row.assignment} {row.assignment===1?'فكرة':'أفكار'}</strong></td>
          <td>{stage(row.execution,row.assignment,row.executionPercent,'execution')}</td>
          <td>{stage(row.publishing,row.assignment,row.publishingPercent,'publishing')}</td>
          <td>{stage(row.funding,row.assignment,row.fundingPercent,'funding')}</td>
        </tr>)}</tbody>
      </table>
      {!query.loading&&!query.error&&!rows.length&&<p className="mkt-track-empty">لا توجد تكليفات مطابقة للبحث والفترة المحددة.</p>}
      {query.loading&&!query.data&&<p className="mkt-track-empty">جارٍ تحميل البيانات...</p>}
    </section>
  </div>;
}
