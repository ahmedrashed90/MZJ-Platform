import { Fragment, useMemo, useState } from 'react';
import { Medal, TrendUp, UsersThree, CalendarBlank } from '@phosphor-icons/react';
import { workRatingLevel } from '../../../shared/marketing-workflow';
import { RatingStars } from '../workflow/TaskDetail';
import { useWorkQuery } from '../workflow/api';
import '../marketing.css';

type Rating = {
  item_id: string; assignee_id: string; assignee_name: string; percentage: number;
  scores: { criterionId: string; criterionName: string; score: number }[];
  created_at: string; updated_at: string; idea_name: string; task_name: string;
  task_no: string; reviewer_name: string;
};
type RatingPayload = { ok: true; rows: Rating[]; canViewAll: boolean };
const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const ratingDate = (timestamp: string) => dateKey(new Date(timestamp));
const defaultFrom = () => `${dateKey(new Date()).slice(0,4)}-01-01`;
const monthFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long' });
const asPercent = (value: number) => `${value.toLocaleString('ar-SA-u-nu-latn', {maximumFractionDigits: 2})}%`;

type Ranking = { id: string; name: string; percentage: number; count: number; ratings: Rating[] };
function rankRatings(rows: Rating[]): Ranking[] {
  const map = new Map<string, Rating[]>();
  for (const row of rows) map.set(row.assignee_id, [...(map.get(row.assignee_id) || []), row]);
  return [...map.entries()].map(([id, ratings]) => ({ id, name: ratings[0]?.assignee_name || id,
    count: ratings.length, percentage: Math.round(ratings.reduce((a, r) => a + Number(r.percentage), 0) / ratings.length * 100) / 100, ratings }))
    .sort((a, b) => b.percentage - a.percentage || b.count - a.count || a.name.localeCompare(b.name, 'ar'));
}

