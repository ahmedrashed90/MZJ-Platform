import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { Empty, WorkAlert } from './components';
import { isWorkDate } from '../../../shared/marketing-workflow';
import { showDate, useWorkQuery, workPost } from './api';
import './strategyDrafts.css';

type Idea = { ideaCode: string; ideaName: string; currentDates: string[]; postCount: number;
  blockedPosts: number; platforms: string[] };
type AgendaSchedule = { ok: boolean; totalPosts: number; unmappedPosts: number; ideas: Idea[]; planNo: string };

const ar = {
  open: '\u062a\u0639\u062f\u064a\u0644 \u0645\u0648\u0627\u0639\u064a\u062f \u0646\u0634\u0631 \u0623\u0641\u0643\u0627\u0631 \u0627\u0644\u0623\u062c\u0646\u062f\u0629',
  close: '\u0625\u063a\u0644\u0627\u0642 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u0648\u0627\u0639\u064a\u062f',
  search: '\u0628\u062d\u062b \u0628\u0627\u0633\u0645 \u0627\u0644\u0641\u0643\u0631\u0629 \u0623\u0648 \u0643\u0648\u062f\u0647\u0627',
  newDate: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u062c\u062f\u064a\u062f',
  current: '\u0627\u0644\u0645\u0648\u0627\u0639\u064a\u062f \u0627\u0644\u062d\u0627\u0644\u064a\u0629',
  multiple: '\u0645\u0648\u0627\u0639\u064a\u062f \u0645\u062e\u062a\u0644\u0641\u0629',
  posts: '\u0628\u0648\u0633\u062a',
  ideas: '\u0641\u0643\u0631\u0629',
  unavailable: '\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0645\u0646\u0634\u0648\u0631\u0629 \u0623\u0648 \u0645\u062c\u062f\u0648\u0644\u0629 \u062e\u0627\u0631\u062c\u064a\u064b\u0627 \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u063a\u064a\u064a\u0631 \u0645\u0648\u0639\u062f\u0647\u0627',
  missing: '\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0628\u062f\u0648\u0646 \u0643\u0648\u062f \u0641\u0643\u0631\u0629 \u0645\u0631\u062a\u0628\u0637 \u2014 \u0644\u0646 \u062a\u062a\u063a\u064a\u0631 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627',
  save: '\u062d\u0641\u0638 \u062c\u0645\u064a\u0639 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u0645\u0648\u0627\u0639\u064a\u062f',
  saved: '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0645\u0648\u0627\u0639\u064a\u062f \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u0645\u062e\u0637\u0637\u0629 \u0628\u0646\u062c\u0627\u062d',
  confirm: '\u062a\u0623\u0643\u064a\u062f \u062a\u063a\u064a\u064a\u0631 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0634\u0631 \u0644\u0643\u0644 \u0628\u0648\u0633\u062a\u0627\u062a \u0627\u0644\u0623\u0641\u0643\u0627\u0631 \u0627\u0644\u0645\u062d\u062f\u062f\u0629\u061f',
  note: '\u0643\u0644 \u0641\u0643\u0631\u0629 \u0644\u0647\u0627 \u062a\u0627\u0631\u064a\u062e \u0648\u0627\u062d\u062f \u0639\u0644\u0649 \u062c\u0645\u064a\u0639 \u0627\u0644\u0645\u0646\u0635\u0627\u062a \u0648\u0623\u0646\u0648\u0627\u0639 \u0627\u0644\u0646\u0634\u0631. \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u0641\u0639\u0644\u064a \u0648\u062d\u0627\u0644\u0629 \u0627\u0644\u0627\u0639\u062a\u0645\u0627\u062f \u0644\u0646 \u064a\u062a\u063a\u064a\u0631\u0627.',
};

