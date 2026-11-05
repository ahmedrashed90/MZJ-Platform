import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import { campaignPlatformGoalRows, type CampaignGoalOption, type CampaignPlatformGoals } from '../../../shared/marketing-campaign-goals';

/** One row per platform in reports, regardless of product/post type count. */
export function CampaignGoalsTable({ lines, saved }: { lines: WorkPlanLine[]; saved?: CampaignPlatformGoals[] | null }) {
  const rows = campaignPlatformGoalRows(lines,saved);
  return <section className="mkw-campaign-objectives-summary" aria-label="الهدف من الحملة حسب المنصة">
    <h3>الهدف من الحملة — حسب المنصة</h3>
    <div className="mkw-table-wrap"><table><thead><tr><th scope="col">المنصة</th><th scope="col">الأهداف</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.platformId || row.platformName}><th scope="row">{row.platformName}</th><td>{row.goals.length ? <div className="mkw-campaign-goal-tags">{row.goals.map(goal => <span key={goal.id || goal.name}>{goal.name}</span>)}</div> : <span className="mkw-muted">لم تُحدَّد أهداف بعد</span>}</td></tr>)}
      {!rows.length && <tr><td colSpan={2}>لا توجد منصات في الحملة</td></tr>}
    </tbody></table></div>
  </section>;
}

/** Shared, controlled, multi-objective selector for new and historical plans. */
export function CampaignGoalPicker({ platformName, goals, selectedIds, onChange, disabled = false }: {
  platformName: string; goals: CampaignGoalOption[]; selectedIds: string[];
  onChange: (next: string[]) => void; disabled?: boolean;
}) {
  return <div className="mkw-campaign-goal-picker">
    <div className="mkw-campaign-goal-picker-heading"><strong>{platformName}</strong><small>{selectedIds.length ? `${selectedIds.length} هدف محدد` : 'اختر هدفًا أو أكثر'}</small></div>
    <div className="mkw-campaign-goal-options" role="group" aria-label={`أهداف ${platformName}`}>
      {goals.length ? goals.map(goal => <label className={selectedIds.includes(goal.id) ? 'is-checked' : ''} key={goal.id}>
        <input type="checkbox" disabled={disabled} checked={selectedIds.includes(goal.id)} onChange={() => onChange(selectedIds.includes(goal.id) ? selectedIds.filter(value => value !== goal.id) : [...selectedIds,goal.id])}/>
        <span>{goal.name}</span>
      </label>) : <p className="mkw-muted">لا توجد أهداف مضافة في إعدادات التسويق بعد.</p>}
    </div>
  </div>;
}