export function MarketingRatingsPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => dateKey(new Date()));
  const [applied, setApplied] = useState({ from: defaultFrom(), to: dateKey(new Date()) });
  const [assignee, setAssignee] = useState('all');
  const [month, setMonth] = useState('all');
  const [year, setYear] = useState('all');
  const [expanded, setExpanded] = useState('');
  const valid = Boolean(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to);
  const query = useWorkQuery<RatingPayload>('ratings', { dateFrom: applied.from, dateTo: applied.to });
  const all = query.data?.rows || [];
  const people = useMemo(() => [...new Map(all.map(row => [row.assignee_id, row.assignee_name])).entries()].sort((a,b) => a[1].localeCompare(b[1], 'ar')), [all]);
  const years = useMemo(() => [...new Set(all.map(row => ratingDate(row.created_at).slice(0,4)))].sort().reverse(), [all]);
  const monthlyRows = useMemo(() => all.filter(row => { const key = ratingDate(row.created_at); return (month === 'all' || key.slice(5,7) === month) && (year === 'all' || key.slice(0,4) === year); }), [all,month,year]);
  const rows = useMemo(() => monthlyRows.filter(row => assignee === 'all' || row.assignee_id === assignee), [monthlyRows,assignee]);
  const ranking = useMemo(() => rankRatings(rows), [rows]);
  const months = useMemo(() => {
    const groups = new Map<string, Rating[]>();
    for (const row of monthlyRows) {
      const key = ratingDate(row.created_at).slice(0,7);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups.entries()].sort((a,b) => b[0].localeCompare(a[0])).map(([key, group]) => {
      const leaders = rankRatings(group.filter(row => assignee === 'all' || row.assignee_id === assignee));
      return { key, winner: leaders[0] || null, count: group.length };
    }).filter(month => month.winner);
  }, [monthlyRows,assignee]);
  const average = rows.length ? rows.reduce((sum,row)=>sum+Number(row.percentage),0)/rows.length : null;
  return <div className="mkw-rating-dashboard">
    <section className="panel mkw-ratings-head"><div><h2>تقييمات المنفذين</h2></div>
      <div className="mkw-ratings-filters">
        <label>من تاريخ<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}/></label>
        <label>إلى تاريخ<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}/></label>
        <button type="button" className="primary-button" disabled={!valid || query.loading} onClick={() => setApplied({from,to})}>تطبيق التاريخ</button>
        <label>الشهر<select value={month} onChange={e=>setMonth(e.target.value)}><option value="all">جميع الشهور</option>{Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=><option key={m} value={m}>{monthFormat.format(new Date(2026,Number(m)-1,1)).split(' ')[0]}</option>)}</select></label>
        <label>السنة<select value={year} onChange={e=>setYear(e.target.value)}><option value="all">جميع السنوات</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
        <label>المنفذ<select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="all">كل المنفذين</option>{people.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      </div>
    </section>
    {query.error && <div className="mkw-alert" role="alert">{query.error}</div>}
    <div className="mkw-ratings-stats">
      <article className="panel"><Medal size={28}/><span>أعلى تقييم خلال الفترة</span><strong>{ranking.length ? asPercent(ranking[0].percentage) : '—'}</strong><small>{ranking[0]?.name || ''}</small></article>
      <article className="panel"><TrendUp size={28}/><span>متوسط جودة التنفيذ</span><strong>{average === null ? '—' : asPercent(average)}</strong><small>{rows.length.toLocaleString('ar-SA-u-nu-latn')} مطلوب مقيّم</small></article>
      <article className="panel"><UsersThree size={28}/><span>المنفذون المقيّمون</span><strong>{ranking.length.toLocaleString('ar-SA-u-nu-latn')}</strong></article>
    </div>
    <section className="panel mkw-ratings-monthly"><header><CalendarBlank size={23}/><h3>أعلى تقييم خلال كل شهر</h3></header>
      <div className="mkw-ratings-months">{months.map(({key,winner}) => winner && <article key={key}><small>{monthFormat.format(new Date(`${key}-01T12:00:00Z`))}</small><strong>{winner.name}</strong><b>{asPercent(winner.percentage)}</b><RatingStars percentage={winner.percentage}/><span>{winner.count} مطلوب مقيّم</span></article>)}</div>
      {!months.length && <div className="mkw-ratings-empty">لا توجد تقييمات للفترة المحددة</div>}
    </section>
    <section className="panel mkw-ratings-ranking"><h3>ترتيب المنفذين</h3>
      <div className="mkw-ratings-table-scroll"><table><thead><tr><th>الترتيب</th><th>المنفذ</th><th>عدد المطلوبات المقيّمة</th><th>نسبة الجودة</th><th>التقدير</th><th>النجوم</th><th>التفاصيل</th></tr></thead><tbody>
        {ranking.map((row,index) => <Fragment key={row.id}><tr><td>{index+1}</td><td>{row.name}</td><td>{row.count}</td><td><strong>{asPercent(row.percentage)}</strong></td><td><span className={`mkw-rating-level is-${workRatingLevel(row.percentage).css}`}>{workRatingLevel(row.percentage).label}</span></td><td><RatingStars percentage={row.percentage}/></td><td><button type="button" className="secondary-button small" onClick={() => setExpanded(expanded === row.id ? '' : row.id)}>{expanded === row.id ? 'إغلاق' : 'عرض المطلوبات'}</button></td></tr>
          {expanded === row.id && <tr key={`${row.id}-detail`} className="mkw-rating-detail-row"><td colSpan={7}><div>{row.ratings.map(item=><article key={item.item_id}><div><strong>{item.task_no} · {item.idea_name}</strong><span>{item.reviewer_name} · {new Date(item.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',{timeZone:'Asia/Riyadh'})}</span></div><b>{asPercent(Number(item.percentage))}</b><div>{item.scores.map(score=><small key={score.criterionId}>{score.criterionName}: {score.score} / 3</small>)}</div></article>)}</div></td></tr>}
        </Fragment>)}
        {!ranking.length && <tr><td colSpan={7}>لا توجد تقييمات للفترة المحددة</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
