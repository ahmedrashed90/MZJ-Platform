import { getSql } from "./_db.js";
import type { SessionUser } from "./_auth.js";
import { canAccessAllOperationsBranches } from "./_operations-auth.js";

export async function getOperationsVehicleDetail(id: string, user: SessionUser) {
  const sql = getSql();
  const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);
  const [vehicle] = await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,v.plate_no,
      v.batch_no,v.location_id::text,v.branch_code,v.status_code,v.status_note,v.source_type,v.has_notes,v.notes,
      v.reservation_shortage_location_note,v.is_archived,v.archived_at,v.archive_reason,v.created_at,v.updated_at,v.version,
      l.code as location_code,l.name as location_name,l.location_type,
      s.name as status_name,s.requires_status_note,s.starts_delivery_cycle,s.is_final_delivery,
      cu.full_name as created_by_name,uu.full_name as updated_by_name
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join core.users cu on cu.id=v.created_by
    left join core.users uu on uu.id=v.updated_by
    where v.id=${id}::uuid and v.is_deleted=false
      and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
  `;
  if (!vehicle) return null;

  const [checks, checkHistory, noteHistory, movements, requests, approvals, approvalEvents, tracking] = await Promise.all([
    sql<any[]>`
      select i.code,i.name,i.sort_order,coalesce(c.status,'unknown') as status,c.note,c.updated_at,u.full_name as updated_by_name
      from operations.check_items i
      left join operations.vehicle_checks c on c.item_code=i.code and c.vehicle_id=${id}::uuid
      left join core.users u on u.id=c.updated_by
      where i.is_active=true order by i.sort_order
    `,
    sql<any[]>`
      select h.id::text,h.item_code,i.name as item_name,h.old_status,h.new_status,h.old_note,h.new_note,h.created_at,u.full_name as changed_by_name
      from operations.vehicle_check_history h join operations.check_items i on i.code=h.item_code
      left join core.users u on u.id=h.changed_by where h.vehicle_id=${id}::uuid order by h.created_at desc limit 100
    `,
    sql<any[]>`
      select n.id::text,n.note_type,n.note,n.created_at,u.full_name as created_by_name
      from operations.vehicle_notes n left join core.users u on u.id=n.created_by
      where n.vehicle_id=${id}::uuid order by n.created_at desc limit 100
    `,
    sql<any[]>`
      select m.id::text,m.batch_id::text,m.request_id::text,m.old_status,m.new_status,m.note,m.status_note,m.reservation_shortage_location_note,
        m.performed_by_name,m.performed_role,m.performed_branch,m.created_at,fl.name as from_location,tl.name as to_location
      from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
      where m.vehicle_id=${id}::uuid order by m.created_at desc limit 100
    `,
    sql<any[]>`
      select r.id::text,r.request_no,r.request_type,r.status,r.requested_at,r.completed_at,r.cancelled_at,r.notes,
        sl.name as source_location,dl.name as destination_location
      from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
      left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
      where rv.vehicle_id=${id}::uuid and r.is_deleted=false order by r.requested_at desc limit 100
    `,
    sql<any[]>`
      select a.id::text,a.delivery_cycle_id::text,a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,
        a.financial_approved_at,a.administrative_approved_at,a.financial_reverted_at,a.administrative_reverted_at,a.created_at,a.updated_at,
        fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name
      from operations.vehicle_approvals a left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
      where a.vehicle_id=${id}::uuid order by a.created_at desc limit 20
    `,
    sql<any[]>`
      select e.id::text,e.approval_type,e.action,e.actor_name,e.reason,e.before_data,e.after_data,e.created_at
      from operations.approval_events e where e.vehicle_id=${id}::uuid order by e.created_at desc limit 100
    `,
    sql<any[]>`
      select t.tracking_request_id::text,t.tracking_vehicle_id::text,t.request_no,t.status,t.is_archived,t.is_deleted,t.progress,t.current_stage_order,t.created_at,t.updated_at
      from operations.vehicle_tracking_summary t where t.vehicle_id=${id}::uuid
      order by case when t.status in ('not_started','in_progress') and not t.is_archived then 0 else 1 end,t.updated_at desc
    `,
  ]);

  return { ...vehicle, checks, checkHistory, noteHistory, movements, requests, approvals, approvalEvents, tracking };
}
