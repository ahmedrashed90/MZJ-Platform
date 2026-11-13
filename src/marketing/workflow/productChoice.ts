import type { WorkProduct } from '../../../shared/marketing-workflow';

/** One canonical human-readable product label for new and revised campaigns
 * and agendas. The product UUID remains unchanged. */
export function productChoiceLabel(product:WorkProduct):string {
  const number=Number(product.requirement_number || product.sort_order+1);
  return [
    `المطلوب ${number}`,
    product.idea_code ? `كود الفكرة ${product.idea_code}` : '',
    product.idea_name,
    product.media_kind==='video'?'فيديو':'صورة',
    product.assignee_name||'—',
    String(product.idea||'').replace(/\s+/g,' ').slice(0,100),
  ].filter(Boolean).join(' — ');
}
export function productChoiceGroups(products:WorkProduct[]) {
  const groups=new Map<string,{title:string;rows:WorkProduct[]}>();
  for(const product of products){
    const key=String(product.task_id||product.task_no);
    if(!groups.has(key))groups.set(key,{title:`${product.task_no} — ${product.task_name}`,rows:[]});
    groups.get(key)!.rows.push(product);
  }
  return [...groups.values()];
}
