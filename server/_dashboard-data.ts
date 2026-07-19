import { getSql } from "./_db.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import type { DashboardData } from "../src/types.js";

const locationNames = [["warehouse","المستودع"],["agency","الوكالة"],["hall","الصالة"],["qadisiyah","القادسية"],["multaqa","الملتقى"]] as const;

function emptyData(): DashboardData {
  return {
    connected:false,generatedAt:new Date().toISOString(),sectionErrors:{},
    crm:{totalCustomers:null,openConversations:null,potentialCustomers:null,sold:null,cashSales:null,financeSales:null,customerService:null,newToday:null,newThisWeek:null,recentConversations:[],newCustomersSeries:[]},
    marketing:{campaigns:null,scheduled:null,delayed:null},tracking:{requests:null,inProgress:null,completed:null},
    operations:{
      inventory:{actualTotal:null,agency:null,availableForSale:null,underDelivery:null,hasNotes:null},
      locations:locationNames.map(([key,name])=>({key,name,actualTotal:null,underDelivery:null,availableForSale:null,reserved:null,delivered:null,hasNotes:null})),
      approvals:{total:null,missingFinancial:null,missingAdministrative:null,completed:null},
      shortages:{total:null,multaqa:null,hall:null,qadisiyah:null},
      transfers:{total:null,requestReceived:null,vehicleReceived:null,vehicleSent:null,completed:null},
      salesTracking:{total:null,notStarted:null,inProgress:null,completed:null},
    },
  };
}
const asNumber=(value:unknown)=>Number(value??0);

