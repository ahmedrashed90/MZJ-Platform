import type { WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';

/** Dashboard search operates only on the existing permission-scoped workflow response.
 * Dates are kept as Gregorian calendar days; timestamps use the Saudi business day. */
export type DashboardSearchPlan = {
  id: string;
  kind: 'agenda' | 'campaign';
  first: WorkPlanLine;
  lines: WorkPlanLine[];
  scheduledFrom: string;
  scheduledTo: string;
};

export type DashboardSearchResults = {
  tasks: WorkTask[];
  publications: WorkPlanLine[];
  agendas: DashboardSearchPlan[];
  campaigns: DashboardSearchPlan[];
};

const saudiDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
});

const westernDigits = (value: string) => value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g,
  digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)));

export function normalizeDashboardSearch(value: unknown): string {
  return westernDigits(String(value ?? '').normalize('NFKC'))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064a').replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648').replace(/\u0626/g, '\u064a')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function saudiDate(value: unknown): string {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = new Date(raw);
  if (!Number.isFinite(timestamp.getTime())) return '';
  const parts = saudiDateFormatter.formatToParts(timestamp);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Accept yyyy/m/d, d/m/yyyy, m/yyyy, yyyy/m and both slash and dash separators.
 * Prefix matching only (not substring) avoids confusing 8/11 with 18/11. */
export function dashboardDateKeywords(value: unknown): string[] {
  const day = saudiDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return [];
  const [, year, mm, dd] = match;
  const month = String(Number(mm)), date = String(Number(dd));
  return [
    `${year}/${mm}/${dd}`, `${year}/${month}/${date}`, `${year}/${mm}/${date}`,
    `${year}/${month}/${dd}`, `${year}/${mm}`, `${year}/${month}`,
    `${dd}/${mm}/${year}`, `${date}/${month}/${year}`, `${date}/${mm}/${year}`,
    `${dd}/${month}/${year}`, `${mm}/${year}`, `${month}/${year}`,
    `${date}/${month}`, `${dd}/${mm}`, year,
  ];
}

const dateFragment = /^\d{1,4}[/.\-]\d{1,4}(?:[/.\-]\d{1,4})?$/;

function matchesKeywords(query: string, texts: unknown[], dates: unknown[]): boolean {
  const terms = normalizeDashboardSearch(query).split(' ').filter(Boolean);
  if (!terms.length) return false;
  const textIndex = texts.map(normalizeDashboardSearch).join(' ');
  const dateIndex = terms.some(term => dateFragment.test(term) || /^\d+$/.test(term))
    ? dates.flatMap(dashboardDateKeywords) : [];
  return terms.every(term => dateFragment.test(term)
    ? dateIndex.some(date => date.startsWith(term.replace(/[.\-]/g, '/')))
    : textIndex.includes(term) || dateIndex.some(date => date.includes(term)));
}

function planStatusTerms(status: unknown): string {
  switch (String(status || '')) {
    case 'in_progress': return 'قيد التنفيذ';
    case 'submitted': return 'قيد المراجعة مرسل للمراجعة';
    case 'revision': return 'مطلوب تعديل قيد التعديل';
    case 'publishing': return 'معتمد جاري النشر';
    case 'published': return 'منشور تم النشر';
    case 'failed': return 'فشل النشر';
    default: return '';
  }
}

function platformAliases(code: unknown): string {
  switch (String(code || '').toLowerCase()) {
    case 'instagram': return 'انستجرام إنستجرام انستغرام انستا instagram insta';
    case 'facebook': return 'فيس بوك فيسبوك فيس facebook fb';
    case 'snapchat': case 'snap': return 'سناب شات سنابشات سناب snapchat snap';
    case 'tiktok': case 'tik_tok': return 'تيك توك تيكتوك tiktok tik tok';
    case 'youtube': return 'يوتيوب يوتيوب شورتس youtube shorts';
    case 'x': case 'twitter': return 'تويتر اكس twitter';
    default: return '';
  }
}

function timelineOrder(left: string, right: string, today: string): number {
  // Future appointments first, nearest to farthest; historic items newest first.
  const leftUpcoming = Boolean(left && left >= today);
  const rightUpcoming = Boolean(right && right >= today);
  if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  return leftUpcoming ? left.localeCompare(right) : right.localeCompare(left);
}

/** Return the executors whose names match a dashboard keyword search. When a
 * query also includes a date/product, use the strongest name match. A task
 * found by name/code/idea alone keeps its normal, unfiltered detail view. */
export function matchingTaskExecutors(task: WorkTask, query: string): string[] {
  const text = normalizeDashboardSearch(query);
  if (text.length < 2) return [];
  const names = [...new Set((task.assignee_names || []).map(name => String(name || '').trim()).filter(Boolean))];
  const exact = names.filter(name => normalizeDashboardSearch(name).includes(text));
  if (exact.length) return exact;
  const terms = text.split(/\s+/).filter(term => term.length >= 2 && !/^\d/.test(term));
  if (!terms.length) return [];
  const scored = names.map(name => ({ name, score: terms.filter(term => normalizeDashboardSearch(name).includes(term)).length }));
  const highest = Math.max(0, ...scored.map(entry => entry.score));
  return highest ? scored.filter(entry => entry.score === highest).map(entry => entry.name) : [];
}

/** Scope only the visible requirements (and archived requirements) to the
 * matched executor. This is a view filter, never authentication/impersonation. */
export function filterDashboardExecutorItems<T extends { assignee_name: string }>(items: T[], assigneeNames?: string[]): T[] {
  if (!assigneeNames?.length) return items;
  const allowed = new Set(assigneeNames.map(normalizeDashboardSearch));
  return items.filter(item => allowed.has(normalizeDashboardSearch(item.assignee_name)));
}

function taskDates(task: WorkTask) {
  return [task.due_from, task.due_to, ...(task.due_dates || []), task.created_at];
}

function taskTexts(task: WorkTask): unknown[] {
  return [task.name, task.task_no, task.type_name, task.status,
    task.status === 'active' ? 'قيد التنفيذ' : task.status === 'completed' ? 'مكتمل تم التنفيذ' : 'لم يبدأ',
    ...(task.assignee_names || []), ...(task.search_ideas || []), ...(task.search_briefs || [])];
}

function publicationTexts(line: WorkPlanLine): unknown[] {
  return [line.name, line.plan_no, line.kind, line.kind === 'agenda' ? 'أجندة' : 'حملة',
    line.idea_name, line.product_idea, line.task_no, line.task_name, line.assignee_name,
    line.platform_name, line.platform_code, platformAliases(line.platform_code),
    line.post_type_name, line.caption, line.hashtags, line.status, planStatusTerms(line.review_status),
    line.published_ready ? 'تم النشر منشور' : 'لم ينشر بانتظار النشر',
    line.publication_timing === 'overdue' ? 'متأخر ولم ينشر' :
      line.publication_timing === 'late' ? 'نشر متأخر' :
      line.publication_timing === 'on_time' ? 'نشر في الموعد' : ''];
}

function groupPlans(lines: WorkPlanLine[]): DashboardSearchPlan[] {
  const groups = new Map<string, WorkPlanLine[]>();
  for (const line of lines) {
    const group = groups.get(line.plan_id);
    if (group) group.push(line);
    else groups.set(line.plan_id, [line]);
  }
  return [...groups.entries()].map(([id, group]) => {
    const dates = group.map(line => String(line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort();
    return { id, kind: group[0].kind, first: group[0], lines: group,
      scheduledFrom: dates[0] || '', scheduledTo: dates[dates.length - 1] || '' };
  });
}

function planMatches(plan: DashboardSearchPlan, query: string): boolean {
  const { first, lines } = plan;
  // A platform-only query shows the exact matching publications, not unrelated
  // posts from their parent plan. Product queries also reveal linked plans.
  return matchesKeywords(query, [first.plan_no, first.name, first.creator_name,
    first.kind === 'agenda' ? 'أجندة' : 'حملة', first.review_status, planStatusTerms(first.review_status),
    ...lines.flatMap(line => [line.idea_name, line.product_idea, line.task_name])],
  [first.plan_created_at, first.agenda_from, first.agenda_to,
    first.funding_from, first.funding_to, ...lines.map(line => line.scheduled_on)]);
}

export function searchMarketingDashboard(
  tasks: WorkTask[], lines: WorkPlanLine[], query: string, today = saudiDate(new Date()),
): DashboardSearchResults {
  if (!normalizeDashboardSearch(query)) return { tasks: [], publications: [], agendas: [], campaigns: [] };
  const taskMatches = tasks.filter(task => matchesKeywords(query, taskTexts(task), taskDates(task)))
    .sort((a, b) => timelineOrder(a.due_to || a.due_from || '', b.due_to || b.due_from || '', today));
  const publications = lines.filter(line => matchesKeywords(query, publicationTexts(line),
    [line.scheduled_on, line.published_on]))
    .sort((a, b) => timelineOrder(String(a.scheduled_on || ''), String(b.scheduled_on || ''), today)
      || String(a.plan_no).localeCompare(String(b.plan_no), 'ar'));
  const plans = groupPlans(lines).filter(plan => planMatches(plan, query));
  const order = (a: DashboardSearchPlan, b: DashboardSearchPlan) => timelineOrder(
    a.kind === 'agenda' ? a.first.agenda_from || a.scheduledFrom : a.first.funding_from || a.scheduledFrom,
    b.kind === 'agenda' ? b.first.agenda_from || b.scheduledFrom : b.first.funding_from || b.scheduledFrom, today);
  return {
    tasks: taskMatches,
    publications,
    agendas: plans.filter(plan => plan.kind === 'agenda').sort(order),
    campaigns: plans.filter(plan => plan.kind === 'campaign').sort(order),
  };
}