export function AgendaIdeaDateEditor({ planId, onChanged }: { planId: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const query = useWorkQuery<AgendaSchedule>('agenda_idea_dates', { planId }, open);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setDates({}); }, [planId, query.data]);
  const ideas = query.data?.ideas || [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return ideas.filter(idea => !term || `${idea.ideaName} ${idea.ideaCode}`.toLocaleLowerCase().includes(term));
  }, [ideas, search]);
  const selected = ideas.filter(idea => dates[idea.ideaCode] &&
    (idea.currentDates.length !== 1 || dates[idea.ideaCode] !== idea.currentDates[0]) && !idea.blockedPosts);
  const postCount = selected.reduce((total, idea) => total + idea.postCount, 0);
  async function save() {
    if (!selected.length || busy) return;
    if (!window.confirm(`${ar.confirm}\n${selected.length} ${ar.ideas} / ${postCount} ${ar.posts}`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ updatedIdeas: number; updatedPosts: number }>('reschedule_agenda_ideas', {
        planId,
        changes: selected.map(idea => ({ ideaCode: idea.ideaCode, date: dates[idea.ideaCode], expectedDates: idea.currentDates })),
      });
      setMessage(`${ar.saved}: ${result.updatedIdeas} ${ar.ideas} / ${result.updatedPosts} ${ar.posts}`);
      await query.reload();
      onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <section className="mkw-agenda-idea-dates">
    <div className="mkw-section-title"><strong>{ar.open}</strong>
      <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? ar.close : ar.open}</button>
    </div>
    {open && <div className="mkw-agenda-idea-editor">
      <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
      <p className="mkw-muted">{ar.note}</p>
      {query.data && <div className="mkw-agenda-idea-summary"><span>{ideas.length} {ar.ideas}</span><span>{query.data.totalPosts} {ar.posts}</span>
        {query.data.unmappedPosts > 0 && <span className="mkw-agenda-idea-warning"><WarningCircle size={17}/>{query.data.unmappedPosts} {ar.missing}</span>}
      </div>}
      <label className="mkw-agenda-idea-search"><MagnifyingGlass size={18}/><input aria-label={ar.search} placeholder={ar.search} value={search} onChange={e => setSearch(e.target.value)}/></label>
      {query.loading && !query.data ? <Empty>{'...'}</Empty> : <div className="mkw-agenda-idea-list">
        {filtered.map(idea => {
          const current = idea.currentDates.length === 1 ? idea.currentDates[0] : '';
          const value = dates[idea.ideaCode] ?? current;
          return <details key={idea.ideaCode} className="mkw-agenda-idea-row">
            <summary><span className="mkw-agenda-idea-row-title"><strong>{idea.ideaName}</strong><small dir="ltr">{idea.ideaCode}</small></span>
              <span className="mkw-agenda-idea-row-meta">{idea.postCount} {ar.posts} · {idea.currentDates.length === 1 ? showDate(current) : ar.multiple}</span></summary>
            <div className="mkw-agenda-idea-fields"><div><small>{ar.current}</small><strong>{idea.currentDates.map(date => showDate(date)).join(' / ')}</strong>
              <small>{idea.platforms.join(' · ')}</small></div>
              <label>{ar.newDate}<input type="date" value={value} disabled={busy || idea.blockedPosts > 0}
                onChange={e => setDates(old => ({ ...old, [idea.ideaCode]: e.target.value }))}/></label>
              {idea.blockedPosts > 0 && <p className="mkw-agenda-idea-warning"><WarningCircle size={17}/>{idea.blockedPosts} {ar.unavailable}</p>}
            </div>
          </details>;
        })}
      </div>}
      <div className="mkw-agenda-idea-save"><span>{selected.length} {ar.ideas} · {postCount} {ar.posts}</span>
        <button type="button" className="primary" disabled={busy || !selected.length || selected.some(idea => !isWorkDate(dates[idea.ideaCode]))}
          onClick={() => void save()}><CheckCircle size={17}/>{ar.save}</button></div>
    </div>}
  </section>;
}
