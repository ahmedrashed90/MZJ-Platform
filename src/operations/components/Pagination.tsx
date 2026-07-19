import type { Pagination as PaginationType } from "../types";
export function Pagination({value,onChange}:{value:PaginationType;onChange:(page:number)=>void}) {
  if (value.pages<=1) return <div className="operations-pagination"><span>إجمالي النتائج: {value.total}</span></div>;
  return <div className="operations-pagination"><span>إجمالي النتائج: {value.total}</span><div><button type="button" disabled={value.page<=1} onClick={()=>onChange(value.page-1)}>السابق</button><strong>{value.page} / {value.pages}</strong><button type="button" disabled={value.page>=value.pages} onClick={()=>onChange(value.page+1)}>التالي</button></div></div>;
}
