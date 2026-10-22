import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Heart, LinkSimple } from '@phosphor-icons/react';
import { marketingDate } from '../api';

export type DailyFollower = { date: string; followers: number };
export type EngagedSocialPost = {
  caption: string; permalink: string; publishedAt: string;
  likes: number | null; comments: number | null; shares: number | null; engagementTotal: number;
};
const fmt = (value: unknown) => Number(value || 0).toLocaleString('ar-SA-u-nu-latn');
export function followerDifference(snapshots: DailyFollower[], date: string): number | null {
  const index = snapshots.findIndex(row => row.date === date);
  if (index <= 0) return null;
  const current = snapshots[index], previous = snapshots[index - 1];
  const dayBefore = new Date(`${date}T12:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return previous.date === dayBefore.toISOString().slice(0, 10) ? current.followers - previous.followers : null;
}
export function CompactFollowerChart({ snapshots }: { snapshots: DailyFollower[] }) {
  const ordered = [...snapshots].filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.followers))
    .sort((a,b) => a.date.localeCompare(b.date));
  const latest = ordered.at(-1);
  const change = latest ? followerDifference(ordered, latest.date) : null;
  return <section className="marketing-social-follower-trend">
    <header><strong>تطور المتابعين اليومي</strong>{change !== null && <span className={change > 0 ? 'is-up' : change < 0 ? 'is-down' : 'is-flat'} dir="ltr">{change > 0 ? '+' : ''}{fmt(change)}</span>}</header>
    {ordered.length > 1 ? <div className="marketing-social-mini-chart" dir="ltr">
      <ResponsiveContainer width="100%" height={108}>
        <LineChart data={ordered} margin={{ top: 9, right: 7, left: 7, bottom: 2 }}>
          <XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{fontSize:10}} axisLine={false} tickLine={false} minTickGap={24}/>
          <Tooltip labelFormatter={value => {const day=String(value);const diff=followerDifference(ordered,day);return `${day}${diff===null ? '' : ` · ${diff > 0 ? '+' : ''}${fmt(diff)} متابع`}`;}}
            formatter={value => [fmt(value),'المتابعون']} />
          <Line type="monotone" dataKey="followers" stroke="var(--brand)" strokeWidth={2.5} dot={ordered.length < 11} activeDot={{r:5}} connectNulls={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div> : <div className="marketing-social-mini-empty">{latest ? `${latest.date} · ${fmt(latest.followers)}` : '—'}</div>}
  </section>;
}
export function TopEngagedSocialPost({ post }: { post: EngagedSocialPost | null }) {
  return <section className="marketing-meta-top-post marketing-social-top-post">
    <div className="marketing-meta-top-post-title"><Heart size={16}/><strong>أعلى بوست تفاعلًا</strong><span>{post ? `${fmt(post.engagementTotal)} تفاعل` : '—'}</span></div>
    {post && <><p>{post.caption || '—'}</p>
      <div className="marketing-meta-top-post-metrics">
        {post.likes !== null && <span>إعجابات: {fmt(post.likes)}</span>}
        {post.comments !== null && <span>تعليقات: {fmt(post.comments)}</span>}
        {post.shares !== null && <span>مشاركات: {fmt(post.shares)}</span>}
      </div>
      <footer><span>{post.publishedAt ? marketingDate(post.publishedAt) : ''}</span>
        {/^https:\/\//i.test(post.permalink) && <a href={post.permalink} target="_blank" rel="noopener noreferrer">فتح المنشور <LinkSimple size={14}/></a>}
      </footer>
    </>}
  </section>;
}
