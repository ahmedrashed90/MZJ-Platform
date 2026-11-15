import type { WorkProduct } from '../../../shared/marketing-workflow';
import { taskCategoryLabel } from './taskPresentation';

/** One canonical human-readable product label for new and revised campaigns
 * and agendas. The product UUID remains unchanged. */
export function productChoiceLabel(product:WorkProduct):string {
  if (product.manual_product) return `كلمات بحث`;
  // Same order as the products table: التصنيف — المطلوب — رقم التاسك — رقم الطلب — اسم الفكرة.
  return [
    product.strategy_category || taskCategoryLabel(product.task_name),
    product.media_kind==='video'?'فيديو':'صورة',
    product.task_no || '—',
    product.strategy_order_no || '—',
    product.idea_name,
  ].map(value=>String(value||'').trim()||'—').join(' — ');
}
export function productChoiceGroups(products:WorkProduct[]) {
  const groups=new Map<string,{title:string;rows:WorkProduct[]}>();
  for(const product of products){
    const key=String(product.task_id||product.task_no);
    if(!groups.has(key))groups.set(key,{title:product.manual_product ? 'كلمات بحث' : `${product.task_no} — ${product.task_name}`,rows:[]});
    groups.get(key)!.rows.push(product);
  }
  return [...groups.values()];
}
