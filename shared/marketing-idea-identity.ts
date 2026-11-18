/** The strategy's existing immutable idea.code is the public tracking identity.
 * No extra ID sequence, mirror table or migration is necessary. Historical
 * task markers without per-item codes are resolved by original idea-name
 * groups only when the ordering is unambiguous. */
export type StrategyMarker = {
  source?: string; planId?: string; ideaCodes?: string[];
  clientKeys?: string[]; itemIdeaCodes?: string[];
};
export type StrategyAssignedItem = {
  id: string; client_key: string; idea_name: string; sort_order: number;
  status?: string; delivery_mode?: string; in_agenda?: boolean; in_campaign?: boolean;
  submitted_at?: string | Date | null; agenda_published?: boolean; campaign_linked?: boolean;
};

export function strategyCodeMap(marker: StrategyMarker | null | undefined, items: StrategyAssignedItem[]): Map<string, string> {
  const result = new Map<string,string>();
  const codes = [...new Set((marker?.ideaCodes || []).filter((code): code is string => typeof code === 'string' && !!code))];
  if (marker?.source !== 'mzj-content-strategy' || !codes.length) return result;
  const accepted = new Set(codes);
  const keys = marker?.clientKeys || [];
  const itemCodes = marker?.itemIdeaCodes || [];
  if (keys.length && keys.length === itemCodes.length) {
    const byKey = new Map(keys.map((key,index)=>[key,itemCodes[index]]));
    for (const item of items) {
      const code = byKey.get(item.client_key);
      if (code && accepted.has(code)) result.set(item.id,code);
    }
  }
  if (result.size === items.length) return result;
  if (codes.length === 1) {
    for (const item of items) if (!result.has(item.id)) result.set(item.id,codes[0]);
    return result;
  }
  // Before itemIdeaCodes existed, the bridge inserted all performers for each
  // idea together, in the same order as source.ideaCodes. Reconstruct that
  // sequence using the first occurrence of each distinct idea title. Do not
  // guess a code when idea titles are ambiguous or the counts disagree.
  const ordered = [...items].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
  const titles=[...new Set(ordered.map(item=>item.idea_name.trim()))];
  if (titles.length !== codes.length || titles.some(title=>!title)) return result;
  const codeForTitle = new Map(titles.map((title,index)=>[title,codes[index]]));
  for (const item of ordered) {
    const code=codeForTitle.get(item.idea_name.trim());
    if (code && !result.has(item.id)) result.set(item.id,code);
  }
  return result;
}

export type MarketingIdeaTrackingRow = {
  taskId: string; taskNo: string; createdAt: string;
  assignment: number;
  execution: number; executionPercent: number;
  publishing: number; publishingPercent: number;
  funding: number; fundingPercent: number;
};
/** MZJ tracking rule (per idea, then averaged over the assignment's ideas):
 * التنفيذ  50% عند الإرسال + 50% عند الاعتماد
 * النشر    50% عند وضع الطلب في أجندة + 50% عند إضافة رابط النشر
 * التمويل  50% عند وضع الطلب في حملة + 50% عند ربط الحملة بتقارير الحملات
 * The count is the number of ideas that started the stage. */
const average = (scores:number[]) => scores.length ? Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length) : 0;
function executionScore(item:StrategyAssignedItem) {
  if (item.status==='approved') return 100;
  if (item.submitted_at || ['submitted','revision','editing'].includes(String(item.status||''))) return 50;
  return 0;
}
export function calculateIdeaTracking(taskId:string,taskNo:string,createdAt:string,marker:StrategyMarker,items:StrategyAssignedItem[]):MarketingIdeaTrackingRow {
  const codes = [...new Set((marker.ideaCodes || []).filter(code=>typeof code==='string' && !!code))];
  const mapped=strategyCodeMap(marker,items);
  const ideaItems=new Map(codes.map(code=>[code,[] as StrategyAssignedItem[]]));
  for (const item of items) {
    const code=mapped.get(item.id);
    if (code && ideaItems.has(code)) ideaItems.get(code)!.push(item);
  }
  const executionScores:number[]=[],publishingScores:number[]=[],fundingScores:number[]=[];
  for(const list of ideaItems.values()){
    const finalItems=list.filter(item=>item.delivery_mode!=='drive_link');
    const production=finalItems.length ? finalItems : list;
    executionScores.push(production.length ? average(production.map(executionScore)) : 0);
    publishingScores.push(list.some(item=>Boolean(item.in_agenda)) ? (list.some(item=>Boolean(item.agenda_published)) ? 100 : 50) : 0);
    fundingScores.push(list.some(item=>Boolean(item.in_campaign)) ? (list.some(item=>Boolean(item.campaign_linked)) ? 100 : 50) : 0);
  }
  const assignment=codes.length;
  const started=(scores:number[])=>scores.filter(score=>score>0).length;
  const percent=(scores:number[])=>assignment ? Math.round(scores.reduce((sum,value)=>sum+value,0)/assignment) : 0;
  return {taskId,taskNo,createdAt,assignment,
    execution:started(executionScores),executionPercent:percent(executionScores),
    publishing:started(publishingScores),publishingPercent:percent(publishingScores),
    funding:started(fundingScores),fundingPercent:percent(fundingScores)};
}
