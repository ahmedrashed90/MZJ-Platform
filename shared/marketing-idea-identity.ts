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
const percentage = (count:number,total:number) => total ? Math.round(count*100/total) : 0;
export function calculateIdeaTracking(taskId:string,taskNo:string,createdAt:string,marker:StrategyMarker,items:StrategyAssignedItem[]):MarketingIdeaTrackingRow {
  const codes = [...new Set((marker.ideaCodes || []).filter(code=>typeof code==='string' && !!code))];
  const mapped=strategyCodeMap(marker,items);
  const ideaItems=new Map(codes.map(code=>[code,[] as StrategyAssignedItem[]]));
  for (const item of items) {
    const code=mapped.get(item.id);
    if (code && ideaItems.has(code)) ideaItems.get(code)!.push(item);
  }
  let execution=0,publishing=0,funding=0;
  for(const list of ideaItems.values()){
    const finalItems=list.filter(item=>item.delivery_mode!=='drive_link');
    if ((finalItems.length ? finalItems : list).length && (finalItems.length ? finalItems : list).every(item=>item.status==='approved')) execution++;
    if(list.some(item=>Boolean(item.in_agenda))) publishing++;
    if(list.some(item=>Boolean(item.in_campaign))) funding++;
  }
  const assignment=codes.length;
  return {taskId,taskNo,createdAt,assignment,execution,executionPercent:percentage(execution,assignment),
    publishing,publishingPercent:percentage(publishing,assignment),funding,fundingPercent:percentage(funding,assignment)};
}