export async function getDashboardData():Promise<DashboardData>{
  const data=emptyData(); let sql:ReturnType<typeof getSql>;
  const errors:Record<string,string>={};
  try{sql=getSql();await sql`select 1 as ok`;data.connected=true;}catch(error){console.error("Dashboard connection check failed",error);return data;}
  try{await ensureOperationsSchema();}catch(error){const requestId=`dashboard-operations-schema-${Date.now().toString(36)}`;console.error("Operations schema preparation failed",{requestId,error});errors["operations.schema"]=requestId;}
  async function capture<T>(key:string,run:()=>Promise<T>):Promise<T|null>{try{return await run();}catch(error){const requestId=`dashboard-${key}-${Date.now().toString(36)}`;console.error("Dashboard widget query failed",{key,requestId,error});errors[key]=requestId;return null;}}

  const crmRow=await capture("crm.summary",async()=>{const [row]=await sql<any[]>`
    select (select count(*) from crm.leads where is_deleted=false)::int total_customers,
      (select count(*) from crm.conversations where status='open')::int open_conversations,
      (select count(*) from crm.leads where status_label='محتمل' and is_deleted=false)::int potential_customers,
      (select count(*) from crm.leads where status_label in ('تم البيع','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') and is_deleted=false)::int sold,
      (select count(*) from crm.leads where department_code='cash_sales' and is_deleted=false)::int cash_sales,
      (select count(*) from crm.leads where department_code='finance_sales' and is_deleted=false)::int finance_sales,
      (select count(*) from crm.leads where department_code='customer_service' and is_deleted=false)::int customer_service,
      (select count(*) from crm.leads where created_at::date=current_date and is_deleted=false)::int new_today,
      (select count(*) from crm.leads where created_at>=date_trunc('week',now()) and is_deleted=false)::int new_this_week`;
    return row;
  });
  if(crmRow){data.crm={...data.crm,totalCustomers:asNumber(crmRow.total_customers),openConversations:asNumber(crmRow.open_conversations),potentialCustomers:asNumber(crmRow.potential_customers),sold:asNumber(crmRow.sold),cashSales:asNumber(crmRow.cash_sales),financeSales:asNumber(crmRow.finance_sales),customerService:asNumber(crmRow.customer_service),newToday:asNumber(crmRow.new_today),newThisWeek:asNumber(crmRow.new_this_week)};}
  const recent=await capture("crm.recent",()=>sql<any[]>`select c.id::text,coalesce(c.customer_name,l.customer_name,'عميل') customer_name,coalesce(c.preview_text,'') preview_text,c.last_message_at,coalesce(c.unread_count,0)::int unread_count,coalesce(c.lead_id::text,'') lead_id,coalesce(l.department_code,'') department_code from crm.conversations c left join crm.leads l on l.id=c.lead_id and l.is_deleted=false order by c.last_message_at desc nulls last limit 5`);
  if(recent)data.crm.recentConversations=recent.map((row)=>({id:row.id,customerName:row.customer_name,preview:row.preview_text,time:row.last_message_at?new Date(row.last_message_at).toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"}):"",unreadCount:asNumber(row.unread_count),leadId:row.lead_id,department:row.department_code==="finance_sales"||row.department_code==="call_center"?"finance":row.department_code==="customer_service"?"service":"cash"}));
  const series=await capture("crm.series",()=>sql<any[]>`select to_char(day,'DD/MM') label,count(l.id)::int value from generate_series(current_date-interval '6 days',current_date,interval '1 day') day left join crm.leads l on l.created_at::date=day::date and l.is_deleted=false group by day order by day`);
  if(series)data.crm.newCustomersSeries=series.map((row)=>({label:row.label,value:asNumber(row.value)}));

  const marketing=await capture("marketing",async()=>{const [row]=await sql<any[]>`select count(*)::int campaigns,count(*) filter(where status='scheduled')::int scheduled,count(*) filter(where due_at<now() and status not in ('completed','archived'))::int delayed from marketing.campaigns where is_deleted=false`;return row;});
  if(marketing)data.marketing={campaigns:asNumber(marketing.campaigns),scheduled:asNumber(marketing.scheduled),delayed:asNumber(marketing.delayed)};
  const tracking=await capture("tracking",async()=>{const [row]=await sql<any[]>`select count(*) filter(where coalesce(is_archived,false)=false)::int requests,count(*) filter(where coalesce(is_archived,false)=false and status='in_progress')::int in_progress,count(*) filter(where coalesce(is_archived,false)=true)::int completed from tracking.orders where coalesce(is_deleted,false)=false`;return row;});
  if(tracking)data.tracking={requests:asNumber(tracking.requests),inProgress:asNumber(tracking.in_progress),completed:asNumber(tracking.completed)};

  const inventory=await capture("operations.inventory",async()=>{const [row]=await sql<any[]>`
    select count(*) filter(where v.is_deleted=false and v.archived_at is null and coalesce(s.is_inventory,true))::int actual_total,
      count(*) filter(where v.is_deleted=false and v.archived_at is null and l.code='agency' and coalesce(s.is_inventory,true))::int agency,
      count(*) filter(where v.is_deleted=false and v.archived_at is null and v.status_code='available_for_sale')::int available_for_sale,
      count(*) filter(where v.is_deleted=false and v.archived_at is null and v.status_code='under_delivery')::int under_delivery,
      count(*) filter(where v.is_deleted=false and v.archived_at is null and (v.has_notes=true or v.status_code='has_notes'))::int has_notes
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code`;
    return row;
  });
  if(inventory)data.operations.inventory={actualTotal:asNumber(inventory.actual_total),agency:asNumber(inventory.agency),availableForSale:asNumber(inventory.available_for_sale),underDelivery:asNumber(inventory.under_delivery),hasNotes:asNumber(inventory.has_notes)};

  const locations=await capture("operations.locations",()=>sql<any[]>`
    select l.code key,l.name,
      count(v.id) filter(where v.is_deleted=false and v.archived_at is null and coalesce(s.is_inventory,true))::int actual_total,
      count(v.id) filter(where v.status_code='under_delivery' and v.is_deleted=false and v.archived_at is null)::int under_delivery,
      count(v.id) filter(where v.status_code='available_for_sale' and v.is_deleted=false and v.archived_at is null)::int available_for_sale,
      count(v.id) filter(where v.status_code='reserved' and v.is_deleted=false and v.archived_at is null)::int reserved,
      count(v.id) filter(where v.status_code='delivered' and v.is_deleted=false and v.archived_at is null)::int delivered,
      count(v.id) filter(where (v.has_notes=true or v.status_code='has_notes') and v.is_deleted=false and v.archived_at is null)::int has_notes
    from operations.locations l left join operations.vehicles v on v.location_id=l.id left join operations.vehicle_statuses s on s.code=v.status_code where l.is_active=true group by l.code,l.name,l.sort_order order by l.sort_order`);
  if(locations)data.operations.locations=data.operations.locations.map((base)=>{const found=locations.find((row)=>row.key===base.key||row.name===base.name);return found?{key:found.key,name:found.name,actualTotal:asNumber(found.actual_total),underDelivery:asNumber(found.under_delivery),availableForSale:asNumber(found.available_for_sale),reserved:asNumber(found.reserved),delivered:asNumber(found.delivered),hasNotes:asNumber(found.has_notes)}:base;});

  const approvals=await capture("operations.approvals",async()=>{const [row]=await sql<any[]>`
    select count(*)::int total,count(*) filter(where c.financial_approved=false)::int missing_financial,
      count(*) filter(where c.administrative_approved=false)::int missing_administrative,
      count(*) filter(where c.financial_approved=true and c.administrative_approved=true)::int completed
    from operations.vehicle_approval_cycles c join operations.vehicles v on v.id=c.vehicle_id
    where c.is_active=true and v.status_code='under_delivery' and v.is_deleted=false and v.archived_at is null`;return row;});
  if(approvals)data.operations.approvals={total:asNumber(approvals.total),missingFinancial:asNumber(approvals.missing_financial),missingAdministrative:asNumber(approvals.missing_administrative),completed:asNumber(approvals.completed)};

  const shortages=await capture("operations.shortages",async()=>{const [row]=await sql<any[]>`select count(*) filter(where s.is_resolved=false)::int total,count(*) filter(where s.is_resolved=false and l.code='multaqa')::int multaqa,count(*) filter(where s.is_resolved=false and l.code='hall')::int hall,count(*) filter(where s.is_resolved=false and l.code='qadisiyah')::int qadisiyah from operations.vehicle_shortages s join operations.vehicles v on v.id=s.vehicle_id left join operations.locations l on l.id=v.location_id`;return row;});
  if(shortages)data.operations.shortages={total:asNumber(shortages.total),multaqa:asNumber(shortages.multaqa),hall:asNumber(shortages.hall),qadisiyah:asNumber(shortages.qadisiyah)};

  const transfers=await capture("operations.transfers",async()=>{const [row]=await sql<any[]>`
    select count(*) filter(where status in ('request_received','vehicle_sent','vehicle_received'))::int total,
      count(*) filter(where status='request_received')::int request_received,count(*) filter(where status='vehicle_received')::int vehicle_received,
      count(*) filter(where status='vehicle_sent')::int vehicle_sent,count(*) filter(where status='completed')::int completed
    from operations.transfer_requests where coalesce(transfer_type,'transfer')='transfer'`;return row;});
  if(transfers)data.operations.transfers={total:asNumber(transfers.total),requestReceived:asNumber(transfers.request_received),vehicleReceived:asNumber(transfers.vehicle_received),vehicleSent:asNumber(transfers.vehicle_sent),completed:asNumber(transfers.completed)};

  const salesTracking=await capture("operations.tracking",async()=>{const [row]=await sql<any[]>`select count(*) filter(where coalesce(is_archived,false)=false)::int total,count(*) filter(where coalesce(is_archived,false)=false and status='not_started')::int not_started,count(*) filter(where coalesce(is_archived,false)=false and status='in_progress')::int in_progress,count(*) filter(where coalesce(is_archived,false)=true)::int completed from tracking.orders where coalesce(is_deleted,false)=false`;return row;});
  if(salesTracking)data.operations.salesTracking={total:asNumber(salesTracking.total),notStarted:asNumber(salesTracking.not_started),inProgress:asNumber(salesTracking.in_progress),completed:asNumber(salesTracking.completed)};

  data.sectionErrors=errors;data.generatedAt=new Date().toISOString();return data;
}
