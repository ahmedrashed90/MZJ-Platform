import { NavLink,Outlet } from "react-router-dom";
import { Archive,ArrowsLeftRight,Car,CheckCircle,ClipboardText,FileXls,Garage,ListMagnifyingGlass,Stack,Truck } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

const pages=[
  {to:"/operations",label:"مخزون السيارات",icon:Car,end:true,permissions:["operations.vehicles.view"]},
  {to:"/operations/manage",label:"إدارة السيارات",icon:Garage,permissions:["operations.vehicles.create","operations.vehicles.update"]},
  {to:"/operations/import-export",label:"الاستيراد والتصدير",icon:FileXls,permissions:["operations.vehicles.import","operations.vehicles.export"]},
  {to:"/operations/movements",label:"حركة سيارة",icon:ArrowsLeftRight,permissions:["operations.movements.execute"]},
  {to:"/operations/bulk-movement",label:"حركة جماعية",icon:Stack,permissions:["operations.movements.bulk"]},
  {to:"/operations/requests",label:"طلبات النقل والتصوير",icon:Truck,permissions:["operations.requests.create","operations.requests.view_outgoing","operations.requests.view_incoming","operations.requests.view_all"]},
  {to:"/operations/approvals",label:"الموافقات",icon:CheckCircle,permissions:["operations.approvals.view"]},
  {to:"/operations/all-vehicles",label:"جميع السيارات",icon:ListMagnifyingGlass,permissions:["operations.vehicles.view"]},
  {to:"/operations/movement-log",label:"سجل الحركات",icon:ClipboardText,permissions:["operations.movements.view"]},
  {to:"/operations/archive",label:"الأرشيف",icon:Archive,permissions:["operations.archive.view"]},
];
export function OperationsLayout(){const {user}=useAuth();const unrestricted=Boolean(user?.isSystemAdmin||user?.roleCodes.includes("system_admin"));const visible=pages.filter(page=>unrestricted||page.permissions.some(permission=>user?.permissionCodes.includes(permission)));return <section className="operations-module"><header className="operations-module-head"><div><span>نظام العمليات</span><h1>إدارة مخزون وحركة السيارات</h1><p>فلو أصلي داخل المنصة بصلاحيات الفروع ومعاملات PostgreSQL وسجل تدقيق كامل.</p></div></header><nav className="operations-tabs" aria-label="صفحات العمليات">{visible.map(({to,label,icon:Icon,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>isActive?"active":""}><Icon size={18}/><span>{label}</span></NavLink>)}</nav><Outlet/></section>}
