import { NavLink,Outlet } from "react-router-dom";
const tabs=[
  ["/operations","مخزون السيارات"],
  ["/operations/manage","إدارة السيارات"],
  ["/operations/movement","الحركة"],
  ["/operations/transfers","طلبات النقل"],
  ["/operations/approvals","الموافقات"],
  ["/operations/all","جميع السيارات"],
  ["/operations/movements","سجل الحركات"],
  ["/operations/archive","الأرشيف"],
];
export function OperationsLayout(){return <div className="operations-shell"><nav className="operations-tabs">{tabs.map(([href,label])=><NavLink key={href} to={href} end={href==='/operations'} className={({isActive})=>isActive?'active':''}>{label}</NavLink>)}</nav><Outlet/></div>}
